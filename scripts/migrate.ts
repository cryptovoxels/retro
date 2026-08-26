#!/usr/bin/env tsx
/**
 * AST codemod: babylonjs globals -> @babylonjs/lite + wgpu-matrix.
 *
 * Only three kinds of edits, all provably syntax-safe:
 *   1. type positions: BABYLON.X -> lite type or `any`
 *   2. whitelisted expression swaps (whole call/new expressions only)
 *   3. any other BABYLON-rooted expression -> `(undefined as any /* todo(lite): original *\/)`
 *
 * A node that gets edited is never recursed into, so edits can't overlap.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'

const SRC = path.join(__dirname, '..', 'src')

// BABYLON.X used in *type* position -> lite type name (anything missing -> any)
const TYPE_MAP: Record<string, string> = {
  Scene: 'SceneContext',
  Engine: 'EngineContext',
  ThinEngine: 'EngineContext',
  AbstractEngine: 'EngineContext',
  WebGPUEngine: 'EngineContext',
  Vector2: 'Vec2',
  Vector3: 'Vec3',
  Quaternion: 'Quat',
  Matrix: 'Mat4',
  Color3: 'Color3',
  Color4: 'Color4',
  Mesh: 'Mesh',
  AbstractMesh: 'Mesh',
  InstancedMesh: 'Mesh',
  GroundMesh: 'Mesh',
  TransformNode: 'TransformNode',
  Node: 'TransformNode',
  Camera: 'Camera',
  TargetCamera: 'Camera',
  FreeCamera: 'FreeCamera',
  ArcRotateCamera: 'ArcRotateCamera',
  StandardMaterial: 'StandardMaterialProps',
  PBRMaterial: 'PbrMaterialProps',
  Material: 'Material',
  ShaderMaterial: 'ShaderMaterial',
  Texture: 'Texture2D',
  DynamicTexture: 'DynamicTexture2D',
  CubeTexture: 'CubeTexture',
  HemisphericLight: 'HemisphericLight',
  DirectionalLight: 'DirectionalLight',
  SpotLight: 'SpotLight',
  PointLight: 'PointLight',
  Light: 'LightBase',
  ShadowGenerator: 'ShadowGenerator',
  AnimationGroup: 'AnimationGroup',
  AssetContainer: 'AssetContainer',
  PickingInfo: 'PickingInfo',
}

// names importable from @babylonjs/lite (verified against index.d.ts)
const LITE_NAMES = new Set([
  ...Object.values(TYPE_MAP).filter((n) => n !== 'any'),
  'Mat4',
  'PbrMaterialProps',
  'LightBase',
  'SceneNode',
  'onBeforeRender',
])

const WGPU_NAMES = new Set(['vec3', 'quat', 'mat4', 'vec2'])

type Edit = { start: number; end: number; text: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p)
  }
  return out
}

/** leftmost identifier of a property/element/call/new/as/paren chain */
function leftmostId(node: ts.Expression): string | null {
  let cur: ts.Expression = node
  for (;;) {
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) cur = cur.expression
    else if (ts.isCallExpression(cur) || ts.isNewExpression(cur)) {
      if (!cur.expression) return null
      cur = cur.expression
    } else if (ts.isAsExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur)) cur = cur.expression
    else if (ts.isIdentifier(cur)) return cur.text
    else return null
  }
}

function isBabylonRooted(node: ts.Expression): boolean {
  return leftmostId(node) === 'BABYLON'
}

/** `BABYLON.Type.member` -> { type, member }, else null */
function staticRef(expr: ts.Expression): { type: string; member: string } | null {
  if (!ts.isPropertyAccessExpression(expr)) return null
  const inner = expr.expression
  if (!ts.isPropertyAccessExpression(inner)) return null
  if (!ts.isIdentifier(inner.expression) || inner.expression.text !== 'BABYLON') return null
  return { type: inner.name.text, member: expr.name.text }
}

function sanitize(text: string): string {
  return text.replace(/\*\//g, '*\\/')
}

function todoComment(orig: string): string {
  return `/* todo(lite): ${sanitize(orig)} */`
}

/** stub a BABYLON expression; semicolon when it's its own statement (ASI trap otherwise) */
function stubExpr(node: ts.Node, sf: ts.SourceFile): string {
  const text = `(undefined as any ${todoComment(node.getText(sf))})`
  const p = node.parent
  if (p && ts.isExpressionStatement(p) && p.expression === node) return `${text};`
  return text
}

function mapTypeText(node: ts.TypeNode, sf: ts.SourceFile): string {
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText(sf)
    if (name === 'BABYLON.Nullable') {
      const inner = node.typeArguments?.[0]
      return inner ? `(${mapTypeText(inner, sf)} | null)` : 'any'
    }
    if (name.startsWith('BABYLON.')) {
      // BABYLON.X or BABYLON.GUI.X etc
      const parts = name.split('.')
      const mapped = parts.length === 2 ? (TYPE_MAP[parts[1]] ?? 'any') : 'any'
      if (mapped === 'any') return 'any' // drop type args, any<T> is invalid
      if (node.typeArguments?.length) {
        const args = node.typeArguments.map((t) => mapTypeText(t, sf)).join(', ')
        return `${mapped}<${args}>`
      }
      return mapped
    }
    // non-BABYLON generic (Promise<BABYLON.X>, Array<BABYLON.X>, ...): map the args
    if (node.typeArguments?.length && /\bBABYLON\b/.test(node.getText(sf))) {
      const args = node.typeArguments.map((t) => mapTypeText(t, sf)).join(', ')
      return `${name}<${args}>`
    }
  }
  if (ts.isTypeQueryNode(node) && node.exprName.getText(sf).startsWith('BABYLON')) return 'any'
  if (ts.isArrayTypeNode(node)) return `${mapTypeText(node.elementType, sf)}[]`
  if (ts.isUnionTypeNode(node)) return node.types.map((t) => mapTypeText(t, sf)).join(' | ')
  return node.getText(sf)
}

