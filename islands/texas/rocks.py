"""Bake chipped Texas sandstone and creek rocks at quarter resolution."""
import json
from pathlib import Path
from random import Random
from islands.vox import Vox

root = Path(__file__).resolve().parents[2]
pack = json.loads((root / "islands/texas/artpack.json").read_text())
sizes = {}
for i, name in enumerate(pack["rocks"]):
    rand = Random(name)
    w, d, h = ((6,5,4),(6,4,2),(4,4,2),(4,4,6),(5,5,4),
               (7,5,2),(4,4,3),(4,3,4),(6,5,3),(5,4,5))[i%10]
    sizes[name] = [w,d,h]
    rock = Vox(w,d,h)
    colors = ("98513e","b26648","c67b52","d99568") if i<10 else ("887666","a58d72","bca688","c9b08f")
    corners = rand.sample([(0,0),(0,d-1),(w-1,0),(w-1,d-1)],4)
    for z in range(h):
        for y in range(d):
            for x in range(w):
                dist = [abs(x-a)+abs(y-b) for a,b in corners]
                if dist[0] == 0 or (dist[1] == 0 and z >= h//2) or (dist[2] <= (i%3 == 0) and z == h-1):
                    continue
                if i>=10 and dist[3]==0 and z==0:
                    continue
                if i%10 == 4 and x==w//2 and y<d-1 and z==h-1:
                    continue
                vein = z + (x if i%2 else y)*.18
                color = colors[0 if vein<h*.24 else 1 if vein<h*.52 else 3 if vein<h*.68 else 2]
                rock.box((x,y,z),(x+1,y+1,z+1),color)
    rock.save(root/"dist/models/artpacks/texas"/(name+".vox"))
(root/"islands/texas/rock-sizes.json").write_text(json.dumps(sizes, indent=2)+"\n")
