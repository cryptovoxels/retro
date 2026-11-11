import lua from 'luaparse'

function expect(ok, message) {
  if (!ok) throw Error('critter rig: ' + message)
}
function fields(node) {
  expect(node?.type === 'TableConstructorExpression', 'expected a named table')
  const out = new Map()
  for (const f of node.fields) {
    expect(f.type === 'TableKeyString' && !out.has(f.key.name), 'expected unique named fields')
    out.set(f.key.name, f.value)
  }
  return out
}
function returned(body) {
  expect(body?.length === 1 && body[0].type === 'ReturnStatement' && body[0].arguments.length === 1, 'expected one return')
  return body[0].arguments[0]
}
function literal(n) {
  if (n.type === 'TableConstructorExpression')
    return n.fields.map((f) => {
      expect(f.type === 'TableValue', 'expected a list')
      return literal(f.value)
    })
  if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'NumericLiteral') return -n.argument.value
  expect(['StringLiteral', 'BooleanLiteral', 'NumericLiteral'].includes(n.type), 'expected a literal')
  return n.value
}
function scalar(n) {
  if (n.type === 'NumericLiteral' && Number.isFinite(n.value)) return String(n.value)
  if (n.type === 'Identifier' && n.name === 'phase') return 'phase'
  if (n.type === 'MemberExpression' && n.indexer === '.' && ['pos', 'rot'].includes(n.base.name) && ['X', 'Y', 'Z'].includes(n.identifier.name)) return n.base.name + '.' + n.identifier.name.toLowerCase()
  if (n.type === 'UnaryExpression' && n.operator === '-') return '(-' + scalar(n.argument) + ')'
  if (n.type === 'BinaryExpression' && ['+', '-', '*'].includes(n.operator)) return '(' + scalar(n.left) + n.operator + scalar(n.right) + ')'
  if (n.type === 'CallExpression' && n.base.type === 'MemberExpression' && n.base.indexer === '.' && n.base.base.name === 'math' && ['sin', 'cos'].includes(n.base.identifier.name) && n.arguments.length === 1)
    return 'Math.' + n.base.identifier.name + '(' + scalar(n.arguments[0]) + ')'
  throw Error('critter rig: unsupported expression ' + n.type)
}
export function compileRig(source) {
  const rig = fields(returned(lua.parse(source, { encodingMode: 'pseudo-latin1' }).body))
  const parts = []
  const slots = new Map()
  for (const [name, definition] of fields(rig.get('parts'))) {
    const part = { name }
    slots.set(name, parts.length)
    for (const [key, n] of fields(definition)) {
      expect(['asset', 'position', 'offset', 'mirror', 'parent'].includes(key), 'unknown part field ' + key)
      const v = literal(n)
      if (key === 'parent') expect(slots.has(v) && v !== name, 'declare parent first')
      else if (key === 'asset') expect([v].flat().length && [v].flat().every((s) => typeof s === 'string' && /^[a-z0-9-]+$/.test(s)), 'invalid asset name')
      else if (key === 'mirror') expect(typeof v === 'boolean', 'mirror expects boolean')
      else expect(Array.isArray(v) && v.length === 3 && v.every(Number.isFinite), 'expected three numbers')
      part[key] = key === 'parent' ? slots.get(v) : v
    }
    expect(part.asset, 'missing asset')
    parts.push(part)
  }
  const fn = rig.get('animate')
  expect(fn?.type === 'FunctionDeclaration' && fn.parameters.map((p) => p.name).join(',') === 'pos,rot,phase', 'expected animate(pos, rot, phase)')
  const lines = []
  for (const [part, pose] of fields(returned(fn.body))) {
    expect(slots.has(part), 'unknown part ' + part)
    for (const [field, n] of fields(pose)) {
      expect(['position', 'rotation'].includes(field), 'unknown transform ' + field)
      const target = 'nodes[' + slots.get(part) + '].' + field
      if (n.type === 'Identifier' && ['pos', 'rot'].includes(n.name)) lines.push(target + '.copyFrom(' + n.name + ')')
      else {
        expect(n.type === 'CallExpression' && n.base.type === 'MemberExpression' && n.base.indexer === '.' && n.base.base.name === 'Vector3' && n.base.identifier.name === 'new' && n.arguments.length === 3, 'expected Vector3.new')
        lines.push(target + '.set(' + n.arguments.map(scalar).join(',') + ')')
      }
    }
  }
  return 'export const parts = ' + JSON.stringify(parts) + '\nexport function animate(nodes,pos,rot,phase){\n' + lines.join('\n') + '\n}'
}
