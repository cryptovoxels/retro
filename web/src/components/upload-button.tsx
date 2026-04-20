import { useCallback, useRef, useState } from 'preact/hooks'
import { Assetish } from '../asset'
import { app } from '../state'
import { PanelType } from './panel'

type UploadResult = {
  success: boolean
  error?: string
  asset?: Assetish
  collection_id?: number
  wearable_note?: string
}

type Row = {
  id: number
  file: File
  result?: UploadResult
}

const isVox = (f: File) => f.name.toLowerCase().endsWith('.vox')

const uploadAsset = async (file: File, collectionId: number | null): Promise<UploadResult> => {
  const formData = new FormData()
  formData.append('file', file)
  if (collectionId != null && collectionId > 0) {
    formData.append('collection_id', String(collectionId))
  }

  const f = await fetch(`/api/assets/upload`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  if (!f.ok) {
    return { success: false, error: 'Failed to upload asset, please try again' }
  }

  return await f.json()
}

type Props = { collection?: boolean; targetCollectionId?: number | null; onUpload?: () => void }

export default function UploadButton({ collection, targetCollectionId, onUpload }: Props) {
  const [uploads, setUploads] = useState<Row[]>([])
  const [dragActive, setDragActive] = useState(false)
  const inFlightRef = useRef(0)
  const nextIdRef = useRef(0)
  const successSeenRef = useRef(false)

  const queueFiles = useCallback(
    async (input: FileList | File[] | null | undefined) => {
      if (!input?.length) return
      const all = Array.from(input as ArrayLike<File>)
      const vox = all.filter(isVox)
      if (!vox.length) {
        if (all.length && app.showSnackbar) {
          app.showSnackbar('Only .vox files are accepted', PanelType.Warning)
        }
        return
      }

      const existingId = targetCollectionId != null && targetCollectionId > 0 ? targetCollectionId : null
      const wantPack = !existingId && (!!collection || vox.length >= 2)
      let packId: number | null = existingId
      if (!packId && wantPack) {
        const r = await fetch('/api/collections/upload-pack', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const j = (await r.json().catch(() => ({}))) as { success?: boolean; collection_id?: number; message?: string }
        if (!r.ok || !j.success || j.collection_id == null) {
          if (app.showSnackbar) {
            app.showSnackbar(j.message || 'Could not create upload collection', PanelType.Warning)
          }
          return
        }
        packId = Number(j.collection_id)
      }

      const rows: Row[] = vox.map((file) => ({ id: ++nextIdRef.current, file }))
      inFlightRef.current += rows.length
      setUploads((prev) => [...prev, ...rows])

      for (const row of rows) {
        uploadAsset(row.file, packId).then((result) => {
          if (result.success) {
            successSeenRef.current = true

            // Notify the parent that the upload is complete
            onUpload?.()
          }

          setUploads((prev) => prev.map((r) => (r.id === row.id ? { ...r, result } : r)))

          inFlightRef.current--

          if (inFlightRef.current === 0) {
            if (onUpload) {
              onUpload()
            } else {
              window.location.reload()
            }
          }
        })
      }
    },
    [collection, targetCollectionId],
  )

  const onInputChange = (e: Event) => {
    const t = e.target as HTMLInputElement
    queueFiles(t.files)
    t.value = ''
  }

  const userId = app.state.wallet?.toLowerCase()

  return (
    <div class="upload-button">
      <div
        class={'asset-vox-drop' + (dragActive ? ' asset-vox-drop-active' : '')}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragActive(true)
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragActive(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragActive(false)
          queueFiles(e.dataTransfer?.files)
        }}
      >
        <p class="asset-vox-drop-hint">Drop .vox files here (many at once) or pick files below.</p>

        <input type="file" name="upload-btn" multiple id="upload-btn" accept=".vox" onChange={onInputChange} />
      </div>

      <ul>
        {uploads
          .filter((upload) => !upload.result?.success)
          .map((upload) => (
            <li key={upload.id}>{upload.result ? <span title={upload.result.error}>{upload.file.name} (failed)</span> : <span>{upload.file.name}...</span>}</li>
          ))}
      </ul>
    </div>
  )
}
