import { mat4 } from 'wgpu-matrix'

const shader = /* wgsl */ `
struct Camera { vp: mat4x4<f32>, eye: vec4<f32>, fog: vec4<f32> }
struct Object { world: mat4x4<f32>, tint: vec4<f32>, uv: vec4<f32> }
@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var picture: texture_2d<f32>;
@group(1) @binding(1) var filtering: sampler;
@group(2) @binding(0) var<storage, read> objects: array<Object>;
struct Vertex {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) normal: vec3<f32>,
  @location(3) position: vec3<f32>,
}
@vertex fn vertex(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>, @location(3) color: vec4<f32>, @builtin(instance_index) instance: u32) -> Vertex {
  let object = objects[instance];
  let world = object.world * vec4<f32>(position, 1.0);
  var out: Vertex;
  out.clip = camera.vp * world;
  out.color = color * object.tint;
  out.uv = uv * object.uv.xy + object.uv.zw;
  let a = object.world[0].xyz; let b = object.world[1].xyz; let c = object.world[2].xyz;
  out.normal = normalize(mat3x3<f32>(cross(b,c), cross(c,a), cross(a,b)) * normal * sign(dot(a,cross(b,c))));
  out.position = world.xyz;
  return out;
}
@fragment fn fragment(in: Vertex) -> @location(0) vec4<f32> {
  let surface = textureSample(picture, filtering, in.uv) * in.color;
  if (surface.a < 0.5) { discard; }
  let light = 0.65 + 0.35 * max(dot(normalize(in.normal), normalize(vec3<f32>(0.4, 0.8, 0.3))), 0.0);
  let distance = length(in.position - camera.eye.xyz);
  let fog = smoothstep(camera.fog.w, camera.eye.w, distance);
  return vec4<f32>(mix(surface.rgb * light, camera.fog.rgb, fog), 1.0);
}`

type Geometry = { vertices: GPUBuffer; indices: GPUBuffer; count: number; refs: number }
type Item = { batch: Batch; slot: number }
type Batch = {
  key: string
  index: number
  bounds: Float32Array
  geometry: Geometry
  source: BABYLON.Geometry
  texture: GPUTexture
  start: number
  count: number
  items: Item[]
  data: Float32Array
  buffer: GPUBuffer
  binding: GPUBindGroup
  picture: GPUBindGroup
}

// Babylon remains the authoring scene. Only sync touches its mesh hierarchy.
export class Renderer {
  readonly stats = { objects: 0, batches: 0, draws: 0, passes: 0, views: 1, copies: 0, triangles: 0, renderMs: 0, syncMs: 0, sweeps: 0 }
  private device: GPUDevice
  private context: GPUCanvasContext
  private geometries = new Map<BABYLON.Geometry, Geometry>()
  private pending = new Map<BABYLON.Geometry, Generator<void>>()
  private batches = new Map<string, Batch>()
  private draws: Batch[] = []
  private retired = new Set<Batch>()
  private planes = new Float32Array(24)
  private items = new Map<BABYLON.AbstractMesh, Item[]>()
  private textures = new WeakMap<GPUTexture, number>()
  private textureId = 0
  private cursor = 0
  private uniforms: GPUBuffer[] = []
  private cameras: GPUBindGroup[] = []
  private cameraData = new Float32Array(24)
  private scratch = new Float32Array(24)
  private resolved: { batch: Batch; mat: any; tex: any }[] = []
  private view: BABYLON.Camera[] = []
  private white: GPUTexture
  private sampler: GPUSampler
  private layouts: GPUBindGroupLayout[]
  private pipelines = new Map<GPUTextureFormat, GPURenderPipeline>()
  private depth?: GPUTexture
  private removal: BABYLON.Nullable<BABYLON.Observer<BABYLON.AbstractMesh>>

