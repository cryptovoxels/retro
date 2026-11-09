import assert from 'assert'
import type { Response } from 'express'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { QueryConfig } from 'pg'
import { isPlural } from 'pluralize'
import { noCache } from '../cache'
import { Db } from '../pg'
import type { VoxelsUserRequest } from '../user'
import log from './logger'

// simple in-mem cache
const QUERY_CACHE = new Map<string, string>()

async function loadQueryFile(queryName: string): Promise<string> {
  let cached = QUERY_CACHE.get(queryName)
  if (cached) return cached

  // /Users/ben/Projects/classic/server/queries/stats/get-worn-wearable-by-wallet.sql

  const filePath = path.join(process.cwd(), 'server/queries', `${queryName}.sql`)
  const text = await readFile(filePath, 'utf8')

  QUERY_CACHE.set(queryName, text)
  return text
}

export function createRequestHandlerForQuery(db: Db, queryName: string, fieldName?: string, argumentMapper?: (req: VoxelsUserRequest) => any[] | null): (req: VoxelsUserRequest, res: Response) => void {
  return async (req, res) => {
    try {
      const args = argumentMapper ? argumentMapper(req) : []

      if (args === null) {
        const r: any = { success: false, error: 'Invalid arguments' }
        if (fieldName) r[fieldName] = []
        return res.status(400).json(r)
      }

      const result = await query(db, queryName, fieldName, args)

      if (result.success) {
        if (fieldName && result[fieldName] && !Array.isArray(result[fieldName]) && result[fieldName].updated_at) {
          const lastModified = new Date(result[fieldName].updated_at)
          if (!isNaN(lastModified.getTime())) {
            res.setHeader('Last-Modified', lastModified.toUTCString())
          }
        }

        return res.status(200).json(result)
      }
    } catch (e: any) {
      const errorDetails: any = {
        error: e?.toString(),
        query: queryName,
        arguments: argumentMapper ? argumentMapper(req) : [],
        request: {
          url: req.url,
          method: req.method,
          ip: (req as any).ip,
          params: req.params,
          query: req.query,
          user: req.user?.wallet || 'anonymous',
        },
      }

      for (const k of ['message', 'code', 'detail', 'hint', 'position', 'where', 'table', 'column', 'constraint']) {
        if (e?.[k]) errorDetails[k] = e[k]
      }

      log.error(`Database query failed for ${queryName}:`, errorDetails)
    }

    noCache(res)
    res.status(400).json({ success: false })
  }
}

type Row = Record<string, any>

export function queryAndCallback<T extends Row = any, Field extends string = string>(
  db: Db,
  queryName: string,
  fieldName: Field = 'results' as any,
  args: any[],
  callback: (result: ({ [key in Field]: T } & { success: true }) | { success: false; err?: unknown }) => void,
) {
  query<T, Field>(db, queryName, fieldName, args)
    .then(callback)
    .catch(() => callback({ success: false }))
}

export async function query<T extends Row | Row[] = any, Field extends string = string>(
  db: Db,
  queryName: string,
  fieldName: Field = 'results' as any,
  args: any[],
): Promise<({ [key in Field]: T } & { success: true }) | { success: false }> {
  assert(queryName)

  const sql = await loadQueryFile(queryName)

  try {
    const queryConfig: QueryConfig<any[]> = {
      text: sql,
      name: queryName,
      values: args,
    }

    const queryResult = await db.query<T>(queryConfig)

    const field = isPlural(fieldName) ? queryResult.rows : queryResult.rows[0]

    return field ? { success: true, [fieldName]: field } : { success: false }
  } catch (err: any) {
    const errorDetails: any = {
      error: err.toString(),
      query: queryName,
      arguments: args,
    }

    for (const k of ['message', 'code', 'detail', 'hint', 'position', 'where', 'table', 'column', 'constraint']) {
      if (err?.[k]) errorDetails[k] = err[k]
    }

    log.error(`Query failed for ${queryName}:`, errorDetails)
    throw err
  }
}
