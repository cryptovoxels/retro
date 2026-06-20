// Built-in behaviour presets shown at the top of the "add behaviour" menu.
// Kept in code (not asset_library) so they're trivial to tweak. Picking one copies
// its code inline onto the feature - no DB row, no uuid. They only touch what the
// runtime `self` exposes: position, rotation, visible, state, self:animate, self:emit.

export const BEHAVIOUR_PRESETS: { name: string; code: string }[] = [
  {
    name: 'door',
    code: `local Door = Behave.new("door")
Door.state = { shut = true }

function Door:open(t)
  self.rotation.y = t * 90
end

function Door:close(t)
  self.rotation.y = (1.0 - t) * 90
end

function Door:onclick()
  self:animate(self.state.shut and "open" or "close", 1000)
  self.state.shut = not self.state.shut
end

return Door
`,
  },
  {
    name: 'spinner',
    code: `local Spinner = Behave.new("spinner")

function Spinner:spin(t)
  self.rotation.y = t * 360
end

function Spinner:onclick()
  self:animate("spin", 2000)
end

return Spinner
`,
  },
  {
    name: 'lift',
    code: `local Lift = Behave.new("lift")
Lift.state = { down = true, base = 0 }

function Lift:up(t)
  self.position.y = self.state.base + t * 3
end

function Lift:down(t)
  self.position.y = self.state.base + (1.0 - t) * 3
end

function Lift:onclick()
  self.state.base = self.state.down and self.position.y or (self.position.y - 3)
  self:animate(self.state.down and "up" or "down", 800)
  self.state.down = not self.state.down
end

return Lift
`,
  },
  {
    name: 'bob',
    code: `local Bob = Behave.new("bob")
Bob.state = { base = 0 }

function Bob:hop(t)
  self.position.y = self.state.base + math.sin(t * math.pi) * 1.5
end

function Bob:onclick()
  self.state.base = self.position.y
  self:animate("hop", 600)
end

return Bob
`,
  },
  {
    name: 'flip',
    code: `local Flip = Behave.new("flip")
Flip.state = { over = false, base = 0 }

function Flip:roll(t)
  self.rotation.z = self.state.base + t * 180
end

function Flip:onclick()
  self.state.base = self.state.over and (self.rotation.z - 180) or self.rotation.z
  self:animate("roll", 700)
  self.state.over = not self.state.over
end

return Flip
`,
  },
  {
    name: 'toggle',
    code: `local Toggle = Behave.new("toggle")

function Toggle:onclick()
  self.visible = not self.visible
end

return Toggle
`,
  },
  {
    name: 'wobble',
    code: `local Wobble = Behave.new("wobble")
Wobble.state = { base = 0 }

function Wobble:shake(t)
  self.rotation.z = self.state.base + math.sin(t * math.pi * 4) * 20
end

function Wobble:onclick()
  self.state.base = self.rotation.z
  self:animate("shake", 800)
end

return Wobble
`,
  },
]
