import { expect, test } from 'vitest'
import * as path from 'path'
import { ParcelVersionValidator } from '../../src/helpers/parcel-version-validator'
import * as fs from 'fs'

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8')
const parcel = () => JSON.parse(fixture('parcela.json'))

test('validate version', () => {
  const pi = new ParcelVersionValidator(parcel())
  expect(pi.validate(fixture('parcela_version.json')).parcel_id).toBe(3792)
})

test('validate bad shape', () => {
  const pi = new ParcelVersionValidator(parcel())
  // bad shape doesnt matter, it will get stuffed within bounds
  expect(() => pi.validate(fixture('parcel_a_wrong_shape.json'))).not.toThrow()
})

test('validate bad voxel data', () => {
  const pi = new ParcelVersionValidator(parcel())
  expect(() => pi.validate(fixture('parcel_a_bad_voxels.json'))).toThrow(/voxel data isn't parsable/i)
})

test('nerf naughty features', () => {
  const pi = new ParcelVersionValidator(parcel())
  const version = fixture('parcel_a_bad_features.json')
  const actual = pi.validate(version)
  // there should now only be one feature inside
  expect(actual).not.toBe(version)
  expect(actual.content.features?.length).toBe(1)
  expect(actual.content.features![0].id).toBe('at_edge')
})
