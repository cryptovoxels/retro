export function batwing(direction: number, closed: number) {
  return `local Door = Behave.new("batwing")
Door.state = { start = ${closed}, near = false }
local closed, opened = ${closed}, ${closed + direction * 88}
function Door:swing(t)
  self.rotation.y = lerp(self.state.start, opened, ease.out_cubic(math.min(1, t * 8)))
  if t > 0.72 and not self.state.near then
    self.rotation.y = lerp(opened, closed, ease.in_out_quad((t - 0.72) / 0.28))
  end
end
function Door:shut(t)
  self.rotation.y = lerp(self.state.start, closed, ease.in_out_quad(t))
end
function Door:onclick()
  self.state.start = self.rotation.y
  self:animate("swing", 2400)
end
function Door:ontrigger()
  self.state.near = true
  self.state.start = self.rotation.y
  self:animate("swing", 2400)
end
function Door:onuntrigger()
  self.state.near = false
  self.state.start = self.rotation.y
  self:animate("shut", 550)
end
return Door`
}
