import { debounce } from 'lodash'
import { Component, createRef } from 'preact'
import { Costume, CostumeAttachment } from '../../../common/messages/costumes'
import { app } from '../../../web/src/state'
import { md5 } from '../../../common/helpers/utils'
// import { Wearable } from './wearable'

import { v7 as uuidv7 } from 'uuid'
import { CollectiblesData } from '../../../common/helpers/collections-helpers'
import cachedFetch from '../../../web/src/helpers/cached-fetch'
import { getWearableGif } from '../../../web/src/helpers/wearable-helpers'
import Controls from '../../controls/controls'
import Persona from '../../persona'
import { UserAvatar } from '../../user-avatar'

// if (process.env.NODE_ENV === 'development') {
// Must use require here as import statements are only allowed to exist at top-level.
// require('preact/debug')
// }

export const AVATAR_BONES = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'HeadTop_End',

  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',

  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',

  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'LeftToeBase',
  'LeftToe_End',

  'RightUpLeg',
  'RightLeg',
  'RightFoot',
  'RightToeBase',
  'RightToe_End',
]

const stableHash = md5

const MAX_ATTACHMENTS = 12
const MAX_CLONES = 4

const ContentType = 'application/json'

const fetchParams = {
  headers: { Accept: ContentType, 'Content-Type': ContentType },
  credentials: 'include',
} as const

interface Props {
  scene: BABYLON.Scene
}

type Wearable = CollectiblesData

interface State {
  loading: boolean
  attachmentId: string | null
  costumes: Array<Costume>
  costumeId?: number
  expandAttachments?: boolean
  targetBone: string | null
  wasFirstPerson: boolean
  assets: Array<Wearable>
}

export default class Costumer extends Component<Props, State> {
  // state: State = { attachmentId: null, loading: true }
  // private engine: BABYLON.Engine | null = null
  // private scene: BABYLON.Scene | null = null
  private targetBone: string | null = null
  private gizmoManager: BABYLON.GizmoManager | null = null
  private editor = createRef()
  private canvas = createRef()

  constructor(props: Props) {
    super(props)

    this.state = {
      costumes: [],
      wasFirstPerson: this.persona.firstPersonView,
      attachmentId: null,
      loading: true,
      costumeId: this.userAvatar?.getCostume()?.id ?? undefined,
      targetBone: null,
      assets: [],
    }
  }

  componentDidMount() {
    this.enterThirdPerson()
    // this.tpose()

    this.fetch()
  }

  tpose() {
    this.userAvatar.tpose()
  }

  private get userAvatar() {
    return this.persona.avatar as UserAvatar
  }

  private get attachment(): any {
    return this.costume?.attachments?.find((a) => a.uuid == this.state.attachmentId)
  }

  private get layer() {
    return this.scene?.getHighlightLayerByName('selected') ?? null
  }

  private get bones() {
    return AVATAR_BONES
  }

  private get bonespheres() {
    return this.scene?.getMeshesById('bonesphere') ?? null
  }

  private get costume(): Costume | null {
    if (!this.state.costumes || !this.state.costumeId) {
      return null
    }

    return this.state.costumes.find((c) => this.state.costumeId == c.id) ?? null
  }

  get controls() {
    return window.connector.controls as Controls
  }
  get persona() {
    return this.controls.persona as Persona
  }

  enterThirdPerson() {
    this.controls.enterThirdPerson()
  }

  get scene() {
    return this.props.scene
  }

  componentWillUnmount() {
    if (this.state.wasFirstPerson) {
      this.controls.enterFirstPerson()
    }

    this.gizmoManager?.dispose()
  }

  componentDidUpdate(prevProps: Props) {
    if (!this.state.attachmentId) {
      if (this.layer) {
        this.layer.removeAllMeshes()
      }

      if (this.gizmoManager) {
        this.gizmoManager.attachToMesh(null)
      }
    }
  }

