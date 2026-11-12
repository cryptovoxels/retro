return {
  parts = {
    body = {asset="eagle", offset={0,-0.22,0}},
    leftwing = {asset="eagle-wing", parent="body", position={-0.11,0.045,0}, offset={0.54,0,0}, mirror=true},
    rightwing = {asset="eagle-wing", parent="body", position={0.11,0.045,0}, offset={0.54,0,0}}
  },
  animate = function(pos, rot, phase)
    return {
      body = {position=pos, rotation=rot},
      leftwing = {rotation=Vector3.new(0,0,-math.sin(phase)*0.35)},
      rightwing = {rotation=Vector3.new(0,0,math.sin(phase)*0.35)}
    }
  end
}
