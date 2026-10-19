import { expect, test } from 'vitest'
import Parcel from '../parcel'

test('parcel#ctor', () => {
  const p = new Parcel({ id: 42 })
  expect(p).toBeTruthy()
  expect(p.id).toBe(42)
})

test('parcel#getFeaturesByType', () => {
  const features = [{ type: 'boop' }, { type: 'boop' }, { type: 'zing' }]
  const p = new Parcel({ content: { features } })
  expect(p.getFeaturesByType('boop' as any).length).toBe(2)
  expect(p.getFeaturesByType('zing' as any).length).toBe(1)
  expect(p.getFeaturesByType('sbaerbva' as any).length).toBe(0)
})

test('parcel#summary', () => {
  const p = new Parcel({})
  expect(typeof p.summary).toBe('object')
})

test('parcel#setContent', () => {
  const p = new Parcel({})
  p.setContent({ voxels: 'boop', features: ['herp', 'derp'] })
  expect(p.content.voxels).toBeTruthy()
})
