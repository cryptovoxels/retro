import { expect, test } from 'vitest'
import Parcel from '../src/parcel'
import ParcelBudget, { featureBudget } from '../src/parcel-budget'
import { FeatureType } from '../common/messages/feature'

const types: Readonly<FeatureType[]> = [
  'animation-platform',
  'audio',
  'boombox',
  'button',
  'collectible-model',
  'cube',
  'group',
  'guest-book',
  'image',
  'lantern',
  'megavox',
  'ride',
  'nft-image',
  'particles',
  'polytext-v2',
  'portal',
  'richtext',
  'sign',
  'slider-input',
  'spawn-point',
  'text-input',
  'video',
  'vid-screen',
  'vox-model',
  'youtube',
  'showbox',
] as const

// numeric id: a real parcel, not a space, so owner is never read
const p = { id: 1 } as Parcel

test('hasBudgetFor', () => {
  const b = new ParcelBudget(p)
  expect(b.hasBudgetFor('particles')).toBeTruthy()
  expect(b.hasBudgetFor('polytext-v2')).toBeTruthy()
})

test('consume', () => {
  const b = new ParcelBudget(p)
  const f = { type: 'particles' } as const
  expect(b.consume(f)).toBeTruthy()
  expect(b.consume(f)).toBeTruthy()
  expect(b.consume(f)).toBeTruthy()
  expect(b.consume(f)).toBeTruthy()
  expect(b.hasBudgetFor('particles')).toBeFalsy()
  expect(b.consume(f)).toBeFalsy()
})

test('unconsume', () => {
  const b = new ParcelBudget(p)
  const f = { type: 'particles' } as const
  expect(b.consume(f)).toBeTruthy()
  expect(b.consume(f)).toBeTruthy()
  expect(b.consume(f)).toBeTruthy()
  expect(b.consume(f)).toBeTruthy()
  expect(b.features.length).toBe(4)

  b.unconsume(f)
  expect(b.features.length).toBe(3)

  expect(b.hasBudgetFor('particles')).toBeTruthy()
})

test('reset', () => {
  const b = new ParcelBudget(p)
  b.consume({ type: 'polytext' })
  b.reset()

  expect(b.features.length).toBe(0)
})

test('all_limits_enforced', () => {
  const b = new ParcelBudget(p)

  for (const type of types) {
    const limit = ParcelBudget.budget(type)
    expect(limit, `${type} has a limit`).toBeGreaterThan(-1)
    expect(limit, `${type} has a limit <= 1000`).toBeLessThanOrEqual(1000)

    const setLimit = featureBudget[type]
    if (setLimit) {
      expect(limit, `${type} has the correct limit`).toBe(setLimit)
    }

    for (let i = 0; i < limit; i++) {
      expect(b.consume({ type }), `${type} can be consumed`).toBeTruthy()
    }
    expect(b.hasBudgetFor(type), `${type} has no budget left`).toBeFalsy()
  }
})
