import { expect, test } from 'vitest'
import ModerationReport from '../report'

test('Reports#object', () => {
  const object = new ModerationReport({ id: 42, author: 'abc', reported_id: 10, reason: 'cleaned the toilet' })
  expect(object).toBeTruthy()
  expect(object.reason).toBe('cleaned the toilet')
})

test('Reports#DoesNotExist', async () => {
  expect(await ModerationReport.loadFromId(42)).toBeFalsy()
})

test('Reports#Create', async () => {
  const p = new ModerationReport({ author: 'abc', reported_id: 10, reason: 'cleaned the toilet' })
  const response = await p.create()
  expect(response).toBeTruthy()
  expect(response.success).toBeTruthy()
})

test('Reports#IsNotResolved', async () => {
  const object = await ModerationReport.loadFromId(1)
  expect(object).toBeTruthy()
  expect(object?.reason).toBe('cleaned the toilet')
  expect(object?.author).toBe('abc')
  expect(object?.resolved).toBe(false)
})

test('Reports#Update', async () => {
  const object = await ModerationReport.loadFromId(1)
  expect(object).toBeTruthy()
  if (object) {
    object.resolved = true
  }
  const response = await object?.update()
  expect(response).toBeTruthy()
  expect(response?.success).toBeTruthy()
})

test('Reports#IsResolved', async () => {
  const object = await ModerationReport.loadFromId(1)
  expect(object).toBeTruthy()
  expect(object?.reason).toBe('cleaned the toilet')
  expect(object?.author).toBe('abc')
  expect(object?.resolved).toBe(true)
})

test('Reports#Remove', async () => {
  const object = await ModerationReport.loadFromId(1)
  expect(object).toBeTruthy()
  const response = await object?.remove()
  expect(response).toBeTruthy()
  expect(response?.success).toBeTruthy()
})

test('Reports#Deleted', async () => {
  expect(await ModerationReport.loadFromId(1)).toBeFalsy()
})
