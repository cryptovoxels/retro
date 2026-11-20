return {
  parts = {
    body = {asset={"rat-0","rat-1","rat-2"}},
    tail = {asset="rat-tail", parent="body", position={0,0.045,-0.29}, offset={0,0,-0.18}}
  },
  animate = function(pos, rot, phase)
    return {
      body = {position=pos, rotation=rot},
      tail = {rotation=Vector3.new(0,math.sin(phase)*0.22,0)}
    }
  end
}