  onDragEnd = async () => {
    const trunc = (x: number) => Math.round(x * 1000) / 1000
    const degrees = (x: number) => Math.round((x * 1000 * 180) / Math.PI) / 1000

    if (!this.gizmoManager?.['_attachedMesh']) {
      throw new Error("onDragEnd: Can't find mesh attached to gizmo manager")
    }

    const mesh = this.gizmoManager['_attachedMesh']
    const editor = this.editor.current

    if (!editor) {
      throw new Error("onDragEnd: Can't find current editor")
    }

    const position = mesh.position.asArray().map(trunc)
    const rotation = mesh.rotation.asArray().map(degrees)
    const scaling = mesh.scaling.asArray().map(trunc)

    await editor.setStateAsync({ position, rotation, scaling })

    const attachment = Object.assign({}, this.attachment, { position, rotation, scaling })
    await this.updateAttachment(attachment)
  }

  setSkin = async (skin: string) => {
    if (!this.costume) {
      return
    }

    if (!this.scene) {
      return
    }

    const material = this.scene.getMaterialByName(`material/costume`) as BABYLON.StandardMaterial | null

    if (!material) {
      console.error('Could not find material')
      return
    }

    const encodedData = 'data:image/svg+xml;base64,' + window.btoa(skin)
    const hash = stableHash(skin)
    const texture = BABYLON.Texture.LoadFromDataString(`texture/costume/${this.state.costumeId}/${hash}`, encodedData, this.scene, false, false, false)
    texture.hasAlpha = true

    if (material.diffuseTexture) {
      material.diffuseTexture.dispose()
    }

    material.diffuseTexture = texture

    // Update state / save skin
    const costume = { ...this.costume }
    costume.skin = skin

    const costumes = this.state.costumes?.map((c) => {
      if (c.id == this.state.costumeId) {
        return costume
      } else {
        return c
      }
    })

    this.setState({ costumes })

    await this.throttledUpdate(costume)
  }

  onClick = (mesh: BABYLON.AbstractMesh | undefined) => {
    if (!mesh) {
      this.setState({ attachmentId: null })
    }
  }

  updateCostume = async (costume: Costume, blocking?: boolean) => {
    const body = JSON.stringify(costume)

    const costumes = this.state.costumes?.map((c: Costume) => {
      if (c.id == costume.id) {
        return costume
      } else {
        return c
      }
    })

    if (blocking) {
      await fetch(`/api/costumes/${costume.id}`, { ...fetchParams, method: 'PUT', body })
      await this.fetch()
    } else {
      this.setState({ costumes })
      await fetch(`/api/costumes/${costume.id}`, { ...fetchParams, method: 'PUT', body })
    }
  }

  throttledUpdate = debounce(async (costume) => {
    await this.updateCostume(costume)
  }, 1000)

  downloadCostume = () => {
    const costume = this.costume

    if (!costume) {
      return
    }

    const text = JSON.stringify(costume, null, 2)

    const a: HTMLAnchorElement = document.createElement('a')
    a.style.display = 'hidden'
    a.href = window.URL.createObjectURL(new Blob([text], { type: ContentType }))
    a.download = (costume.name ?? costume.id) + '.json'
    a.click()
    a.remove()
  }

