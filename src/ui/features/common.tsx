import { Fragment, JSX } from 'preact'
import { Dispatch, StateUpdater, useState } from 'preact/hooks'
import { VectorField } from '../../../web/src/components/editor/fields/vector-field'

type converter = (x: number) => number
export const noConversion: converter = (x: number) => x

export const DEFAULT_DP = 2
export const RADIAN_DP = 5
export const DEGREE_DP = 1

/**
 * Generate an event handler for a field to set a numeric value
 * @param setter The function that is passed the new value
 * @param defaultValue The value to use if a non-numeric value is entered (including empty string)
 * @param modifier A function to transform the number through before passing it to the setter
 * @param limiterFunction A function that ensures an absolute value does not go too high
 */
export const numericFieldHandler = (setter: (val: number) => void, defaultValue: number, modifier: converter = noConversion, limiterFunction: ((value: number) => number) | undefined = undefined) => {
  return (e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    const value = limiterFunction ? limiterFunction(parseFloat(e.currentTarget.value)) : parseFloat(e.currentTarget.value)
    setter(modifier(isNaN(value) ? defaultValue : value))
  }
}

/**
 * Convert radians to degrees
 */
export const radToDeg = (rad: number) => truncate((rad * 180) / Math.PI, DEGREE_DP)

/**
 * Convert degrees to radians
 */
export const degToRad = (deg: number) => truncate((deg * Math.PI) / 180, RADIAN_DP)

/**
 * Truncate a number to the given number of fraction digits
 */
export const truncate = (x: unknown, length = DEFAULT_DP): number => {
  const v = Number(x)
  if (isNaN(v)) {
    // This was return '' which is a type-error. Preserving NaN seems equally valid
    return v
  }

  return parseFloat(v.toFixed(length))
}

export type Array3D = [number, number, number]

export const floatArray = (x: number, y: number, z: number, length = DEFAULT_DP): Array3D | null => {
  if (isNaN(x) || isNaN(y) || isNaN(z)) {
    return null
  } else {
    return [truncate(x, length), truncate(y, length), truncate(z, length)]
  }
}

export const updateHighlight = () => {
  queueMicrotask(() => {
    window.ui?.featureTool?.updateHighlight()
  })
}

/**
 * Return an xyz field triple
 * Convert alters the value passed in x/y/z, unconvert alters the user-supplied value before passing to setX/Y/Z
 *
 * this field takes care of validating the input, and only if values are valid will it set the parent values
 */
export const xyzFields = (
  parentX: number,
  parentY: number,
  parentZ: number,
  setParentX: Dispatch<StateUpdater<number>>,
  setParentY: Dispatch<StateUpdater<number>>,
  setParentZ: Dispatch<StateUpdater<number>>,
  step: number,
  convert: converter = noConversion,
  unConvert: converter = noConversion,
  axisLimiter?: (axis: 'x' | 'y' | 'z') => converter,
) => {
  const [error, setError] = useState<string | undefined>()
  return (
    <Fragment>
      <div class="vec3">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <VectorField
            key={axis}
            title={axis}
            value={[parentX, parentY, parentZ][i]}
            setter={[setParentX, setParentY, setParentZ][i]}
            step={step}
            convert={convert}
            unconvert={unConvert}
            limiter={axisLimiter?.(axis)}
            errorMessage={setError}
          />
        ))}
      </div>
      {error && <div class="vector-error">{error}</div>}
    </Fragment>
  )
}
