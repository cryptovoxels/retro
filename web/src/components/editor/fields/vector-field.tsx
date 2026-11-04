import { JSXInternal } from 'preact/src/jsx'
import { useEffect, useRef, useState } from 'preact/hooks'
import { JSX } from 'preact'

type VectorProps = {
  title?: string
  value: number
  setter: (value: number) => void
  errorMessage: (err: string | undefined) => void
  step: number
  convert?: (n: number) => number
  unconvert?: (n: number) => number
  limiter?: (x: number) => number
}

export function VectorField(props: VectorProps): JSXInternal.Element {
  const displayValue = () => Number((props.convert ? props.convert(props.value) : props.value).toFixed(4))
  const drag = useRef<{ x: number; value: number } | null>(null)
  type Valid = { value: any; ok: boolean }
  const [n, setN] = useState<Valid>({
    value: displayValue(),
    ok: true,
  })
  const input = useRef<HTMLInputElement>(null)

  // make sure to update the state if the prop is changing
  useEffect(() => {
    const v = displayValue()
    // Don't overwrite local state if it ends with "." and represents the same numeric value
    // This preserves the decimal point while the user is typing
    if (typeof n.value === 'string' && n.value.endsWith('.') && Number(n.value) === v) {
      return
    }
    setN({ value: v, ok: true })
  }, [props.value])

  const setState = (val: any, errorMessage?: string) => {
    setN({ value: val, ok: !errorMessage })
    props.errorMessage(errorMessage)
    if (!errorMessage) {
      // Always convert to number for parent, even if local display keeps "3."
      const numericValue = Number(val)
      props.unconvert ? props.setter(props.unconvert(numericValue)) : props.setter(numericValue)
    }
  }

  const isValid = (value: any) => {
    if (value === '') {
      setState('', `${props.title} must have a value`)
      return false
    }
    const num = Number(value)
    if (!Number.isFinite(num)) {
      setState(value, `${props.title} has a invalid numeric value`)
      return false
    }
    if (props.limiter && props.limiter(num) !== num) {
      setState(value, `${props.title} has a too high or low value`)
      return false
    }
    return true
  }

  const stepValue = (direction: number, event: { shiftKey: boolean; altKey: boolean }) => {
    const value = Number(n.value)
    if (!Number.isFinite(value) || n.value === '') return
    const step = props.step * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1)
    const next = Number((value + direction * step).toFixed(6))
    if (isValid(next)) setState(next)
  }

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    e.stopPropagation()
    stepValue(e.key === 'ArrowUp' ? 1 : -1, e)
  }

  const onInput: (e: JSX.TargetedEvent<HTMLInputElement, Event>) => void = (e) => {
    const val = e.currentTarget.value.replace(/,/g, '.')
    if (isValid(val)) setState(val)
  }

  useEffect(() => {
    const el = input.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el) return
      e.preventDefault()
      e.stopPropagation()
      if (e.deltaY) stepValue(e.deltaY < 0 ? 1 : -1, e)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [n.value, props.step])

  const axis = (props.title ?? 'x').toLowerCase()
  const className = 'number' + (!n.ok ? ' error' : '')
  return (
    <label class={`axis ${axis}`}>
      <span
        title="Drag to adjust. Shift: coarse. Alt: fine."
        onPointerDown={(e) => {
          if (e.button !== 0 || !Number.isFinite(Number(n.value))) return
          e.preventDefault()
          drag.current = { x: e.clientX, value: Number(n.value) }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const step = props.step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1)
          const next = Number((drag.current.value + (e.clientX - drag.current.x) * step).toFixed(6))
          if (isValid(next)) setState(next)
        }}
        onPointerUp={(e) => {
          drag.current = null
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
      >
        {axis}
      </span>
      <input ref={input} className={className} onInput={onInput} onKeyDown={onKeyDown} type="text" inputMode="decimal" aria-label={props.title} aria-invalid={!n.ok} title={props.title} value={n.value} />
    </label>
  )
}
