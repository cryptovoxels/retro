local Eagle = setmetatable({}, Critter)
Eagle.__index = Eagle
eagles = {} -- Other scripts can call eagles[id]:on_target(rat) or :on_squawk().

function Eagle:on_target(rat)
  if self.state ~= "circling" or self.time < self.hungry_at then return end
  local prey = claim_rat(self, rat)
  if prey then self:enter("diving", 0, prey) end
end

function Eagle:on_squawk()
  if self.state == "perching" or self.state == "cleaning" then self:climb() end
end

function Eagle:climb()
  self:enter("climbing", 0, vec(self.position.x, self.altitude, self.position.z))
end

function Eagle:find_perch()
  local sites = self:nav_candidates("+y", 10)
  local perch
  for i = 1, #sites do
    local site = sites[i]
    if site.sky and site.y + 0.5 < self.altitude and (not perch or site.y > perch.y) then perch = site end
  end
  if not perch then return self:enter("circling", 2) end
  perch.y = perch.y + 0.16 -- model origin above the talons
  self.perch = perch
  self:enter("approaching", 0, vec(perch.x, math.max(self.position.y, perch.y + 2), perch.z))
end

function Eagle:circling(dt)
  local a = self.phase + self.time * 0.48
  move_to(self, vec(10 + 1.6 * math.cos(a), self.altitude, 10 + 5 * math.sin(a)), 4.5 * dt)
  if self.age < self.duration then return end
  self:on_target()
  if self.state == "circling" then self:find_perch() end
end

function Eagle:diving(dt)
  local rat = rat_position(self.target)
  if not rat then release_rat(self); return self:climb() end
  if move_to(self, rat, 8 * dt) then self:enter("grabbing", 0.4, self.target) end
end

function Eagle:grabbing(dt)
  local rat = rat_position(self.target)
  if not rat then release_rat(self); return self:climb() end
  if move_to(self, rat, 8 * dt) and self.age >= self.duration then
    eat_rat(self, 8)
    self.hungry_at = self.time + 18 + self.id
    self:climb()
  end
end

function Eagle:climbing(dt)
  if move_to(self, self.target, 5 * dt) then self:enter("circling", 3 + self.id) end
end

function Eagle:approaching(dt)
  if move_to(self, self.target, 5 * dt) then self:enter("landing", 0, self.perch) end
end

function Eagle:landing(dt)
  if move_to(self, self.target, 3 * dt) then
    self.pitch = 0
    self:enter("perching", 3 + self.id)
  end
end

function Eagle:perching()
  if self.age >= self.duration then self:enter("cleaning", 3) end
end

function Eagle:cleaning()
  if self.age >= self.duration then self:climb() end
end

-- Pure local offsets: position, rotation. Only elapsed state time goes in.
local function still(t) return vec(0, 0, 0), vec(0, 0, 0) end
local function glide(t) return vec(0, 0.04 * math.sin(t * 2), 0), vec(0, 0, 0.12 * math.sin(t)) end
local function breathe(t) return vec(0, 0.012 * math.sin(t * 3), 0), vec(0, 0.08 * math.sin(t), 0) end
local function preen(t) return vec(0, -0.02 * math.sin(t * 3)^2, 0), vec(0.22 * math.sin(t * 6), 0.35 * math.sin(t * 3), 0.18) end

Eagle.idles = {circling = glide, diving = still, grabbing = still, climbing = still,
               approaching = glide, landing = still, perching = breathe, cleaning = preen}

function wake_eagle(id)
  local a = id * 2 * math.pi / 5
  local bird = Eagle:new(id, vec(10 + 1.6 * math.cos(a), 8 + id * 0.5, 10 + 5 * math.sin(a)))
  bird.phase, bird.altitude, bird.hungry_at = a, bird.position.y, 0
  bird:enter("circling", 3 + id * 3)
  eagles[id] = bird
end

function tick_eagle(id, dt)
  local bird = eagles[id]
  local position, rotation = bird:tick(dt)
  return bird, position, rotation
end
