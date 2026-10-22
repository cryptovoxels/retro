export default class Skybox {
  private readonly _mesh: BABYLON.Mesh
  private material: BABYLON.ShaderMaterial

  constructor(scene: BABYLON.Scene) {
    const material = new BABYLON.ShaderMaterial(
      'skybox/sky-material',
      scene,
      {
        vertexSource: `
        precision highp float;
        attribute vec3 position;
        uniform mat4 worldViewProjection;
        varying vec3 direction;
        void main() {
          direction = position;
          gl_Position = worldViewProjection * vec4(position, 1.0);
        }`,
        fragmentSource: `
        precision highp float;
        varying vec3 direction;
        uniform vec3 fogColor;
        uniform vec3 sunPosition;
        uniform float linearOutput;
        void main() {
          vec3 view = normalize(direction);
          float height = smoothstep(0.0, 0.65, max(view.y, 0.0));
          float sun = pow(max(dot(view, normalize(sunPosition)), 0.0), 8.0);
          vec3 sky = fogColor * (0.48 + sun * 0.16);
          vec3 color = mix(fogColor, sky, height);
          gl_FragColor = vec4(mix(color, pow(color, vec3(2.2)), linearOutput), 1.0);
        }`,
      },
      { attributes: ['position'], uniforms: ['worldViewProjection', 'fogColor', 'sunPosition', 'linearOutput'] },
    )
    material.backFaceCulling = false // leave
    material.fogEnabled = false // we set out fog kinda thick so we can't enable it for the sky
    material.freeze()
    this.material = material

    const mesh = BABYLON.MeshBuilder.CreateSphere('skybox', { segments: 16, diameter: 1 }, scene)

    const updateScale = (drawDistance: number) => {
      mesh.scaling.setAll(drawDistance * 1.96)
    }

    updateScale(window.draw.distance)
    window.draw.addEventListener('distance-changed', (e) => updateScale(e.detail))

    mesh.material = material
    mesh.infiniteDistance = true
    mesh.isPickable = false
    mesh.alphaIndex = 0 // render behind all other alpha blended meshes

    this._mesh = mesh
  }

  get mesh(): BABYLON.Mesh {
    return this._mesh
  }

  update(sunPosition: BABYLON.Vector3) {
    this.material.setVector3('sunPosition', sunPosition)
    this.material.setColor3('fogColor', this.material.getScene().fogColor)
    this.material.setFloat('linearOutput', this.material.getScene().imageProcessingConfiguration.applyByPostProcess ? 1 : 0)
  }
}
