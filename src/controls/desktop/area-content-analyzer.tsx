import { Component, render } from 'preact'
import { unmountComponentAtNode } from 'preact/compat'
import { Dictionary, groupBy, sortBy } from 'lodash'
import type Grid from '../../grid'
import { exitPointerLock, requestPointerLockIfNoOverlays } from '../../../common/helpers/ui-helpers'
import type Parcel from '../../parcel'
import FPSCounter from '../../components/fps-counter'
import type Feature from '../../features/feature'
import { FeatureRecord } from '../../../common/messages/feature'

interface Props {
  onClose?: (e: MouseEvent) => void
  scene: BABYLON.Scene
}

type State = {
  numberParcels: number
  parcels: Parcel[]
  nearbyFeatures: Feature[]
  groupedNearbyFeatures: Dictionary<Feature<FeatureRecord>[]>
  showBoundingBoxes: boolean
  showColliders: boolean
}

export class AreaContentAnalyzer extends Component<Props, State> {
  static showingBoundingBox: boolean
  static showingCollidersBoundingBox: boolean
  static currentElement: Element
  currentPosition: string = undefined!
  state: State = {
    numberParcels: 20,
    parcels: [],
    nearbyFeatures: [],
    groupedNearbyFeatures: {},
    showBoundingBoxes: AreaContentAnalyzer.showingBoundingBox,
    showColliders: AreaContentAnalyzer.showingCollidersBoundingBox,
  }

  get grid() {
    return window.grid as Grid
  }

  get scene() {
    return this.props.scene
  }

  get ui() {
    return window.ui
  }

  /**
   * Get approximate player position
   */
  get currentPoint() {
    const forwardRay = this.scene.activeCamera!.getForwardRay()
    return forwardRay.origin.add(forwardRay.direction.multiplyByFloats(3, 3, 3))
  }

  componentDidMount() {
    const urlParams = new URLSearchParams(window.location.search)
    this.currentPosition = urlParams.get('coords')!
    const parcels = this.grid.getNearest(this.state.numberParcels, this.currentPoint) as Array<Parcel>

    this.setState({ parcels: parcels }, () => {
      this.gridGetContentNearby()
    })
  }

  /**
   * Obtain all features in a array of parcels.
   */
  async gridGetContentNearby() {
    // bias towards the parcel we are looking at

    const parcels = this.state.parcels as Array<Parcel>

    let features: any = []

    for (const parcel of parcels) {
      const p = parcel.featuresList?.map((f) => {
        f.parcel = parcel
        return f
      })
      features = features.concat(p)
    }

    features = await sortBy(
      features.filter((x: any) => {
        return x !== undefined
      }),
      (f: any) => {
        return f.type || f.description.type
      },
    )

    this.setState({ nearbyFeatures: features }, () => {
      this.groupFeatures()
    })
  }

  /**
   * Calls a Parcel.nerfTriggers() function that kills any triggers in the parcel
   */
  nerfTriggers() {
    this.state.parcels &&
      this.state.parcels.map((p: Parcel) => {
        p.nerfTriggers()
      })
  }

  nerfAnimations() {
    this.scene.animationsEnabled = false
  }

  /**
   * Query the Grid to obtain all nearest parcels and re-fetch the parcels' content.
   */
  refresh() {
    const urlParams = new URLSearchParams(window.location.search)
    this.currentPosition = urlParams.get('coords')!
    const parcels = this.grid.getNearest(this.state.numberParcels, this.currentPoint) as Array<Parcel>

    this.setState({ parcels: parcels }, () => {
      this.gridGetContentNearby()
    })
  }

  /**
   * Group all features by Types
   */
  async groupFeatures() {
    const features = await groupBy(this.state.nearbyFeatures, (f) => {
      return f.type || f.description.type
    })
    this.setState({ groupedNearbyFeatures: features })
  }

  highlight = (f: any) => {
    this.ui?.highlightFeature(f)
  }

  toggleBoundingBoxes() {
    this.setState({ showBoundingBoxes: !this.state.showBoundingBoxes }, () => {
      AreaContentAnalyzer.showingBoundingBox = this.state.showBoundingBoxes
      this.scene.meshes.map((m) => {
        return (m.showBoundingBox = this.state.showBoundingBoxes)
      })
    })
  }

