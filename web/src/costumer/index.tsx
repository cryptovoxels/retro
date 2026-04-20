import { Component, Fragment, createRef } from 'preact'
import TextInput from '../../src/components/inplace/text'
import Skin from './skin'
import WearableList from './wearable-list'
import { app } from '../../src/state'
import Avatar from './avatar'
import { Costume, CostumeAttachment } from '../../../common/messages/costumes'
import { debounce, isEqual, sortBy } from 'lodash'
import { Editor } from './editor'
import { PanelType } from '../../src/components/panel'
import { route } from 'preact-router'
import { pending, registerCostumerVoidBackground, setupGizmos, setupScene } from './utils'
import { Wearable } from './wearable'
import { CollectiblesData, fetchMergedWearableCatalog } from '../../../common/helpers/collections-helpers'
import { wearablesForBone } from './bone-wearables'
import { getWearableGif } from '../helpers/wearable-helpers'
import { createHash } from 'crypto'
import { Spinner } from '../../src/spinner'
import Redirect from '../../src/components/redirect'
import { bucketUrl, renderUrl } from '../assets'
import Image from '../components/image'

if (process.env.NODE_ENV === 'development') {
  // Must use require here as import statements are only allowed to exist at top-level.
  require('preact/debug')
}

const md5 = (data: string) => createHash('md5').update(data).digest('hex').toString()

const MAX_ATTACHMENTS = 12

const ContentType = 'application/json'

const fetchParams = {
  headers: { Accept: ContentType, 'Content-Type': ContentType },
  credentials: 'include',
} as const

interface Props {
  costumeId?: string
}

interface State {
  loading: boolean
  attachmentIdx: number | null
  costumes?: Array<Costume>
  avatarCostumeId?: number
  pickedBone: BABYLON.Bone | null
  bonePickerLoading: boolean
  bonePickerItems: CollectiblesData[] | null
  wearables: CollectiblesData[]
}

import { useEffect, useRef, useState } from 'preact/hooks'

interface BonePickerProps {
  bone: BABYLON.Bone
  scene: BABYLON.Scene
  canvas: HTMLCanvasElement
  items: CollectiblesData[] | null
  onBackdrop: (e: MouseEvent) => void
  onClose: () => void
  onPick: (w: CollectiblesData) => void
}

