attribute vec3 position;
attribute vec3 color;

#include<instancesDeclaration>
uniform mat4 worldViewProjection;
uniform mat4 view;
uniform mat4 projection;
uniform vec3 cameraPosition;
uniform vec3 meshOrigin;
uniform float meshScale;

varying vec3 vPosEyeRel;
varying float vFogDistance;
varying vec3 colorValue;

void main() {
  #include<instancesVertex>

  colorValue = color / 255.0;

  vec3 localPos = meshOrigin + vec3(position) * meshScale;
  vec4 pos_ws = finalWorld * vec4(localPos, 1.0);
  vPosEyeRel = pos_ws.xyz - cameraPosition.xyz;
  gl_Position = projection * (view * pos_ws);
  vFogDistance = gl_Position.z;
}
