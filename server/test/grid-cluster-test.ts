import fc from 'fast-check'
import test from 'tape'
import { LightmapStatus } from '../../common/messages/parcel'
import { GridClusterMessage } from '../grid/GridClusterMessageBroker'
import { mapFromPgNotificationArgs, mapToPgNotificationArgs } from '../grid/impl/PgGridClusterMessageBroker'

const ensureAllLiterals = <TKey extends string>(keys: Record<TKey, unknown>): readonly TKey[] => {
  return Object.keys(keys) as TKey[]
}

type InferGridClusterMessage<T extends GridClusterMessage['type']> = GridClusterMessage extends infer M
  ? M extends {
      type: T
    }
    ? M
    : never
  : never

type GridClusterMessageArbitraries = {
  [Type in GridClusterMessage['type']]: fc.Arbitrary<InferGridClusterMessage<Type>>
}

const parcelIdArb = fc.nat()
const patchArb = fc.dictionary(fc.string(), fc.anything())
const senderArb = fc.string()

const lightmapStatusArb = fc.constantFrom<LightmapStatus[]>(
  ...ensureAllLiterals<LightmapStatus>({
    None: '',
    Requested: '',
    HashMismatch: '',
    Baking: '',
    Baked: 'azzz',
    Failed: 'soz bro',
  }),
)

const maybeWithSpaceId = <M extends GridClusterMessage>(messageArb: fc.Arbitrary<M>): fc.Arbitrary<M> => {
  type SpaceIdSetInstruction =
    | {
        type: 'setAsUuid'
        value: string
      }
    | {
        type: 'setAsUndefined'
      }
    | {
        type: 'unset'
      }

  const spaceIdSetInstructionArb: fc.Arbitrary<SpaceIdSetInstruction> = fc.oneof(
    fc.uuid().map(
      (value): SpaceIdSetInstruction => ({
        type: 'setAsUuid',
        value,
      }),
    ),
    fc.constant<SpaceIdSetInstruction>({
      type: 'setAsUndefined',
    }),
    fc.constant<SpaceIdSetInstruction>({
      type: 'unset',
    }),
  )

  return fc.tuple(messageArb, spaceIdSetInstructionArb).map(([message, spaceIdSetInstruction]) => {
    switch (spaceIdSetInstruction.type) {
      case 'setAsUuid':
        return {
          ...message,
          payload: {
            ...message.payload,
            spaceId: spaceIdSetInstruction.value,
          },
        }
      case 'setAsUndefined':
        return {
          ...message,
          payload: {
            ...message.payload,
            spaceId: undefined,
          },
        }
      case 'unset':
        return message
    }
  })
}

const gridClusterMessageArbs: GridClusterMessageArbitraries = {
  patchCreate: fc.record<GridClusterMessage.PatchCreate>({
    type: fc.constant('patchCreate'),
    payload: fc.record({
      parcelId: parcelIdArb,
      patch: patchArb,
      sender: senderArb,
    }),
  }),
  patchStateCreate: fc.record<GridClusterMessage.PatchStateCreate>({
    type: fc.constant('patchStateCreate'),
    payload: fc.record({
      parcelId: parcelIdArb,
      patch: patchArb,
      sender: senderArb,
    }),
  }),
  metaUpdate: fc.record<GridClusterMessage.MetaUpdate>({
    type: fc.constant('metaUpdate'),
    payload: fc.record({
      parcelId: parcelIdArb,
    }),
  }),
  scriptUpdate: fc.record<GridClusterMessage.ScriptUpdate>({
    type: fc.constant('scriptUpdate'),
    payload: fc.record({
      parcelId: parcelIdArb,
    }),
  }),
  lightmapUpdate: fc.record<GridClusterMessage.LightmapUpdate>({
    type: fc.constant('lightmapUpdate'),
    payload: fc.record({
      parcelId: parcelIdArb,
      lightmap_url: fc.string(),
    }),
  }),
}

const gridClusterMessageArb = maybeWithSpaceId(fc.oneof(...Object.values(gridClusterMessageArbs)))

test('PgGridClusterMessageBroker#encodeDecode', (t) => {
  fc.assert(
    fc.property(gridClusterMessageArb, (msg) => {
      const msg0 = mapFromPgNotificationArgs(...mapToPgNotificationArgs(msg))

      t.deepEquals(msg, msg0)
    }),
  )

  t.end()
})
