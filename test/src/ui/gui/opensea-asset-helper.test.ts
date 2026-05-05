import { describe, it, expect } from 'vitest'
import OpenseaAssetHelper from '../../../../src/ui/gui/opensea-asset-helper'

const OWNER = '0x46efbaedc92067e6d60e84ed6395099723252496'
const OTHER = '0x1111111111111111111111111111111111111111'

function fixture(overrides: any = {}) {
  return {
    asset_contract: { address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', schema_name: 'ERC721' },
    image_url: null,
    name: '#1',
    description: '',
    owners: [{ address: OWNER, quantity: 1 }],
    ...overrides,
  } as any
}

describe('OpenseaAssetHelper.isOwner', () => {
  it('returns true when wallet is in owners[]', () => {
    const h = new OpenseaAssetHelper(fixture())
    expect(h.isOwner(OWNER)).toBe(true)
    expect(h.isOwner(OWNER.toUpperCase())).toBe(true)
  })

  it('returns false when wallet is not in owners[]', () => {
    const h = new OpenseaAssetHelper(fixture())
    expect(h.isOwner(OTHER)).toBe(false)
  })

  it('returns false for empty or missing wallet', () => {
    const h = new OpenseaAssetHelper(fixture())
    expect(h.isOwner('')).toBe(false)
    expect(h.isOwner(undefined as any)).toBe(false)
  })

  it('returns false when owner holds quantity 0', () => {
    const h = new OpenseaAssetHelper(fixture({ owners: [{ address: OWNER, quantity: 0 }] }))
    expect(h.isOwner(OWNER)).toBe(false)
  })

  it('still honours the legacy v1 ownership shape', () => {
    const h = new OpenseaAssetHelper(fixture({ owners: undefined, ownership: { owner: { address: OWNER } } }))
    expect(h.isOwner(OWNER)).toBe(true)
    expect(h.isOwner(OTHER)).toBe(false)
  })

  it('returns false when neither owners[] nor ownership is present', () => {
    const h = new OpenseaAssetHelper(fixture({ owners: undefined }))
    expect(h.isOwner(OWNER)).toBe(false)
  })
})
