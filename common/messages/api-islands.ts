////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Types for /api/islands

import * as t from 'io-ts'

export const PointGeometry = t.type(
  {
    type: t.literal('Point'),
    crs: t.type({
      type: t.literal('name'),
      properties: t.type({
        name: t.string,
      }),
    }),
    coordinates: t.tuple([t.number, t.number]),
  },
  'PointGeometry',
)
export type PointGeometry = t.TypeOf<typeof PointGeometry>

export const IslandRecord = t.type(
  {
    name: t.string,
    texture: t.union([t.string, t.null, t.undefined]),
    position: t.union([PointGeometry, t.null, t.undefined]),
    id: t.number,
    content: t.union([t.UnknownRecord, t.null, t.undefined]),
  },
  'IslandRecord',
)
export type IslandRecord = t.TypeOf<typeof IslandRecord>
