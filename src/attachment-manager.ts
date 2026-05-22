import { Costume, CostumeAttachment } from '../common/messages/costumes'
import { app } from '../web/src/state'
import { voxImporter } from '../common/vox-import/vox-import'
import type Avatar from './avatar'

export interface AttachmentWithMesh extends CostumeAttachment {
  mesh?: BABYLON.Mesh
}

export class AvatarAttachmentManager {
  skeleton: BABYLON.Skeleton | null
  attached: BABYLON.Mesh[] = []
  visible = true
  abortController = new AbortController()
  costume: Costume | null = null
  costume_id: number | null = null
  attachments: Array<AttachmentWithMesh> = []

  constructor(
    private scene: BABYLON.Scene,
    private avatar: Avatar,
    private readonly avatarViewDistance: number,
  ) {
    this.skeleton = avatar.skeleton
  }

  get wallet() {
    return this.avatar.wallet
  }

  dispose() {
    if (this.attached) {
      this.attached.forEach((a) => a.dispose())
    }
    if (this.attachments) {
      this.attachments.length = 0
    }
    this.abortController.abort('ABORT: disposing AvatarAttachmentManager')
  }

  /**
   * Gets the costume of the avatar from the db.
   * If isUser, the costume is already stored in app state, and won't fetch it.
   * @see /web/src/state.ts
   */
  async loadCostume(costume?: Costume, costumeId?: number) {
    if (costume) {
      this.costume_id = costume.id
      this.generateCostume(costume)
    } else if (this.avatar.isUser) {
      const state = await app.getState()
      this.generateCostume(state.costume)
    } else {
      if (costumeId) this.costume_id = costumeId
      this.fetchCostume(this.costume_id ?? undefined)
    }
  }

  /**
   * Generate the given costume
   * @param {Object} costume the costume to generate
   * @see /web/src/state.ts
   * @returns {void} void
   */
  generateCostume(costume?: Costume) {
    this.abortController = new AbortController()
    this.costume = costume ?? null

    if (costume) {
      // bnolan model has its own material and texture
      this.avatar.setSkin(costume.skin)
    }

    this.costume_id = costume?.id || null
    this.attachments = ((costume && costume.attachments) || []).slice(0, 12)
    this.avatar.isUser && app.setState({ costume: costume })
    this.loadAttachments()
  }

  async fetchCostume(costumeId?: number) {
    const url = costumeId ? `${process.env.API}/costumes/${costumeId}` : `${process.env.API}/avatars/${this.wallet}/costume.json`

    const r = await fetch(url)
    const { success, costume } = await r.json()

    if (success && costume) {
      this.costume = costume
      this.generateCostume(costume)
    }
  }

  /**
   * Iterates through this.attachments and generates all the attachments on the avatar.
   * @returns {void} void
   */
  async loadAttachments() {
    if (this.attached) {
      this.attached.forEach((a) => a.dispose())
    }
    this.attached = []

    for (const attachment of this.attachments) {
      try {
        await this.loadAttachment(attachment)
      } catch (e) {
        console.error(`Error loading attachment ${attachment.wid}`, e)
      }
    }
  }

  loadAttachment = async (attachment: AttachmentWithMesh) => {
    const name = attachment.bone
    if (!this.skeleton) {
      return
    }
    const boneName = this.skeleton.bones.find((b) => b.name.toLowerCase() === `mixamorig:${name}`.toLowerCase())?.name ?? name
    const index = this.skeleton.getBoneIndexByName(boneName)

    if (index == -1) {
      console.log(`Bad bone name ${name}`)
      return
    }

    const bone = this.skeleton.bones[index]

    if (!attachment.wid) {
      return
    }

    const url = `/api/collectibles/${attachment.wid}/vox`

    const opts = { invertX: false, signal: this.abortController.signal }
    const mesh = await voxImporter().import(url, opts)
    mesh.name = 'wearable'

    this.attached.push(mesh)
    attachment['mesh'] = mesh

    if (bone && this.avatar.avatarMesh) {
      mesh.attachToBone(bone, this.avatar.avatarMesh)
    }
    mesh.isPickable = false
    mesh.metadata = {
      parcel: null,
      isAvatarPart: true,
    }

    mesh.addLODLevel(this.avatarViewDistance, null)

    const position = new BABYLON.Vector3(attachment.position[0], attachment.position[1], attachment.position[2])
    mesh.position.copyFrom(position)

    // eulers
    const rotation = new BABYLON.Vector3(BABYLON.Angle.FromDegrees(attachment.rotation[0]).radians(), BABYLON.Angle.FromDegrees(attachment.rotation[1]).radians(), BABYLON.Angle.FromDegrees(attachment.rotation[2]).radians())
    mesh.rotationQuaternion = null
    mesh.rotation = rotation

    // scale
    mesh.scaling.set(attachment.scaling[0], attachment.scaling[1], attachment.scaling[2])

    if (!this.visible) {
      mesh.setEnabled(false)
    }
  }

  refreshSingleAttachment(wid: string) {
    const attachment = this.attachments.find((col) => col.wid == wid)
    if (!attachment) {
      console.warn(`Attachment with wid ${wid} not found`)
      return
    }
    // No attachment found, just generate new one
    if (!attachment.mesh) {
      this.loadAttachment(attachment)
      return
    }
    const collectibleMesh = this.attached.find((col) => col.uniqueId == attachment.mesh!.uniqueId)
    // Attachment was found, nerf the previous mesh, clean the attached array and generate a new collectible.
    if (collectibleMesh) {
      this.attached.splice(this.attached.indexOf(collectibleMesh), 1)
      collectibleMesh.dispose()
    }
    this.loadAttachment(attachment)
  }

  getAttachmentByWid(wid: string): AttachmentWithMesh | null {
    return this.attachments.find((a) => a.wid == wid) ?? null
  }

  wear = (attachment: CostumeAttachment) => {
    if (typeof attachment.wid !== 'string') {
      return
    }
    this.attachments.push(attachment)
    this.refreshSingleAttachment(attachment.wid)
  }

  remove = (wid: string) => {
    const wearable = this.getAttachmentByWid(wid)
    if (!wearable) return

    this.attachments.splice(this.attachments.indexOf(wearable), 1)
    const mesh = wearable.mesh
    if (!mesh) return
    this.attached.splice(this.attached.indexOf(mesh), 1)
    mesh.dispose()
  }

  hideAllWearables() {
    this.visible = false
    this.attached.forEach((m) => m.setEnabled(false))
  }

  showAllWearables() {
    this.visible = true
    this.attached.forEach((m) => m.setEnabled(true))
  }
}
