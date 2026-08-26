import type Parcel from './parcel'
import { app } from '../web/src/state'
import { Vec3 } from '@babylonjs/lite'

const ANONYMOUS_NAME = 'anon'

export class User {
  parcels: Array<Parcel> = []

  get wallet(): string | null {
    return app.state.wallet
  }

  get name(): string {
    return app.state.name ?? app.state.wallet ?? ANONYMOUS_NAME
  }

  get identity() {
    const anon = this.anonymous

    if (anon) {
      return { name: ANONYMOUS_NAME }
    } else {
      return { name: app.state.name, wallet: app.state.wallet, token: app.state.key }
    }
  }

  get moderator(): boolean {
    return app.state.moderator || false
  }

  get anonymous() {
    return !app.state.wallet
  }

  update(name?: string, wallet?: string): void {
    app.setState({
      name,
      wallet,
    })
  }

  /**
   * Get the parcels intersecting with the given point (in grid coordinates)
   */
  getParcels(pointInGrid: Vec3): Array<Parcel> {
    (undefined as any /* todo(lite): BABYLON.TmpVectors.Vector3[0].copyFrom(pointInGrid) */)
    // Nudge up or else the pointInGrid is too LOW.
    (undefined as any /* todo(lite): BABYLON.TmpVectors.Vector3[0].addInPlaceFromFloats(0, 0.5, 0) */)
    return this.parcels.filter((p) => p.exteriorBounds.intersectsPoint((undefined as any /* todo(lite): BABYLON.TmpVectors.Vector3[0] */)))
  }
}
