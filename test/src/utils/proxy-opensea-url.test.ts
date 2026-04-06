import { describe, it, expect } from 'vitest'
import { OPENSEA_BASE_CHAIN_ID, openseaAssetsChainSlug, readOpenseaUrl } from '../../../src/utils/proxy'

const SAMPLE = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'

describe('readOpenseaUrl', () => {
  it('parses Base mainnet OpenSea asset URLs', () => {
    const r = readOpenseaUrl(`https://opensea.io/assets/base/${SAMPLE}/123`)
    expect(r).toEqual({ contract: SAMPLE, token: '123', chain: OPENSEA_BASE_CHAIN_ID })
  })

  it('parses explicit ethereum and legacy two-segment paths', () => {
    expect(readOpenseaUrl(`https://opensea.io/assets/ethereum/${SAMPLE}/1`)).toEqual({
      contract: SAMPLE,
      token: '1',
      chain: 1,
    })
    expect(readOpenseaUrl(`https://opensea.io/assets/${SAMPLE}/1`)).toEqual({
      contract: SAMPLE,
      token: '1',
      chain: 1,
    })
  })

  it('parses matic and polygon slugs as chain 137', () => {
    expect(readOpenseaUrl(`https://opensea.io/assets/matic/${SAMPLE}/9`)?.chain).toBe(137)
    expect(readOpenseaUrl(`https://opensea.io/assets/polygon/${SAMPLE}/9`)?.chain).toBe(137)
  })

  it('returns null for unsupported chain slugs', () => {
    expect(readOpenseaUrl(`https://opensea.io/assets/arbitrum/${SAMPLE}/1`)).toBeNull()
  })
})

describe('openseaAssetsChainSlug', () => {
  it('maps chain ids to OpenSea path segments', () => {
    expect(openseaAssetsChainSlug(1)).toBe('ethereum')
    expect(openseaAssetsChainSlug(137)).toBe('matic')
    expect(openseaAssetsChainSlug(OPENSEA_BASE_CHAIN_ID)).toBe('base')
  })
})
