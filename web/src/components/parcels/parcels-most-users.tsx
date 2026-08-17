import { groupBy, sortBy } from 'lodash'
import { Component } from 'preact'
import ParcelHelper from '../../../../common/helpers/parcel-helper'
import { fetchFromMPServer } from '../../../../common/helpers/utils'
import { Spinner } from '../../spinner'
import { fetchOptions } from '../../utils'
import Carousel from '../carousel'

type User = {
  lastSeen: number
  name: string
}
type Parcel = {
  id: string
}

type ActiveParcel = {
  parcel_id: string
  users: User[]
}

interface Props {
  teleportTo?: (e: any) => void
}

interface State {
  parcels: ActiveParcel[]
  loaded?: boolean
}

export default class ParcelMostUsers extends Component<Props, State> {
  controller: AbortController | undefined = undefined
  state = {
    loaded: false,
    parcels: [],
  }
  private interval: NodeJS.Timeout | undefined

  componentDidMount() {
    this.fetchUsers()
    this.interval = setInterval(() => {
      this.fetchUsers()
    }, 10000)
  }

  componentWillUnmount() {
    if (this.controller) {
      this.controller.abort('ABORT: quitting component')
    }
    clearInterval(this.interval)
  }

  async fetchUsers() {
    const r = await fetchFromMPServer<{ users?: User[] }>('/api/users.json')
    if (!r || !r.users) return

    const users = groupBy(r.users, (u: User) => u.lastSeen)
    delete users['undefined'] // remove users with no lastSeen
    delete users['null'] // remove users with no lastSeen

    let result: ActiveParcel[] = []
    Object.keys(users).forEach((parcel_id) => {
      result.push({ parcel_id: parcel_id, users: users[parcel_id] })
    })
    result = sortBy(result, (p: ActiveParcel) => p.users.length).reverse()
    this.fetchParcels(result)
  }

  fetchParcels(parcels: ActiveParcel[]) {
    if (!parcels) {
      return
    }

    this.controller = new AbortController()

    const params = new URLSearchParams()
    parcels?.forEach((p) => params.append('parcel_ids', p.parcel_id))

    fetch(`${process.env.API}/parcels.json?${params}`, { signal: this.controller.signal, ...fetchOptions() })
      .then((r) => r.json())
      .then((r: { parcels?: Parcel[] }) => {
        if (!r.parcels) return

        const result = parcels.map((activeParcel) => {
          const parcel = r.parcels?.find((pa: Parcel) => pa.id == activeParcel.parcel_id)
          return parcel ? { ...activeParcel, ...parcel } : { ...activeParcel }
        })
        this.setState({ parcels: result })
      })
      .catch((e) => {
        // ignore abort errors
        if (typeof e == 'string' && e.startsWith('ABORT')) {
          return
        }
        console.error('Error', e)
      })
      .finally(() => this.setState({ loaded: true }))
  }

  teleport(p: ParcelHelper) {
    p.spawnUrl().then((url) => {
      this.props.teleportTo?.(url)
    })
  }

  getUsersPresent(p: { users: any[] }) {
    const userNotAnon = p.users.find((u: User) => u.name !== 'anon')
    const number = p.users.length
    if (p.users.length == 1 && userNotAnon) {
      return `${userNotAnon.name} present`
    }
    return `${number} present`
  }

  render() {
    if (this.state.loaded && !this.state.parcels?.length) {
      return <div>Nothing is happening at the moment!</div>
    }

    const Parcels =
      this.state.loaded &&
      this.state.parcels.map((p: any) => {
        // protected from mismatch between stale MP server data and database
        if (!ParcelHelper.has_geometry(p)) {
          return
        }
        const parcel = new ParcelHelper(p)
        const url = `https://voxels.com/api/parcels/${p.id}.png`
        return (
          <div key={p.id} onClick={() => this.teleport(parcel)}>
            <img src={url} alt={`map tile of ${p.name || p.address}`} />
            <div>
              <b>{p.name || p.address}</b>
              <small>{this.getUsersPresent(p)}</small>
            </div>
          </div>
        )
      })

    return !this.state.loaded ? <Spinner size={24} bg="dark" /> : <Carousel>{Parcels}</Carousel>
  }
}
