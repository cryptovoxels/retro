local a=Vector2.new(3,4)
assert(a.Magnitude==5 and (2*a).X==6 and a:Dot(a)==25 and a:Cross(Vector2.new(0,1))==3)
assert(a:Lerp(Vector2.new(5,6),0.5)==Vector2.new(4,5))
local v=Vector3.new(1,0,0):Cross(Vector3.new(0,1,0))
assert(v==Vector3.new(0,0,1) and v.Unit==v and -v==Vector3.new(0,0,-1))
assert(Vector3.zero.Unit==Vector3.zero)
-- The same four-cell ledge and overhead platform are stamped at two world origins.
function check_floor(x,z)
  assert(math.abs(floor_at(x,0,z,1)-0.24)<0.00001)
  assert(math.abs(floor_at(x,2,z,1)-1.74)<0.00001)
  assert(floor_at(x,1,z,0.1)==nil)
  assert(floor_at(x-0.5,0,z,4)==nil)
  assert(floor_at(x+2,0,z,4)==nil)
end

local original=classes.rat.wake
function classes.rat:wake()
  if self.id==1 then check_floor(self.position.X,self.position.Z) end
  return original(self)
end

function shore_test(x,z)
  assert(math.abs(floor_at(x,0,z,2)-0.74)<0.00001)
  assert(floor_at(x+1,0,z+1,2)==nil)
  assert(floor_at(x+5,0,z,2)==nil)
end

classes.probe = {wake=function(self) shore_test(self.position.X,self.position.Z) end}
