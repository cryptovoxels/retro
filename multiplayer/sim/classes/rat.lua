local Rat = {}
classes.rat = Rat
local directions = {Vector2.new(1,0), Vector2.new(0,1), Vector2.new(-1,0), Vector2.new(0,-1)}

function Rat:wake()
  local p=self.position
  local y=floor_at(p.X,p.Y,p.Z,2048)
  if not y then return false end
  self.position=Vector3.new(math.floor(p.X*2)*0.5+0.25,y,math.floor(p.Z*2)*0.5+0.25)
  self.heading=self.id%4
end

function Rat:step(dt)
  local p=self.position
  if not self.target then
    local first=math.random(4)==1 and math.random(0,3) or self.heading
    for turn=0,3 do
      local heading=(first+turn)%4
      local d=directions[heading+1]
      local x,z=p.X+d.X*0.5,p.Z+d.Y*0.5
      local y=floor_at(x,p.Y,z,0.5)
      if y then
        self.target=Vector3.new(x,y,z)
        self.heading=heading
        self.rotation=Vector3.new(0,math.atan(d.X,d.Y),0)
        break
      end
    end
  end
  if not self.target then return end
  local delta=self.target-p
  local t=math.min(1,dt*2/delta.Magnitude)
  self.position=p:Lerp(self.target,t)
  self.phase=(self.phase+delta.Magnitude*t*9)%(2*math.pi)
  if t==1 then self.target=nil end
end
