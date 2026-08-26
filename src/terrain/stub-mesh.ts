import type { Mesh } from '@babylonjs/lite'

/** Instanced ground template for ocean / ocean-floor until lite mesh builders land. */
export function stubInstancedMesh(): Mesh & { instances: Mesh[] } {
  const instances: Mesh[] = []
  const position = {
    x: 0,
    y: 0,
    z: 0,
    set: (x: number, y: number, z: number) => {
      position.x = x
      position.y = y
      position.z = z
    },
  }
  const mesh = {
    scaling: { setAll: (_: number) => {} },
    material: null,
    position,
    setEnabled: (_: boolean) => {},
    receiveShadows: false,
    isPickable: false,
    isVisible: true,
    createInstance: (_name: string) => {
      const inst = {
        position: { x: 0, y: 0, z: 0 },
        dispose: () => {},
      } as Mesh
      instances.push(inst)
      return inst
    },
    get instances() {
      return instances
    },
    dispose: () => {},
  }
  return mesh as Mesh & { instances: Mesh[] }
}
