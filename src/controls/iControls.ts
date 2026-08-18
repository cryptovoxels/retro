/**
 * interface to avoid circular dependencies
 */
export interface IControls {
  worldOffset: BABYLON.TransformNode
  setNoclip: (on: boolean) => void
}
