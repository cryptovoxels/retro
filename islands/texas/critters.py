"""Bake the articulated Texas animals with python3 -m islands.texas.critters."""
from pathlib import Path
from islands.vox import Vox

out = Path(__file__).resolve().parents[2] / 'dist/models/critters'
out.mkdir(exist_ok=True)


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
eagle.box((1, 13, 7), (17, 36, 19), '503a2c')     # body
eagle.box((3, 5, 12), (15, 17, 24), 'e6e2d5')     # head
eagle.box((6, 0, 13), (12, 5, 17), 'dda638')      # beak
eagle.box((3, 36, 10), (15, 48, 13), 'e6e2d5')    # tail
for x in (3, 13):
    eagle.box((x, 6, 18), (x+2, 8, 20), '302718')
    eagle.box((x, 21, 3), (x+2, 28, 7), 'dda638')
eagle.save(out / 'eagle.vox')

# One outstretched wing, mirrored at the opposite shoulder.
wing = Vox(55, 24, 7)
wing.box((0, 4, 2), (33, 19, 6), '664a35')
wing.box((33, 9, 2), (55, 20, 5), '503a2c')
wing.save(out / 'eagle-wing.vox')
