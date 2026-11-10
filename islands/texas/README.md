# texas

Open [/admin/island?draft=texas](http://localhost:9000/admin/island?draft=texas). Build repeats the current seed. Regenerate rolls another. Save draft keeps that iteration in the local database. The checked-in starting recipe is in `draft.json`.

## recipe

- `layout.ts` places the ten districts, streets, numbered lots, terraces and creek beds. `streets.json` holds the 100 selected Census TIGER street names.
- `buildings.ts` paints each parcel in street-facing coordinates. The ten styles have relative weights of 0.76 to the power of their rank. Parcel coordinates seed the draw so adjacent buildings vary and rebuilding gives the same facade.
- `furniture.ts` revisits curb slots five times. Empty space competes with a lamp, hydrant, bench or thrift find. Nearby objects change the score. Street mouths and door approaches are excluded. Hydrants need a corner clear of potholes.
- `artpack.json` and `models.ts` hold the selected 256 models, their VOX extents, the building atlas and the four ground color/height pairs. `source/sample.json` records the original 500 randomly sampled production IDs. The selection used working VOX files up to 32 voxels on each axis.
- To rebuild the ground and trim assets, run `python3 islands/texas/ground.py`, then `finishes.py` and `frames.py` in the same directory from the repo root (Python with Pillow). The source swatches are in `source/ground.png`. Runtime files live under `dist/textures` and `dist/models/artpacks/texas`.
- The shared island worker rasterizes the roads and terrain, and writes the byte field. The admin preview and insert handlers call the same parcel builder. Island furniture uses the ordinary feature renderer with an island owner.

## review list

- [ ] Fit the 736 parcels inside a supplied Texas bitmap with a recognizable panhandle. Today the ten suburbs occupy hand-placed blocks. Compare constrained region growth with a diffusion-generated district/street sketch and enforce parcel count and access after sampling.
- [ ] Draw river and creek guides into that same input. Review crossings, banks, dead ends against cliffs, and pedestrian approaches to the seven terrace elevations.
- [ ] Walk all ten building varieties at street level. Check frame colors and fit, both house silhouettes, the wood-framed mall frontage, saloon porch, square and shop signs against the reference. Review the color and rarity mix across suburbs.
- [ ] Walk busy and quiet intersections. Tune lamp spacing, benches, hydrants, art footprints and doorway clearance. Review landmark-sized placements and the waterfront cinema, record store and star water tower from the reference.
- [ ] Review ground corner transitions, dirt paths, potholes and the 10 cm kerb relief across all four 8x8 pages. Kerb relief currently affects shading; collision follows the terrace mesh.
- [ ] Prototype independent per-face U/V repeat dividers (1, 2, 4, 8) and check compatibility with existing uint16 parcel fields.
- [ ] Review the 256 thrift finds in-world. Add the commissioned VOX collection once the Drive library is available.
- [ ] Check furniture load time and draw cost while walking the full island. Add spatial loading when needed.
- [ ] Exercise the full production generation and insertion flow on a disposable database, including street names, parcel elevations and terrain reload. The local draft is the working copy.
- [ ] Decide which parts of this recipe should become user-editable for the next styled island.
