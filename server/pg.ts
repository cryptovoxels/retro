import { userInfo } from 'os'
import { performance } from 'perf_hooks'
import { Pool, PoolClient, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow } from 'pg'
import PgPromise from 'pg-promise'
import { named } from './lib/logger'

const log = named('postgres')

function since(startTime: number): number {
  return (performance.now() - startTime) / 1000.0
}

function errorLog<I extends any[] = any[]>(startTime: number, err: any, queryTextOrConfig: QueryConfig<I>) {
  log.error(`(${since(startTime).toFixed(2)}sec) '${err.toString()}': ${toLine(queryTextOrConfig)}`)
}

// converts a string into a one line string
const toLine = <I extends any[] = any[]>(sql: QueryConfig<I>): string => {
  let result = ''
  try {
    result = sql.text
      // remove Unicode line break characters
      .replace(/[/[\r\n\x0B\x0C\u0085\u2028\u2029]+/g, ' ')
      // remove double whitespaces
      .replace(/\s+/g, ' ')
      .trim()
  } catch (err) {}
  return result
}

const connectionString = process.env.DATABASE_URL || `postgres://localhost/voxels`
console.log('connectionString', connectionString)

// Convert postgresql:// to postgres:// if needed, DO uses postgresql in their connection strings
const formattedConnectionString = connectionString.replace(/^postgresql:\/\//, 'postgres://')
// Enable SSL for production databases (DigitalOcean, etc.) but disable for local development
const isLocalhost = formattedConnectionString.includes('localhost') || formattedConnectionString.includes('127.0.0.1')
const sslConfig = isLocalhost ? false : { rejectUnauthorized: false }
const pool = new Pool({ connectionString: formattedConnectionString, max: 20, ssl: sslConfig })

// Based on https://node-postgres.com/features/pooling#examples.
// the pool will emit an error on behalf of any idle clients
// it contains if a backend error or network partition happens
pool.on('error', (err, client) => {
  console.error(`Unexpected error on idle PostgreSQL client with ${client.listenerCount} listeners:`, err)
  process.exit(100) // Without this, Node would crash with a terse error message anyway
})
// unfortunately any clients using this function will not be logged or sent to metrics
const connect = (): Promise<PoolClient> => pool.connect()

// this class mimics and wraps the pg query calls to add logging of failing queries and or debug information if ENV var `DEBUG_LOG=true`
// Specifying the client is only supported via one of the two overloads, but no one calls the other one anyway.
function query<R extends QueryResultRow = any, I extends any[] = any[]>(queryConfig: QueryConfig<I>): Promise<QueryResult<R>>
function query<R extends QueryResultRow = any, I extends any[] = any[]>(queryName: string, queryText: string, values?: I, dbClient?: PoolClient): Promise<QueryResult<R>>
function query<R extends QueryResultRow = any, I extends any[] = any[]>(queryConfigOrName: string | QueryConfig<I>, queryText?: string, values?: I, dbClient?: PoolClient): Promise<QueryResult<R>> {
  const queryConfig = resolveQueryConfig(queryConfigOrName, queryText || null, values || null)
  const totalStartTime = performance.now()

  const connectStartTime = performance.now()
  const specifiedOrAnyClient = dbClient ? Promise.resolve(dbClient) : pool.connect()

  const SHOW_QUERY_DEBUG = false

  return specifiedOrAnyClient
    .then((client) => {
      const connectDuration = performance.now() - connectStartTime
      if (SHOW_QUERY_DEBUG && connectDuration > 100) {
        log.debug(`[DB] Connection acquisition took ${connectDuration.toFixed(1)}ms (pool stats: total=${pool.totalCount}, idle=${pool.idleCount}, waiting=${pool.waitingCount})`)
      }

      const queryStartTime = performance.now()

      // no callback, return promise
      return client
        .query(queryConfig)
        .then((res) => {
          const totalDuration = performance.now() - totalStartTime

          if (SHOW_QUERY_DEBUG && totalDuration > 100) {
            log.debug(`SLOW QUERY (connect=${connectDuration.toFixed(1)}ms, query=${(totalDuration - connectDuration).toFixed(1)}ms, total=${totalDuration.toFixed(1)}ms, ${res.rowCount} rows): ${toLine(queryConfig)}`)
          }
          return res
        })
        .catch((err) => {
          errorLog(queryStartTime, err, queryConfig)
          return Promise.reject(err)
        })
        .finally(() => {
          if (!dbClient) {
            client.release()
          }
        })
    })
    .catch((err) => {
      log.error(`pg.Pool connection failure: ${err.toString()}`)
      return Promise.reject(err)
    })
}

const resolveQueryConfig = <Values extends any[]>(queryConfigOrName: string | QueryConfig<Values>, queryText: string | null, values: Values | null): QueryConfig<Values> => {
  const queryName: string | undefined = typeof queryConfigOrName === 'string' ? queryConfigOrName : queryConfigOrName.name
  const queryConfig: QueryConfig<Values> = typeof queryConfigOrName === 'string' ? { text: queryText! } : queryConfigOrName

  if (values) {
    queryConfig.values = values as QueryConfigValues<Values>
  }

  const queryHeader = `/*
app: cryptovoxels-main
query: ${queryName || '(unknown)'}
*/
`
  queryConfig.text = queryHeader + queryConfig.text

  return queryConfig
}

// drain the pool of all active clients, disconnect them, and shut down any internal timers in the pool
function drain() {
  pool.end()
}

export type Db = {
  connect: typeof connect
  query: typeof query
  drain: typeof drain
}

const db: Db = {
  connect,
  query,
  drain,
}

export default db

export const pgp = PgPromise()(connectionString)

export type DBPromise = typeof pgp
