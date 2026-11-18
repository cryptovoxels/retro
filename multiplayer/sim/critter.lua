-- Metres from the block origin, seconds since wake, Euler angles in radians.
Critter = {}
Critter.__index = Critter

function vec(x, y, z)
  return {x = x, y = y, z = z}
end

function Critter:new(id, position)
  return setmetatable({id = id, position = position, pitch = 0, yaw = 0, time = 0}, self)
end

function Critter:enter(state, duration, target)
  self.state = state
  self.age = 0
  self.duration = duration or 0
  self.target = target
end

function Critter:nav_candidates(face, radius, path)
  return nav_candidates(self.position, face, radius, path)
end

function Critter:tick(dt)
  self.time = self.time + dt
  self.age = self.age + dt
  self[self.state](self, dt)
  return self.idles[self.state](self.age)
end
