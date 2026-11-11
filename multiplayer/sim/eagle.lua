-- Distances are half-metre cells on the Texas street. Time is in seconds.
local huntAt = {}

local function circle(id, time, step)
  local angle = time * 0.45 + id * 2 * math.pi / 5
  flyTo(id, 20 + 4 * math.cos(angle), 16 + id, 20 + 14 * math.sin(angle), step)
end

function wakeEagle(id)
  circle(id, 0, math.huge)
  huntAt[id] = 3 + id * 3
end

function flyEagle(id, time, dt)
  if time >= huntAt[id] and claimRat(id) then
    if dive(id, 16 * dt) then
      eatRat(id, 8)
      huntAt[id] = time + 18 + id
    end
  else
    circle(id, time, 9 * dt)
  end
end
