import { expect, test } from 'vitest'
import { getFieldShape } from '../../common/voxels/helpers'

test('getFieldShape', () => {
  const tests = [
    { x1: 0, y1: 0, z1: 0, x2: 1, y2: 1, z2: 1, expected: [2, 2, 2] },
    { x1: -2, y1: -2, z1: -2, x2: 2, y2: 2, z2: 2, expected: [8, 8, 8] },
    { x1: -2, y1: -2, z1: -2, x2: -4, y2: -4, z2: -4, expected: [4, 4, 4] },
  ]

  tests.forEach((tc) => {
    expect(getFieldShape(tc)).toEqual(tc.expected)
  })
})
