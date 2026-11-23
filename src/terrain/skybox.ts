export default class Skybox {
  private readonly _mesh: BABYLON.Mesh
  private material: BABYLON.ShaderMaterial

  constructor(scene: BABYLON.Scene) {
    const material = new BABYLON.ShaderMaterial(
      'skybox/sky-material',
      scene,
      {
        vertexSource: `
        attribute position: vec3<f32>;
        uniform worldViewProjection: mat4x4<f32>;
        varying direction: vec3<f32>;
        @vertex
        fn main(input: VertexInputs) -> FragmentInputs {
          vertexOutputs.direction = vertexInputs.position;
          vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
        }`,
        fragmentSource: `
        varying direction: vec3<f32>;
        uniform fogColor: vec3<f32>;
        uniform sunPosition: vec3<f32>;
        uniform linearOutput: f32;
        @fragment
        fn main(input: FragmentInputs) -> FragmentOutputs {
          let view = normalize(fragmentInputs.direction);
          let height = smoothstep(0.0, 0.65, max(view.y, 0.0));
          let sun = pow(max(dot(view, normalize(uniforms.sunPosition)), 0.0), 8.0);
          let sky = uniforms.fogColor * (0.58 + sun * 0.12);
          let color = mix(uniforms.fogColor, sky, height);
          fragmentOutputs.color = vec4f(mix(color, pow(color, vec3f(2.2)), uniforms.linearOutput), 1.0);
        }`,
      },
      { shaderLanguage: BABYLON.ShaderLanguage.WGSL, attributes: ['position'], uniforms: ['worldViewProjection', 'fogColor', 'sunPosition', 'linearOutput'] },
    )
    material.backFaceCulling = false // leave
    material.fogEnabled = false // we set out fog kinda thick so we can't enable it for the sky
    material.freeze()
    this.material = material

    const mesh = BABYLON.MeshBuilder.CreateSphere('skybox', { segments: 16, diameter: 1 }, scene)

    mesh.scaling.setAll(window.draw.distance * 1.96)

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
