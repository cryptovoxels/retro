declare module '*.rig.lua' {
  type Vec = [number, number, number]
  export const parts: { name: string; asset: string | string[]; parent?: number; position?: Vec; offset?: Vec; mirror?: boolean }[]
  export function animate(nodes: BABYLON.TransformNode[], pos: BABYLON.Vector3, rot: BABYLON.Vector3, phase: number): void
}