/** whole-expression whitelist. returns replacement text + needed imports, or null */
function whitelist(node: ts.Expression, sf: ts.SourceFile): string | null {
  const argText = (args: readonly ts.Expression[] | undefined) => (args ?? []).map((a) => a.getText(sf)).join(', ')

  if (ts.isNewExpression(node) && isBabylonRooted(node)) {
    const name = node.expression.getText(sf)
    const args = node.arguments
    const a = argText(args)
    switch (name) {
      case 'BABYLON.Vector3':
        return args?.length ? `vec3.fromValues(${a})` : 'vec3.create()'
      case 'BABYLON.Quaternion':
        return args?.length ? `quat.fromValues(${a})` : 'quat.identity()'
      case 'BABYLON.Vector2':
        return args?.length === 2 ? `({ x: ${args[0].getText(sf)}, y: ${args[1].getText(sf)} } as Vec2)` : null
      case 'BABYLON.Color3':
        return args?.length ? `([${a}] as Color3)` : '([0, 0, 0] as Color3)'
      case 'BABYLON.Color4':
        return args?.length ? `([${a}] as Color4)` : '([0, 0, 0, 0] as Color4)'
    }
    return null
  }

  if (ts.isCallExpression(node)) {
    // BABYLON.Angle.FromDegrees(d).radians()
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'radians' &&
      ts.isCallExpression(node.expression.expression)
    ) {
      const inner = node.expression.expression
      const ref = staticRef(inner.expression)
      if (ref?.type === 'Angle' && ref.member === 'FromDegrees') {
        return `((${inner.arguments[0]?.getText(sf) ?? '0'}) * Math.PI / 180)`
      }
    }

    const ref = staticRef(node.expression)
    if (ref) {
      const a = argText(node.arguments)
      const key = `${ref.type}.${ref.member}`
      switch (key) {
        case 'Vector3.Zero':
          return 'vec3.create()'
        case 'Vector3.One':
          return 'vec3.fromValues(1, 1, 1)'
        case 'Vector3.Up':
          return 'vec3.fromValues(0, 1, 0)'
        case 'Vector3.Distance':
          return `vec3.distance(${a})`
        case 'Vector3.DistanceSquared':
          return `vec3.distanceSq(${a})`
        case 'Vector3.Dot':
          return `vec3.dot(${a})`
        case 'Vector3.Cross':
          return `vec3.cross(${a})`
        case 'Vector3.Lerp':
          return `vec3.lerp(${a})`
        case 'Vector3.FromArray':
          return `vec3.clone(${a} as any)`
        case 'Quaternion.Identity':
          return 'quat.identity()'
        case 'Quaternion.Zero':
          return 'quat.create()'
        case 'Quaternion.Slerp':
          return `quat.slerp(${a})`
        case 'Quaternion.FromEulerAngles':
          return `quat.fromEuler(${a}, 'yxz') /* todo(lite): verify euler order */`
        case 'Matrix.Identity':
          return 'mat4.identity()'
        case 'Color3.Black':
          return '([0, 0, 0] as Color3)'
        case 'Color3.White':
          return '([1, 1, 1] as Color3)'
        case 'Color3.Red':
          return '([1, 0, 0] as Color3)'
        case 'Color3.Green':
          return '([0, 1, 0] as Color3)'
        case 'Color3.Blue':
          return '([0, 0, 1] as Color3)'
        case 'Color3.Gray':
          return '([0.5, 0.5, 0.5] as Color3)'
        case 'Tools.ToRadians':
          return `((${a}) * Math.PI / 180)`
        case 'Tools.ToDegrees':
          return `((${a}) * 180 / Math.PI)`
      }
      return null
    }

    // scene.onBeforeRenderObservable.add(fn) -> onBeforeRender(scene, fn)
    if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'add') {
      const obs = node.expression.expression
      if (ts.isPropertyAccessExpression(obs) && obs.name.text === 'onBeforeRenderObservable' && node.arguments.length >= 1) {
        const target = obs.expression.getText(sf)
        // only safe when the observable target is a scene-ish local; lite signature is onBeforeRender(scene, fn)
        return `onBeforeRender(${target}, ${node.arguments[0].getText(sf)})`
      }
    }
    return null
  }

  // property constants
  if (ts.isPropertyAccessExpression(node)) {
    const ref = staticRef(node)
    if (ref) {
      const key = `${ref.type}.${ref.member}`
      switch (key) {
        case 'Axis.X':
          return 'vec3.fromValues(1, 0, 0)'
        case 'Axis.Y':
          return 'vec3.fromValues(0, 1, 0)'
        case 'Axis.Z':
          return 'vec3.fromValues(0, 0, 1)'
      }
    }
  }

  return null
}

