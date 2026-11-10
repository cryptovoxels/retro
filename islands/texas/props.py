"""Bake Texas street furniture with python3 -m islands.texas.props."""
from pathlib import Path
from islands.vox import Vox

out = Path(__file__).resolve().parents[2] / "dist/models/artpacks/texas"
iron, steel, brass = "323d43", "536063", "c79b57"

# A slatted pecan seat with cast iron arms, through bolts and open legs.
bench = Vox(32, 12, 17)
for x in (4, 26):
    bench.box((x, 1, 0), (x + 2, 11, 9), iron)
    bench.box((x, 3, 0), (x + 2, 9, 6))
    bench.box((x, 9, 8), (x + 2, 11, 17), steel)
    bench.box((x, 2, 8), (x + 2, 3, 12), steel)
    bench.box((x, 2, 11), (x + 2, 10, 12), iron)
for y, color in zip((0, 3, 6), ("ad6740", "bd7a4b", "a76337")):
    bench.box((0, y, 7), (32, y + 2, 9), color)
for z, color in ((11, "a86239"), (15, "b87547")):
    bench.box((0, 8, z), (32, 10, z + 2), color)
    for x in (4, 27):
        bench.box((x, 8, z), (x + 1, 9, z + 1), brass)
bench.save(out / "bench.vox")

# Stepped castings, opposing capped outlets and a brass operating nut.
hydrant = Vox(18, 14, 22)
red, light = "bd4637", "de6150"
hydrant.box((2, 2, 0), (16, 12, 2), iron)
hydrant.box((4, 3, 2), (14, 11, 17), red)
hydrant.box((5, 2, 3), (13, 12, 16), red)
hydrant.box((1, 5, 8), (17, 9, 12), light)
for x in (0, 15):
    hydrant.box((x, 4, 7), (x + 3, 10, 13), red)
    hydrant.box((x, 5, 8), (x + 3, 9, 12), brass)
hydrant.box((6, 0, 7), (12, 4, 13), brass)
hydrant.box((3, 2, 16), (15, 12, 18), light)
hydrant.box((5, 3, 18), (13, 11, 20), red)
hydrant.box((7, 5, 20), (11, 9, 22), brass)
hydrant.save(out / "hydrant.vox")

# A hollow lantern cage leaves room for the separate emissive lantern feature.
lamp = Vox(8, 8, 32)
lamp.box((1, 1, 0), (7, 7, 2), iron)
lamp.box((2, 2, 2), (6, 6, 5), steel)
lamp.box((3, 3, 5), (5, 5, 24), iron)
for z in (5, 22):
    lamp.box((2, 2, z), (6, 6, z + 1), brass)
lamp.box((1, 1, 24), (7, 7, 30), iron)
lamp.box((2, 1, 25), (6, 7, 29))
lamp.box((1, 2, 25), (7, 6, 29))
lamp.box((0, 0, 30), (8, 8, 31), steel)
lamp.box((2, 2, 31), (6, 6, 32), brass)
lamp.save(out / "lamp-post.vox")
