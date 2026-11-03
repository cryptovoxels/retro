import { expect, test, vi } from 'vitest'
import { createEngine } from '../common/helpers/utils'

test('engine creation never requests WebGL1 when WebGL2 is unavailable', () => {
  const getContext = vi.fn((_type: string, _options: any) => null)
  expect(() => createEngine({ getContext })).toThrow('WebGL2 is required')
  expect(getContext).toHaveBeenCalledTimes(1)
  expect(getContext.mock.calls[0][0]).toBe('webgl2')
})

test('engine creation rejects an existing WebGL1 context', () => {
  expect(() => createEngine({ canvas: {}, getParameter: () => 'WebGL 1.0' })).toThrow('WebGL2 is required')
})
