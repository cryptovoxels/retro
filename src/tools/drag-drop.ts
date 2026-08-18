import { FeatureType } from '../../common/messages/feature'
import { app } from '../../web/src/state'
import { getImageInfo, getURlImageInfo, getVoxInfo } from '../../web/src/utils'

import { uploadMedia, UploadMediaResult } from '../../common/helpers/upload-media'
import { uploadVoxModelMedia } from '../utils/upload-vox-media'
import { PanelType } from '../../web/src/components/panel'
import { yeetWearable } from '../object-vox'

const MB = 1024 * 1024

function preventDefaults(e: any) {
  e.preventDefault()
  e.stopPropagation()
}

// Drag drop manager
export class DragDrop {
  scene: BABYLON.Scene

  pickInfo: BABYLON.PickingInfo | undefined

  constructor(scene: BABYLON.Scene) {
    this.scene = scene

    document.body.addEventListener('dragenter', preventDefaults, false)
    document.body.addEventListener('dragover', this.onDragOver, false)
    document.body.addEventListener('dragleave', this.onDragLeave, false)
    document.body.addEventListener('drop', this.onDrop, false)
  }

  get ui() {
    return window.ui
  }

  onDragLeave = (e: any) => {
    if (!this.ui) {
      return
    }
    this.ui.featureTool.deactivate()
    preventDefaults(e)
  }

  onDragOver = (e: any) => {
    const el = e.target

    if (el.nodeName !== 'CANVAS') {
      return
    }

    const dataTransfer = e.dataTransfer as DataTransfer
    const types = dataTransfer?.types ? Array.from(dataTransfer.types) : []
    if (types.includes('text/x-yeet')) {
      preventDefaults(e)
      dataTransfer.dropEffect = 'copy'
      return
    }

    if (!this.ui) {
      // Can't place features without UI
      return
    }

    preventDefaults(e)

    this.pickInfo = this.scene.pick(e['clientX'], e['clientY'], (mesh) => {
      // only allow parcel voxel surfaces to be picked by drag and drop
      return mesh.isVisible && mesh.isPickable && (mesh.name.startsWith('voxel-field/opaque') || mesh.name.startsWith('voxelizer/'))
    })!
    // Since the new z-fighting PR we have to offset the picking position by the worldOffset.
    const offset = window.persona.controls.worldOffset.position
    this.pickInfo.pickedPoint?.addInPlaceFromFloats(-offset.x, offset.y, -offset.z)

    if (!dataTransfer.items.length) {
      return
    }

    // console.log(dataTransfer)

    const type = dataTransfer.items[0]?.type
    dataTransfer.dropEffect = 'copy'

    // Show placeholder when user drags over world
    // we don't yet have access to the actual files when dragOver event fires
    // so instead we look at types and make a best guess
    if (type.startsWith('image/')) {
      this.ui.featureTool.spawnPlaceholder(this.pickInfo, {
        type: 'image',
        scale: [4 / 3, 1, 0],
      })
      dataTransfer.dropEffect = 'copy'
    } else if (type.startsWith('video/')) {
      this.ui.featureTool.spawnPlaceholder(this.pickInfo, {
        type: 'video',
        scale: [16 / 9, 1, 0],
      })
    } else if (type.startsWith('audio/')) {
      this.ui.featureTool.spawnPlaceholder(this.pickInfo, {
        type: 'audio',
        scale: [2, 0.5, 0],
      })
    } else if (type.startsWith('text/plain')) {
      this.ui.featureTool.spawnPlaceholder(this.pickInfo, {
        type: 'nft-image',
        scale: [1, 1, 0],
      })
    } else {
      this.ui.featureTool.spawnPlaceholder(this.pickInfo, {
        type: 'vox-model',
        scale: [0.5, 0.5, 0.5],
      })
    }
  }

