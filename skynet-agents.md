# skynet // voxels field manual

You build in Voxels through MCP tools that drive the owner's own browser tab
(`play?...&agent=skynet`). The tab's login is your login. If the owner can't
edit a parcel, neither can you. Stay inside the parcel you were given.

## start every session

1. `health`. `grid` must be true and the target parcel must be in `editable`.
   If not: the tab isn't open, isn't logged in, or isn't near the parcel. Say
   which. Don't pretend.
2. `get_parcel` for the target id. Note `shape`, `tileset`, `palette`, `budget`.
3. Look before you touch: `read_voxels` (census, a few layers), `list_features`,
   one `screenshot`.
4. Before a big change, `snapshot` it. Keep the version id so you can `revert`.

## coordinates

- Voxel field coordinates are integer `[x, y, z]`, zero based, Y up. Valid
  range is `0` to `shape[axis] - 1`. One voxel is 0.5m, so a 6m wide parcel is
  12 voxels wide.
- +x is east, +z is north. `z = 0` is the south edge, `y = 0` is ground.
- `from`/`to` are inclusive corners, any order.
- Feature `position` is metres, parcel-local, measured from the parcel centre
  at ground level. `[0, 0, 0]` is the middle of the floor. Features can poke a
  few metres past the parcel edge, voxels can't.
- `bounds` in `get_parcel` are world metres, only useful for framing.

## blocks

A voxel is a uint16. `0` is air.

```
value = textureIndex + 1 + tintIndex * 32 + (opaque ? 32768 : 0)
```

- `textureIndex` 0-15 picks a tile from the parcel tileset (a 4x4 atlas).
  Index 1 is glass and is never opaque. Everything else is opaque.
- `tintIndex` 0-7 picks a colour from the parcel palette. Tint 0 leaves the
  tile untouched, use it for artwork.
- Default tiles: 0 grid, 1 glass, 2 plain white, 3 line, 4 bricks, then
  patterns. A custom tileset can replace any of them, check `tileset`.

Examples: white `32771`, white tinted palette 3 `32867`, glass `2`, bricks `32773`.

## budgets

`get_parcel.budget` is how many more of each feature type fit. `add_feature`
refuses when it hits zero. Voxels have no budget, just the field shape.

## writes

- `set_voxels`, `add_feature`, `update_feature`, `remove_feature`, `revert`
  all wait for the server to save before they return. A result means saved.
  An error means not saved, and the tab has been resynced from the server.
- `set_voxels` returns `changed`: voxels that actually changed value. Writing
  what's already there costs nothing and returns 0.
- Batch ops into one `set_voxels` call where you can. Don't edit by hand in the
  tab while the agent is writing.
- Sandbox parcels (`sandbox: true`) don't save. Tell the owner.

## verify

- Check geometry with `read_voxels`, not by looking at pictures. Read the
  layer or region you changed and compare the census.
- `screenshot` (`top`, `iso`, `front`) is for judging looks: proportions,
  materials, light. It can't prove a hole is three voxels wide.
- Persistence is confirmed by the write result. If the owner doubts it,
  `GET /grid/parcels/<id>` reads straight from the database.

## building

- Voxels for structure: walls, floors, roofs, stairs. Features for things:
  models, images, signs, text, lights.
- Block out footprint, doors and height first. Then materials. Then detail.
- Walking scale: a person is about 2m (4 voxels). Doors need 5 voxels of
  headroom. Leave a way in.
- A few good materials repeated beats every tile at once.
- Finish with what changed, what you verified and anything that failed.
