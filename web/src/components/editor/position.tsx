import Feature from '../../../../src/features/feature'
import { useEffect, useState } from 'preact/hooks'
import { floatArray, truncate, updateHighlight } from '../../../../src/ui/features/common'
import { Vec3Description } from '../../../../common/messages/feature'
import { isEqual, throttle } from 'lodash'
import { VectorField } from './fields/vector-field'

type PositionalProps = {
  feature: Feature
  handleStateChange?: (x: number, y: number, z: number) => void
}

export function Position(props: PositionalProps) {
  const [x, setX] = useState<number>(truncate(props.feature.position.x || 0))
  const [y, setY] = useState<number>(truncate(props.feature.position.y || 0))
  const [z, setZ] = useState<number>(truncate(props.feature.position.z || 0))
  const [error, setError] = useState<string | undefined>('')
  const propsPosition = (props.feature.position as BABYLON.Vector3).asArray()

  const update = (position: Vec3Description) => {
    props.feature.set({ position })
    updateHighlight()
  }

  const throttledUpdate = throttle(update, 100, { leading: false, trailing: true })

  const hardBoundaryLimiter = (axis: 'x' | 'y' | 'z') => (value: number) => {
    const proposedPosition = BABYLON.Vector3.FromArray(propsPosition)
    proposedPosition[axis] = value
    return props.feature.allowedProposedPosition(proposedPosition) ? proposedPosition[axis] : props.feature.position[axis]
  }

  useEffect(() => {
    const position = floatArray(x, y, z)
    if (isEqual([x, y, z], propsPosition) || !position) return
    const proposedPosition = BABYLON.Vector3.FromArray([x, y, z])
    if (props.feature.allowedProposedPosition(proposedPosition)) {
      throttledUpdate(position)
      props.handleStateChange?.(x, y, z)
    }
  }, [x, y, z])

  const step = 0.05

  const displayError = (err: string | undefined) => {
    return err ? (
      <dd class="full">
        <small>{err}</small>
      </dd>
    ) : null
  }

  return (
    <>
      <dt>Position</dt>
      <dd class="vec3">
        <VectorField title="X" step={step} errorMessage={setError} value={x} setter={setX} limiter={hardBoundaryLimiter('x')} />
        <VectorField title="Y" step={step} errorMessage={setError} value={y} setter={setY} limiter={hardBoundaryLimiter('y')} />
        <VectorField title="Z" step={step} errorMessage={setError} value={z} setter={setZ} limiter={hardBoundaryLimiter('z')} />
      </dd>
      {displayError(error)}
    </>
  )
}
