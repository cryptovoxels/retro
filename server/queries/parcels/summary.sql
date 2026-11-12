select properties.id as id,
       address,
       properties.island,
       properties.name as name
from properties
         left join
     suburbs on suburbs.id = properties.suburb_id
order by id asc;