function BonePicker({ bone, scene, canvas, items, onBackdrop, onClose, onPick }: BonePickerProps) {
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const tick = () => {
      const camera = scene.activeCamera
      if (!camera) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const bonePos = BABYLON.Vector3.TransformCoordinates(BABYLON.Vector3.Zero(), bone.getWorldMatrix())
      const viewport = camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight)
      const projected = BABYLON.Vector3.Project(bonePos, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), viewport)
      const cx = Math.min(Math.max(4, projected.x - 24), Math.max(4, canvas.clientWidth - 220))
      const cy = Math.min(Math.max(4, projected.y - 24), Math.max(4, canvas.clientHeight - 160))
      setX(cx)
      setY(cy)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [bone, scene, canvas])

  const boneName = bone.name.split(':').pop() ?? bone.name

  return (
    <div onMouseDown={onBackdrop}>
      <div class="bonepicker" style={{ left: `${x}px`, top: `${y}px`, position: 'absolute' }} onMouseDown={(e) => e.stopPropagation()}>
        <div>
          <strong>{boneName}</strong>
          <button type="button" onClick={onClose}>
            x
          </button>
        </div>
        <ul>
          {(items || []).map((w) => (
            <li key={`bp-${w.id}`} onClick={() => onPick(w)}>
              <Image type="wearable" src={bucketUrl(w.id!)} altsrc={renderUrl(w.id!)} />
              <span>{w.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default class Costumer extends Component<Props, State> {
  private engine: BABYLON.Engine | null = null
  private scene: BABYLON.Scene | null = null
  private targetBone: string | null = null
  private gizmoManager: BABYLON.GizmoManager | null = null
  private editor = createRef()
  private canvas = createRef()

  state: State = {
    attachmentIdx: null,
    loading: true,
    pickedBone: null,
    bonePickerLoading: false,
    bonePickerItems: null,
    wearables: [],
  }

  componentDidMount() {
    if (!this.canvas.current) {
      console.error('Could not find canvas')
      return
    }

    this.engine = new BABYLON.Engine(this.canvas.current, true, { stencil: true })
    window.addEventListener('resize', () => this.engine?.resize(), { passive: true })
    this.scene = setupScene(this.canvas.current, this.engine, this.onClick)

    this.gizmoManager = setupGizmos(this.scene, this.onDragEnd)

    registerCostumerVoidBackground()

    this.fetch().then(() => {
      this.engine?.runRenderLoop(() => {
        this.scene?.render()
      })
    })
  }

  componentWillUnmount() {
    this.gizmoManager?.dispose()
    this.scene?.dispose()
    this.engine?.dispose()
    this.scene = null
    this.engine = null
  }

  componentDidUpdate(prevProps: Props) {
    if (!isEqual(this.props.costumeId, prevProps.costumeId)) {
      this.setState({ attachmentIdx: null })
      this.forceUpdate()
    }

    if (!this.state.attachmentIdx) {
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
    const hash = md5(skin)
    const texture = BABYLON.Texture.LoadFromDataString(`texture/costume/${this.props.costumeId}/${hash}`, encodedData, this.scene, false, false, false)
    texture.hasAlpha = true

    if (material.diffuseTexture) {
      material.diffuseTexture.dispose()
    }

    material.diffuseTexture = texture

    // Update state / save skin
    const costume = { ...this.costume }
    costume.skin = skin

    const costumes = this.state.costumes?.map((c) => {
      if (c.id == this.costumeId) {
        return costume
      } else {
        return c
      }
    })

    this.setState({ costumes })

    await this.throttledUpdate(costume)
  }
  onClick = (mesh: BABYLON.AbstractMesh | undefined) => {
    if (mesh?.id === 'bonesphere' && mesh.metadata) {
      const boneName = String(mesh.metadata)
      // @ts-expect-error global skeleton
      const skeleton: BABYLON.Skeleton | null = window['skeleton']
      const idx = skeleton?.getBoneIndexByName(`mixamorig:${boneName}`) ?? -1
      const bone = idx !== -1 ? skeleton!.bones[idx] : null
      if (bone) void this.openBoneWearablePicker(bone)
      return
    }
    if (!mesh) {
      this.closeBoneWearablePicker()
      this.setState({ attachmentIdx: null })
    }
  }

  openBoneWearablePicker = async (bone: BABYLON.Bone) => {
    this.resetBoneSphereHighlights(null)
    const boneName = bone.name.split(':').pop() ?? bone.name
    this.setState({ pickedBone: bone })
  }

  closeBoneWearablePicker = () => {
    this.resetBoneSphereHighlights(null)
    this.setState({ pickedBone: null })
  }

  onBonePickerBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      this.closeBoneWearablePicker()
    }
  }

  onPickWearableFromBonePopup = (w: CollectiblesData) => {
    const bone = this.state.pickedBone
    if (!bone) return
    const boneName = bone.name.split(':').pop() ?? bone.name
    this.closeBoneWearablePicker()
    void this.addAttachment(w, boneName)
  }

  onCanvasPointerMove = (ev: MouseEvent) => {
    if (!this.scene || !this.canvas.current || this.state.pickedBone) {
      return
    }
    const info = this.scene.pick(ev.offsetX, ev.offsetY, (m: BABYLON.AbstractMesh) => m.id == 'bonesphere')
    const hb = info?.hit && info.pickedMesh?.metadata ? String(info.pickedMesh.metadata) : null
    this.resetBoneSphereHighlights(hb)
  }

  onCanvasLeave = () => {
    if (!this.state.pickedBone) {
      this.resetBoneSphereHighlights(null)
    }
  }

  resetBoneSphereHighlights(hoverBone: string | null) {
    this.bonespheres?.forEach((mesh: BABYLON.AbstractMesh) => {
      if (!mesh.material) {
        return
      }
      const mat = mesh.material as BABYLON.StandardMaterial
      const bone = mesh.metadata as string
      if (hoverBone && bone === hoverBone) {
        mat.emissiveColor.set(0.35, 0, 1)
      } else {
        mat.emissiveColor.set(0.75, 0.75, 0.78)
      }
    })
  }
  setActive = async () => {
    const costume_id = this.props.costumeId
    if (!costume_id) {
      throw new Error("can't set active costume without a costumeId")
    }

    const body = { costume_id }

    await fetch('/api/avatar', { ...fetchParams, method: 'POST', body: JSON.stringify(body) })
      .then((response) => {
        if (!response.ok) {
          throw new Error(response.status + ' ' + response.statusText)
        }
        this.setState({ avatarCostumeId: parseInt(costume_id, 10) })
        app.showSnackbar('Costume choice saved', PanelType.Info)
      })
      .catch((err) => {
        app.showSnackbar('Could not set preferred costume, internal error', PanelType.Warning)
        console.error(err)
      })
  }

  deleteCostume = async () => {
    const answer = confirm(`Are you sure you want to delete costume #${this.props.costumeId}?`)
    if (!answer) {
      return
    }
    this.setState({ loading: true })
    fetch(`/api/costumes/${this.props.costumeId}`, { ...fetchParams, method: 'DELETE' })
      .then((response) => {
        if (!response.ok) throw new Error(response.status + ' ' + response.statusText)
        return response.json()
      })
      .then((data) => {
        if (!data.success) throw new Error('Could not delete costume')
      })
      .then(() => this.fetch())
      .then((costumeID) => {
        app.showSnackbar('Costume deleted', PanelType.Info)
        route(costumeID ? `/costumer/${costumeID}` : `/costumer/`, true)
      })
      .catch((err) => {
        app.showSnackbar('Could not delete costume, internal error', PanelType.Warning)
        throw err
      })
      .finally(() => {
        this.setState({ loading: false })
      })
  }

  createCostume = async (costume: Event | null | Partial<Costume>) => {
    if (!costume || costume instanceof Event) {
      let id = 1

      if (this.state.costumes) {
        const numbers = this.state.costumes.map((c) => parseInt(`${c.name}`.split('-')[1], 10) || 0)
        id = Math.max(...numbers) + 1

        if (!id || isNaN(id) || !isFinite(id)) {
          id = 1
        }
      }

      costume = { name: `Costume-${id}` }
    }

    const body = JSON.stringify(costume)
    const createResponse = await fetch(`/api/costumes/create`, { ...fetchParams, method: 'POST', body })
    if (!createResponse.ok) {
      app.showSnackbar('Could not create costume, please retry', PanelType.Warning)
      console.error('Error response from server when trying to create costume...')
      return
    }

    const createdCostume = await createResponse.json()

    if (!createdCostume || !createdCostume.success) {
      console.error('Could not create costume')
      app.showSnackbar('Could not create new costume, please retry', PanelType.Warning, 7500)
      return
    }
    await this.fetch()

    app.showSnackbar('Costume created', PanelType.Info)

    route(`/costumer/${createdCostume.id}`, true)
  }

  duplicateCostume = async () => {
    const costume = { ...this.costume }
    if (costume.name) {
      costume.name = costume.name.replace(/ copy/i, '') + ' copy'
    }

    const body = JSON.stringify(costume)

    this.setState({ loading: true })
    const createResponse = await fetch(`/api/costumes/create`, { ...fetchParams, method: 'POST', body })

    if (!createResponse.ok) {
      console.error('Error response from server when trying to duplicate costume...')
      app.showSnackbar('Could not duplicate costume, please retry', PanelType.Warning)
      return
    }

    const createdCostume = await createResponse.json()

    if (!createdCostume || !createdCostume.success) {
      console.error('Could not create costume')
      app.showSnackbar('Could not duplicate costume, please retry', PanelType.Warning)
      return
    }

    await this.fetch()

    app.showSnackbar('Duplicated costume', PanelType.Success)

    route(`/costumer/${createdCostume.id}`, true)
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

    if (this.scene) {
      const info = this.scene.pick(ev.offsetX, ev.offsetY, (mesh: BABYLON.AbstractMesh) => mesh.id == 'bonesphere')
      const hb = info?.hit && info.pickedMesh?.metadata ? String(info.pickedMesh.metadata) : null
      this.resetBoneSphereHighlights(hb)
      if (info?.pickedMesh?.metadata) {
        this.targetBone = info.pickedMesh.metadata
      }
    }

    ev.preventDefault()
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = 'copy'
    }
  }

  onDragExit = () => {
    this.resetBoneSphereHighlights(null)
  }

  onWheel = (ev: WheelEvent) => {
    ev.preventDefault()
  }

  onDrop = async () => {
    this.resetBoneSphereHighlights(null)

    const wearable = this.droppedWearable()
    if (!wearable) {
      console.warn('no wearable')
      return
    }
    const bone = this.targetBone || 'Head' // this.skeleton.bones[0]

    if (!this.canAdd(wearable)) {
      app.showSnackbar('Unable to add to costume', PanelType.Warning)
      return
    }

    await this.addAttachment(wearable, bone)
  }

  setName = async (name: string) => {
    if (!this.costume) {
      app.showSnackbar("Can't set name on when no costume is selected", PanelType.Warning, 5000)
      return
    }
    const costume = { ...this.costume }
    costume.name = name

    await this.updateCostume(costume)
    await this.fetch()
  }

  removeAttachment = async (attachmentIdx: number) => {
    if (!this.costume) {
      app.showSnackbar("Can't remove attached wearable when no costume is selected", PanelType.Warning, 5000)
      return
    }
    const attachments = this.costume?.attachments?.slice() as CostumeAttachment[]
    attachments.splice(attachmentIdx, 1)

    const costume = { ...this.costume, attachments }

    await this.updateCostume(costume, true)
    this.setState({ attachmentIdx: null })

    app.showSnackbar('Removed attachment', PanelType.Success)
  }

  throttledUpdate = debounce(async (costume) => {
    await this.updateCostume(costume)
  }, 1000)

  updateAttachment = async (attachment: CostumeAttachment) => {
    if (!this.costume) {
      app.showSnackbar("Can't update an attached wearable when no costume is selected", PanelType.Warning, 5000)
      return
    }
    const costume = { ...this.costume }

    if (costume.attachments) {
      costume.attachments.forEach((a) => {
        if (a.wid == attachment.wid) {
          Object.assign(a, attachment)
        }
      })
    }

    const costumes: Costume[] | undefined = this.state.costumes?.map((c: Costume) => {
      if (c.id == this.costumeId) {
        return costume
      } else {
        return c
      }
    })

    this.setState({ costumes })

    await this.throttledUpdate(costume)
  }

  private get attachment(): CostumeAttachment | null {
    return this.costume?.attachments?.[this.state.attachmentIdx ?? 0] ?? null
  }

  private get layer() {
    return this.scene?.getHighlightLayerByName('selected') ?? null
  }

  private get bonespheres() {
    return this.scene?.getMeshesById('bonesphere') ?? null
  }

  private get costumeId() {
    if (!this.props.costumeId) {
      return null
    }
    return parseInt(this.props.costumeId, 10)
  }

  private get costume(): Costume | null {
    if (!this.state.costumes || !this.props.costumeId) {
      return null
    }

    return this.state.costumes.find((c) => this.costumeId == c.id) ?? null
  }

  async fetch(): Promise<number | undefined> {
    if (!app.state.wallet) {
      throw new Error('No wallet')
    }

    this.setState({ loading: true })
    let avatarCostumeId: number | undefined

    const wallet = app.state.wallet.toLowerCase()
    // Don't block on this
    fetch(`/api/avatars/${wallet}.json`)
      .then(async (f) => {
        if (!f.ok) {
          throw new Error('Not a 200 OK response from api server')
        }
        const r = await f.json()
        if (!r.success) {
          throw new Error('Not a success in response from api server')
        }
        avatarCostumeId = r.avatar?.costume_id
        this.setState({ avatarCostumeId })
      })
      .catch((err) => {
        app.showSnackbar('Failed to load avatar costume', PanelType.Warning)
        this.setState({ loading: false })
        throw err
      })

    var f = await fetch(`/api/wearables/all`)
    if (!f.ok) {
      console.error('Could not fetch wearables')
    } else {
      const { wearables } = await f.json()

      console.log(wearables)

      this.setState({ wearables })
    }

    // Wait for this... (must match CostumesController GET /api/avatars/:wallet/costumes)
    f = await fetch(`/api/avatars/${wallet}/costumes`)
    if (!f.ok) {
      this.setState({ loading: false })
      throw new Error('Could not fetch costumes')
    }

    const { costumes, success } = (await f.json()) as { costumes: Costume[]; success: boolean }

    if (!success) {
      app.showSnackbar('Failed to load costumes. Please try again', PanelType.Warning)
      this.setState({ loading: false })
      throw new Error('Could not fetch costumes')
    }
    this.setState({ costumes: costumes, loading: false })

    return avatarCostumeId
  }

  hideBoneSpheres() {
    this.resetBoneSphereHighlights(null)
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

    return true
  }

  pickWearableForHand = (wearable: CollectiblesData, bone: string) => {
    void this.addAttachment(wearable, bone)
  }

  async addAttachment(wearable: CollectiblesData, bone: string) {
    if (!this.costume) {
      app.showSnackbar("Can't attach wearable when no costume is selected", PanelType.Warning, 5000)
      return
    }

    const s = 0.5
    const costume = { ...this.costume }

    const attachment: CostumeAttachment = {
      name: wearable.name,
      wid: wearable.id!,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scaling: [s, s, s],
      bone,
    }

    let attachments = [...(costume.attachments || [])]
    attachments = attachments.filter((a) => a.bone !== bone)
    costume.attachments = attachments
    costume.attachments.push(attachment)

    const attachmentIdx = attachments.length - 1

    this.setState({ attachmentIdx })
    await this.updateCostume(costume)
    app.showSnackbar('Wearable added', PanelType.Success)
  }

  private getCostumeForRender() {
    if (!this.state.costumes) return null
    return sortBy(this.state.costumes, (c) => c.id).map((c) => {
      const active = this.costumeId == c.id
      const flag = this.state.avatarCostumeId == c.id ? '👗 ' : ''
      return <option value={c.id}>{c.name || `costume#${c.id}`}</option>
    })
  }

  private getWearablesForRender() {
    return (
      this.costume?.attachments?.map((attachment, idx) => {
        const length = this.costume?.attachments?.length ?? 0
        const key = [idx, attachment.bone, attachment.wid, length].join('-')

        return (
          <Wearable
            key={key}
            scene={this.scene}
            attachment={attachment}
            selected={idx === this.state.attachmentIdx}
            gizmoManager={this.gizmoManager}
            updateAttachment={this.updateAttachment}
            onSelect={() => this.setState({ attachmentIdx: idx })}
          />
        )
      }) ?? null
    )
  }

  onChange = (e: Event) => {
    let id = (e.target as HTMLSelectElement).value
    route(`/costumer/${id}`, true)
  }

  render() {
    if (!app.signedIn) {
      return <Redirect to="/account" />
    }

    const avatar = this.scene && (
      <Avatar scene={this.scene} costume={this.costume}>
        {this.getWearablesForRender()}
      </Avatar>
    )

    const skinKey = `skin-${this.props.costumeId}`

    const worn = !this.props.costumeId ? false : this.state.avatarCostumeId == parseInt(this.props.costumeId, 10)
    const editorKey = `editor-${this.state.attachmentIdx ?? 0}-${this.props.costumeId}`
    const preview = `/u/${app.wallet}/costumes/${this.props.costumeId}`
    const attachments = this.costume?.attachments ?? []

    return (
      <section class="columns costumer-page">
        <h1>{this.costume?.name || 'New costume'}</h1>

        <article>
          <figcaption>
            <button type="button" class="secondary" onClick={pending(this.createCostume)}>
              New
            </button>

            <button type="button" disabled={worn} onClick={pending(this.setActive)}>
              Wear
            </button>
            <button type="button" onClick={pending(this.duplicateCostume)}>
              Duplicate
            </button>
            <button type="button" onClick={pending(this.deleteCostume)}>
              Delete
            </button>
            <a class="buttonish" href={preview}>
              Preview
            </a>
          </figcaption>

          <figure>
            <div id="gizmos" class={this.state.attachmentIdx !== null ? 'active' : 'inactive'}>
              <button class="iconish" disabled={this.state.attachmentIdx === null} id="gizmo-position">
                P
              </button>
              <button class="iconish" disabled={this.state.attachmentIdx === null} id="gizmo-rotation">
                R
              </button>
              <button class="iconish" disabled={this.state.attachmentIdx === null} id="gizmo-scale">
                S
              </button>
            </div>

            <canvas onWheel={this.onWheel} onDragOver={this.onDragOver} onDragExit={this.onDragExit} onDrop={this.onDrop} onMouseMove={this.onCanvasPointerMove} onMouseLeave={this.onCanvasLeave} class="costumer" ref={this.canvas} />
            {this.state.pickedBone && this.scene && this.canvas.current ? (
              <BonePicker
                bone={this.state.pickedBone}
                scene={this.scene}
                canvas={this.canvas.current}
                items={this.state.wearables}
                onBackdrop={this.onBonePickerBackdrop}
                onClose={this.closeBoneWearablePicker}
                onPick={this.onPickWearableFromBonePopup}
              />
            ) : null}
          </figure>

          {avatar}
        </article>

        <aside>
          <h2>Name</h2>
          <input type="text" value={this.costume?.name ? this.costume.name : ``} />

          <h2>Wearables</h2>

          <div class="wearables">
            {attachments.map((a, idx) => {
              const name = a.name ?? a.wid
              const bone = a.bone

              const selected = idx == this.state.attachmentIdx

              return (
                <>
                  <div class="attachment">
                    <cite class="bone">{bone}</cite>
                    <p>
                      {selected ? (
                        <b>{name}</b>
                      ) : (
                        <a onClick={(e) => this.setState({ attachmentIdx: idx })} href={anchorUrl(a)}>
                          {name}
                        </a>
                      )}
                    </p>
                  </div>
                  {selected ? <Editor ref={this.editor} key={editorKey} attachmentIdx={idx} costume={this.costume} deleteAttachment={this.removeAttachment} updateAttachment={this.updateAttachment} /> : null}
                </>
              )
            })}
          </div>

          {false && <Skin key={skinKey} costume={this.costume as any} skin={this.costume?.skin ?? ''} default_color={this.costume?.default_color ?? ''} setSkin={this.setSkin} />}

          <h2>Download</h2>

          <button type="button" onClick={this.downloadCostume}>
            costume-{this.costume?.id ?? 'new'}.json
          </button>
        </aside>
      </section>
    )
  }
}

const anchorUrl = (a: CostumeAttachment) => {
  const name = a.name ?? a.wid
  return `#${name.toLowerCase().replace(/^[a-z]/g, '-')}`
}
