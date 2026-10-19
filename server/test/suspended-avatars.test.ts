import { expect, test } from 'vitest'
import Avatar from '../avatar'

const DAY = 24 * 60 * 60 * 1000

test('Avatar#getSuspended-none', async () => {
  expect(await Avatar.getSuspended('non-existent')).toBeFalsy()
})

test('Avatar#suspend', async () => {
  const response = await Avatar.suspend('a', 'test', 30)
  expect(response).toBeTruthy()
  expect(response.wallet).toBe('a')
  expect(response.reason).toBe('test')
})

test('Avatar#getSuspended', async () => {
  await Avatar.suspend('b', 'test', 7)

  const sixDaysFromNow = new Date(Date.now() + 6 * DAY)
  const eightDaysFromNow = new Date(Date.now() + 8 * DAY)

  const response = await Avatar.getSuspended('b')
  expect(response).toBeTruthy()
  expect(response!.expires_at).toBeInstanceOf(Date)
  expect(response!.expires_at > sixDaysFromNow && response!.expires_at < eightDaysFromNow, 'expires 7 days from now').toBeTruthy()
  expect(response!.reason).toBe('test')
})

test('Avatar#unsuspend', async () => {
  await Avatar.suspend('c', 'test', 7)

  const response = await Avatar.unsuspend('c')
  expect(response).toBeTruthy()
  // add 1 minute to current time to ensure matching db time
  expect(new Date(response.expires_at) < new Date(Date.now() + 60e3), 'expires at is in the past').toBeTruthy()

  expect(await Avatar.getSuspended('c')).toBeFalsy()
})
