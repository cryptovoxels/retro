# Showbox move / resize

## How it works now

Opening the showbox editor binds gizmos via `bindGizmosToFeature` in `src/tools/gizmos.ts`.

- **Face drag** — `attachWindowDrag`: slide on the screen's local plane (depth locked). Short click does not move. Grab any part of the screen face that is not a corner handle or the Z arrow. Near edges/centers of other same-plane features, soft-snaps and shows faint guide lines (hold Alt to skip).
- **Corner handles** — four utility-layer boxes; opposite corner pinned; aspect lock via `feature.scaleAspectLocked` (default true).
- **Depth** — blue Z `AxisDragGizmo` only (local to the screen). X/Y arrows stay off.
- **Re-stick to another wall** — use the existing **Move** tool (surface snap). Face drag does not wall-snap.

Scale / Position fields in the editor refresh on drag end via `setSelectedFeature`. Aspect lock is the Scale checkbox ("Lock aspect ratio"), mirrored to `scaleAspectLocked`.

## Goals

1. Blue outline hugs during and after corner resize, face drag, and Z depth drag.
2. Corner handles stay on the visible corners every frame.
3. Face drag: U/D/L/R on the current plane only.
4. Z arrow: push in/out along the screen normal.
5. Hit order: corner → Z arrow → face.
6. Click without move does not nudge.
7. Move / resize cursors on face and corners.
8. Second screens (angle mirrors) use the same bind path.

## Non-goals

- Wall-snap during face drag (use Move)
- Free 3D face drag / modifier-key depth
- Landscape/portrait radios wiping custom scale
- Persisting aspect lock across reload
- Parcel hard-bounds on in-world drag

## Acceptance

- Select showbox → outline matches screen; handles on corners; blue Z visible.
- Corner drag → outline + handles follow; release + reload keep size.
- Face drag → plane only; click does not nudge.
- Z drag → in/out along normal; Position updates on end.
- Unlock aspect in Scale → free stretch; lock → uniform again.
- Second screen: same feel as stage.
