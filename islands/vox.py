"""Build a MagicaVoxel model with ordered solid boxes and box cutouts. Z is up."""
import struct
from itertools import product


class Vox:
    def __init__(self, width, depth, height):
        self.size = (width, depth, height)
        if not all(1 <= n <= 256 for n in self.size):
            raise ValueError("VOX axes must fit in a byte")
        self.cells = {}

    def box(self, start, end, color=None):
        """Fill [start, end) with an RGB hex color, or subtract it when omitted."""
        if len(start) != 3 or len(end) != 3 or not all(0 <= a < b <= n for a, b, n in zip(start, end, self.size)):
            raise ValueError(f"box outside {self.size}: {start}, {end}")
        for cell in product(*(range(a, b) for a, b in zip(start, end))):
            if color is None:
                self.cells.pop(cell, None)
            else:
                self.cells[cell] = color

    def save(self, path):
        colors = {rgb: i for i, rgb in enumerate(dict.fromkeys(self.cells.values()), 1)}
        if not 1 <= len(colors) <= 255:
            raise ValueError("a VOX model needs 1 to 255 colors")
        palette = b"".join(bytes.fromhex(rgb) + b"\xff" for rgb in colors)
        pixels = b"".join(bytes((*cell, colors[color])) for cell, color in self.cells.items())

        def chunk(name, data=b"", children=b""):
            return name + struct.pack("<II", len(data), len(children)) + data + children

        body = chunk(b"SIZE", struct.pack("<III", *self.size))
        body += chunk(b"XYZI", struct.pack("<I", len(self.cells)) + pixels)
        body += chunk(b"RGBA", palette.ljust(1024, b"\0"))
        path.write_bytes(b"VOX " + struct.pack("<I", 150) + chunk(b"MAIN", children=body))
