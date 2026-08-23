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

type Props = { targetCollectionId?: number | null; onUpload?: () => void }

export default function UploadButton({ targetCollectionId, onUpload }: Props) {
  const [uploads, setUploads] = useState<Row[]>([])
  const [dragActive, setDragActive] = useState(false)
  const inFlightRef = useRef(0)
  const nextIdRef = useRef(0)

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

      // Collection wearables only from a collection page. Elsewhere: asset upload only.
      const packId = targetCollectionId != null && targetCollectionId > 0 ? targetCollectionId : null

      const rows: Row[] = vox.map((file) => ({ id: ++nextIdRef.current, file }))
      inFlightRef.current += rows.length
      setUploads((prev) => [...prev, ...rows])

      for (const row of rows) {
        uploadAsset(row.file, packId).then((result) => {
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
    [targetCollectionId, onUpload],
  )

  const onInputChange = (e: Event) => {
    const t = e.target as HTMLInputElement
    queueFiles(t.files)
    t.value = ''
  }

  return (
    <div class="upload-button">
      <h3>Upload Collectibles</h3>

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
