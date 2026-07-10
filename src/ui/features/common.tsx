import { Fragment, JSX } from 'preact'
import { Dispatch, StateUpdater, useState } from 'preact/hooks'
import { vectorField } from '../../../web/src/components/editor/fields/vector-field'

type converter = (x: number) => number
export const noConversion: converter = (x: number) => x

type InputEvent = JSX.TargetedEvent<HTMLInputElement, Event>
type InputEventHandler = (e: InputEvent) => void
type KbEvent = JSX.TargetedKeyboardEvent<HTMLInputElement>
type KbEventHandler = (e: KbEvent) => void

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
  type Valid = { value: any; ok: boolean; error: string }
  type Setter = (val: Valid) => void

  const [x, setX] = useState<Valid>({ value: convert(parentX), ok: true, error: '' })
  const [y, setY] = useState<Valid>({ value: convert(parentY), ok: true, error: '' })
  const [z, setZ] = useState<Valid>({ value: convert(parentZ), ok: true, error: '' })

  const parentConverter = (setter: Dispatch<StateUpdater<number>>, num: number) => {
    setter(unConvert(num))
  }

  const handleInput = (setter: Setter, setParentField: Dispatch<StateUpdater<number>>, limiter?: converter): InputEventHandler => {
    return (e: InputEvent) => {
      if (e.currentTarget.value === '') {
        return setter({ value: '', ok: false, error: 'a field is empty' })
      }

      // half of the world is using a comma for decimals separation, and we won't position things in the thousands, so
      // replace it with period
      const val = e.currentTarget.value.replace(/,/g, '.')
      // ... before we turn it into a number
      const num = Number(val)
      if (isNaN(num)) {
        return setter({ value: e.currentTarget.value, ok: false, error: 'a field has a invalid numeric value' })
      }

      if (limiter && limiter(num) !== num) {
        return setter({ value: e.currentTarget.value, ok: false, error: 'a field has a too high or low value' })
      }

      setter({ value: val, ok: true, error: '' })
      parentConverter(setParentField, num)
    }
  }

  // use the up and down arrow to increase the value by `step`
  const handleKeyUp = (setter: Setter, setParentField: Dispatch<StateUpdater<number>>, limiter?: converter): KbEventHandler => {
    return (e: KbEvent) => {
      e.stopPropagation()
      const num = Number(e.currentTarget.value)
      if (isNaN(num)) {
        return
      }

      if (limiter && limiter(num) !== num) {
        return setter({ value: e.currentTarget.value, ok: false, error: 'a field has a too high or low value' })
      }

      if (e.code === 'ArrowUp') {
        const newVal = truncate(num + step)
        setter({ value: newVal, ok: true, error: '' })
        parentConverter(setParentField, newVal)
      }

      if (e.code === 'ArrowDown') {
        const newVal = truncate(num - step)
        setter({ value: newVal, ok: true, error: '' })
        parentConverter(setParentField, newVal)
      }
    }
  }

  const displayFirstError = (errors: string[]) => {
    const firstErr = errors.find((err) => !!err)
    return firstErr ? <div className="vector-error">{firstErr}</div> : null
  }

  const xLim = axisLimiter ? axisLimiter('x') : undefined
  const yLim = axisLimiter ? axisLimiter('y') : undefined
  const zLim = axisLimiter ? axisLimiter('z') : undefined

  return (
    <Fragment>
      {vectorField('x', x.value, x.ok, handleInput(setX, setParentX, xLim), handleKeyUp(setX, setParentX, xLim))}
      {vectorField('y', y.value, y.ok, handleInput(setY, setParentY, yLim), handleKeyUp(setY, setParentY, yLim))}
      {vectorField('z', z.value, z.ok, handleInput(setZ, setParentZ, zLim), handleKeyUp(setZ, setParentZ, zLim))}
      {displayFirstError([x.error, y.error, z.error])}
    </Fragment>
  )
}
