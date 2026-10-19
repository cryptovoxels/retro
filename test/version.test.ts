import { describe, expect, test } from 'vitest'
import { deprecated } from '../common/version'

describe('version deprecated', () => {
  test('compare two semver', () => {
    expect(deprecated('1.9.99', '2.0.0')).toBeTruthy()
  })
  test('compare semver check and build num release', () => {
    expect(deprecated('2.0.0', '1')).toBeTruthy()
  })
  test('compare build num check and semver release', () => {
    expect(deprecated('1', '2.0.0')).toBeFalsy()
  })
  test('compare two build nums', () => {
    expect(deprecated('1', '2')).toBeTruthy()
  })
})
