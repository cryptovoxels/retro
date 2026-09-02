import test from 'tape'
import ParcelEvent from '../parcel-event'

test('ParcelEvent#object', (t) => {
  const p = new ParcelEvent({
    id: 1,
    parcel_id: 670,
    name: 'My event',
    author: '0x0fA074262d6AF761FB57751d610dc92Bac82AEf9',
    description: 'My event',
    starts_at: new Date(Date.now() + 5 * 60000),
  })
  t.ok(p)
  t.equal(p.parcel_id, 670)
  t.end()
})

test('ParcelEvent does not exists', async (t) => {
  const eventObject = await ParcelEvent.loadFromId(1)
  t.notOk(eventObject)
  t.end()
})

test('ParcelEvent Create', async (t) => {
  const p = new ParcelEvent({
    parcel_id: 670,
    name: 'My event',
    author: '0x0fA074262d6AF761FB57751d610dc92Bac82AEf9',
    description: 'My event',
    starts_at: new Date(Date.now() + 5 * 60000),
  })
  const response = await p.create()
  t.ok(response)
  t.true(response.success)
  t.end()
})

test('ParcelEvent load event', async (t) => {
  const eventObject = await ParcelEvent.loadFromId(1)
  if (!eventObject) {
    t.fail('eventObject is null')
    return
  }
  t.equal(eventObject.parcel_id, 670)
  t.equal(eventObject.author, '0x0fA074262d6AF761FB57751d610dc92Bac82AEf9')
  t.end()
})

test('ParcelEvent edit event', async (t) => {
  const eventObject = await ParcelEvent.loadFromId(1)
  if (!eventObject) {
    t.fail('eventObject is null')
    return
  }
  eventObject.name = 'My new name'
  await eventObject.update()
  t.end()
})

test('ParcelEvent, edit was successful', async (t) => {
  const eventObject = await ParcelEvent.loadFromId(1)
  if (!eventObject) {
    t.fail('eventObject is null')
    return
  }
  t.assert(eventObject.name == 'My new name')
  t.end()
})

test('ParcelEvent remove', async (t) => {
  const eventObject = await ParcelEvent.loadFromId(1)
  if (!eventObject) {
    t.fail('eventObject is null')
    return
  }
  const response = await eventObject.remove()
  t.ok(response)
  t.ok(response.success)
  t.end()
})

test('ParcelEvent has been removed', async (t) => {
  const eventObject = await ParcelEvent.loadFromId(1)
  t.notOk(eventObject)
  t.end()
})