  render() {
    // Get all features that have a trigger activated
    const featuresWithTrigger = this.state.nearbyFeatures.filter((feature: any) => feature.description.isTrigger)
    // Get all features with a script.
    const featuresWithScripts = this.state.nearbyFeatures.filter((feature: any) => {
      return feature.description.script
    })
    // Get all features with a 'setInterval' in their script.
    const featuresWithSetIntervals = this.state.nearbyFeatures.filter((feature: any) => feature.description.script?.match(/setInterval/m))

    // Get all features with the 'autoplay' property
    const featureWithautoPlays = this.state.nearbyFeatures.filter((feature: any) => feature.description.autoplay)
    const featureWithAnimations = this.state.nearbyFeatures.filter((feature: any) => feature.description.animations!)
    // Get all features and display them grouped by types.
    const featureTypes = Array.from(Object.keys(this.state.groupedNearbyFeatures)).map((type) => {
      const features = this.state.nearbyFeatures.filter((feature: any) => feature.description.type == type)
      const parcelsCount = features.filter((v: any, i: any, a: any) => a.findIndex((t: any) => t?.parcel.id === v?.parcel.id) === i).length
      const list = features.map((feature: Feature) => {
        return <FeatureRow feature={feature} highlight={this.highlight} />
      })

      return (
        <li>
          {type} - {features.length + ' items'} - {parcelsCount + ' parcels'}
          <ul>{list}</ul>
        </li>
      )
    })

    return (
      <dialog className="-resizable">
        <header>
          <h3>📊 Area Content Analyzer</h3>
          <p className="subtitle">
            Position:{' '}
            <a
              title="Teleport to this position"
              onClick={() => {
                window.persona.teleport(`/play?coords=${this.currentPosition}`)
              }}
            >
              {this.currentPosition}
            </a>
            , Number of nearby parcels:{' '}
            <input
              type="number"
              width={25}
              value={this.state.numberParcels}
              min={1}
              max={70}
              onChange={(e) => {
                this.setState({ numberParcels: (e as any).target['value'] })
              }}
            />
            <a title="Re-fetch all nearby parcels" onClick={() => this.refresh()}>
              🔄<small> Refresh</small>
            </a>
          </p>
          <button className="close" onClick={this.props.onClose}>
            &times;
          </button>
        </header>

        <section class="SplitPanel">
          <aside class="panel_left">
            <div class="Panel">
              <header>
                <p className="subtitle">Summary</p>
              </header>
              <div>
                <FPSCounter scene={this.scene} />
                <ul style="margin-left: 15px">
                  <li>{featureWithAnimations.length} Animations in the area.</li>
                  <ul>
                    {featureWithAnimations.length > 0 && (
                      <li>
                        <a
                          onClick={() => {
                            this.nerfAnimations()
                          }}
                        >{`Nerf Animations`}</a>
                      </li>
                    )}
                  </ul>
                  <li>{featureWithautoPlays.length} autoPlays in the area.</li>
                  <FeaturesList features={featureWithautoPlays} highlight={this.highlight} />
                  <li>{featuresWithTrigger.length} triggers in the area.</li>
                  <ul>
                    {featuresWithTrigger.length > 0 && (
                      <li>
                        <a
                          onClick={() => {
                            this.nerfTriggers()
                          }}
                        >{`Nerf triggers`}</a>
                      </li>
                    )}
                  </ul>
                  <li>{featuresWithScripts.length} scripts in the area.</li>
                  <FeaturesList features={featuresWithScripts} highlight={this.highlight} />
                  <li>{featuresWithSetIntervals.length} setIntervals in the area.</li>
                  <FeaturesList features={featuresWithSetIntervals} highlight={this.highlight} />
                </ul>
              </div>
            </div>
            <div class="Panel">
              <header>
                <p className="subtitle">Babylon Options</p>
              </header>
              <div>
                <ul className="ButtonList">
                  <li>
                    <button
                      onClick={() => {
                        this.toggleBoundingBoxes()
                      }}
                    >
                      {this.state.showBoundingBoxes ? 'Hide All BoundingBoxes' : 'Show All BoundingBoxes'}
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </aside>
          <div class="Panel">
            <header>
              <p className="subtitle">Nearby Content</p>
              <button onClick={() => this.gridGetContentNearby()}>Refresh</button>
            </header>
            <div class="AcaFeatureList">
              <ol>{featureTypes}</ol>
            </div>
          </div>
        </section>
      </dialog>
    )
  }
}

export function showAreaContentAnalyzeUI(scene: BABYLON.Scene) {
  if (!!AreaContentAnalyzer.currentElement) {
    unmountComponentAtNode(AreaContentAnalyzer.currentElement) // unmount the component
    AreaContentAnalyzer.currentElement = null!
  } else {
    const div = document.createElement('div')
    document.body.appendChild(div)
    AreaContentAnalyzer.currentElement = div

    render(
      <AreaContentAnalyzer
        scene={scene}
        onClose={() => {
          !!AreaContentAnalyzer.currentElement && unmountComponentAtNode(AreaContentAnalyzer.currentElement)
          AreaContentAnalyzer.currentElement = null!
          requestPointerLockIfNoOverlays()
          div?.remove()
        }}
      />,
      div,
    )
    exitPointerLock()
  }
}

function FeaturesList(props: { features: Feature[]; highlight: (f: Feature) => void }) {
  const { features, highlight } = props
  if (!features.length) {
    return null
  }
  return (
    <ol>
      {features.map((f) => {
        return (
          <li
            onMouseOver={() => highlight(f)}
            onClick={() => {
              return f.inspect()
            }}
          >
            <a>{f.type || f.description.type}</a>
          </li>
        )
      })}
    </ol>
  )
}

function FeatureRow(props: { feature: Feature; highlight: (f: Feature) => void }) {
  const feature = props.feature

  const isGroup = feature.type == 'group'

  let featuresInGroup = !isGroup || !window.grid ? [] : window.grid.getByID(feature.parcel.id)?.featuresList.filter((f) => f.groupId == feature.uuid)

  if (!featuresInGroup) {
    featuresInGroup = []
  }

  return (
    <li>
      <div style={{ margin: '2px' }}>
        {feature.script && <i className="fi-file-text-o" title="Has a script" />}
        {feature.isAnInstance && <i className="fi-flag-checkered" title="Is an instance" />}
        <a
          onMouseOver={() => props.highlight(feature)}
          onClick={() => {
            return feature.inspect()
          }}
          title={feature.toString()}
          style={{}}
        >
          {feature.toString() || `${feature.type}-no-url`}
        </a>
      </div>
      {!!featuresInGroup.length && (
        <ul>
          <ol>features in group:</ol>
          {featuresInGroup.map((f) => (
            <ol>
              <a
                onMouseOver={() => props.highlight(f)}
                onClick={() => {
                  return f.inspect()
                }}
                title={f.toString()}
                style={{}}
              >
                {' '}
                - {f.toString() || f.description.id || f.type}
              </a>
            </ol>
          ))}
        </ul>
      )}
    </li>
  )
}
