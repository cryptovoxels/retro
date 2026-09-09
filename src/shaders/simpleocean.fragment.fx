precision highp float;

#define FOGMODE_NONE 0.
#define FOGMODE_EXP 1.
#define FOGMODE_EXP2 2.
#define FOGMODE_LINEAR 3.
#define E 2.71828

varying vec3 vPositionW;
varying vec3 vNormalW;
varying vec2 vUV;
varying float fFogDistance;

uniform vec3 diffuseColor;

uniform vec4 vEyePosition;
uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform float sunSpecularPower;

uniform float isUnderwater;
uniform float waterSurfaceY;

#include<helperFunctions>
#include<imageProcessingDeclaration>
#include<imageProcessingFunctions>
#include<fogFragmentDeclaration>

vec3 calculateSunSpecular(vec3 normal, vec3 viewDir, vec3 lightDir, vec3 lightColor, float specularPower) {
    vec3 halfVector = normalize(viewDir + lightDir);
    float NdotH = max(dot(normal, halfVector), 0.0);
    float specular = pow(NdotH, specularPower);
    return lightColor * specular * 0.5;
}

void main(void) {
    vec3 normal = normalize(vNormalW);
    vec3 viewDir = normalize(vEyePosition.xyz - vPositionW);

    vec3 color = diffuseColor;

    if (length(sunColor) > 0.0) {
        vec3 sunSpecular = calculateSunSpecular(normal, viewDir, sunDirection, sunColor, sunSpecularPower);
        color += sunSpecular;
    }

    #ifdef FOG
    float fog = CalcFogFactor();
    color.rgb = mix(vFogColor, color.rgb, fog);
    #endif

    gl_FragColor = vec4(color, 1.0);

    #include<imageProcessingCompatibility>
}