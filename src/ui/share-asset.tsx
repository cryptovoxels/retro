import { useState } from 'preact/hooks'
import { app } from '../../web/src/state'
import Panel, { PanelType } from '../../web/src/components/panel'
import { FeatureAssetCategory, LibraryAsset, LibraryAsset_Type, ScriptAssetCategory, TypeOfLibraryAsset } from '../library-asset'
import { FeatureTemplate } from '../features/_metadata'

const SCRIPT_IMAGE = `${process.env.ASSET_PATH}/images/scripting-default.png`

type Props = {
  asset: FeatureTemplate | string
  onClose: () => void
}

function assetType(asset: FeatureTemplate | string): TypeOfLibraryAsset {
  if (typeof asset === 'string') return 'script'
  if (asset.children) return 'group'
  return 'feature'
}

function placeholderImage(type: TypeOfLibraryAsset) {
  if (type === 'script') return SCRIPT_IMAGE
  const icon = type === 'group' ? 'group' : 'vox-model'
  return `${process.env.ASSET_PATH}/icons/${icon}.png`
}

export default function ShareAsset({ asset, onClose }: Props) {
  const type = assetType(asset)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [category, setCategory] = useState<FeatureAssetCategory | ScriptAssetCategory>(type === 'script' ? ScriptAssetCategory.Random : FeatureAssetCategory.Miscellaneous)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const categories = type === 'script' ? Object.entries(ScriptAssetCategory) : Object.entries(FeatureAssetCategory)

  const submit = async () => {
    if (!app.signedIn) {
      setError('You are not signed in')
      return
    }
    if (!name || name.length < 2) {
      setError('Name is invalid.')
      return
    }
    if (name.length > 50) {
      setError('Name is too long. (>50 characters)')
      return
    }
    if (description && description.length > 200) {
      setError('Description is too long (>200 characters).')
      return
    }

    setUploading(true)
    setError(null)

    const body = {
      type,
      author: app.state.wallet,
      content: [asset],
      category,
      name,
      description: description || '',
      public: true,
      image_url: placeholderImage(type),
    } as LibraryAsset_Type

    const r = await new LibraryAsset(body).create()
    setUploading(false)

    if (!r.success) {
      setError(r.message || 'Something went wrong, please try again')
      return
    }

    app.showSnackbar('Asset saved in the asset library!', PanelType.Success)
    onClose()
  }

  return (
    <section class="editor">
      <h3>Share asset</h3>

      <div class="f">
        <label>Name</label>
        <input type="text" placeholder="My Asset" maxLength={50} value={name} onInput={(e) => setName(e.currentTarget.value)} />
      </div>

      <div class="f">
        <label>Description</label>
        <textarea placeholder="Description" maxLength={250} value={description} onInput={(e) => setDescription(e.currentTarget.value)} />
      </div>

      <div class="f">
        <label>Category</label>
        <select value={category} onInput={(e) => setCategory(e.currentTarget.value as any)}>
          {categories.map(([label, value]) => (
            <option value={value}>{label}</option>
          ))}
        </select>
      </div>

      {error && <Panel type="danger">{error}</Panel>}

      <button disabled={uploading || !name} onClick={submit}>
        {uploading ? 'Saving...' : 'Submit'}
      </button>
      <button onClick={onClose}>Back</button>
    </section>
  )
}
