import { Component } from 'preact'
import { uploadWithProgress } from '../../common/helpers/upload-media'

type State = {
  busy: boolean
  progress: number
  errors: string[]
  pendingSrc: string | null
  status: string
}

function localAvatar() {
  return window.connector?.persona?.avatar
}

export class AvatarTab extends Component<{}, State> {
  state: State = {
    busy: false,
    progress: 0,
    errors: [],
    pendingSrc: null,
    status: '',
  }

  onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    this.setState({ busy: true, progress: 0, errors: [], pendingSrc: null, status: 'compiling...' })

    const { compileVrm } = await import('../vrm')
    const { bytes, errors } = await compileVrm(file)
    if (errors.length || !bytes) {
      this.setState({ busy: false, errors, status: '' })
      return
    }

    this.setState({ status: 'uploading...' })
    const compiled = new File([bytes as BlobPart], file.name.replace(/\.vrm$/i, '') + '.vrm', { type: 'application/octet-stream' })
    const result = await uploadWithProgress(compiled, (pct) => this.setState({ progress: pct }), 'avatar')
    if (!result.success) {
      this.setState({ busy: false, errors: [result.error || 'upload failed'], status: '' })
      return
    }

    localAvatar()?.wearPreview(result.location)
    this.setState({ busy: false, pendingSrc: result.location, progress: 100, status: 'previewing - hit save to keep it' })
  }

  save = async () => {
    const src = this.state.pendingSrc
    if (!src) return
    this.setState({ busy: true, status: 'saving...' })
    try {
      const res = await fetch('/api/avatar/appearance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        this.setState({ busy: false, errors: [data.error || 'save failed'], status: '' })
        return
      }
      localAvatar()?.clearPreview()
      this.setState({ busy: false, pendingSrc: null, status: 'saved' })
    } catch (e) {
      this.setState({ busy: false, errors: [e instanceof Error ? e.message : 'save failed'], status: '' })
    }
  }

  takeOff = async () => {
    this.setState({ busy: true, status: 'removing...' })
    try {
      const res = await fetch('/api/avatar/appearance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: null }),
      })
      if (!res.ok) {
        this.setState({ busy: false, errors: ['could not take it off'], status: '' })
        return
      }
      localAvatar()?.wearPreview(null)
      localAvatar()?.clearPreview()
      this.setState({ busy: false, pendingSrc: null, status: 'back to woody' })
    } catch {
      this.setState({ busy: false, errors: ['could not take it off'], status: '' })
    }
  }

  cancelPreview = () => {
    localAvatar()?.clearPreview()
    this.setState({ pendingSrc: null, status: '', errors: [] })
  }

  render() {
    const { busy, progress, errors, pendingSrc, status } = this.state
    const wearing = localAvatar()?.src

    return (
      <div>
        <h3>avatar</h3>
        <p>upload a VRM 1.0. we compile it, test it hard, then you preview before saving.</p>

        <div class="f">
          <label>vrm file</label>
          <input type="file" accept=".vrm" disabled={busy} onChange={this.onFile} />
        </div>

        {busy && progress > 0 && progress < 100 && (
          <div class="f">
            <label>upload</label>
            <span>{Math.round(progress)}%</span>
          </div>
        )}

        {status && (
          <div class="f">
            <label>status</label>
            <span>{status}</span>
          </div>
        )}

        {errors.length > 0 && (
          <div class="f">
            <label>failed</label>
            <ul>
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {pendingSrc && (
          <div class="f">
            <label />
            <button type="button" disabled={busy} onClick={this.save}>
              save
            </button>
            <button type="button" disabled={busy} onClick={this.cancelPreview}>
              cancel
            </button>
          </div>
        )}

        {wearing && !pendingSrc && (
          <div class="f">
            <label />
            <button type="button" disabled={busy} onClick={this.takeOff}>
              take it off
            </button>
          </div>
        )}
      </div>
    )
  }
}
