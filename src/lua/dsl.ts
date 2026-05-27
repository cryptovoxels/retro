// Lua DSL prelude loaded into every behaviour VM.
// State is plain Lua values now - no descriptor wrappers. Animation is driven
// by self:animate(target, ms) + a tick(self, t) function. The runtime stamps
// t0/t1 on the JS side and only invokes tick while now < t1.
//
// Vec3 and Euler are global helpers. Euler is degrees - the runtime converts
// to radians before writing to feature.description.rotation.

export const DSL_PRELUDE = `
__behaviour_specs = __behaviour_specs or {}

function number(default, opts)
  opts = opts or {}
  return {
    __kind = "param",
    paramType = "number",
    default = default,
    min = opts.min,
    max = opts.max,
    step = opts.step,
  }
end

-- 'text' instead of 'string' so we don't shadow Lua's string stdlib.
function text(default)
  return { __kind = "param", paramType = "string", default = default }
end

function boolean(default)
  return { __kind = "param", paramType = "boolean", default = default }
end

function behaviour(name)
  return function(spec)
    spec.name = name
    table.insert(__behaviour_specs, spec)
    return spec
  end
end

-- Easing helpers. Use however you like inside tick(self, t).
ease = {
  linear      = function(t) return t end,
  in_quad     = function(t) return t * t end,
  out_quad    = function(t) return 1 - (1 - t) * (1 - t) end,
  in_out_quad = function(t)
    if t < 0.5 then return 2 * t * t end
    return 1 - ((-2 * t + 2) ^ 2) / 2
  end,
  in_cubic    = function(t) return t * t * t end,
  out_cubic   = function(t) return 1 - (1 - t) ^ 3 end,
  in_out_cubic= function(t)
    if t < 0.5 then return 4 * t * t * t end
    return 1 - ((-2 * t + 2) ^ 3) / 2
  end,
}

function lerp(a, b, t) return a + (b - a) * t end

-- Vec3 with operator overloading. Plain lowercase props.
do
  local mt = {}
  Vec3 = setmetatable({ __type = "Vec3" }, {})
  mt.__index = Vec3

  function Vec3.new(x, y, z)
    return setmetatable({ x = x or 0, y = y or 0, z = z or 0 }, mt)
  end

  local function isVec(v) return type(v) == "table" and v.__type == "Vec3" end

  mt.__add = function(a, b)
    if type(a) == "number" then return Vec3.new(a + b.x, a + b.y, a + b.z) end
    if type(b) == "number" then return Vec3.new(a.x + b, a.y + b, a.z + b) end
    if isVec(a) and isVec(b) then return Vec3.new(a.x + b.x, a.y + b.y, a.z + b.z) end
  end
  mt.__sub = function(a, b)
    if type(a) == "number" then return Vec3.new(a - b.x, a - b.y, a - b.z) end
    if type(b) == "number" then return Vec3.new(a.x - b, a.y - b, a.z - b) end
    if isVec(a) and isVec(b) then return Vec3.new(a.x - b.x, a.y - b.y, a.z - b.z) end
  end
  mt.__mul = function(a, b)
    if type(a) == "number" then return Vec3.new(a * b.x, a * b.y, a * b.z) end
    if type(b) == "number" then return Vec3.new(a.x * b, a.y * b, a.z * b) end
    if isVec(a) and isVec(b) then return Vec3.new(a.x * b.x, a.y * b.y, a.z * b.z) end
  end
  mt.__div = function(a, b)
    if type(a) == "number" then return Vec3.new(a / b.x, a / b.y, a / b.z) end
    if type(b) == "number" then return Vec3.new(a.x / b, a.y / b, a.z / b) end
    if isVec(a) and isVec(b) then return Vec3.new(a.x / b.x, a.y / b.y, a.z / b.z) end
  end
  mt.__tostring = function(t) return "(" .. t.x .. ", " .. t.y .. ", " .. t.z .. ")" end

  function Vec3:magnitude()
    return math.sqrt(self.x * self.x + self.y * self.y + self.z * self.z)
  end
  function Vec3:unit()
    local m = self:magnitude()
    if m == 0 then return Vec3.new(0, 0, 0) end
    return Vec3.new(self.x / m, self.y / m, self.z / m)
  end
  function Vec3:dot(b) return self.x * b.x + self.y * b.y + self.z * b.z end
  function Vec3:cross(b)
    return Vec3.new(
      self.y * b.z - self.z * b.y,
      self.z * b.x - self.x * b.z,
      self.x * b.y - self.y * b.x
    )
  end
  function Vec3:lerp(b, t) return self + (b - self) * t end
end

-- Euler in degrees. Plain x/y/z holder; runtime converts to radians at the boundary.
do
  local mt = {}
  Euler = setmetatable({ __type = "Euler" }, {})
  mt.__index = Euler

  function Euler.new(x, y, z)
    return setmetatable({ x = x or 0, y = y or 0, z = z or 0 }, mt)
  end
  mt.__tostring = function(t) return "Euler(" .. t.x .. ", " .. t.y .. ", " .. t.z .. ")" end
end
`
