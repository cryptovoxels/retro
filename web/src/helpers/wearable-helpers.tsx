import config from '../../../common/config'
import { VoxImporter } from '../../../common/vox-import/vox-import'

const legendaryColor = '#f3b643'
const epicColor = '#cf52cb'
const rareColor = '#4e95f1'
const commonColor = '#9ba3a6'

function getProperId(w: { token_id?: any; id?: any }): string | null {
  /* check if default is null */
  let token_id = w.token_id ? w.token_id.toString() : w.id.toString()
  /* check if match uuid */
  const isDefaultAUUID = token_id.match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)
  /* check if other option is undefined */
  const isOtherIDaUUID = typeof w.id !== 'undefined' && w.id.toString().match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)

  if (!isDefaultAUUID) {
    if (!isOtherIDaUUID) {
      token_id = null
    } else {
      token_id = w.id.toString()
    }
  }

  return token_id
}

export function getWearableGif(w: any): string {
  // if (config.isDevelopment) {
  //   return `http://localhost:4321/render/${w?.id}`
  // } else {
  return `https://render.voxels.com/render/${w?.id}`
  // }
}

export function rarityLabel(issues: number | undefined) {
  if (issues === undefined) return 'unknown'
  let rarity_class = 'common'
  if (issues > 0 && issues < 10) {
    rarity_class = 'legendary'
  } else if (issues >= 10 && issues < 100) {
    rarity_class = 'epic'
  } else if (issues >= 100 && issues < 1000) {
    rarity_class = 'rare'
  }
  return rarity_class
}

export function rarityColor(issues: number) {
  let rarity_color = commonColor
  if (issues > 0 && issues < 10) {
    rarity_color = legendaryColor
  } else if (issues >= 10 && issues < 100) {
    rarity_color = epicColor
  } else if (issues >= 100 && issues < 1000) {
    rarity_color = rareColor
  }
  return rarity_color
}

export const loadWearableVox = (importer: VoxImporter, urlOrBuffer: string | ArrayBuffer, scene: BABYLON.Scene, abortController: AbortController) => {
  return importer.import(urlOrBuffer, { signal: abortController.signal }).then((mesh: BABYLON.Mesh) => {
    if (!mesh) {
      throw new Error('could not load mesh')
    }

    // center mesh at origin by using the bounding box
    const center = mesh.getBoundingInfo().boundingBox.centerWorld
    mesh.position.set(-center.x, -center.y, center.z)
    mesh.freezeWorldMatrix()

    const mat = new BABYLON.StandardMaterial('wearable', scene)
    mat.emissiveColor.set(0.5, 0.5, 0.5)
    mat.diffuseColor.set(1, 1, 1)
    mat.blockDirtyMechanism = true
    mat.freeze()
    mesh.material = mat

    // use the radius of the bounding sphere to distance the camera from the mesh
    const radius = mesh.getBoundingInfo().boundingSphere.radius
    scene.cameras.forEach((c) => {
      if ('radius' in c) c.radius = radius * 2.8
      if ('lowerRadiusLimit' in c) c.lowerRadiusLimit = radius * 2.8
      if ('upperRadiusLimit' in c) c.upperRadiusLimit = radius * 2.8
    })

    return mesh
  })
}
