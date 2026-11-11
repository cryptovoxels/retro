# critter scripts

A creature row supplies an id, species, island and spawn x/z in world metres. The species names its server class and client rig. A region wakes when a viewer approaches. On sleep its transient movement state goes away. Saved island previews use the matching draft slug.

## server movement

Put a .lua file in multiplayer/sim/classes. Assign a table to classes.your_species. The loader reads all class files once per process. Implement two methods.

- wake() receives self.id, self.position, self.rotation and self.phase. Return false to skip this spawn.
- step(dt) updates those three pose fields. Positions are world metres, rotations are XYZ Euler radians, phase is a cyclic angle in radians. The server advances at 5 Hz.
- floor_at(x, y, z, reach) returns the closest exposed voxel top within reach metres vertically, or nil. Equal distances choose the lower floor. Samples stay inside the current 32m tile. Tiles use saved ground and overlapping parcel voxels at wake. Polygon islands use their shoreline and holes.
- Vector2.new(x,y) and Vector3.new(x,y,z) provide X/Y/Z, Magnitude, Unit, Dot, Cross and Lerp. Use +, -, unary minus, scalar or component-wise multiplication and division. Omitted components and a zero vector's Unit are zero. These Lua tables are mutable.

The multiplayer snapshot contains [id, model, [x,y,z], [rx,ry,rz], phase]. Appearance and disappearance from a nearby viewer's snapshot spawn and remove the model. Class methods are private to the simulation.

## client rigs

Put a repo-authored .rig.lua file in src/rigs and register its import in src/critters.ts. The rat and eagle rigs are working examples. Each part has an asset name (or a list of variants selected by id) and an optional parent declared earlier. Position sets the joint pivot. Offset places the mesh relative to its joint. Mirror flips the joint's X axis.

animate(pos, rot, phase) returns a table keyed by part name. Assign position and rotation in the parent's coordinate system. A root receives world coordinates. Use pos or rot directly, or Vector3.new with scalar expressions. Scalars support finite numbers, pos.X/Y/Z, rot.X/Y/Z, phase, +, -, *, unary minus, math.sin and math.cos.

The build parses the rig with luaparse and emits direct Babylon vector writes. The browser interpolates the packet once per frame and calls the compiled function. Only checked-in rigs enter this build. Server Lua has a separate runtime and API.

## checks

Run node --import tsx multiplayer/sim/check.cjs for the built core and terrain fixtures, and pnpm exec vitest run test/critters.test.ts for the packet, compiler and Babylon model checks. After changing C, rebuild core.cjs with sh multiplayer/sim/build.sh (Emscripten and Lua 5.4.7).
