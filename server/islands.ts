import db from './pg'

interface Island {
  id: number
  name: string
  geometry: any
  holes_geometry_json?: any
  lakes_geometry_json: any
}

interface PendingGet {
  resolve: (IslandArray: any) => void
  reject: (err: any) => void
}

export class Islands {
  static pendingGets: PendingGet[] = []
  static cachedIslands?: Island[]
  static loadingStarted = false

  // static getOrFetch(): Promise<Island[]> {
  //   return new Promise((resolve, reject) => {
  //     if (this.cachedIslands) return resolve(this.cachedIslands)

  //     // queue it up for resolution once loaded
  //     this.pendingGets.push({ resolve, reject })

  //     if (!this.loadingStarted) {
  //       this.fetch()
  //         .then((islands) => {
  //           this.cachedIslands = islands
  //           while (this.pendingGets.length) {
  //             this.pendingGets.shift()!.resolve(this.cachedIslands)
  //           }
  //         })
  //         .catch(() => {
  //           while (this.pendingGets.length) {
  //             this.pendingGets.shift()!.reject(this.cachedIslands)
  //           }
  //         })
  //     }
  //   })
  // }

  static async fetch() {
    const result = await db.query(
      'embedded/get-islands',
      `
    select
      id,
      name,
      texture,
      json_build_object('origin', content->'origin', 'features', content->'features', 'streets', content->'streets') as content,
      
      holes_geometry_json,
      lakes_geometry_json,
      geometry_json as geometry
    from
      islands
    order by
      id asc;
    `,
    )

    return result.rows.map((row: Island) => {
      if (!['Scarcity', 'Flora', 'Andromeda'].includes(row.name)) {
        // Temporarily remove basement holes from islands other than Scarcity and Flora
        // until we can stream islands to user instead of preloading.
        // We still allow lakes, since there are not many of these
        row.holes_geometry_json = undefined
        // row.lakes_geometry_json = { coordinates: [] }
      }
      return row
    }) as Island[]
  }
}
