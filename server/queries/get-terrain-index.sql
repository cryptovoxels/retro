select cube_ll_coord(position, 1)::int as x,
       cube_ll_coord(position, 2)::int as y,
       cube_ll_coord(position, 3)::int as z
from terrains
order by x, y, z;