  onDrop = async (e: DragEvent) => {
    const el = e.target as any
    if (!el) {
      return
    }
    if (el.nodeName !== 'CANVAS') {
      return
    }

    preventDefaults(e)

    const yeetId = e.dataTransfer?.getData('text/x-yeet') || ''
    const plain = e.dataTransfer?.getData('text/plain') || ''
    const wid = yeetId || (plain.startsWith('yeet:') ? plain.slice(5) : '')
    if (wid) {
      yeetWearable(wid)
      return
    }

    if (!this.ui) {
      return
    }

    const file = e.dataTransfer?.files[0]
    let textItem
    try {
      textItem = JSON.parse(e.dataTransfer?.getData('text/plain') || '')
    } catch {}

    if (textItem) {
      this.handleJSONAndSpawn(textItem)
      return
    }
    if (!file) {
      return
    }

    const i = file.name.lastIndexOf('.')
    const ext = (i >= 0 ? file.name.slice(i) : '').toLowerCase()

    if (file.size > 50 * MB) {
      alert('File must be less than 50 MB. Please resize and then try again.')
      return
    }

    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif') {
      const imageInfo = await getImageInfo(file)
      await this.uploadAndSpawn(file, {
        type: 'image',
        stretch: true,
        transparent: imageInfo.hasAlpha,
        blendMode: 'Multiply',
        scale: [imageInfo.aspectRatio, 1, 0],
      })
    } else if (ext === '.mp3') {
      await this.uploadAndSpawn(file, {
        type: 'audio',
        scale: [2, 0.5, 0],
      })
    } else if (ext === '.vox') {
      const voxInfo = await getVoxInfo(file)
      await this.uploadAndSpawn(file, {
        type: voxInfo.megavox ? 'megavox' : 'vox-model',
        scale: voxInfo.megavox ? [1, 1, 1] : [0.5, 0.5, 0.5],
      })
    } else if (ext === '.mov' || ext === '.mp4') {
      await this.uploadAndSpawn(file, {
        type: 'video',
        blendMode: 'Multiply',
        scale: [16 / 9, 1, 0],
      })
    } else {
      this.ui?.featureTool.deactivate()
      alert(`We don't support drag drop upload of ${ext} yet.`)
    }
  }

  async handleJSONAndSpawn(json: { type: FeatureType; content: any }) {
    if (!this.ui) return
    const currentParcel = window.grid?.currentParcel() || window.grid?.nearestEditableParcel()
    if (!this.pickInfo) {
      app.showSnackbar('no pick info found')
      return
    }

    if (!json.type || !json.content) {
      app.showSnackbar('Cannot generate a feature with this JSON.')
      this.ui?.featureTool.deactivate()
      return
    }

    if (json.type !== 'nft-image') {
      app.showSnackbar('We currently do not support other types of JSON features')
      this.ui?.featureTool.deactivate()
      return
    }

    if (!currentParcel) {
      app.showSnackbar('Cannot generate a feature when not in a parcel.')
      this.ui?.featureTool.deactivate()
      return
    }

    if (!currentParcel.canEdit) {
      app.showSnackbar('You do not have the rights to edit this parcel.')
      this.ui?.featureTool.deactivate()
      return
    }

    if (!currentParcel.budget.hasBudgetFor(json.type)) {
      app.showSnackbar('Limit reached for this feature', PanelType.Danger)
      this.ui?.featureTool.deactivate()
      return
    }
    // const imageInfo = await getURlImageInfo(json.content.image)

    const featureTemplate = {
      type: 'nft-image',
      blendMode: 'Multiply',
      scale: [1.5, 1.5, 0],
      url: json.content.url,
    }

    this.ui.activeTool = this.ui.featureTool
    await this.ui.featureTool.spawn(this.pickInfo, featureTemplate)
  }

  async uploadAndSpawn(file: File, featureTemplate: any) {
    const currentParcel = window.grid?.currentParcel() || window.grid?.nearestEditableParcel()

    if (!this.pickInfo) {
      app.showSnackbar('no pick info found')
      return
    }

    if (!currentParcel) {
      app.showSnackbar('Cannot upload file when not in a parcel.')
      this.ui?.featureTool.deactivate()
      return
    }

    if (!currentParcel.canEdit) {
      app.showSnackbar('You do not have the rights to edit this parcel.')
      this.ui?.featureTool.deactivate()
      return
    }

    if (!currentParcel.budget.hasBudgetFor(featureTemplate.type)) {
      app.showSnackbar('Limit reached for this feature', PanelType.Danger)
      this.ui?.featureTool.deactivate()
      return
    }

    let result: UploadMediaResult
    try {
      if (featureTemplate.type === 'vox-model' || featureTemplate.type === 'megavox') {
        result = await uploadVoxModelMedia(file, featureTemplate.type === 'megavox', this.scene)
      } else {
        result = await uploadMedia(file)
      }
    } catch (ex) {
      result = {
        success: false,
        error: 'An error occurred while uploading. Please try again. If problem persists, please report on discord!',
      }
      console.error(ex)
    }

    if (!result.success) {
      alert(result.error)
      this.ui?.featureTool.deactivate()
      return
    }

    if (!this.ui) {
      // can't spawn without UI
      return
    }
    this.ui.activeTool = this.ui.featureTool

    featureTemplate = Object.assign({}, featureTemplate, { url: result.location })
    this.ui.featureTool.spawn(this.pickInfo, featureTemplate)
  }
}
