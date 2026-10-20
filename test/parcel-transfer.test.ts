import './view-helper'
import { afterEach, expect, test, vi } from 'vitest'
import { render } from 'preact'
import Parcel from '../web/src/parcel'
import { app } from '../web/src/state'

const originalWallet = app.state.wallet
const content = { voxels: 'compressed-voxels', features: [{ type: 'image', url: 'ugc://image.png' }], palette: ['#ffffff'] }
const record = { id: 42, owner: '0xowner', parcel_users: [{ owner: '0xcollaborator', role: 'contributor' }], name: 'Test parcel', island: 'Origin', x1: 0, x2: 10, y1: 0, y2: 8, z1: 0, z2: 10 }

function page(wallet = '0xowner') {
  app.state.wallet = wallet
  const view = new Parcel({ id: 42 })
  view.state = { ...view.state, parcel: record as any, loading: false }
  view.setState = ((patch: any) => {
    view.state = { ...view.state, ...patch }
  }) as any
  view.uploadFile.current = { files: [{ name: 'build.json', text: async () => JSON.stringify(content) }], value: 'build.json' } as any
  return view
}

afterEach(() => {
  app.state.wallet = originalWallet
  vi.restoreAllMocks()
})

test.each(['0xowner', '0xcollaborator', '0xother', ''])('transfer form visibility for %s', (wallet) => {
  const view = page(wallet)
  const root = document.createElement('div')
  render(view.render(), root)
  expect(!!root.querySelector('#parcel-upload')).toBe(wallet === '0xowner' || wallet === '0xcollaborator')
  render(null, root)
})

test('collaborator uploads content without parcel metadata and sees success', async () => {
  const view = page('0xcollaborator')
  view.uploadFile.current!.files![0].text = async () => JSON.stringify({ parcel: { id: 99, owner: 'someone-else', content } })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as any)
  await view.upload(new Event('submit'))
  expect(fetch).toHaveBeenCalledWith('/grid/parcels/42', expect.objectContaining({ method: 'PUT', credentials: 'include', body: JSON.stringify({ content }) }))
  expect(view.state.transferMessage).toBe('Uploaded to parcel #42.')
  expect(view.uploadFile.current!.value).toBe('')
})

test.each(['{bad', '{}', 'null', '{"features":"bad"}'])('invalid upload does not write: %s', async (json) => {
  const view = page()
  view.uploadFile.current!.files![0].text = async () => json
  const fetch = vi.spyOn(globalThis, 'fetch')
  await view.upload(new Event('submit'))
  expect(fetch).not.toHaveBeenCalled()
  expect(view.state.transferMessage).toBeTruthy()
  expect(view.state.transferring).toBe(false)
})

test('cancelled replacement does not write', async () => {
  const view = page()
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  const fetch = vi.spyOn(globalThis, 'fetch')
  await view.upload(new Event('submit'))
  expect(fetch).not.toHaveBeenCalled()
})

test('rejected save keeps the file and shows the server error', async () => {
  const view = page()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ success: false, error: 'Permission denied' }) } as any)
  await view.upload(new Event('submit'))
  expect(view.state.transferMessage).toBe('Permission denied')
  expect(view.uploadFile.current!.value).toBe('build.json')
})

test('non-collaborator cannot invoke upload', async () => {
  const view = page('0xother')
  const fetch = vi.spyOn(globalThis, 'fetch')
  await view.upload(new Event('submit'))
  expect(fetch).not.toHaveBeenCalled()
})

test('downloaded JSON round-trips through upload without losing scene content', async () => {
  const view = page()
  let downloaded: Blob
  const create = vi.fn((blob: Blob) => {
    downloaded = blob
    return 'blob:parcel'
  })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ success: true, parcel: { content } }) } as any)
  await view.download()
  expect(click).toHaveBeenCalledOnce()
  const json = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsText(downloaded!)
  })
  expect(JSON.parse(json)).toEqual(content)
  view.uploadFile.current!.files![0].text = async () => json
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as any)
  await view.upload(new Event('submit'))
  expect(JSON.parse(fetch.mock.calls[fetch.mock.calls.length - 1][1]!.body as string)).toEqual({ content })
})

test('render parcel transfer form for review', async () => {
  const { renderView } = await import('./view-helper')
  const view = page()
  const root = await renderView('parcel-transfer', view.render()!, '#parcel-upload')
  render(null, root)
})