  constructor(private scene: BABYLON.Scene) {
    const engine = scene.getEngine() as any
    this.device = engine._device
    this.context = engine._context
    this.layouts = [
      this.device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] }),
      this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        ],
      }),
      this.device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }] }),
    ]
    this.white = this.device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    this.device.queue.writeTexture({ texture: this.white }, new Uint8Array([255, 255, 255, 255]), {}, [1, 1])
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' })
    for (let eye = 0; eye < 2; eye++) {
      const buffer = this.device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      this.uniforms.push(buffer)
      this.cameras.push(this.device.createBindGroup({ layout: this.layouts[0], entries: [{ binding: 0, resource: { buffer } }] }))
    }
    this.removal = scene.onMeshRemovedObservable.add((mesh) => this.remove(mesh))
    scene.onDisposeObservable.addOnce(() => this.dispose())
    console.info('NG renderer: flat batches, opaque/cutout surfaces, no Babylon scene.render', scene)
  }

  private pipeline(format: GPUTextureFormat) {
    let pipeline = this.pipelines.get(format)
    if (pipeline) return pipeline
    const module = this.device.createShaderModule({ code: shader })
    pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: this.layouts }),
      vertex: {
        module,
        entryPoint: 'vertex',
        buffers: [
          {
            arrayStride: 48,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x2' },
              { shaderLocation: 3, offset: 32, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
    })
    this.pipelines.set(format, pipeline)
    return pipeline
  }

  private *upload(source: BABYLON.Geometry): Generator<void> {
    const positions = source.getVerticesData(BABYLON.VertexBuffer.PositionKind)
    const indices = source.getIndices()
    if (!positions?.length || !indices?.length) return
    const normals = source.getVerticesData(BABYLON.VertexBuffer.NormalKind)
    const uv = source.getVerticesData(BABYLON.VertexBuffer.UVKind)
    const colors = source.getVerticesData(BABYLON.VertexBuffer.ColorKind)
    const data = new Float32Array((positions.length / 3) * 12)
    for (let i = 0; i < positions.length / 3; i++) {
      const o = i * 12
      for (let j = 0; j < 3; j++) {
        data[o + j] = positions[i * 3 + j]
        data[o + 3 + j] = normals?.[i * 3 + j] ?? (j === 1 ? 1 : 0)
      }
      data[o + 6] = uv?.[i * 2] || 0
      data[o + 7] = uv?.[i * 2 + 1] || 0
      for (let j = 0; j < 4; j++) data[o + 8 + j] = colors?.[i * 4 + j] ?? 1
      if (i % 256 === 255) yield
    }
    const indexData = new Uint32Array(indices)
    const vertices = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    const indexBuffer = this.device.createBuffer({ size: indexData.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
    try {
      for (const [buffer, array] of [
        [vertices, data],
        [indexBuffer, indexData],
      ] as const) {
        for (let offset = 0; offset < array.byteLength; offset += 65536) {
          this.device.queue.writeBuffer(buffer, offset, array.buffer, offset, Math.min(65536, array.byteLength - offset))
          yield
        }
      }
      this.geometries.set(source, { vertices, indices: indexBuffer, count: indices.length, refs: 0 })
    } finally {
      if (!this.geometries.has(source)) {
        vertices.destroy()
        indexBuffer.destroy()
      }
    }
  }

  private resize(batch: Batch) {
    const old = batch.buffer
    const data = new Float32Array(Math.max(16 * 24, batch.data.length * 2))
    data.set(batch.data)
    batch.data = data
    batch.buffer = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    batch.binding = this.device.createBindGroup({ layout: this.layouts[2], entries: [{ binding: 0, resource: { buffer: batch.buffer } }] })
    this.device.queue.writeBuffer(batch.buffer, 0, data)
    old?.destroy()
  }

  private remove(mesh: BABYLON.AbstractMesh) {
    const items = this.items.get(mesh)
    if (!items) return
    for (const item of items) {
      const b = item.batch
      const last = b.items.pop()!
      if (last !== item) {
        b.items[item.slot] = last
        b.data.copyWithin(item.slot * 24, last.slot * 24, last.slot * 24 + 24)
        last.slot = item.slot
        this.device.queue.writeBuffer(b.buffer, item.slot * 96, b.data.buffer, item.slot * 96, 96)
      }
      if (!b.items.length) this.retired.add(b)
      this.stats.objects--
    }
    this.items.delete(mesh)
  }

  private mesh(mesh: BABYLON.AbstractMesh) {
    const original = mesh instanceof BABYLON.InstancedMesh ? mesh.sourceMesh : (mesh as BABYLON.Mesh)
    if (original.isBlocked) {
      this.remove(mesh)
      return
    }
    const source = original.metadata?.voxLOD && this.scene.activeCamera ? original.getLOD(this.scene.activeCamera, mesh.getBoundingInfo().boundingSphere)! : original
    const geometry = source?.geometry
    if (!geometry || mesh.isDisposed() || !mesh.isEnabled() || !mesh.isVisible || mesh.visibility <= 0 || mesh.name === 'skybox') {
      this.remove(mesh)
      return
    }
    const gpu = this.geometries.get(geometry)
    if (!gpu) {
      if (!this.pending.has(geometry)) this.pending.set(geometry, this.upload(geometry))
      return
    }
    const parts = source.subMeshes
    const old = this.items.get(mesh)
    const resolved = this.resolved
    const world = mesh.computeWorldMatrix().m
    let changed = old?.length !== parts.length
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p]
      const mat: any = part.getMaterial()
      const tex = mat?.diffuseTexture || mat?.albedoTexture || mat?.emissiveTexture
      const internal = tex?.isReady() && tex.getInternalTexture()
      let texture: GPUTexture = internal?._hardwareTexture?.underlyingResource || this.white
      if (texture.dimension !== '2d' || texture.depthOrArrayLayers !== 1 || !(texture.usage & GPUTextureUsage.TEXTURE_BINDING)) texture = this.white
      let tid = this.textures.get(texture)
      if (!tid) this.textures.set(texture, (tid = ++this.textureId))
      const key = geometry.uniqueId + ':' + part.indexStart + ':' + part.indexCount + ':' + tid
      let batch = this.batches.get(key)
      if (!batch) {
        batch = {
          key,
          index: this.draws.length,
          bounds: new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]),
          geometry: gpu,
          source: geometry,
          texture,
          start: part.indexStart,
          count: part.indexCount,
          items: [],
          data: new Float32Array(0),
          picture: this.device.createBindGroup({
            layout: this.layouts[1],
            entries: [
              { binding: 0, resource: texture.createView() },
              { binding: 1, resource: this.sampler },
            ],
          }),
        } as any
        this.resize(batch!)
        this.batches.set(key, batch!)
        this.draws.push(batch!)
        gpu.refs++
      }
      const partData = resolved[p] ?? (resolved[p] = { batch: batch!, mat, tex })
      partData.batch = batch!
      partData.mat = mat
      partData.tex = tex
      if (old?.[p]?.batch !== batch) changed = true
    }
    if (changed) this.remove(mesh)
    let items = this.items.get(mesh)
    if (!items) this.items.set(mesh, (items = []))
    for (let p = 0; p < parts.length; p++) {
      const { batch, mat, tex } = resolved[p]
      let item = items[p]
      if (!item) {
        this.retired.delete(batch)
        if ((batch.items.length + 1) * 24 > batch.data.length) this.resize(batch)
        item = { batch, slot: batch.items.length }
        batch.items.push(item)
        items.push(item)
        this.stats.objects++
      }
      const color = mat?.diffuseColor || mat?.albedoColor
      this.scratch.set(world)
      this.scratch[16] = color?.r ?? 1
      this.scratch[17] = color?.g ?? 1
      this.scratch[18] = color?.b ?? 1
      this.scratch[19] = (mat?.alpha ?? 1) * mesh.visibility
      this.scratch[20] = tex?.uScale ?? 1
      this.scratch[21] = tex?.vScale ?? 1
      this.scratch[22] = tex?.uOffset ?? 0
      this.scratch[23] = tex?.vOffset ?? 0
      const bounds = mesh.getBoundingInfo().boundingBox
      const lo = bounds.minimumWorld,
        hi = bounds.maximumWorld
      batch.bounds[0] = Math.min(batch.bounds[0], lo.x)
      batch.bounds[1] = Math.min(batch.bounds[1], lo.y)
      batch.bounds[2] = Math.min(batch.bounds[2], lo.z)
      batch.bounds[3] = Math.max(batch.bounds[3], hi.x)
      batch.bounds[4] = Math.max(batch.bounds[4], hi.y)
      batch.bounds[5] = Math.max(batch.bounds[5], hi.z)
      const offset = item.slot * 24
      let dirty = changed
      for (let i = 0; i < 24; i++)
        if (batch.data[offset + i] !== this.scratch[i]) {
          dirty = true
          break
        }
      if (dirty) {
        batch.data.set(this.scratch, offset)
        this.device.queue.writeBuffer(batch.buffer, offset * 4, this.scratch)
      }
    }
  }

  sync(scene: BABYLON.Scene, { budget }: { budget: number }) {
    const start = performance.now(),
      deadline = start + Math.max(0, budget)
    const deferred = (scene as any)._toBeDisposed as BABYLON.IDisposable[]
    while (deferred.length && performance.now() < deadline) deferred.pop()?.dispose()
    // Empty batches have no draws and are retired during the bounded sync phase.
    for (const batch of this.retired) {
      if (performance.now() >= deadline) break
      this.retired.delete(batch)
      batch.buffer.destroy()
      this.batches.delete(batch.key)
      const last = this.draws.pop()!
      if (last !== batch) {
        this.draws[batch.index] = last
        last.index = batch.index
      }
      if (--batch.geometry.refs === 0) {
        batch.geometry.vertices.destroy()
        batch.geometry.indices.destroy()
        this.geometries.delete(batch.source)
      }
    }
    let visited = 0
    while (performance.now() < deadline) {
      const job = this.pending.entries().next().value
      if (job) {
        if (job[0].isDisposed() || job[1].next().done) {
          job[1].return(undefined)
          this.pending.delete(job[0])
        }
      }
      if (visited++ >= scene.meshes.length) break
      if (this.cursor >= scene.meshes.length) {
        this.cursor = 0
        this.stats.sweeps++
      }
      const mesh = scene.meshes[this.cursor++]
      if (mesh) this.mesh(mesh)
    }
    this.stats.batches = this.batches.size
    this.stats.syncMs = performance.now() - start
  }

  render() {
    const start = performance.now(),
      scene = this.scene
    // Preserve game/streaming callbacks without invoking Babylon's render traversal.
    ;(scene as any)._frameId++
    ;(scene as any)._renderId++
    scene.onBeforeAnimationsObservable.notifyObservers(scene)
    scene.animate()
    const camera = scene.activeCamera
    if (!camera) return
    camera.update()
    scene.onBeforeRenderObservable.notifyObservers(scene)
    this.view[0] = camera
    const views = camera instanceof BABYLON.WebXRCamera ? camera.rigCameras : this.view
    const encoder = this.device.createCommandEncoder()
    this.stats.draws = this.stats.passes = this.stats.copies = this.stats.triangles = 0
    this.stats.views = views.length
    for (let eye = 0; eye < views.length; eye++) {
      const view = views[eye],
        target = view.outputRenderTarget as any
      const color: GPUTexture = target?.getInternalTexture()?._hardwareTexture?.underlyingResource || this.context.getCurrentTexture()
      if (!this.depth || this.depth.width !== color.width || this.depth.height !== color.height) {
        this.depth?.destroy()
        this.depth = this.device.createTexture({ size: [color.width, color.height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT })
      }
      mat4.multiply(view.getProjectionMatrix().m, view.getViewMatrix().m, this.cameraData)
      const position = view.globalPosition,
        fog = scene.fogColor
      this.cameraData[16] = position.x
      this.cameraData[17] = position.y
      this.cameraData[18] = position.z
      this.cameraData[19] = scene.fogEnd || 200
      this.cameraData[20] = fog.r
      this.cameraData[21] = fog.g
      this.cameraData[22] = fog.b
      this.cameraData[23] = scene.fogStart || 50
      this.device.queue.writeBuffer(this.uniforms[eye], 0, this.cameraData)
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: color.createView({ dimension: '2d', baseArrayLayer: target?.layerIndex || 0, arrayLayerCount: 1 }), clearValue: { r: fog.r, g: fog.g, b: fog.b, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      })
      pass.setPipeline(this.pipeline(color.format))
      pass.setBindGroup(0, this.cameras[eye])
      if (target) pass.setViewport(view.viewport.x * color.width, view.viewport.y * color.height, view.viewport.width * color.width, view.viewport.height * color.height, 0, 1)
      const m = this.cameraData
      for (let plane = 0; plane < 6; plane++) {
        const row = plane >> 1,
          sign = plane % 2 ? -1 : 1
        for (let c = 0; c < 4; c++) this.planes[plane * 4 + c] = plane === 4 ? m[c * 4 + 2] : m[c * 4 + 3] + sign * m[c * 4 + row]
      }
      for (let index = 0; index < this.draws.length; index++) {
        const batch = this.draws[index]
        if (!batch.items.length) continue
        const b = batch.bounds,
          planes = this.planes
        let visible = true
        for (let p = 0; p < 24; p += 4) {
          if (planes[p] * b[planes[p] >= 0 ? 3 : 0] + planes[p + 1] * b[planes[p + 1] >= 0 ? 4 : 1] + planes[p + 2] * b[planes[p + 2] >= 0 ? 5 : 2] + planes[p + 3] < 0) {
            visible = false
            break
          }
        }
        if (!visible) continue
        pass.setBindGroup(1, batch.picture)
        pass.setBindGroup(2, batch.binding)
        pass.setVertexBuffer(0, batch.geometry.vertices)
        pass.setIndexBuffer(batch.geometry.indices, 'uint32')
        pass.drawIndexed(batch.count, batch.items.length, batch.start)
        this.stats.draws++
        this.stats.triangles += (batch.count * batch.items.length) / 3
      }
      pass.end()
      this.stats.passes++
    }
    this.device.queue.submit([encoder.finish()])
    scene.onAfterRenderObservable.notifyObservers(scene)
    this.stats.renderMs = performance.now() - start
  }

  dispose() {
    this.scene.onMeshRemovedObservable.remove(this.removal)
    for (const job of this.pending.values()) job.return(undefined)
    for (const batch of this.batches.values()) batch.buffer.destroy()
    for (const geometry of this.geometries.values()) {
      geometry.vertices.destroy()
      geometry.indices.destroy()
    }
    for (const buffer of this.uniforms) buffer.destroy()
    this.depth?.destroy()
    this.white.destroy()
    this.pending.clear()
    this.batches.clear()
    this.draws.length = 0
    this.retired.clear()
    this.geometries.clear()
    this.items.clear()
  }
}
