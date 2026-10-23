import { expect, it, vi } from 'vitest'

vi.mock('../../src/features/feature', () => ({ Feature2D: class {}, TransparencyMode: { Ignore: 'Ignore' } }))
vi.mock('../../web/src/components/editor', () => ({}))
vi.mock('../../web/src/state', () => ({}))
vi.mock('../../src/tools/gizmos', () => ({}))
vi.mock('../../src/ui/features', () => ({ FeatureEditor: class {} }))
vi.mock('../../src/ui/gui/opensea-asset-helper', () => ({ default: class {} }))
vi.mock('../../src/ui/html-ui/nft-view', () => ({ default: vi.fn() }))
vi.mock('../../src/utils/helpers', () => ({}))
vi.mock('../../src/utils/proxy', () => ({}))
vi.mock('../../src/features/image', () => ({}))
vi.mock('../../src/textures/textures', () => ({}))

import NftImage from '../../src/features/nft-image'

it.each([
  ['legacy WebP', 'UklGR' + 'A'.repeat(819), true],
  ['RGB', 'A'.repeat(64), false],
] as const)('%s draft does not block artwork unless renderable', async (_name, draft, loads) => {
  const nft = new (NftImage as any)()
  Object.assign(nft, {
    description: { draft },
    url: 'https://opensea.io/assets/ethereum/0x123/1',
    uuid: 'art',
    parcel: { id: 4724, summary: { nfts: { art: 'https://example.com/art.png' } } },
    abortController: new AbortController(),
    generateDraft: vi.fn(),
    paintTexture: vi.fn(),
  })
  await nft.generateNFT()
  expect(nft.paintTexture).toHaveBeenCalledTimes(loads ? 1 : 0)
  if (loads) expect(nft.paintTexture).toHaveBeenCalledWith('https://example.com/art.png')
})
