import type { FeatureTemplate } from '../src/features/_metadata'
import db from './pg'

export type LibraryAssetType = 'group' | 'script' | 'feature'

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

export default class LibraryAsset {
  // All attributes are usually = to columns in db table
  id: string = undefined!
  type: LibraryAssetType = 'feature'
  author: string = undefined!
  name: string = undefined!
  description?: string
  category: FeatureAssetCategory | ScriptAssetCategory = FeatureAssetCategory.Miscellaneous
  public = false
  image_url: string = undefined!
  views?: number = 0
  content?: (FeatureTemplate | string)[]
  hash?: string
  has_script?: boolean = false
  has_unsafe_script?: boolean = false
  created_at: any
  updated_at: any

  constructor(params?: any) {
    if (params) {
      Object.assign(this, params)
    }
  }

  static async loadFromId(id: string): Promise<LibraryAsset | null> {
    const res = await db.query('embedded/get-asset-library', `select * from asset_library where id=$1`, [id])

    if (!res.rows[0]) {
      return null
    }

    return new LibraryAsset(res.rows[0])
  }

  async getHashIfValid(): Promise<{ plagiarised: boolean; hash: string }> {
    if (this.type == 'script' && this.content && typeof this.content[0] == 'string') {
      // Remove the white space of the content if it's a script when generating a hash.
      this.content[0].replace(/\s+/, '')
    }

    // Check if hashed content is similar to an asset that already exists
    const res = await db.query(
      'embedded/get-asset-library-hash',
      `
      with computedHash as (
        select
        encode(digest(coalesce($1::text, 'content'), 'sha1'),'hex') as hash
      )
      select
           ( 
            select
            count(id)
            from
            asset_library,computedHash
            where
            computedHash.hash = asset_library.hash),
               ( 
            select
            computedHash.hash as h
            from
            computedHash)
    `,
      [JSON.stringify(this.content)],
    )

    // if count is greater than 0 it means the hash is the same as another asset. (not good)
    // in any case the hash is returned
    return { plagiarised: !!res.rows[0] && res.rows[0]?.count > 0, hash: res.rows[0]?.h }
  }

  async create(): Promise<{ success: boolean; message?: string }> {
    if (this.type !== 'script') {
      // if we have a feature or a group, we clean non-null yet empty scripts.
      // this is to facilitate checking if a content has a script or not.
      // not necessary, but nice, as that allows us to check directly with a query if script is null or not.

      // We remove position information since we don't need it
      // We also remove the uuid to guarantee uniqueness

      this.content = this.content?.map((feature) => {
        if (typeof feature === 'string') {
          this.has_script = true
          return feature
        }
        feature.script = feature.script === '' || feature.script === ' ' ? undefined : feature.script
        feature.type !== 'group' && delete (feature as any).uuid
        // @ts-ignore
        delete feature.position
        if (!!feature.script) {
          this.has_script = true
        }
        return feature
      })
    } else {
      this.has_script = true
    }

    const plagiarismCheck = await this.getHashIfValid()

    if (plagiarismCheck.plagiarised) {
      return { success: false, message: 'An asset similar to this already exists.' }
    }
    // We passed the weak plagiarismCheck; hash is the new hash
    this.hash = plagiarismCheck.hash

    this.has_unsafe_script = this.content && checkScriptSafety(this.content) // returns true if fails

    const res = await db.query(
      'embedded/insert-asset-library',
      `
      insert into
      asset_library (id, type, author,name,description,category,public,image_url,content,hash,has_script,has_unsafe_script,created_at,updated_at)
      values
        (gen_random_uuid(), $1, lower($2),$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW(), NOW())
      returning
        id
    `,
      [this.type, this.author, this.name, this.description, this.category, this.public, this.image_url, JSON.stringify(this.content), this.hash, this.has_script, this.has_unsafe_script],
    )
    // Returning Id to know if the query has been successful.
    if (!res.rows[0]) {
      return { success: false, message: 'Could not share this asset.' }
    }
    this.id = res.rows[0].id
    return { success: true }
  }

  async remove(): Promise<{ success: boolean; message?: string }> {
    const res = await db.query(
      'embedded/delete-asset-library',
      `
    delete
    from
      asset_library
    where
    id = $1
      returning
      id
  `,
      [this.id],
    )
    if (!res.rows[0]) {
      return { success: false, message: 'Could not remove asset.' }
    }
    this.id = res.rows[0].id
    return { success: true }
  }

  async update(): Promise<{ success: boolean; message?: string }> {
    const res = await db.query(
      'embedded/update-asset-library',
      `
      update asset_library
      set name=$2,
      description=$3,
      category=$4,
      public=$5,
      updated_at=now()
      where id = $1
      returning
        id
  `,
      [this.id, this.name, this.description, this.category, this.public],
    )
    if (!res.rows[0]) {
      return { success: false, message: 'Could not update asset.' }
    }
    this.id = res.rows[0].id
    return { success: true }
  }
  static async updateViewsCount(id: string): Promise<{ success: boolean; message?: string }> {
    if (typeof id !== 'string') {
      return { success: false }
    }
    const res = await db.query(
      'embedded/update-asset-library-views',
      `
      update asset_library
      set views=views +1
      where id = $1
      returning
        id
  `,
      [id],
    )
    if (!res.rows[0]) {
      return { success: false }
    }
    const ok = !!res.rows[0].id
    return { success: ok }
  }
}

function checkScriptSafety(content: (FeatureTemplate | string)[]): boolean {
  let failed = false

  let script = ''

  // Group all the scripts into one string
  content.forEach((element) => {
    if (typeof element == 'string') {
      // element is a script
      script = element
    } else {
      // element is a feature
      script += ' \n ' + (element.script || '')
    }
  })

  if (script.match(/(setInterval)/)) {
    failed = true
  }
  // enter further tests here
  return failed
}
