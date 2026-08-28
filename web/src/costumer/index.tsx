import { Component, Fragment, createRef } from 'preact'
import TextInput from '../../src/components/inplace/text'
import Skin from './skin'
import { app } from '../../src/state'
import Avatar from './avatar'
import { BoneNames, Costume, CostumeAttachment } from '../../../common/messages/costumes'

export type Attachment = Omit<CostumeAttachment, 'wid'> & {
  wid?: string
  wearable?: { id: string; name: string }
}
import { debounce, isEqual, sortBy } from 'lodash'
import { Editor } from './editor'
import { PanelType } from '../../src/components/panel'
import { route } from 'preact-router'
import { pending, registerCostumerVoidBackground, setupGizmos, setupScene } from './utils'
import { Wearable } from './wearable'
import Redirect from '../../src/components/redirect'
import WearableSelector from './wearable-selector'
import WearableIcon from '../components/wearable-icon'
import { md5 } from '../../../common/helpers/utils'

if (process.env.NODE_ENV === 'development') {
  // Must use require here as import statements are only allowed to exist at top-level.
  require('preact/debug')
}

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
  ctxMenu: { id: number; x: number; y: number } | null
  navOpen: boolean
  bonePicker: boolean
  unowned: string[]
}

export default class Costumer extends Component<Props, State> {
  private resizeObserver: ResizeObserver | null = null
  private engine: BABYLON.Engine | null = null
  private scene: BABYLON.Scene | null = null
  private gizmoManager: BABYLON.GizmoManager | null = null
  private editor = createRef()
  private canvas = createRef()

  state: State = {
    attachmentIdx: null,
    loading: true,
    ctxMenu: null,
    navOpen: true,
    bonePicker: false,
    unowned: [],
  }

  componentDidMount() {
    if (!this.canvas.current) {
      console.error('Could not find canvas')
      return
    }

    this.engine = new BABYLON.Engine(this.canvas.current, true, { stencil: true })
    this.resizeObserver = new ResizeObserver(() => this.engine?.resize())
    this.resizeObserver.observe(this.canvas.current)
    this.scene = setupScene(this.canvas.current, this.engine, this.onClick)

    this.gizmoManager = setupGizmos(this.scene, this.onDragEnd)

    registerCostumerVoidBackground()

    this.fetch().then((avatarCostumeId) => {
      if (!this.props.costumeId && avatarCostumeId) {
        route(`/costumer/${avatarCostumeId}`, true)
      }
      this.engine?.runRenderLoop(() => {
        this.scene?.render()
      })
    })
  }

  componentWillUnmount() {
    this.resizeObserver?.disconnect()
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
      void this.loadUnowned()
    }

