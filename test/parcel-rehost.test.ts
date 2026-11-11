import { h } from 'preact'
import { renderView, stubFetch } from './view-helper'
import { expect, test } from 'vitest'
import { invalidateUrl } from '../web/src/helpers/cached-fetch'
import Parcel from '../web/src/parcel'
import { app } from '../web/src/state'

const owner = '0x1234567890123456789012345678901234567890'

test.each([
  ['owner', owner, []],
  ['contributor', '0x2345678901234567890123456789012345678901', [{ owner: '0x2345678901234567890123456789012345678901', role: 'contributor' }]],
  ['visitor', null, []],
] as const)('rehost button permissions: %s', async (role, wallet, parcel_users) => {
  await invalidateUrl('/api/parcels/4724.json')
  const previous = app.state.wallet
  app.setState({ wallet })
  stubFetch({
    '/api/parcels/4724.json': {
      success: true,
      parcel: {
        content: { features: [{ type: 'image', link: 'https://teia.art/objkt/13' }] },
        id: 4724,
        name: 'Uncle Bitcoin | Far Far Away Gallery',
        address: '5 Pebble Boulevard',
        owner,
        x1: 0,
        x2: 10,
        y1: 0,
        y2: 9,
        z1: 0,
        z2: 16,
        island: 'Far Far Away',
        suburb: 'Far Far Away',
        minted: true,
        parcel_users,
      },
    },
  })
  try {
    const root = await renderView(`parcel-rehost-${role}`, h(Parcel, { id: 4724 }), 'h1')
    expect(Array.from(root.querySelectorAll('button')).some((button) => button.textContent === 'Rehost')).toBe(role !== 'visitor')
    expect(root.textContent?.includes('auto-convert 1 image')).toBe(role === 'owner')
  } finally {
    app.setState({ wallet: previous })
  }
})
