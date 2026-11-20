local Eagle = {}
classes.eagle = Eagle

function Eagle:wake()
  local p=self.position
  self.center=Vector3.new(p.X,floor_at(p.X,p.Y,p.Z,2048) or p.Y,p.Z)
  self.angle=self.id
end

function Eagle:step(dt)
  self.angle=self.angle+dt*0.48
  local a=self.angle
  self.position=self.center+Vector3.new(2*math.cos(a),8,2*math.sin(a))
  self.rotation=Vector3.new(0,-a,0)
  self.phase=(self.phase+dt*9)%(2*math.pi)
end
