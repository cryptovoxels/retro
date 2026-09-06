export function createGPUMemoryHUD(scene: BABYLON.Scene) {
  const engine = scene.getEngine()
  const gl = (engine as BABYLON.Engine)._gl
  if (!gl) return

  const hud = document.createElement('div')
  hud.style.position = 'fixed'
  hud.style.top = '0'
  hud.style.left = '0'
  hud.style.padding = '6px 12px'
  hud.style.background = 'rgba(0,0,0,0.75)'
  hud.style.color = '#0f0'
  hud.style.fontFamily = 'monospace'
  hud.style.fontSize = '14px'
  hud.style.zIndex = '99999'
  hud.textContent = 'Loading GPU stats...'
  document.body.appendChild(hud)

  function estimateTextureMemory() {
    let totalBytes = 0
    for (const tex of engine.getLoadedTexturesCache()) {
      // if (!tex._texture) continue
      // const { width, height } = tex.getSize()
      const width = tex.width
      const height = tex.height
      const format = tex.format ?? gl.RGBA
      let bpp = 4 // default RGBA

      if (format === gl.RGB) bpp = 3
      else if (format === gl.LUMINANCE || format === gl.ALPHA) bpp = 1

      let size = width * height * bpp
      if (tex.generateMipMaps) size *= 1.33
      totalBytes += size
    }

    return totalBytes
  }

  function estimateMeshMemory(scene: BABYLON.Scene) {
    let total = 0
    const unique = scene.meshes.filter((m: any) => !m.isAnInstance && m.geometry)
    for (const mesh of unique) {
      const verts = mesh.getTotalVertices()
      const indices = mesh.getTotalIndices()
      const bytesPerVertex = 12 * 4 // ~12 floats
      const bytesPerIndex = 4
      total += verts * bytesPerVertex + indices * bytesPerIndex
    }
    return total
  }

  scene.onBeforeRenderObservable.add(() => {
    const meshMB = (estimateMeshMemory(scene) / 1024 / 1024).toFixed(1)
    const texMB = (estimateTextureMemory() / 1024 / 1024).toFixed(1)
    hud.textContent = `🧠 GPU Mem:
Meshes: ${meshMB} MB
Textures: ${texMB} MB`
  })
}