    if (this.state.attachmentIdx === null && this.gizmoManager) {
      this.gizmoManager.attachToMesh(null)
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

    if (this.state.attachmentIdx === null) return
    const attachment = Object.assign({}, this.attachment, { position, rotation, scaling })
    await this.updateAttachment(this.state.attachmentIdx, attachment)
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
      const boneName = String(mesh.metadata).toLowerCase()
      void this.addAttachmentForBone(boneName)
      return
    }
    if (!mesh) this.setState({ attachmentIdx: null })
  }

  addAttachmentForBone = (bone: string) => {
    if (!this.costume) return
    const b = bone.toLowerCase()
    const attachment: Attachment = { position: [0, 0, 0], rotation: [0, 0, 0], scaling: [0.5, 0.5, 0.5], bone: b }
    const attachments = [...((this.costume.attachments || []) as Attachment[])].filter((a) => a.bone !== b)
    attachments.push(attachment)
    const idx = attachments.length - 1
    this.setState({ attachmentIdx: idx })
    void this.updateCostume({ ...this.costume, attachments: attachments as any })
  }

  onCanvasPointerMove = (ev: MouseEvent) => {
    if (!this.scene || !this.canvas.current) return
    const info = this.scene.pick(ev.offsetX, ev.offsetY, (m: BABYLON.AbstractMesh) => m.id == 'bonesphere')
    const hb = info?.hit && info.pickedMesh?.metadata ? String(info.pickedMesh.metadata) : null
    this.resetBoneSphereHighlights(hb)
  }

  onCanvasLeave = () => {
    this.resetBoneSphereHighlights(null)
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

    const id = parseInt(costume_id, 10)
    const name = this.costume?.name || `costume #${id}`

    try {
      const response = await fetch('/api/avatar/appearance', {
        ...fetchParams,
        method: 'POST',
        body: JSON.stringify({ costume_id }),
      })
      if (!response.ok) {
        throw new Error(response.status + ' ' + response.statusText)
      }
      this.setState({ avatarCostumeId: id })
      app.showSnackbar(`You're wearing ${name}`, PanelType.Success, 4000)
      await app.loadAvatar(true)
      window.connector?.sendChangeCostume(id)
      await window.connector?.persona?.avatar?.attachmentManager?.loadCostume(undefined, id)
    } catch (err) {
      app.showSnackbar('Could not wear that costume', PanelType.Warning)
      console.error(err)
    }
  }

  deleteCostume = async (id?: number) => {
    const cid = id ?? this.props.costumeId
    const answer = confirm(`Are you sure you want to delete costume #${cid}?`)
    if (!answer) {
      return
    }
    this.setState({ loading: true })
    fetch(`/api/costumes/${cid}`, { ...fetchParams, method: 'DELETE' })
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

  duplicateCostume = async (id?: number) => {
    const src = id ? this.state.costumes?.find((c) => c.id === id) : this.costume
    const costume = { ...src }
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
    const clean = {
      ...costume,
      attachments: costume.attachments?.map(({ wearable: _, ...a }) => a).filter((a) => a.wid) ?? null,
    }
    const body = JSON.stringify(clean)

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

  downloadCostume = (id?: number) => {
    const costume = id ? (this.state.costumes?.find((c) => c.id === id) ?? null) : this.costume

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

  onWheel = (ev: WheelEvent) => {
    ev.preventDefault()
  }

  onCtxMenu = (id: number) => (e: MouseEvent) => {
    e.preventDefault()
    this.setState({ ctxMenu: { id, x: e.clientX, y: e.clientY } })
  }

  closeCtxMenu = () => this.setState({ ctxMenu: null })

  ctxRename = async () => {
    const { ctxMenu, costumes } = this.state
    if (!ctxMenu) return
    this.closeCtxMenu()
    const c = costumes?.find((x) => x.id === ctxMenu.id)
    if (!c) return
    const name = prompt('Rename costume', c.name ?? '')
    if (!name) return
    await this.updateCostume({ ...c, name })
    await this.fetch()
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
    const attachments = this.costume?.attachments?.slice() as Attachment[]
    attachments.splice(attachmentIdx, 1)

    const costume = { ...this.costume, attachments: attachments as any }

    await this.updateCostume(costume, true)
    this.setState({ attachmentIdx: null })

    app.showSnackbar('Removed attachment', PanelType.Success)
  }

  throttledUpdate = debounce(async (costume) => {
    await this.updateCostume(costume)
  }, 1000)

  updateAttachment = async (idx: number, attachment: Attachment) => {
    if (!this.costume) {
      app.showSnackbar("Can't update an attached wearable when no costume is selected", PanelType.Warning, 5000)
      return
    }
    const attachments = [...(this.costume.attachments || [])] as Attachment[]
    attachments[idx] = attachment

    const costume = { ...this.costume, attachments: attachments as any }

    const costumes: Costume[] | undefined = this.state.costumes?.map((c: Costume) => (c.id == this.costumeId ? costume : c))

    this.setState({ costumes })
    await this.throttledUpdate(costume)
  }

  private get attachment(): Attachment | null {
    if (this.state.attachmentIdx === null) return null
    return this.costume?.attachments?.[this.state.attachmentIdx] ?? null
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
    try {
      const avatarRes = await fetch(`/api/avatars/${wallet}.json`)
      if (avatarRes.ok) {
        const r = await avatarRes.json()
        if (r.success) {
          avatarCostumeId = r.avatar?.costume_id
          this.setState({ avatarCostumeId })
        }
      }
    } catch {
      app.showSnackbar('Failed to load avatar costume', PanelType.Warning)
    }

    // Wait for this... (must match CostumesController GET /api/avatars/:wallet/costumes)
    const f = await fetch(`/api/avatars/${wallet}/costumes`)
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
    this.setState({ costumes: costumes, loading: false }, () => void this.loadUnowned())

    return avatarCostumeId
  }

  // Which pieces of this costume the wallet cannot wear. The answer trails the chain
  // by one /api/avatars/:wallet/assets load, so treat it as advisory: on any failure
  // leave the list alone rather than blocking Wear.
  loadUnowned = async () => {
    const wallet = app.state.wallet
    const wids = [...new Set((this.costume?.attachments ?? []).map((a) => a.wid).filter(Boolean))] as string[]

    if (!wallet || !wids.length) {
      this.setState({ unowned: [] })
      return
    }

    try {
      const r = await fetch(`/api/avatars/${wallet.toLowerCase()}/unowned.json`, { ...fetchParams, method: 'POST', body: JSON.stringify({ wids }) })
      if (!r.ok) return
      const { unowned } = await r.json()
      this.setState({ unowned: unowned ?? [] })
    } catch {
      // never break the costumer over an ownership check
    }
  }

  hideBoneSpheres() {
    this.resetBoneSphereHighlights(null)
  }

  private getWearablesForRender() {
    return (
      this.costume?.attachments?.map((attachment, idx) => {
        if (!attachment.wid) return null
        const length = this.costume?.attachments?.length ?? 0
        const key = [idx, attachment.bone, attachment.wid, length].join('-')

        return <Wearable key={key} scene={this.scene} attachment={attachment} selected={idx === this.state.attachmentIdx} gizmoManager={this.gizmoManager} onSelect={() => this.setState({ attachmentIdx: idx })} />
      }) ?? null
    )
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

    const worn = !this.props.costumeId ? false : this.state.avatarCostumeId == parseInt(this.props.costumeId, 10)
    const editorKey = `editor-${this.state.attachmentIdx}-${this.props.costumeId}`
    const attachments = this.costume?.attachments ?? []
    const { ctxMenu } = this.state
    const costumes = sortBy(this.state.costumes, (c) => c.name)

    return (
      <section class={`columns nav costumer-page${this.state.navOpen ? '' : ' nav-collapsed'}`}>
        <nav class="costume-list">
          <div>
            <button type="button" class="secondary" onClick={pending(this.createCostume)}>
              New
            </button>
            <button type="button" disabled={worn || this.state.unowned.length > 0} onClick={pending(this.setActive)}>
              Wear
            </button>
          </div>
          <ul>
            {costumes.map((c) => (
              <li key={c.id} class={this.costumeId === c.id ? 'active' : ''} aria-selected={this.costumeId === c.id} onContextMenu={this.onCtxMenu(c.id)}>
                <a
                  href={`/costumer/${c.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    route(`/costumer/${c.id}`, true)
                  }}
                >
                  {c.name || `costume#${c.id}`}
                  {this.state.avatarCostumeId === c.id ? ' *' : ''}
                </a>
              </li>
            ))}
          </ul>
          {ctxMenu && (
            <div onClick={this.closeCtxMenu} style="position:fixed;inset:0;z-index:99">
              <menu class="context" style={{ position: 'absolute', left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
                <li onClick={this.ctxRename}>Rename</li>
                <li
                  onClick={() => {
                    this.closeCtxMenu()
                    void this.duplicateCostume(ctxMenu.id)
                  }}
                >
                  Duplicate
                </li>
                <li
                  onClick={() => {
                    this.closeCtxMenu()
                    void this.deleteCostume(ctxMenu.id)
                  }}
                >
                  Delete
                </li>
                <li
                  onClick={() => {
                    this.closeCtxMenu()
                    this.downloadCostume(ctxMenu.id)
                  }}
                >
                  Download
                </li>
              </menu>
            </div>
          )}
        </nav>

        <article>
          <button class="hamburger" type="button" onClick={() => this.setState({ navOpen: !this.state.navOpen })}>
            ☰
          </button>

          <h1>{this.costume?.name}</h1>

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

            <canvas onWheel={this.onWheel} onMouseMove={this.onCanvasPointerMove} onMouseLeave={this.onCanvasLeave} class="costumer" ref={this.canvas} />
          </figure>
          {avatar}
        </article>

        <aside>
          <div class="add-wearable">
            <button type="button" onClick={() => this.setState({ bonePicker: !this.state.bonePicker })}>
              + add wearable
            </button>
            {this.state.bonePicker && (
              <ul class="bone-list">
                {BoneNames.filter((b) => !b.includes('index')).map((b) => (
                  <li
                    key={b}
                    onClick={() => {
                      this.setState({ bonePicker: false })
                      void this.addAttachmentForBone(b)
                    }}
                  >
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {this.state.unowned.length > 0 && (
            <p class="shopping-list">
              you must buy these wearables to wear this:
              {this.state.unowned.map((wid) => (
                <span key={wid}>{wid}</span>
              ))}
            </p>
          )}

          <div class="wearables">
            {attachments.map((a, idx) => {
              const selected = idx == this.state.attachmentIdx
              return (
                <div key={`${a.wid}-${idx}`} class={selected ? 'attachment selected' : 'attachment'} onClick={() => this.setState({ attachmentIdx: idx })}>
                  {a.wid ? <WearableIcon id={a.wid} title={a.wearable?.name ?? a.wid} /> : null}
                  <cite class="bone">{a.bone}</cite>
                </div>
              )
            })}
          </div>
          {this.state.attachmentIdx !== null && attachments[this.state.attachmentIdx] ? (
            <>
              <Editor
                ref={this.editor}
                key={editorKey}
                attachmentIdx={this.state.attachmentIdx}
                costume={this.costume}
                deleteAttachment={this.removeAttachment}
                updateAttachment={(a) => this.updateAttachment(this.state.attachmentIdx!, a)}
              />
              <WearableSelector
                attachment={attachments[this.state.attachmentIdx]}
                bone={attachments[this.state.attachmentIdx].bone}
                onPick={(w) => {
                  const idx = this.state.attachmentIdx!
                  const a = attachments[idx]
                  void this.updateAttachment(idx, {
                    ...a,
                    wid: w.id,
                    wearable: { id: w.id, name: w.name },
                  })
                }}
              />
            </>
          ) : null}
        </aside>
      </section>
    )
  }
}
