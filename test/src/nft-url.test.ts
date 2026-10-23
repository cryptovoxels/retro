import { expect, it } from 'vitest'
import { readNftUrl, writeCaip19, TEZOS_CHAIN_ID } from '../../common/helpers/nft-url'

const KO = '0xabb3738f04dc2ec20f4ae4462c3d069d02ae045b'
const HEN = 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton'

it.each([
  ['https://opensea.io/assets/ethereum/0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0/1', 1, '0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0', '1'],
  ['https://rarible.com/token/0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0:123?tab=owners', 1, '0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0', '123'],
  ['https://app.rarible.com/token/polygon/0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0:9', 137, '0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0', '9'],
  ['https://superrare.com/artwork-v2/some-piece-12345', 1, '0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0', '12345'],
  ['https://superrare.co/artwork/old-piece-77', 1, '0x41a322b28d0ff354040e2cbc676f0320d8c8850d', '77'],
  ['https://foundation.app/@someone/foundation/4242', 1, '0x3b3ee1931dc30c1957379fac9aba94d1c48a5405', '4242'],
  ['https://www.artblocks.io/token/123', 1, '0x059edd72cd353df5106d2b9cc5ab83a52287ac3a', '123'],
  ['https://www.artblocks.io/token/3000123', 1, '0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270', '3000123'],
  ['https://knownorigin.io/gallery/11432000-trash-me-if-you-can', 1, KO, '11432000'],
  ['https://objkt.com/asset/KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/555', TEZOS_CHAIN_ID, HEN, '555'],
  ['https://www.hicetnunc.xyz/objkt/12', TEZOS_CHAIN_ID, HEN, '12'],
  ['https://teia.art/objkt/13', TEZOS_CHAIN_ID, HEN, '13'],
  ['https://versum.xyz/token/8', TEZOS_CHAIN_ID, 'KT1LjmAdYQCLBjwv4S2oFkEzyHVkomAf5MrW', '8'],
])('%s', (url, chain, contract, token) => {
  expect(readNftUrl(url)).toEqual({ chain, contract, token })
})

it.each(['https://knownorigin.io/ina-vare', 'https://foundation.app/@someone/my-collection/1', 'https://objkt.com/asset/some-slug/1', 'https://twitter.com/x'])('%s is not an nft', (url) => {
  expect(readNftUrl(url)).toBeNull()
})

it('tezos caip round trips', () => {
  const nft = { chain: TEZOS_CHAIN_ID, contract: HEN, token: '1' }
  expect(readNftUrl(writeCaip19(nft))).toEqual(nft)
})
