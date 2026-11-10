"""Bake shaded VOX trim palettes from the Texas wall atlas. Run from repo root."""
import json
from pathlib import Path
from PIL import Image

models = Path("dist/models/artpacks/texas")
atlas = Image.open("dist/textures/texas-thrift.png").convert("RGB")
colors = atlas.resize((4, 4), Image.Resampling.BOX)
for tile in json.loads(Path("islands/texas/artpack.json").read_text())["frames"]["tiles"]:
    layer = tile + 1  # getBlockId stores a one-based layer; the mesher samples it directly.
    rgb = colors.getpixel((layer % 4, layer // 4))
    for kind in ("window", "door", "viga"):
        vox = bytearray((models / f"{kind}-honey.vox").read_bytes())
        start = vox.index(b"RGBA") + 12
        for i, shade in enumerate((0.81, 0.54, 1, 1.16)):
            at = start + 4 * i
            vox[at:at+3] = bytes(min(255, round(c * shade)) for c in rgb)
        (models / f"{kind}-{tile}.vox").write_bytes(vox)
