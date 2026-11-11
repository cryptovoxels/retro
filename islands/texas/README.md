# texas

Open [/admin/island?draft=texas](http://localhost:9000/admin/island?draft=texas). Build repeats the current seed. Regenerate rolls another. Save draft keeps that iteration in the local database. The checked-in starting recipe is in `draft.json`.

## recipe

- `layout.ts` places the ten districts, streets, numbered lots, terraces and creek beds. `streets.json` holds the 100 selected Census TIGER street names.
- `parcels/buildings.ts` paints each parcel in street-facing coordinates. The ten styles have relative weights of 0.76 to the power of their rank. Parcel coordinates seed the draw so adjacent buildings vary and rebuilding gives the same facade.
- `furniture.ts` revisits curb slots five times. Empty space competes with a lamp, hydrant, bench or thrift find. Nearby objects change the score. Street mouths and door approaches are excluded. Hydrants need a corner clear of potholes.
- Island furniture uses VOX models. Build the bench, hydrant and lamp post with `python3 -m islands.texas.props` from the repo root. The shared `islands/vox.py` helper paints solid boxes or subtracts them when the color is omitted. The lamp cage holds a separate lantern feature.
- `artpack.json` and `models.ts` hold the selected 256 models, their VOX extents, the building atlas and the four ground colour pages. `source/sample.json` records the original 500 randomly sampled production IDs. The selection used working VOX files up to 32 voxels on each axis.
- To rebuild the ground and trim assets, run `python3 islands/texas/ground.py`, then `finishes.py` and `frames.py` in the same directory from the repo root (Python with Pillow). The source swatches are in `source/ground.png`. Texas loads its models and atlases from `https://ugc.voxels.com/artpacks/texas/v1/`. Local bake outputs live in `assets/`.
- The shared island worker rasterizes the roads and terrain, and writes the byte field. The admin preview and insert handlers call the same parcel builder. Island furniture uses the ordinary feature renderer with an island owner.

- `parcels/windows.ts` divides each face around a large pane. The interior and exterior VOX trim follows the same aperture. `parcels/gallery.ts` fits ArtFrames onto the solid space between openings. The two batwing doors share a Lua behaviour link; benches, rocking chairs and camp logs carry their own seat pose.
- The ten unsold commons alternate between `parcels/mesa.ts` and `parcels/camp.ts`. The mesa footprint also paints the underlying soil; campfires, seats and cosmetic bulb strings belong to the camps. Bake the 15 plants and 20 chipped rocks with `python3 -m islands.texas.flora` and `python3 -m islands.texas.rocks`. The rock bake writes the dimensions used to centre the collidable river steps.
- VOX models accept keyframes or one wind preset: `grass`, `bush`, `tree`, `flag`. The vertex shader uses world coordinates and a shared clock; no animation tracks are stored for plants or flags.

## before production

- [ ] Walk the default seed in first and third person. Check batwing approach/click, the two-metre E prompt, sit/stand, gallery sight lines and river steps at low and high banks.
- [ ] Repeat the desktop gallery flight on mobile and on the compact layout. On the pre-compaction seed, Jett Way in Dallas had the most ArtFrames (293 of 21,447). Two fresh Chromium contexts flew the same 50 m over 20 s at 1100x760 after 9 s of warmup. With frames, median/p95/p99 were 7.5/39.9/183.5 ms, with 45 frames over 50 ms and peak JS heap of 543 MiB. Omitting ArtFrames gave 7.0/20.3/71.5 ms, 24 frames over 50 ms and 491 MiB peak. Up to 1,960 ArtFrames and 72 parcels were instantiated in the full run. One pass per condition, without forced GC.
- [ ] Rehearse insertion on a disposable database, inspect the 10 commons and mint exclusions, verify street names/heights, then reload the persisted terrain. Save draft does not insert parcels.

## lighting - scoped for later

Keep the half-metre cell and current palette/AO. First build two touching test parcels and one street, with a lamp inside a doorway. Register their solids, glass colours and lights in one world grid. Bake only occupied or lit 32x32x32-cell chunks in the worker. Pass light across chunk faces; internal chunk edges must never be treated as open sky. When a light, wall or loaded neighbour changes, dirty its chunk and propagate only changed borders. Version jobs so late results cannot resurrect an unloaded chunk.

Make the parcel mesher and island ground shader sample the same probes. The first demo should show the lamp spilling onto the street, a wall stopping it, stained glass tinting it, and light disappearing when the lamp or parcel is removed. Compare bake time, frame time and memory against the current per-parcel bake before widening the rollout.

## review list

- [x] Fit the 736 parcels to the 32x32 pixel silhouette in `source/shape.png`. The generator reads its lossless row spans in `source/shape.json` for both street placement and terrain.
- [ ] Draw river and creek guides into that same input. Review crossings, banks, dead ends against cliffs, and pedestrian approaches to the seven terrace elevations.
- [ ] Walk all ten building varieties at street level. Check frame colors and fit, both house silhouettes, the wood-framed mall frontage, saloon porch, square and shop signs against the reference. Review the color and rarity mix across suburbs.
- [ ] Walk busy and quiet intersections. Tune lamp spacing, benches, hydrants, art footprints and doorway clearance. Review landmark-sized placements and the waterfront cinema, record store and star water tower from the reference.
- [ ] Review ground corner transitions, dirt paths, potholes across all four 8x8 pages.
- Deferred: independent per-face U/V repeat dividers and individual ground-tile relief. The island uses the regular parcel UVs and four colour atlas pages.
- [ ] Review the 256 thrift finds in-world. Add the commissioned VOX collection once the Drive library is available.
- [ ] Check furniture load time and draw cost while walking the full island. Add spatial loading when needed.
- [ ] Decide which parts of this recipe should become user-editable for the next styled island.
