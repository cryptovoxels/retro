"""Bake the articulated Texas animals with python3 -m islands.texas.critters."""
import math
from pathlib import Path
from islands.vox import Vox

out = Path(__file__).resolve().parents[2] / 'dist/models/critters'
out.mkdir(exist_ok=True)


def oval(model, center, radius, color):
    """Fill an ellipsoid on voxel centres."""
    for x in range(model.size[0]):
        for y in range(model.size[1]):
            for z in range(model.size[2]):
                if sum(((a + .5 - b) / r) ** 2 for a, b, r in zip((x, y, z), center, radius)) <= 1:
                    model.cells[x, y, z] = color


# The importer maps -Y to forward, Z to up. One cell is two centimetres.
for i, fur in enumerate(('796553', '64585d', '98806c')):
    rat = Vox(18, 44, 19)
    rat.box((1, 13, 1), (17, 36, 15), fur)       # haunches
    rat.box((3, 4, 3), (15, 16, 14), fur)         # head
    rat.box((6, 0, 5), (12, 5, 9), 'cb8d89')     # nose
    for x in (2, 12):
        rat.box((x, 11, 12), (x+4, 14, 18), 'd49e94')
    for x in (2, 14):
        rat.box((x, 5, 9), (x+2, 8, 12), '221d1d')
    rat.save(out / f'rat-{i}.vox')

tail = Vox(8, 20, 3)
tail.box((3, 0, 0), (5, 10, 2), 'c58e86')
tail.box((3, 8, 0), (7, 11, 2), 'c58e86')
tail.box((5, 10, 0), (7, 19, 2), 'c58e86')
tail.save(out / 'rat-tail.vox')

cap = Vox(12, 13, 5)
cap.box((0, 1, 0), (12, 13, 5), 'aa3831')
cap.save(out / 'rat-cap.vox')

chip = Vox(6, 10, 3)
chip.box((0, 0, 0), (6, 10, 3), 'edbc59')
chip.save(out / 'chip.vox')

eagle = Vox(18, 49, 25)
oval(eagle, (9, 24, 13), (7.8, 14.5, 7.6), '503a2c')
oval(eagle, (9, 26, 16), (6.4, 12.5, 5), '6a4c35')
for x in range(3, 16, 3):
    oval(eagle, (x, 37, 12), (1.9, 10.8-abs(x-9)*.25, 1.9), 'dcd5bf')
oval(eagle, (9, 12, 16), (6.2, 7.4, 6.1), 'e6e2d5')
oval(eagle, (9, 6, 15), (3.4, 5.4, 2.6), 'dda638')
eagle.box((8, 1, 12), (10, 3, 16), 'e8ae3a')
for side in (-1, 1):
    x = 9 + side * 5
    eagle.box((x-1, 8, 17), (x+1, 10, 19), '302718')
    eagle.box((x-1, 8, 19), (x+1, 12, 20), 'c7bfab')
    eagle.box((x-1, 26, 4), (x+1, 29, 9), 'd49a38')
    for toe in (-1, 1):
        eagle.box((x+toe, 23, 3), (x+toe+1, 28, 5), 'bd8530')
eagle.save(out / 'eagle.vox')

# One outstretched wing, mirrored at the opposite shoulder.
wing = Vox(55, 24, 7)
for x in range(53):
    sweep = 3 + int(8 * (x/53)**2)
    chord = round(16 - 9*x/53)
    for y in range(sweep, sweep+chord):
        z = 2 + int(2 * math.sin(x/53*math.pi))
        color = '74543b' if y < sweep+3 else '5b402e' if y < sweep+8 else '453427'
        wing.box((x, y, z), (x+1, y+1, z+1+(x < 28 and y < sweep+8)), color)
for i in range(5):
    for x in range(34, 55-i*2):
        y = 10+i*2+(x-34)//7
        wing.box((x,y,2), (x+1,y+2,4), '3c3029' if i%2 else '49382b')
wing.save(out / 'eagle-wing.vox')
