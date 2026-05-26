// Static metadata extractor for behaviour Lua source.
// Walks the luaparse AST to find the top-level `behaviour "name" { ... }` call
// and extracts signal/slot/param metadata without running Lua.
//
// Used at save time (cached on the asset) and reused on the client to populate
// the editor wiring dropdowns - same code, one source of truth.

import * as luaparse from 'luaparse'
import type * as ast from 'luaparse'

export type ParamType = 'number' | 'string' | 'boolean'

export type ParamMeta = {
  name: string
  type: ParamType
  default: number | string | boolean
  min?: number
  max?: number
  step?: number
}

export type BehaviourMeta = {
  name: string
  signals: string[]
  slots: string[]
  params: ParamMeta[]
}

const literal = (n: ast.Expression): number | string | boolean | undefined => {
  if (n.type === 'StringLiteral') return n.value
  if (n.type === 'NumericLiteral') return n.value
  if (n.type === 'BooleanLiteral') return n.value
  if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'NumericLiteral') {
    return -n.argument.value
  }
  return undefined
}

const tableFields = (t: ast.TableConstructorExpression): Map<string, ast.Expression> => {
  const out = new Map<string, ast.Expression>()
  for (const f of t.fields) {
    if (f.type === 'TableKeyString') out.set(f.key.name, f.value)
  }
  return out
}

// Find call statement: behaviour "name" { spec } at top level.
const findBehaviourCall = (chunk: ast.Chunk): { name: string; spec: ast.TableConstructorExpression } | null => {
  for (const stmt of chunk.body) {
    if (stmt.type !== 'CallStatement') continue
    const expr = stmt.expression
    if (expr.type !== 'TableCallExpression') continue
    if (expr.arguments.type !== 'TableConstructorExpression') continue
    const inner = expr.base
    if (inner.type !== 'StringCallExpression') continue
    if (inner.base.type !== 'Identifier' || inner.base.name !== 'behaviour') continue
    if (inner.argument.type !== 'StringLiteral') continue
    return { name: inner.argument.value, spec: expr.arguments }
  }
  return null
}

const extractSignals = (spec: Map<string, ast.Expression>): string[] => {
  const sig = spec.get('signals')
  if (!sig || sig.type !== 'TableConstructorExpression') return []
  const out: string[] = []
  for (const f of sig.fields) {
    if (f.type === 'TableValue' && f.value.type === 'StringLiteral') out.push(f.value.value)
  }
  return out
}

const extractSlots = (spec: Map<string, ast.Expression>): string[] => {
  const slots = spec.get('slots')
  if (!slots || slots.type !== 'TableConstructorExpression') return []
  const out: string[] = []
  for (const f of slots.fields) {
    if (f.type === 'TableKeyString') out.push(f.key.name)
  }
  return out
}

// Recognise number(default, opts), string(default), boolean(default) calls.
const extractParam = (name: string, expr: ast.Expression): ParamMeta | null => {
  if (expr.type !== 'CallExpression') return null
  const fn = expr.base
  if (fn.type !== 'Identifier') return null
  const args = expr.arguments

  if (fn.name === 'number') {
    const def = args[0] ? literal(args[0]) : 0
    if (typeof def !== 'number') return null
    const meta: ParamMeta = { name, type: 'number', default: def }
    if (args[1]?.type === 'TableConstructorExpression') {
      const opts = tableFields(args[1])
      const min = opts.get('min')
      const max = opts.get('max')
      const step = opts.get('step')
      if (min) {
        const v = literal(min)
        if (typeof v === 'number') meta.min = v
      }
      if (max) {
        const v = literal(max)
        if (typeof v === 'number') meta.max = v
      }
      if (step) {
        const v = literal(step)
        if (typeof v === 'number') meta.step = v
      }
    }
    return meta
  }
  if (fn.name === 'text') {
    const def = args[0] ? literal(args[0]) : ''
    if (typeof def !== 'string') return null
    return { name, type: 'string', default: def }
  }
  if (fn.name === 'boolean') {
    const def = args[0] ? literal(args[0]) : false
    if (typeof def !== 'boolean') return null
    return { name, type: 'boolean', default: def }
  }
  return null
}

const extractParams = (spec: Map<string, ast.Expression>): ParamMeta[] => {
  const params = spec.get('params')
  if (!params || params.type !== 'TableConstructorExpression') return []
  const out: ParamMeta[] = []
  for (const f of params.fields) {
    if (f.type !== 'TableKeyString') continue
    const meta = extractParam(f.key.name, f.value)
    if (meta) out.push(meta)
  }
  return out
}

// Throws on parse errors. Throws on missing behaviour() call.
export const parseBehaviourMeta = (source: string): BehaviourMeta => {
  const chunk = luaparse.parse(source, { luaVersion: '5.3' })
  const found = findBehaviourCall(chunk)
  if (!found) throw new Error('No behaviour "name" { ... } call found at top level')
  const spec = tableFields(found.spec)
  return {
    name: found.name,
    signals: extractSignals(spec),
    slots: extractSlots(spec),
    params: extractParams(spec),
  }
}
