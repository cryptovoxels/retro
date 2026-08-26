import type { Mesh } from '@babylonjs/lite'
import { vec3 } from 'wgpu-matrix'
import { patchVec3 } from './vec3-compat'

export function stubMesh(name = 'stub'): Mesh {
  const vertexData: Record<string, Float32Array | number[]> = {}
  return {
    name,
    material: null,
    parent: null,
    isPickable: false,
    isVisible: true,
    useVertexColors: false,
    position: patchVec3(vec3.create()),
    scaling: { setAll: (_: number) => {} },
    setVerticesData(kind: string, data: Float32Array) {
      vertexData[kind] = data
    },
    getVerticesData(kind: string) {
      return vertexData[kind]
    },
    updateVerticesData(kind: string, data: Float32Array) {
      vertexData[kind] = data
    },
    visibility: 1,
    edgesWidth: 0,
    edgesColor: null as any,
    enableEdgesRendering() {},
    disableEdgesRendering() {},
    onAfterRenderObservable: { add: (_cb: any) => {} },
    dispose() {},
    setEnabled(_: boolean) {},
    freezeWorldMatrix() {},
    unfreezeWorldMatrix() {},
  } as Mesh
}

export function stubVertexData() {
  const state = {
    positions: null as Float32Array | null,
    normals: null as Float32Array | null,
    uvs: null as Float32Array | null,
    colors: null as Float32Array | null,
    indices: null as number[] | null,
    applyToMesh(mesh: ReturnType<typeof stubMesh>) {
      if (state.positions) mesh.setVerticesData('position', state.positions)
      if (state.normals) mesh.setVerticesData('normal', state.normals)
      if (state.uvs) mesh.setVerticesData('uv', state.uvs)
      if (state.colors) mesh.updateVerticesData('color', state.colors)
      if (state.indices) (mesh as any).indices = state.indices
    },
  }
  return state
}

function stubColor(r = 1, g = 1, b = 1) {
  const c = [r, g, b]
  return {
    get r() {
      return c[0]
    },
    get g() {
      return c[1]
    },
    get b() {
      return c[2]
    },
    set(nr: number, ng: number, nb: number) {
      c[0] = nr
      c[1] = ng
      c[2] = nb
    },
  }
}

export function stubMaterial() {
  return {
    diffuseTexture: null,
    alpha: 1,
    transparencyMode: 0,
    backFaceCulling: true,
    diffuseColor: stubColor(),
    emissiveColor: stubColor(0, 0, 0),
    specularColor: stubColor(),
    specularPower: 10,
    blockDirtyMechanism: false,
    freeze: () => {},
    dispose: () => {},
    onDisposeObservable: { add: () => {} },
  }
}
