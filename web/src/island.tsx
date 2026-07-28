import { Component, createRef } from 'preact'
import type { VoxelsMap } from './helpers/load-voxels-map'
import { loadVoxelsMap } from './helpers/load-voxels-map'
import Head from './components/head'
import Loading from './components/loading'
import { mapParcelPopup } from './map-parcel-popup'
import { fetchOptions } from './utils'

export interface Props {
  slug?: number
  path?: string
}

export interface State {
  island?: any
  slug?: any
}

export default class Parcels extends Component<Props, State> {
  map: VoxelsMap | null = null
  mapBox = createRef<HTMLDivElement>()

  componentDidMount() {
    this.fetch()
  }

  componentDidUpdate() {
    if (this.props.slug !== this.state.slug) {
      this.fetch()
    }
  }

  componentWillUnmount() {
    this.map?.dispose()
    this.map = null
  }

  get worldCenter() {
    const [lng, lat] = this.state.island.position.coordinates
    return { x: lng * 100, z: lat * 100 }
  }

  get coords() {
    let [lng, lat] = this.state.island.position.coordinates

    lat = Math.floor(Math.abs(lat * 100)) + ' metres ' + (lat < 0 ? 'south' : 'north')
    lng = Math.floor(Math.abs(lng * 100)) + ' metres ' + (lng < 0 ? 'west' : 'east')

    return `Located ${lat}, ${lng} of center.`
  }

  fetch() {
    const slug = this.props.slug

    this.setState({ slug })

    fetch(`${process.env.API}/islands/${slug}.json`, fetchOptions())
      .then((r) => r.json())
      .then((r) => {
        this.setState({ island: r.island }, () => void this.addMap())
      })
  }

  async addMap() {
    if (this.map || !this.state.island) return
    const el = this.mapBox.current
    if (!el) return

    el.innerHTML = ''
    el.style.position = 'relative'
    const canvas = document.createElement('canvas')
    canvas.className = 'voxels-map'
    canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none'
    el.appendChild(canvas)

    const { x, z } = this.worldCenter
    const { VoxelsMap } = await loadVoxelsMap()
    this.map = new VoxelsMap(canvas, {
      ortho: 400,
      parcels: true,
      onClick: (wx, wz) => {
        if (!this.map) return
        const parcel = this.map.parcelAt(wx, wz)
        if (!parcel) return
        mapParcelPopup(this.map, wx, wz, parcel, (url) => window.location.assign(url))
      },
    })
    this.map.setView(x, z, 400)
    this.map.load().catch((e) => console.error('island map load failed', e))
  }

  render() {
    if (!this.state.island) {
      return <Loading />
    }

    const parcels = this.state.island.parcels.map((p: any) => {
      return (
        <li>
          <a className={p.name ? 'bold' : ''} href={`/parcels/${p.id}`}>
            {p.name || p.address}
          </a>
        </li>
      )
    })

    const height = window.innerHeight - 80 + 'px'

    return (
      <section>
        <Head title={`${this.state.island.name}`} />

        <h1>{this.state.island.name}</h1>
        <p>{this.coords}</p>
        <div id="map" class={'map map-web'} style={{ height }} ref={this.mapBox}></div>

        <div>
          <h3>Places</h3>

          <ul>{parcels}</ul>
        </div>
      </section>
    )
  }
}
