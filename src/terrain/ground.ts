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
  const sample = (kind: string) => pages.map((_, i) => (i < 3 ? 'if (page < ' + (i + 0.5) + ') ' : '') + 'return sampleTile(' + kind + i + ',pos,lod);').join('\n')

  const material = new BABYLON.ShaderMaterial(
    'island/ground',
    scene,
    {
      vertexSource: `
      precision highp float;
      attribute vec3 position;
      attribute vec3 normal;
      attribute vec2 uv;
      varying float tile;
      uniform mat4 worldViewProjection;
      varying vec3 local;
      varying vec3 face;
      void main() {
        local = position; face = normal; tile = uv.x;
        gl_Position = worldViewProjection * vec4(position, 1.);
      }`,
      fragmentSource: `
      precision highp float;
      varying vec3 local;
      varying vec3 face;
      varying float tile;
      uniform vec3 cameraPosition;
      uniform sampler2D parcelAtlas;
      ${samplers.map((name) => 'uniform sampler2D ' + name + ';').join('\n')}
      #define sampleTile(tex,uv,lod) ${scene.getEngine().isWebGPU || (scene.getEngine() as any).webGLVersion > 1 ? 'textureLod(tex,uv,lod)' : 'texture2D(tex,uv)'}
      vec4 colorAt(float page, vec2 pos,float lod) { ${sample('color')} }
      vec2 coord(vec2 slot, vec2 uv) { return (slot + clamp(uv, .004, .996)) * .125; }
      void main() {
        vec2 uv = face.y != 0. ? fract(local.xz) : fract(vec2(abs(face.x) > .5 ? local.z : local.x, -local.y));
        // The entrance apron continues the same atlas swatch and half-metre repeat as its parcel floor.
        if (tile == 64. || tile == 65.) {
          float layer = tile == 65. ? 14. : 1.;
          vec2 slot = vec2(mod(layer,4.),floor(layer/4.));
          vec2 sampleUV = (slot + mix(vec2(.752),vec2(.248),fract(local.zx*2.))) * .25;
          gl_FragColor = vec4(sampleTile(parcelAtlas,sampleUV,0.).rgb * .92,1.);
          return;
        }
        float dirt = tile >= 72. ? mod(tile - 72.,8.) : tile;
        vec2 slot = vec2(mod(dirt, 8.), floor(dirt / 8.));
        vec2 cell = floor(local.xz);
        float page = mod(cell.x*3. + cell.y*7. + floor(cell.x/3.) + tile, 4.);
        float shade = .72 + .2 * max(0., face.y);
        float dist = length(cameraPosition-local);
        vec3 ground = colorAt(page,coord(slot,uv),max(0.,log2(max(1.,dist*.14)))).rgb;
        if (tile >= 72.) ground *= mix(vec3(1.), vec3(1.03,.50,.36), floor((tile-72.)/8.)/7.);
        gl_FragColor = vec4(ground * shade, 1.);
      }`,
    },
    { attributes: ['position', 'normal', 'uv'], uniforms: ['worldViewProjection', 'cameraPosition'], samplers: [...samplers, 'parcelAtlas'] },
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
