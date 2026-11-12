-- Constructors also accept omitted components, as in Roblox.
local function vector(dim)
  local class, mt = {}, {}
  function class.new(x,y,z)
    return setmetatable({X=x or 0, Y=y or 0, Z=dim==3 and (z or 0) or nil}, mt)
  end
  local new = class.new
  function class:Dot(v) return self.X*v.X + self.Y*v.Y + (self.Z or 0)*(v.Z or 0) end
  function class:Lerp(v,t) return self + (v-self)*t end
  if dim==3 then
    function class:Cross(v)
      return new(self.Y*v.Z-self.Z*v.Y, self.Z*v.X-self.X*v.Z, self.X*v.Y-self.Y*v.X)
    end
  else
    function class:Cross(v) return self.X*v.Y-self.Y*v.X end
  end
  function mt.__index(v,k)
    if k=="Magnitude" then return math.sqrt(v:Dot(v)) end
    if k=="Unit" then return v.Magnitude==0 and new() or v/v.Magnitude end
    return class[k]
  end
  function mt.__add(a,b) return new(a.X+b.X,a.Y+b.Y,(a.Z or 0)+(b.Z or 0)) end
  function mt.__sub(a,b) return new(a.X-b.X,a.Y-b.Y,(a.Z or 0)-(b.Z or 0)) end
  function mt.__unm(a) return new(-a.X,-a.Y,-(a.Z or 0)) end
  function mt.__mul(a,b)
    if type(a)=="number" then a,b=b,a end
    if type(b)=="number" then return new(a.X*b,a.Y*b,(a.Z or 0)*b) end
    return new(a.X*b.X,a.Y*b.Y,(a.Z or 0)*(b.Z or 0))
  end
  function mt.__div(a,b)
    if type(b)=="number" then return a*(1/b) end
    return new(a.X/b.X,a.Y/b.Y,dim==3 and a.Z/b.Z or nil)
  end
  function mt.__eq(a,b) return a.X==b.X and a.Y==b.Y and a.Z==b.Z end
  class.zero = new()
  return class
end

Vector2 = vector(2)
Vector3 = vector(3)