function migrate(filePath: string): boolean {
  const original = fs.readFileSync(filePath, 'utf8')
  if (!original.includes('BABYLON')) return false

  const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(filePath, original, ts.ScriptTarget.Latest, true, kind)
  const edits: Edit[] = []

  const push = (node: ts.Node, text: string) => edits.push({ start: node.getStart(sf), end: node.getEnd(), text })

  function visit(node: ts.Node): void {
    // ---- type positions ----
    // only intercept when the type itself is BABYLON.X; nested cases like
    // Promise<BABYLON.X> are caught by recursing into the type arguments
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(sf).startsWith('BABYLON.')) {
      push(node, mapTypeText(node, sf))
      return // no recursion into replaced node
    }
    if (ts.isTypeQueryNode(node) && node.exprName.getText(sf).startsWith('BABYLON')) {
      push(node, 'any')
      return
    }

    // ---- heritage clauses: only when the base itself is a BABYLON class ----
    if (ts.isHeritageClause(node) && node.types.some((t) => isBabylonRooted(t.expression))) {
      const clauseText = node.getText(sf)
      const parent = node.parent
      if (node.token === ts.SyntaxKind.ExtendsKeyword && (ts.isClassDeclaration(parent) || ts.isClassExpression(parent))) {
        // keep the class constructible so modules still load
        push(node, `extends (Object as any) ${todoComment(clauseText)}`)
      } else {
        // implements X / interface extends X: drop the clause
        push(node, todoComment(clauseText))
      }
      return
    }

    if (ts.isExpression(node)) {
      // ---- instanceof BABYLON.X -> false ----
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
        isBabylonRooted(node.right)
      ) {
        push(node, `(false ${todoComment(node.getText(sf))})`)
        return
      }

      // ---- whitelisted swaps ----
      const wl = whitelist(node, sf)
      if (wl) {
        push(node, wl)
        return
      }

      // ---- assignment with BABYLON-rooted LHS: nuke whole assignment ----
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        isBabylonRooted(node.left)
      ) {
        push(node, stubExpr(node, sf))
        return
      }

      // ---- any other BABYLON-rooted expression ----
      // (skip identifiers that are just the `.name` side of a property access)
      const isPropName = ts.isIdentifier(node) && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
      if (!isPropName && isBabylonRooted(node)) {
        push(node, stubExpr(node, sf))
        return
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sf)
  if (!edits.length) return false

  let result = original
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, e.start) + e.text + result.slice(e.end)
  }

  // ---- imports: scan identifiers of the result (comments excluded by parsing) ----
  const sf2 = ts.createSourceFile(filePath, result, ts.ScriptTarget.Latest, true, kind)
  const used = new Set<string>()
  const importedAlready = new Set<string>()
  const collect = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) {
      n.importClause?.namedBindings?.forEachChild((b) => {
        if (ts.isImportSpecifier(b)) importedAlready.add(b.name.text)
      })
      if (n.importClause?.name) importedAlready.add(n.importClause.name.text)
      return
    }
    if (ts.isIdentifier(n)) used.add(n.text)
    ts.forEachChild(n, collect)
  }
  collect(sf2)

  const liteNeeded = [...LITE_NAMES].filter((n) => used.has(n) && !importedAlready.has(n)).sort()
  const wgpuNeeded = [...WGPU_NAMES].filter((n) => used.has(n) && !importedAlready.has(n)).sort()

  const importLines: string[] = []
  if (liteNeeded.length) importLines.push(`import { ${liteNeeded.join(', ')} } from '@babylonjs/lite'`)
  if (wgpuNeeded.length) importLines.push(`import { ${wgpuNeeded.join(', ')} } from 'wgpu-matrix'`)

  if (importLines.length) {
    const lines = result.split('\n')
    let insertAt = 0
    for (let i = 0; i < Math.min(lines.length, 100); i++) {
      if (/^import\b/.test(lines[i])) insertAt = i + 1
    }
    lines.splice(insertAt, 0, ...importLines)
    result = lines.join('\n')
  }

  if (result !== original) {
    fs.writeFileSync(filePath, result)
    return true
  }
  return false
}

const files = walk(SRC)
let changed = 0
for (const f of files) {
  try {
    if (migrate(f)) {
      changed++
      console.log('migrated', path.relative(SRC, f))
    }
  } catch (e) {
    console.error('FAILED', path.relative(SRC, f), e)
  }
}
console.log(`done: ${changed}/${files.length} files`)
