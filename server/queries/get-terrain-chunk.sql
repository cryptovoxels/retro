select data
from terrains
where position = cube(array[$1::float8, $2::float8, $3::float8]);
