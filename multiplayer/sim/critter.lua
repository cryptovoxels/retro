classes = {}
local actors = {}

function spawn(kind,id,x,y,z)
  local class = classes[kind]
  if not class then return false end
  local actor = setmetatable({id=id, position=Vector3.new(x,y,z), rotation=Vector3.new(), phase=0}, {__index=class})
  if actor:wake()==false then return false end
  actors[id]=actor
  return true
end

function tick(id,dt)
  local actor=actors[id]
  actor:step(dt)
  local p,r=actor.position,actor.rotation
  return p.X,p.Y,p.Z,r.X,r.Y,r.Z,actor.phase
end
