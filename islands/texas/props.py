"""Bake Texas street furniture with python3 -m islands.texas.props."""
from pathlib import Path
from islands.vox import Vox

out = Path(__file__).resolve().parents[2] / "islands/texas/assets/models"
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

# Panelled counter, recessed toe kick and a pale stone worktop.
counter = Vox(28, 12, 18)
counter.box((2, 2, 0), (26, 10, 2), iron)
counter.box((1, 1, 2), (27, 11, 16), "804b39")
for x in (3, 15):
    counter.box((x, 0, 4), (x + 10, 12, 14), "bf8157")
    counter.box((x + 1, 0, 5), (x + 9, 12, 13), "aa6949")
counter.box((0, 0, 16), (28, 12, 18), "eac997")
counter.save(out / "counter.vox")

# Bracket shelf with books, a terracotta pot and a little succulent.
shelf = Vox(26, 8, 13)
for x in (3, 21):
    shelf.box((x, 0, 0), (x + 2, 2, 5), brass)
    shelf.box((x, 0, 3), (x + 2, 6, 5), brass)
shelf.box((0, 0, 5), (26, 8, 7), "b47750")
for x, h, color in ((2, 12, "548388"), (5, 13, "d4af57"), (8, 11, "9d5142")):
    shelf.box((x, 2, 7), (x + 2, 6, h), color)
shelf.box((18, 2, 7), (23, 7, 10), "cd7453")
shelf.box((20, 3, 10), (22, 5, 13), "6b9358")
shelf.save(out / "wall-shelf.vox")

# The VOX reader mirrors X around half the file width + 4. The brass pins
# sit at that pivot so the leaf swings on its jamb.
leaf = Vox(32, 4, 29)
for x in range(1, 20):
    top = 26 - min(5, (19 - x) // 2)
    leaf.box((x, 1, 3), (x + 1, 3, top), "ad6740" if x % 4 else "915336")
for x in (1, 17):
    leaf.box((x, 0, 2), (x + 3, 4, 26 if x == 17 else 22), "864d38")
for z in (5, 16):
    leaf.box((1, 0, z), (20, 4, z + 2), "c28953")
    leaf.box((19, 1, z - 1), (21, 3, z + 3), brass)
leaf.save(out / "batwing.vox")

rocker = Vox(19, 24, 28)
for x in (2,15):
    for y in range(24):
        z = round(3*((y-12)/12)**2)
        rocker.box((x,y,z),(x+2,y+1,z+2),"7f5040")
    for y in (5,17):
        rocker.box((x,y,2),(x+2,y+2,16),"a46844")
    rocker.box((x,4,15),(x+2,20,17),"bf8959")
for y in range(5,19,3):
    rocker.box((2,y,10),(17,y+2,12),"c58b5b")
for x in (2,5,9,13,15):
    for z in range(11,27):
        y=17+(z-11)//6
        rocker.box((x,y,z),(x+2,y+2,z+1),"a76c49")
rocker.box((1,19,25),(18,22,28),"bf8959")
rocker.save(out / "rocker.vox")

# Keep the hoist on the importer's X pivot. A folded fly and a stepped
# five-point star read from either side of the cloth.
from math import sin
flag = Vox(46, 8, 23)
star = ("...#...","...#...","#######",".#####.","..###..",".##.##.",".#...#.")
for u in range(27):
    y = 3+round(2*sin(u*0.34))
    for v in range(18):
        blue = u < 9
        white = blue and 1 <= u <= 7 and 5 <= v <= 11 and star[11-v][u-1] == "#"
        color = ("f3e9d1" if white else "304774") if blue else ("be473d" if v < 9 else "f3e9d1")
        flag.box((26-u,y,v+2),(27-u,y+2,v+3),color)
flag.box((26,3,0),(28,5,22),brass)
flag.save(out / "lone-star.vox")

bulb = Vox(8, 8, 30)
bulb.box((3,3,8),(5,5,30),"51463e")
bulb.box((2,2,6),(6,6,9),brass)
bulb.box((1,1,2),(7,7,6),"ffebc8")
bulb.box((2,2,0),(6,6,2),"fff3d9")
bulb.save(out / "pendant.vox")
