// Shared world geometry; screen-space handles and measurements stay readable at any zoom.
export default class TransformOverlay {
  corners = Array.from({ length: 8 }, () => BABYLON.Vector3.Zero())
  size = BABYLON.Vector3.Zero()
  handles: HTMLButtonElement[] = []
  label = document.createElement('output')
  private outline: BABYLON.LinesMesh
  private guides: BABYLON.LinesMesh
  private edges = [
    [0, 1],
    [1, 3],
    [3, 2],
    [2, 0],
    [4, 5],
    [5, 7],
    [7, 6],
    [6, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ]
  private lines = this.edges.map(() => [BABYLON.Vector3.Zero(), BABYLON.Vector3.Zero()])
  private rays = Array.from({ length: 6 }, () => [BABYLON.Vector3.Zero(), BABYLON.Vector3.Zero(), BABYLON.Vector3.Zero()])
  private positions = new Float32Array(72)
  private guidePositions = new Float32Array(54)
  private normal = BABYLON.Vector3.Zero()
  private identity = BABYLON.Matrix.Identity()
  private transform = BABYLON.Matrix.Identity()
  private projected = BABYLON.Vector3.Zero()
  private minimum = BABYLON.Vector3.Zero()
  private maximum = BABYLON.Vector3.Zero()
  private local = BABYLON.Vector3.Zero()

  constructor(
    private scene: BABYLON.Scene,
    corners = false,
  ) {
    const style = getComputedStyle(document.body)
    const color = (name: string) => BABYLON.Color3.FromHexString(style.getPropertyValue(name).trim())
    this.outline = BABYLON.MeshBuilder.CreateLineSystem('selection/outline', { lines: this.lines, updatable: true }, scene)
    this.outline.color = color('--accent')
    const grey = color('--muted')
    this.guides = BABYLON.MeshBuilder.CreateLineSystem(
      'selection/guides',
      {
        lines: this.rays,
        colors: this.rays.map(() => [new BABYLON.Color4(grey.r, grey.g, grey.b, 0), new BABYLON.Color4(grey.r, grey.g, grey.b, 0.5), new BABYLON.Color4(grey.r, grey.g, grey.b, 0)]),
        updatable: true,
      },
      scene,
    )
    for (const mesh of [this.outline, this.guides]) {
      mesh.isPickable = false
      mesh.alwaysSelectAsActiveMesh = true
      mesh.setEnabled(false)
    }
    this.label.className = 'transform-size'
    this.label.hidden = true
    document.body.append(this.label)
    if (corners)
      for (let i = 0; i < 4; i++) {
        const handle = document.createElement('button')
        handle.className = 'transform-handle'
        handle.type = 'button'
        handle.tabIndex = -1
        handle.setAttribute('aria-label', 'Resize corner')
        handle.hidden = true
        document.body.append(handle)
        this.handles.push(handle)
      }
  }

  sync(mesh: BABYLON.AbstractMesh | null, flat = false, active = -1) {
    const camera = this.scene.activeCamera
    this.outline.setEnabled(!!mesh)
    this.guides.setEnabled(!!mesh)
    if (!mesh || !camera) {
      this.label.hidden = true
      for (const handle of this.handles) handle.hidden = true
      return
    }
    const world = mesh.computeWorldMatrix(true)
    const bounds = mesh.getBoundingInfo().boundingBox
    this.minimum.setAll(Infinity)
    this.maximum.setAll(-Infinity)
    for (let i = 0; i < 8; i++) {
      this.local.set(i & 1 ? bounds.maximum.x : bounds.minimum.x, i & 2 ? bounds.maximum.y : bounds.minimum.y, flat ? 0 : i & 4 ? bounds.maximum.z : bounds.minimum.z)
      BABYLON.Vector3.TransformCoordinatesToRef(this.local, world, this.corners[i])
      this.minimum.minimizeInPlace(this.corners[i])
      this.maximum.maximizeInPlace(this.corners[i])
    }
    this.size.set(BABYLON.Vector3.Distance(this.corners[0], this.corners[1]), BABYLON.Vector3.Distance(this.corners[0], this.corners[2]), BABYLON.Vector3.Distance(this.corners[0], this.corners[4]))
    this.edges.forEach(([a, b], i) => {
      this.lines[i][0].copyFrom(this.corners[a])
      this.lines[i][1].copyFrom(this.corners[flat && i >= 4 ? a : b])
    })
    this.lines.forEach((line, i) => line.forEach((point, j) => point.toArray(this.positions, i * 6 + j * 3)))
    this.outline.updateVerticesData(BABYLON.VertexBuffer.PositionKind, this.positions)
    // World-axis guides through opposite bounds. Omit the wall's dominant depth axis.
    const normal = BABYLON.Vector3.TransformNormalToRef(BABYLON.Axis.Z, world, this.normal)
    const depth = Math.abs(normal.x) > Math.abs(normal.y) ? (Math.abs(normal.x) > Math.abs(normal.z) ? 0 : 2) : Math.abs(normal.y) > Math.abs(normal.z) ? 1 : 2
    const reach = Math.min(camera.maxZ, 100)
    for (let i = 0; i < 6; i++) {
      const origin = i < 3 ? this.minimum : this.maximum
      const axis = i % 3
      for (const point of this.rays[i]) point.copyFrom(origin)
      if (!flat || axis !== depth) {
        this.rays[i][0][axis === 0 ? 'x' : axis === 1 ? 'y' : 'z'] -= reach
        this.rays[i][2][axis === 0 ? 'x' : axis === 1 ? 'y' : 'z'] += reach
      }
    }
    this.rays.forEach((line, i) => line.forEach((point, j) => point.toArray(this.guidePositions, i * 9 + j * 3)))
    this.guides.updateVerticesData(BABYLON.VertexBuffer.PositionKind, this.guidePositions)
    const canvas = this.scene.getEngine().getRenderingCanvas()
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const viewport = camera.viewport.toGlobal(rect.width, rect.height)
    camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), this.transform)
    const project = (point: BABYLON.Vector3) => BABYLON.Vector3.ProjectToRef(point, this.identity, this.transform, viewport, this.projected)
    for (let i = 0; i < this.handles.length; i++) {
      project(this.corners[i])
      const handle = this.handles[i]
      handle.hidden = this.projected.z < 0 || this.projected.z > 1 || this.projected.x < 0 || this.projected.x > rect.width || this.projected.y < 0 || this.projected.y > rect.height
      handle.style.left = `${rect.left + this.projected.x}px`
      handle.style.top = `${rect.top + this.projected.y}px`
      const x = this.projected.x,
        y = this.projected.y
      project(this.corners[3 - i])
      handle.style.cursor = (x - this.projected.x) * (y - this.projected.y) > 0 ? 'nwse-resize' : 'nesw-resize'
      handle.classList.toggle('active', i === active)
    }
    this.label.hidden = active < 0
    if (active >= 0) {
      project(this.corners[active])
      this.label.hidden = this.projected.z < 0 || this.projected.z > 1
      this.label.style.left = `${Math.max(rect.left, Math.min(rect.right - 150, rect.left + this.projected.x + 16))}px`
      this.label.style.top = `${Math.max(rect.top, Math.min(rect.bottom - 24, rect.top + this.projected.y - 28))}px`
      this.label.textContent = `${this.size.x.toFixed(2)} x ${this.size.y.toFixed(2)}${flat ? '' : ` x ${this.size.z.toFixed(2)}`} m`
    }
  }

  dispose() {
    this.outline.dispose()
    this.guides.dispose()
    this.label.remove()
    for (const handle of this.handles) handle.remove()
  }
}
