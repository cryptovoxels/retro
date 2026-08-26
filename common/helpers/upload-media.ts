import { app } from '../../web/src/state'
import { generateFileName, ugcKey, UploadMediaType } from './ugc-upload-keys'

export type { UploadMediaType } from './ugc-upload-keys'
export { generateFileName, ugcKey } from './ugc-upload-keys'

export const onBeginUpload: BABYLON.Observable<File> = new BABYLON.Observable()
export const onCompleteUpload: BABYLON.Observable<File> = new BABYLON.Observable()
export const onFailUpload: BABYLON.Observable<File> = new BABYLON.Observable()

export type UploadMediaResult =
  | {
      success: true
      location: string
    }
  | {
      success: false
      error: string
    }

const uploaded = new Set<string>()

async function prepare(file: File, mediaType: UploadMediaType) {
  const wallet = app.state.wallet
  if (!wallet) throw new Error('cant upload missing wallet')
  const name = await generateFileName(file, mediaType, wallet)
  return { key: ugcKey(wallet, mediaType, name), name }
}

async function requestPresign(name: string, file: File, mediaType: UploadMediaType) {
  const res = await fetch('/api/ugc/presign', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      contentType: file.type || 'application/octet-stream',
      contentLength: file.size,
      mediaType,
    }),
  })
  const data = await res.json()
  if (!data.success) {
    return { success: false as const, error: data.error || 'presign failed' }
  }
  return {
    success: true as const,
    exists: !!data.exists,
    uploadUrl: data.uploadUrl as string | undefined,
    key: data.key as string,
  }
}

export async function uploadMedia(file: File, mediaType: UploadMediaType = 'parcel-content'): Promise<UploadMediaResult> {
  onBeginUpload.notifyObservers(file)
  try {
    const { name, key } = await prepare(file, mediaType)
    const location = `ugc://${key}`

    if (uploaded.has(key)) {
      onCompleteUpload.notifyObservers(file)
      return { success: true, location }
    }

    const presigned = await requestPresign(name, file, mediaType)
    if (!presigned.success) {
      onFailUpload.notifyObservers(file)
      return presigned
    }

    if (presigned.exists) {
      uploaded.add(key)
      onCompleteUpload.notifyObservers(file)
      return { success: true, location }
    }

    const put = await fetch(presigned.uploadUrl!, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'x-amz-acl': 'public-read',
      },
      body: file,
    })

    if (!put.ok) {
      onFailUpload.notifyObservers(file)
      return { success: false, error: 'upload failed' }
    }

    uploaded.add(key)
    onCompleteUpload.notifyObservers(file)
    return { success: true, location }
  } catch (ex) {
    onFailUpload.notifyObservers(file)
    throw ex
  }
}

export async function uploadWithProgress(file: File, onProgress: (pct: number) => void, mediaType: UploadMediaType = 'parcel-content'): Promise<UploadMediaResult> {
  onBeginUpload.notifyObservers(file)

  try {
    const { name, key } = await prepare(file, mediaType)
    const location = `ugc://${key}`

    if (uploaded.has(key)) {
      onProgress(100)
      onCompleteUpload.notifyObservers(file)
      return { success: true, location }
    }

    const presigned = await requestPresign(name, file, mediaType)
    if (!presigned.success) {
      onFailUpload.notifyObservers(file)
      return presigned
    }

    if (presigned.exists) {
      uploaded.add(key)
      onProgress(100)
      onCompleteUpload.notifyObservers(file)
      return { success: true, location }
    }

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', presigned.uploadUrl!)
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
      xhr.setRequestHeader('x-amz-acl', 'public-read')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          uploaded.add(key)
          onCompleteUpload.notifyObservers(file)
          resolve({ success: true, location })
        } else {
          onFailUpload.notifyObservers(file)
          resolve({ success: false, error: 'upload failed' })
        }
      }
      xhr.onerror = () => {
        onFailUpload.notifyObservers(file)
        resolve({ success: false, error: 'upload failed' })
      }
      xhr.send(file)
    })
  } catch (ex) {
    onFailUpload.notifyObservers(file)
    throw ex
  }
}
