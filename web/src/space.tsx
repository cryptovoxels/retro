import { Component } from 'preact'
import { fetchOptions } from './utils'
import { ssrFriendlyDocument } from '../../common/helpers/utils'
import { SpaceRecord } from '../../common/messages/space'
import { avatarName } from '../../common/messages/avatar-ref'
import Head from './components/head'
import cachedFetch from './helpers/cached-fetch'
import { truncate } from './lib/string-utils'

function featureUrl(raw: unknown): string | null {
  if (!raw) return null
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0]
  if (typeof raw === 'object' && raw !== null && typeof (raw as any).url === 'string') return (raw as any).url
  return null
}

function basename(url: string): string {
  try {
    const path = new URL(url, location.origin).pathname
    const name = path.split('/').filter(Boolean).pop()
    return name || url
  } catch {
    return url.split('/').filter(Boolean).pop() || url
  }
}

function featureColor(raw: unknown): string | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    if (raw.startsWith('#')) return raw
    if (/^[0-9a-fA-F]{3,8}$/.test(raw)) return `#${raw}`
    return raw
  }
  return null
}

function featureSource(f: any): { key: string; label: string; href?: string } {
  const url = featureUrl(f.url) || (typeof f.assetUrl === 'string' && f.assetUrl) || (typeof f.link === 'string' && f.link) || (typeof f.previewUrl === 'string' && f.previewUrl)
  if (url) {
    return { key: url, label: basename(url), href: url }
  }
  const color = featureColor(f.color)
  if (color) return { key: color, label: color }
  return { key: 'unknown', label: 'unknown' }
}

function contentGroups(features: any[]) {
  const byType = new Map<string, Map<string, { count: number; label: string; href?: string }>>()
  for (const f of features) {
    const type = f?.type || 'unknown'
    const src = featureSource(f)
    const group = byType.get(type) || new Map()
    const row = group.get(src.key)
    if (row) row.count++
    else group.set(src.key, { count: 1, label: src.label, href: src.href })
    byType.set(type, group)
  }
  return byType
}

function ownerHref(owner: SpaceRecord['owner']): string | null {
  if (!owner) return null
  if (typeof owner === 'string') return `/avatar/${owner}`
  if (typeof owner === 'object' && (owner as any).owner) return `/avatar/${(owner as any).owner}`
  return null
}

export interface Props {
  space?: SpaceRecord
  path?: string
  id?: string
}

export interface State {
  space: SpaceRecord | null
  error: string | null
}

export default class Space extends Component<Props, State> {
  constructor(props: Props) {
    super()

    const d = ssrFriendlyDocument?.querySelector && ssrFriendlyDocument.querySelector('#space-json')
    let space: SpaceRecord | null = null

    if (d && d.getAttribute('data-space-id') === String(props.id)) {
      try {
        space = JSON.parse(d.getAttribute('value')!)
      } catch {
        space = null
      }
    } else if (props.space) {
      space = props.space
    }

    this.state = { space, error: null }
  }

  componentDidMount() {
    this.fetch()
  }

  componentDidUpdate(prev: Props) {
    if (prev.id != this.props.id) this.fetch()
  }

  fetch() {
    if (!this.props.id) return
    cachedFetch(`/api/spaces/${this.props.id}.json`, fetchOptions())
      .then((r) => r.json())
      .then((r) => {
        if (!r?.space) {
          this.setState({ error: 'not found', space: null })
          return
        }
        this.setState({ space: r.space, error: null })
      })
      .catch(() => this.setState({ error: 'failed to load', space: null }))
  }

  downloadJson = () => {
    const space = this.state.space
    if (!space) return
    const blob = new Blob([JSON.stringify({ space }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    const safe = (space.name || space.id || 'space').replace(/[^\w.-]+/g, '_')
    a.href = URL.createObjectURL(blob)
    a.download = `${safe}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  render() {
    const space = this.state.space
    const features = space?.content?.features || []
    const byType = contentGroups(features)

    const voxels = !!(space?.content?.voxels || space?.voxels)
    const name = space?.name || space?.id || 'space'
    const owner = space ? avatarName(space.owner) : ''
    const href = space ? ownerHref(space.owner) : null

    return (
      <section style={{ padding: '1rem', maxWidth: '40rem' }}>
        {space && <Head title={name} description="spaces are deprecated" url={`/spaces/${space.id}`} />}

        <h1>{name}</h1>

        {this.state.error && <p>{this.state.error}</p>}

        {space && (
          <>
            <p>
              {space.width}&times;{space.height}&times;{space.depth}
              {' · '}
              {features.length} feature{features.length === 1 ? '' : 's'}
              {' · '}
              voxels {voxels ? 'yes' : 'no'}
              {' · '}
              owner {href ? <a href={href}>{owner}</a> : owner || 'none'}
            </p>

            {space.description && <p>{space.description}</p>}

            <p>
              <a href={`/spaces/${space.id}/play`}>view</a>
              {' · '}
              <button type="button" class="outline" onClick={this.downloadJson}>
                download space
              </button>{' '}
              <a href={`/api/spaces/${space.id}.json`}>json</a>
            </p>

            <h2>content</h2>
            {features.length === 0 ? (
              <p>no features</p>
            ) : (
              <ul class="content-tree">
                {[...byType.entries()].map(([type, sources]) => (
                  <li>
                    {type}s:
                    <ul>
                      {[...sources.values()]
                        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
                        .map((row) => (
                          <li>
                            {row.count} {row.href ? <a href={row.href}>{truncate(row.label, 20)}</a> : truncate(row.label, 20)}
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {!space && !this.state.error && <p>loading…</p>}
      </section>
    )
  }
}
