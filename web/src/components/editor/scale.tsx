import { limitAbsoluteValue, XYZ } from '../../../../src/utils/helpers'
import Feature from '../../../../src/features/feature'
import { useEffect, useRef, useState } from 'preact/hooks'
import { floatArray, truncate, updateHighlight } from '../../../../src/ui/features/common'
import { isEqual, throttle } from 'lodash'
import { VectorField } from './fields/vector-field'
import { axisValues } from './helpers/axis-values'
import { getNextScale } from './helpers/get-next-scale'

type ScaleProps = {
  feature: Feature
  handleStateChange?: (x: number, y: number, z: number) => void
  alwaysLocked?: boolean
}

export function Scale(props: ScaleProps) {
  const [x, setX] = useState<number>(truncate(props.feature.scale.x || 0))
  const [y, setY] = useState<number>(truncate(props.feature.scale.y || 0))
  const [z, setZ] = useState<number>(truncate(props.feature.scale.z || 0))

  const equal = x == y && y == z
  // honor the feature's lock preference (e.g. showboxes default it on) so the checkbox and the in-world corner-resize agree
  const [aspectRatioLocked, setAspectRatioLocked] = useState<boolean>(props.alwaysLocked ?? props.feature.scaleAspectLocked ?? equal)
  const [error, setError] = useState<string | undefined>('')

  const previousValues = useRef<axisValues>({
    x: props.feature.scale.x || 0,
    y: props.feature.scale.y || 0,
    z: props.feature.scale.z || 0,
  })

  const propsScale = (props.feature.scale as BABYLON.Vector3).asArray()
  const scaleValues = { x, y, z } as axisValues
  const maxScale = 50 // arbitrary maximum

  const throttledSet = throttle(
    (scale: [number, number, number]) => {
      props.feature.set({ scale })
      updateHighlight()
    },
    100,
    { leading: false, trailing: true },
  )

  useEffect(() => {
    if (isEqual([scaleValues.x, scaleValues.y, scaleValues.z], propsScale)) return

    const scale = floatArray(x, y, z)

    if (scale) {
      throttledSet(scale)
    }
    if (props.handleStateChange) props.handleStateChange(x, y, z)
  }, [x, y, z])

  const setScale = (axisChanged: XYZ) => (value: any) => {
    const newState = getNextScale(axisChanged, aspectRatioLocked, props.feature.scaleAxes(), scaleValues, previousValues.current, value)
    previousValues.current = { ...scaleValues }

    newState.hasOwnProperty('x') && setX(limitAbsoluteValue(newState.x, maxScale))
    newState.hasOwnProperty('y') && setY(limitAbsoluteValue(newState.y, maxScale))
    newState.hasOwnProperty('z') && setZ(limitAbsoluteValue(newState.z, maxScale))
  }

  const toggleAspectRatioLocked = () => {
    const next = !aspectRatioLocked
    setAspectRatioLocked(next)
    props.feature.scaleAspectLocked = next // mirror to the feature so the corner-resize handles follow the same lock
  }

  const displayError = (err: string | undefined) =>
    err ? (
      <dd class="full">
        <small>{err}</small>
      </dd>
    ) : null

  const axes = aspectRatioLocked ? ['x' as XYZ] : props.feature.scaleAxes()

  return (
    <>
      <dt>Scale</dt>
      <dd class="vec3">
        {axes.map((axis: XYZ) => (
          <VectorField key={axis} title={axis} value={scaleValues[axis]} setter={setScale(axis)} errorMessage={setError} step={0.1} />
        ))}
        {props.alwaysLocked ? null : <input type="checkbox" checked={aspectRatioLocked} onChange={toggleAspectRatioLocked} title="Lock aspect ratio" />}
      </dd>
      {displayError(error)}
    </>
  )
}