  onDragOver = (ev: DragEvent) => {
    this.targetBone = null

    this.bonespheres?.forEach((mesh: BABYLON.AbstractMesh) => {
      mesh.setEnabled(true)
      if (!mesh.material) {
        console.warn('no material', mesh)
        return
      }
      const mat = mesh.material as BABYLON.StandardMaterial

      mat.emissiveColor.set(1, 1, 1)
    })

    if (this.scene) {
      const info = this.scene.pick(ev.offsetX, ev.offsetY, (mesh: BABYLON.AbstractMesh) => mesh.id == 'bonesphere')

      if (info?.pickedMesh?.material) {
        const mat = info.pickedMesh.material as BABYLON.StandardMaterial

        mat.emissiveColor.set(0.3, 0, 1)

        this.targetBone = info.pickedMesh.metadata
      }
    }

    ev.preventDefault()
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = 'copy'
    }
  }

  onDragExit = () => {
    this.hideBoneSpheres()
  }

  onWheel = (ev: WheelEvent) => {
    ev.preventDefault()
  }

  onDrop = async () => {
    this.hideBoneSpheres()

    const wearable = this.droppedWearable()
    if (!wearable) {
      console.warn('no wearable')
      return
    }
    const bone = this.targetBone || 'Head' // this.skeleton.bones[0]

    if (!this.canAdd(wearable)) {
      app.showSnackbar('Unable to add to costume')
      return
    }

    await this.addAttachment(wearable, bone)
  }

  setName = async (name: string) => {
    if (!this.costume) {
      app.showSnackbar("Can't set name on when no costume is selected")
      return
    }
    const costume = { ...this.costume }
    costume.name = name

    await this.updateCostume(costume)
    await this.fetch()
  }

  removeAttachment = async (uuid: string) => {
    if (!this.costume) {
      app.showSnackbar("Can't remove attached wearable when no costume is selected")
      return
    }
    const attachments: CostumeAttachment[] = this.costume?.attachments?.filter((a) => a.uuid != uuid) ?? []
    const costume = { ...this.costume, attachments }

    await this.updateCostume(costume, true)

    app.showSnackbar('Removed attachment')
  }

  updateAttachment = async (attachment: CostumeAttachment) => {
    if (!this.costume) {
      app.showSnackbar("Can't update an attached wearable when no costume is selected")
      return
    }
    const costume = { ...this.costume }

    if (costume.attachments) {
      costume.attachments.forEach((a) => {
        if (a.uuid == attachment.uuid) {
          Object.assign(a, attachment)
        }
      })
    }

    const costumes: Costume[] | undefined = this.state.costumes?.map((c: Costume) => {
      if (c.id == this.state.costumeId) {
        return costume
      } else {
        return c
      }
    })

    this.setState({ costumes })

    await this.throttledUpdate(costume)
  }

  async fetch() {
    if (!app.state.wallet) {
      throw new Error('No wallet')
    }

    // Wait for this...
    const r2 = await cachedFetch(`/api/avatars/${app.state.wallet}/costumes`)
    const j2 = await r2.json()
    this.setState({ costumes: j2.costumes })

    var r = await cachedFetch(`/api/avatars/${app.state.wallet}/assets`)
    var j = await r.json()
    this.setState({ assets: j.assets })
  }

  hideBoneSpheres() {
    this.bonespheres?.forEach((mesh: BABYLON.AbstractMesh) => {
      mesh.setEnabled(false)
    })
  }

  droppedWearable(): CollectiblesData | null {
    // @ts-expect-error - global abuse to support drag and drop
    return window['droppedWearable'] ?? null
  }

  canAdd(w: CollectiblesData) {
    if (!this.costume) {
      return false
    }

    if (!this.costume.attachments) {
      return true
    }

    if (this.costume.attachments.length >= MAX_ATTACHMENTS) {
      return false
    }

    const clones = this.costume.attachments.filter((a) => a.collection_id == w.collection_id && a.wearable_id == w.token_id)

    return !(clones.length >= MAX_CLONES)
  }

  async addAttachment(wearable: CollectiblesData, bone: string) {
    if (!this.costume) {
      app.showSnackbar("Can't attach wearable when no costume is selected")
      return
    }

    console.log('addAttachment', wearable, bone)

    const voxelSize = 0.5
    const costume = { ...this.costume }

    const attachmentId = uuidv7()
    const attachment: CostumeAttachment = {
      name: wearable.name,
      wearable_id: wearable.token_id || wearable.id!,
      collection_id: wearable.collection_id,
      collection_address: wearable.collection_address ?? undefined,
      chain_id: wearable.chain_id,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scaling: [voxelSize, voxelSize, voxelSize],
      bone,
      uuid: attachmentId,
    }

    if (!costume.attachments) {
      costume.attachments = []
    }

    costume.attachments.push(attachment)

    this.setState({ attachmentId, expandAttachments: true })
    await this.updateCostume(costume)
    app.showSnackbar('Wearable added')
  }

  // private getWearablesForRender() {
  //   return (
  //     this.costume?.attachments?.map((attachment) => {
  //       return (
  //         <Wearable
  //           key={`${this.state.costumeId}-${attachment.uuid}`}
  //           scene={this.scene}
  //           attachment={attachment}
  //           selected={attachment.uuid === this.state.attachmentId}
  //           gizmoManager={this.gizmoManager}
  //           updateAttachment={this.updateAttachment}
  //           onSelect={() => this.setState({ attachmentId: attachment.uuid, expandAttachments: true })}
  //         />
  //       )
  //     }) ?? null
  //   )
  // }

  private getAttachmentsForRender() {
    // @ts-expect-error global abuse todo stop passing this via window
    const skeleton: BABYLON.Skeleton | null = window['skeleton']
    const bones = skeleton?.bones.filter((b) => !RegExp(/index/i).exec(b.name))

    // sort wearables in bone Y Axis
    this.costume?.attachments?.sort((a, b) => {
      const aBone = bones?.find((n) => (n.name.split(':')[1] ?? n.name) === a.bone)
      const bBone = bones?.find((n) => (n.name.split(':')[1] ?? n.name) === b.bone)
      if (!aBone || !bBone) return 0
      const posA = -aBone?.getPosition(BABYLON.Space.WORLD).y
      const posB = -bBone?.getPosition(BABYLON.Space.WORLD).y
      return posA - posB
    })

    return this.costume?.attachments?.map((a) => {
      const name = a.name ?? `Wearable #${a.wearable_id}`
      const onClick = () => {
        this.setState({ attachmentId: this.state.attachmentId == a.uuid ? null : a.uuid })
      }
      return (
        <li key={a.uuid} onClick={onClick}>
          <a class={this.state.attachmentId !== a.uuid ? '' : 'active'}>{name}</a>
        </li>
      )
    })
  }

  onSelect = (c: Costume) => {
    // console.log('onCostumeChange', e, e.target.value)

    // const costumeId = parseInt(e.target.value)
    // console.log('onCostumeChange', costumeId)

    // const costume = this.state.costumes.find((c) => c.id == costumeId)

    // if (!costume) {
    //   return
    // }

    // console.log('onCostumeChange', costumeId, costume)
    // this.setState({ costumeId })

    this.userAvatar.setCostume(c)

    // console.log('yolo!')
  }

  onBoneClick = (name: string) => {
    this.setState({ targetBone: name })
  }

  onAttachmentSelect = (attachment: CostumeAttachment) => {
    // this.setState({ attachmentId: attachment.uuid })
  }

  render() {
    const costumes = this.state.costumes.map((c) => {
      const url = `https://render.voxels.com/costumes/${c.id}`
      // const url = `http://localhost:4321/costumes/${c.id}`

      return (
        <li value={c.id}>
          {c.name || `costume#${c.id}`}
          <br />
          <img src={url} />
          {c.id}
          <br />
          <button onClick={() => this.onSelect(c)}>Select</button>
        </li>
      )
    })

    const onDragStart = (w: Wearable) => (e: DragEvent) => {
      e.dataTransfer?.setData('text/plain', JSON.stringify({ type: 'wearable', content: w }))
      e.dataTransfer!.effectAllowed = 'copy'
      e.stopImmediatePropagation()
    }

    const onDragEnd = (_w: Wearable) => (_e: DragEvent) => {}

    const wearables = this.state.assets.map((w) => {
      return (
        <div draggable={true} onDragStart={onDragStart(w)} onDragEnd={onDragEnd(w)} key={w.id}>
          <img src={getWearableGif(w)} alt={w.name} />
          {w.name}
        </div>
      )
    })

    return (
      <section class="costume-overlay">
        <header>
          <h2>Costume</h2>
        </header>

        <ul>{costumes}</ul>

        <h3>Wearables</h3>
        <div class="wearables-grid">{wearables}</div>
      </section>
    )
  }
}
