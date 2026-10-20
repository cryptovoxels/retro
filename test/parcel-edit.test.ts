import { renderView, stubFetch } from './view-helper'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, expect, test, vi } from 'vitest'
import ParcelEdit from '../web/src/parcel-edit'
import { app } from '../web/src/state'

const originalWallet = app.state.wallet
let root: HTMLDivElement
const parcel = { id: 42, name: 'Park', description: 'A sweet park', owner: '0xowner', parcel_users: [{ owner: '0xcollaborator', role: 'contributor' }] }
const versions = [
  { id: 82, parcel_id: 42, is_snapshot: true, updated_at: '2026-10-20T00:33:25Z' },
  { id: 81, parcel_id: 42, is_snapshot: false, updated_at: '2026-10-19T23:12:42Z' },
]

async function mount(wallet = '0xowner') {
  app.state.wallet = wallet
  stubFetch({
    '/api/parcels/42.json': { success: true, parcel },
    '/api/parcels/42/history.json': { success: true, versions },
  })
  root = await renderView(wallet === '0xowner' ? 'parcel-edit-history-owner' : 'parcel-edit-history-collaborator', h(ParcelEdit, { id: '42' }) as any, 'time')
}

afterEach(() => {
  if (root) render(null, root)
  app.state.wallet = originalWallet
  vi.restoreAllMocks()
})

test('history has explicit actions, readable sections and no unlabeled upload', async () => {
  await mount()
  expect([...root.querySelectorAll('h2')].map((el) => el.textContent)).toEqual(['parcel details', 'build permissions', 'collaborators', 'parcel edit history'])
  expect(root.textContent).not.toContain('snapshot')
  expect(root.querySelector('input[type=file]')).toBeNull()
  expect(root.querySelectorAll('time')).toHaveLength(2)
  expect(root.querySelectorAll('input[type=radio]')).toHaveLength(2)
  expect([...root.querySelectorAll('button')].filter((el) => el.textContent === 'Download')).toHaveLength(1)
  const save = root.querySelector('article')!.lastElementChild as HTMLButtonElement
  expect(save.textContent).toBe('Save')
  expect(save.getAttribute('form')).toBe('parcel-edit-form')
  const fetch = vi.spyOn(globalThis, 'fetch')
  root.querySelector('time')!.click()
  expect(fetch).not.toHaveBeenCalled()
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  const restore = [...root.querySelectorAll('button')].find((el) => el.textContent === 'Restore')!
  restore.click()
  expect(window.confirm).toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

test('failed save reports an error rather than success', async () => {
  await mount()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ success: false }) } as any)
  const save = [...root.querySelectorAll('button')].find((el) => el.textContent === 'Save current version')!
  save.click()
  await vi.waitFor(() => expect(root.querySelector('[role=status]')?.textContent).toBe('Could not save this version.'))
})

test('collaborators can download history but owner-only history writes stay hidden', async () => {
  await mount('0xcollaborator')
  const buttons = [...root.querySelectorAll('button')].map((el) => el.textContent)
  expect(buttons).toContain('Download')
  expect(buttons).not.toContain('Restore')
  expect(buttons).not.toContain('Save current version')
})

test('restore uses the selected version', async () => {
  await mount()
  const radio = root.querySelector('input[value="81"]') as HTMLInputElement
  await act(() => {
    radio.checked = true
    radio.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await vi.waitFor(() => expect(radio.checked).toBe(true))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ success: true, versions }) } as any)
  const restore = [...root.querySelectorAll('button')].find((el) => el.textContent === 'Restore')!
  restore.click()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/parcels/42/revert', expect.objectContaining({ body: JSON.stringify({ parcel_version_id: 81 }) })))
})
