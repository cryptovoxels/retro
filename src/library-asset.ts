import { PanelType } from '../web/src/components/panel'
import { app } from '../web/src/state'
import { makeIsEnum } from './utils/helpers'

const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

export type LibraryAsset_Type = {
  id?: string
  type: TypeOfLibraryAsset
  author: string
  name: string
  description?: string
  category: FeatureAssetCategory | ScriptAssetCategory
  public: boolean
  views?: number
  content?: any[]
  hash?: string
  image_url: string
  created_at?: any
  updated_at?: any

  // Properties that are checks for user safety
  has_script?: boolean
  has_unsafe_script?: boolean
}

export enum FeatureAssetCategory {
  Animals = 'animals',
  Characters = 'characters',
  Decorations = 'decorations',
  Doors = 'doors',
  LampsAndLamposts = 'lamps',
  Furniture = 'furniture',
  FencesAndWalls = 'walls',
  Floor = 'floor',
  Food = 'food',
  Frames = 'frames',
  Miscellaneous = 'miscellaneous',
  PlantsAndNature = 'nature',
  Clothing = 'clothing',
  TechnologyAndScience = 'technology',
  Scifi = 'science-fiction',
  Engineering = 'engineering',
}

export enum ScriptAssetCategory {
  Tools = 'tools',
  DoorsAndGates = 'doors',
  Games = 'games',
  Decorations = 'decorations',
  Random = 'random',
}

export enum FeatureAssetType {
  RichText = 'richtext',
  TextInput = 'text-input',
  Lantern = 'lantern',
  Particles = 'particles',
  GuestBook = 'guest-book',
  Image = 'image',
  NFTImage = 'nft-image',
  Button = 'button',
  VoxModel = 'vox-model',
  YouTube = 'youtube',
  CollectibleModel = 'collectible-model',
  Polytext = 'polytext',
  Group = 'group',
  Cube = 'cube',
  Audio = 'audio',
  VidScreen = 'vid-screen',
  Sign = 'sign',
  Megavox = 'megavox',
  SpawnPoint = 'spawn-point',
  Video = 'video',
  PoapDispenser = 'poap-dispenser',
  Portal = 'portal',
}

export type TypeOfLibraryAsset = 'feature' | 'script' | 'group'

const isScriptAssetCategory = makeIsEnum<ScriptAssetCategory>(ScriptAssetCategory)
const isFeatureAssetCategory = makeIsEnum<FeatureAssetCategory>(FeatureAssetCategory)
export const isAssetCategory = (x: string): x is ScriptAssetCategory | FeatureAssetCategory => isFeatureAssetCategory(x) || isScriptAssetCategory(x)

export class LibraryAsset {
  id?: string
  type: TypeOfLibraryAsset = 'feature'
  author: string = undefined!
  name: string = undefined!
  description?: string
  category: FeatureAssetCategory | ScriptAssetCategory = FeatureAssetCategory.Miscellaneous
  public = true
  views?: number
  content?: any[]
  hash?: string
  image_url: string = undefined!
  created_at?: any
  updated_at?: any

  // Properties from the queries, checks for user safety
  has_script?: boolean = false
  has_unsafe_script?: boolean = false

  constructor(record: LibraryAsset_Type) {
    Object.assign(this, record)

    if (this.type == 'script' && !record.category) {
      this.category = ScriptAssetCategory.Random
    }
  }

  get summary() {
    return {
      type: this.type,
      author: this.author,
      content: this.content,
      category: this.category,
      name: this.name,
      image_url: this.image_url,
      description: this.description,
      public: this.public,
    }
  }

  private get _isUserAuthor(): boolean {
    return this.author?.toLowerCase() == app.state.wallet?.toLowerCase()
  }

  async create(): Promise<{ success: boolean; message?: string }> {
    const summary = this.summary as any
    // Make sure no valid is null or undefined
    const isAllNotNull = Object.entries(summary).every(([key]: any[]) => {
      return summary[key] !== undefined && summary[key] !== null
    })

    if (!isAllNotNull) {
      return { success: false, message: 'Some information is missing.' }
    }

    let p
    try {
      p = await fetch('/api/library/add', {
        credentials: 'include',
        headers,
        method: 'post',
        body: JSON.stringify(summary),
      })
    } catch (err) {
      console.error(err)
      return { success: false, message: 'Could not reach server' }
    }
    return await p.json()
  }

  async update(dict?: any): Promise<{ success: boolean; message?: string }> {
    let summary = { id: this.id, name: this.name, description: this.description, category: this.category, public: this.public } as any

    if (dict) {
      Object.assign(this, dict)
      summary = { id: this.id, ...dict } // send only a patch if we specify have an object as argument
    }
    // Make sure no valid is null or undefined
    const isAllNotNull = Object.entries(summary).every(([key]: any[]) => {
      return summary[key] !== undefined && summary[key] !== null
    })

    if (!isAllNotNull) {
      return { success: false, message: 'Some information is missing.' }
    }
    if (!this._isUserAuthor) {
      return { success: false, message: 'You are not the creator of this asset.' }
    }
    let p
    try {
      p = await fetch('/api/library/update', {
        credentials: 'include',
        headers,
        method: 'post',
        body: JSON.stringify(summary),
      })
    } catch {
      return { success: false, message: 'Something went wrong, please try again later' }
    }

    return await p.json()
  }

  async remove(): Promise<{ success: boolean; message?: string }> {
    if (!this.id) {
      return { success: false }
    }
    if (!this._isUserAuthor && !app.state.moderator) {
      return { success: false }
    }
    let p
    try {
      p = await fetch('/api/library/remove', {
        credentials: 'include',
        headers,
        method: 'post',
        body: JSON.stringify({ id: this.id }),
      })
    } catch {
      return { success: false, message: 'Could not remove asset, please try again.' }
    }
    const r = await p.json()

    if (r.success) {
      app.showSnackbar(`Successfully removed ${this.name}`, PanelType.Success)
    } else {
      app.showSnackbar(`${r.message || 'Something went wrong'}`, PanelType.Danger)
    }
    return r
  }
}
