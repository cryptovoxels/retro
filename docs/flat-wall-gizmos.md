# Flat wall gizmos

Shared in-world edit tools for wall-plane features (showbox, image, NFT, video, etc.).

## Who gets these tools

Allowlist in [`src/tools/flat-wall.ts`](../src/tools/flat-wall.ts):

- `showbox`
- `image`
- `nft-image`
- `video`
- `youtube`
- `sign`
- `vid-screen`
- `richtext`

To add another flat wall type: append it to `FLAT_WALL_FEATURE_TYPES`. Do not special-case in gizmos.

Not included (different interaction): `womp-wall`, `audio`, `text-input`, `slider-input`, polytext, 3D props.

## Tools (when the feature editor is open)

1. **Face drag** — click-hold the plane (not a corner / Z arrow); slides on that plane. Mesh stays unfrozen while bound so drag keeps working after `setCommon` freezes.
2. **Corner resize** — four utility-layer handles; opposite corner pinned; aspect lock via `feature.scaleAspectLocked` (default on when unset).
3. **Depth** — blue Z arrow only (local to the feature). No X/Y arrows.
4. **Snap** — while face-dragging, soft-snap to edges/centers of other flat-wall peers on the same plane; faint guides. Hold Alt to skip.
5. **Outline** — selection highlight follows mesh world pose (not world AABB).

## Entry points

- [`src/tools/flat-wall.ts`](../src/tools/flat-wall.ts) — `isFlatWallFeature` / type list
- [`src/tools/gizmos.ts`](../src/tools/gizmos.ts) — `bindGizmosToFeature` branches on `isFlatWallFeature`
- [`src/tools/feature.ts`](../src/tools/feature.ts) — `updateHighlight` for flat-wall outline

## Authoring mouse

While the edit UI is open, left-click does not force pointer lock (needed for free drag). Click empty space deselects; trailing tap after a real face-drag does not.

## Acceptance

- Open editor on image / NFT / showbox — face drag, corners, Z, outline hug
- Drag near another flat feature on the same wall — snap + guides
- Add a new type to `FLAT_WALL_FEATURE_TYPES` — same tools without further gizmos edits
