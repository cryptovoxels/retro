import { afterEach, expect, it, vi } from 'vitest'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { VectorField } from '../web/src/components/editor/fields/vector-field'

const host = document.createElement('div')
document.body.append(host)
afterEach(() => act(() => render(null, host)))

function field(props: any = {}) {
  const setter = vi.fn()
  act(() => render(h(VectorField, { title: 'X', value: 1, step: 0.1, setter, errorMessage: vi.fn(), ...props }), host))
  return { input: host.querySelector('input')!, setter }
}

it('keeps decimal input and rejects non-finite values', () => {
  const { input, setter } = field()
  act(() => {
    input.value = '2,'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(setter).toHaveBeenLastCalledWith(2)
  expect(input.value).toBe('2.')
  setter.mockClear()
  act(() => {
    input.value = 'Infinity'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(setter).not.toHaveBeenCalled()
  expect(input.getAttribute('aria-invalid')).toBe('true')
})

it('supports fine and coarse steps with degree conversion and limits', () => {
  const { input, setter } = field({ value: Math.PI / 2, step: 5, convert: (v: number) => (v * 180) / Math.PI, unconvert: (v: number) => (v * Math.PI) / 180, limiter: (v: number) => Math.min(100, v) })
  act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true })))
  expect(setter).toHaveBeenLastCalledWith((90.5 * Math.PI) / 180)
  setter.mockClear()
  act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })))
  expect(setter).not.toHaveBeenCalled()
})

it('changes a vector on wheel without requiring focus and consumes the scroll', () => {
  const { input, setter } = field()
  const event = new WheelEvent('wheel', { deltaY: -10, cancelable: true })
  act(() => void input.dispatchEvent(event))
  expect(setter).toHaveBeenLastCalledWith(1.1)
  expect(event.defaultPrevented).toBe(true)
})
