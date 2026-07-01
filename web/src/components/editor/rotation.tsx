import { isEqual, throttle } from 'lodash'
import { useEffect, useState } from 'preact/hooks'
import { Array3D, degToRad, floatArray, RADIAN_DP, radToDeg, truncate, updateHighlight } from '../../../../src/ui/features/common'
import Feature from '../../../../src/features/feature'
import { VectorField } from './fields/vector-field'

type RotationProps = {
  feature: Feature
  handleStateChange?: (x: number, y: number, z: number) => {}
}

export function Rotation(props: RotationProps) {
  const [x, setX] = useState<number>(truncate(props.feature.rotation.x || 0, RADIAN_DP))
  const [y, setY] = useState<number>(truncate(props.feature.rotation.y || 0, RADIAN_DP))
  const [z, setZ] = useState<number>(truncate(props.feature.rotation.z || 0, RADIAN_DP))
  const [error, setError] = useState<string | undefined>('')

  // Round to 4 decimal places to avoid a re-render of the Editor.
  // if propsRotation and [x,y,z] are different we have a re-render
  const propsRotation = (props.feature.rotation as BABYLON.Vector3).asArray().map((n) => Math.round(n * 10000) / 10000)

  const throttledSet = throttle(
    (rotation: Array3D) => {
      props.feature.set({ rotation })
      updateHighlight()
    },
    100,
    { leading: false, trailing: true },
  )

  useEffect(() => {
    if (isEqual([x, y, z], propsRotation)) return
    const rotation = floatArray(x, y, z, RADIAN_DP)

    if (rotation) {
      throttledSet(rotation)
    }
    if (props.handleStateChange) props.handleStateChange(x, y, z)
  }, [x, y, z])

  const displayError = (err: string | undefined) =>
    err ? (
      <dd class="full">
        <small>{err}</small>
      </dd>
    ) : null

  const step = 10
  return (
    <>
      <dt>Rotation</dt>
      <dd class="vec3">
        <VectorField title="X" step={step} errorMessage={setError} value={x} setter={setX} convert={radToDeg} unconvert={degToRad} />
        <VectorField title="Y" step={step} errorMessage={setError} value={y} setter={setY} convert={radToDeg} unconvert={degToRad} />
        <VectorField title="Z" step={step} errorMessage={setError} value={z} setter={setZ} convert={radToDeg} unconvert={degToRad} />
      </dd>
      {displayError(error)}
    </>
  )
}
