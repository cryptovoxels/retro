import { runCompute } from '../mono-pool'
import texas from '../../islands/texas/artpack.json'
import { unpackGround } from '../../common/voxels/ground-bytes'
import type { IslandRecord } from '../../common/messages/api-islands'

// Swap the fallback shoreline for the voxel surface before registering its collider.
export async function islandGround(mesh: BABYLON.Mesh, island: IslandRecord & { ground?: string }) {
  const inline = island.ground
  let bytes: Uint8Array
  if (inline) bytes = unpackGround(inline)
  else {
    const res = await fetch('/api/islands/' + island.id + '/ground.bin', { cache: 'no-cache' })
    if (!res.ok) return
    bytes = new Uint8Array(await res.arrayBuffer())
  }
  if (mesh.isDisposed() || bytes.length < 16) return
  const geo = await runCompute((worker) => worker.groundMesh(bytes))
  if (mesh.isDisposed()) return
  const data = new BABYLON.VertexData()
  Object.assign(data, geo)
  data.applyToMesh(mesh)
  mesh.position.y = 0
  mesh.computeWorldMatrix(true)
  const scene = mesh.getScene()
  const pages = texas.groundPages
  const samplers = pages.map((_, i) => 'color' + i)
  const sample = pages.map((_, i) => (i < pages.length - 1 ? 'if (page < ' + (i + 0.5) + ') { ' : '') + 'return textureSampleLevel(color' + i + ',color' + i + 'Sampler,pos,lod);' + (i < pages.length - 1 ? ' }' : '')).join('\n')

  const material = new BABYLON.ShaderMaterial(
    'island/ground',
    scene,
    {
      vertexSource: `
      attribute position: vec3<f32>;
      attribute normal: vec3<f32>;
      attribute uv: vec2<f32>;
      varying tile: f32;
      uniform worldViewProjection: mat4x4<f32>;
      varying local: vec3<f32>;
      varying face: vec3<f32>;
      @vertex
      fn main(input: VertexInputs) -> FragmentInputs {
        vertexOutputs.local = vertexInputs.position;
        vertexOutputs.face = vertexInputs.normal;
        vertexOutputs.tile = vertexInputs.uv.x;
        vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
      }`,
      fragmentSource: `
      varying local: vec3<f32>;
      varying face: vec3<f32>;
      varying tile: f32;
      uniform cameraPosition: vec3<f32>;
      var parcelAtlas: texture_2d<f32>;
      var parcelAtlasSampler: sampler;
      ${samplers.map((name) => 'var ' + name + ': texture_2d<f32>; var ' + name + 'Sampler: sampler;').join('\n')}
      fn colorAt(page: f32, pos: vec2f, lod: f32) -> vec4f { ${sample} }
      fn coord(slot: vec2f, uv: vec2f) -> vec2f { return (slot + clamp(uv, vec2f(0.004), vec2f(0.996))) * 0.125; }
      fn modulo(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
      @fragment
      fn main(input: FragmentInputs) -> FragmentOutputs {
        let local = fragmentInputs.local;
        let face = fragmentInputs.face;
        let tile = fragmentInputs.tile;
        let uv = select(fract(vec2f(select(local.x, local.z, abs(face.x) > 0.5), -local.y)), fract(local.xz), face.y != 0.0);
        if (tile == 64.0 || tile == 65.0) {
          let layer = select(1.0, 14.0, tile == 65.0);
          let slot = vec2f(modulo(layer, 4.0), floor(layer / 4.0));
          let sampleUV = (slot + mix(vec2f(0.752), vec2f(0.248), fract(local.zx * 2.0))) * 0.25;
          fragmentOutputs.color = vec4f(textureSampleLevel(parcelAtlas, parcelAtlasSampler, sampleUV, 0.0).rgb * 0.92, 1.0);
        } else {
          let dirt = select(tile, modulo(tile - 72.0, 8.0), tile >= 72.0);
          let slot = vec2f(modulo(dirt, 8.0), floor(dirt / 8.0));
          let cell = floor(local.xz);
          let page = modulo(cell.x * 3.0 + cell.y * 7.0 + floor(cell.x / 3.0) + tile, 4.0);
          let shade = 0.72 + 0.2 * max(0.0, face.y);
          let dist = length(uniforms.cameraPosition - local);
          var ground = colorAt(page, coord(slot, uv), max(0.0, log2(max(1.0, dist * 0.14)))).rgb;
          if (tile >= 72.0) { ground *= mix(vec3f(1.0), vec3f(1.03, 0.50, 0.36), floor((tile - 72.0) / 8.0) / 7.0); }
          fragmentOutputs.color = vec4f(ground * shade, 1.0);
        }
      }`,
    },
    { shaderLanguage: BABYLON.ShaderLanguage.WGSL, attributes: ['position', 'normal', 'uv'], uniforms: ['worldViewProjection', 'cameraPosition'], samplers: [...samplers, 'parcelAtlas'] },
  )
  const textures = pages.map((page, i) => {
    const color = new BABYLON.Texture(page.color, scene, false, false)
    material.setTexture('color' + i, color)
    return color
  })
  const parcelAtlas = new BABYLON.Texture(texas.atlas, scene, false, false)
  material.setTexture('parcelAtlas', parcelAtlas)
  textures.push(parcelAtlas)
  const localCamera = new BABYLON.Vector3()
  material.onBindObservable.add(() => {
    if (scene.activeCamera) material.setVector3('cameraPosition', scene.activeCamera.globalPosition.subtractToRef(mesh.position, localCamera))
  })
  material.zOffset = material.zOffsetUnits = 1
  material.backFaceCulling = false
  mesh.material = material
  mesh.onDisposeObservable.addOnce(() => {
    material.dispose()
    for (const texture of textures) texture.dispose()
  })
}
