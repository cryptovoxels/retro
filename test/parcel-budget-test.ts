import * as test from 'tape'
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

const p = {} as Parcel

test('hasBudgetFor', (t) => {
  const b = new ParcelBudget(p)
  t.ok(b.hasBudgetFor('particles'))
  t.ok(b.hasBudgetFor('polytext-v2'))
  t.end()
})

test('consume', (t) => {
  const b = new ParcelBudget(p)
  const f = { type: 'particles' } as const
  t.ok(b.consume(f))
  t.ok(b.consume(f))
  t.ok(b.consume(f))
  t.ok(b.consume(f))
  t.notOk(b.hasBudgetFor('particles'))
  t.notOk(b.consume(f))
  t.end()
})

test('unconsume', (t) => {
  const b = new ParcelBudget(p)
  const f = { type: 'particles' } as const
  t.ok(b.consume(f))
  t.ok(b.consume(f))
  t.ok(b.consume(f))
  t.ok(b.consume(f))
  t.equal(b.features.length, 4)

  b.unconsume(f)
  t.equal(b.features.length, 3)

  t.ok(b.hasBudgetFor('particles'))
  t.end()
})

test('reset', (t) => {
  const b = new ParcelBudget(p)
  b.consume({ type: 'polytext' })
  b.reset()

  t.equal(b.features.length, 0)
  t.end()
})

test('all_limits_enforced', (t) => {
  const b = new ParcelBudget(p)

  for (const type of types) {
    const limit = ParcelBudget.budget(type)
    t.assert(limit > -1, `${type} has a limit`)
    t.assert(limit <= 1000, `${type} has a limit <= 1000`)

    const setLimit = featureBudget[type]
    if (setLimit) {
      t.isEqual(limit, setLimit, `${type} has the correct limit`)
    }

    for (let i = 0; i < limit; i++) {
      t.assert(b.consume({ type }), `${type} can be consumed`)
    }
    t.false(b.hasBudgetFor(type), `${type} has no budget left`)
  }
  t.end()
})
