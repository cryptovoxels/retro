import { expect, test } from 'vitest'
import ParcelEvent from '../parcel-event'

const AUTHOR = '0x0fA074262d6AF761FB57751d610dc92Bac82AEf9'

test('ParcelEvent#object', () => {
  const p = new ParcelEvent({
    id: 1,
    parcel_id: 670,
    name: 'My event',
    author: AUTHOR,
    description: 'My event',
    starts_at: new Date(Date.now() + 5 * 60000),
  })
  expect(p).toBeTruthy()
  expect(p.parcel_id).toBe(670)
})

test('ParcelEvent does not exists', async () => {
  expect(await ParcelEvent.loadFromId(1)).toBeFalsy()
})

test('ParcelEvent Create', async () => {
  const p = new ParcelEvent({
    parcel_id: 670,
    name: 'My event',
    author: AUTHOR,
    description: 'My event',
    starts_at: new Date(Date.now() + 5 * 60000),
  })
  const response = await p.create()
  expect(response).toBeTruthy()
  expect(response.success).toBeTruthy()
})

test('ParcelEvent load event', async () => {
  const eventObject = await ParcelEvent.loadFromId(1)
  expect(eventObject).toBeTruthy()
  expect(eventObject!.parcel_id).toBe(670)
  expect(eventObject!.author).toBe(AUTHOR)
})

test('ParcelEvent edit event', async () => {
  const eventObject = await ParcelEvent.loadFromId(1)
  expect(eventObject).toBeTruthy()
  eventObject!.name = 'My new name'
  await eventObject!.update()
  expect((await ParcelEvent.loadFromId(1))!.name).toBe('My new name')
})

test('ParcelEvent remove', async () => {
  const eventObject = await ParcelEvent.loadFromId(1)
  expect(eventObject).toBeTruthy()
  const response = await eventObject!.remove()
  expect(response).toBeTruthy()
  expect(response.success).toBeTruthy()
  expect(await ParcelEvent.loadFromId(1)).toBeFalsy()
})
