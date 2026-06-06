import { Component } from 'preact'
import type Parcel from '../../parcel'
import ParcelBudget from '../../parcel-budget'
import VoxelBuilder from './voxel-builder'
import { FeatureType } from '../../../common/messages/feature'
import { app } from '../../../web/src/state'
import Panel, { PanelType } from '../../../web/src/components/panel'
import { FeatureMetadata, featuresInfo, FeatureTemplate, featureTemplates, PlaceableFeatureTypes } from '../../features/_metadata'
import { requestPointerLock } from '../../../common/helpers/ui-helpers'

interface Props {
  parcel?: Parcel
  scene: BABYLON.Scene
}

export default class AddTab extends Component<Props, any> {
  get ui() {
    return window.ui
  }

  get controls() {
    return window.connector.controls
  }

  get parcel() {
    return window.grid?.nearestEditableParcel()
  }

  spawn(template: FeatureTemplate) {
    console.log('spawn', template)

    if (!this.parcel) {
      // Can't place things outside a parcel
      return
    }

    if (!this.parcel.budget.hasBudgetFor(template.type as any)) {
      // If parcel has no budget for feature, don't even consider showing the place holder (or else it's bad UX)
      app.showSnackbar('Limit reached for this feature', PanelType.Danger)
      return
    }

    this.ui?.featureTool.setModeAdd(template)
    this.ui?.setTool(this.ui.featureTool)
    requestPointerLock()

    console.log('spawned')
  }

  count(type: FeatureType) {
    if (!this.props.parcel) {
      return 0
    }
    return this.props.parcel.budget.count(type)
  }

  isNotAvailable(type: PlaceableFeatureTypes) {
    return !this.props.parcel || (type && ParcelBudget.budget(type, this.props.parcel) == 0)
  }

  isSelectable(type: PlaceableFeatureTypes) {
    return (type && this.props.parcel && this.count(type) >= ParcelBudget.budget(type, this.props.parcel)) || !app.signedIn // anon user cant place features
  }

  metaText(type: PlaceableFeatureTypes) {
    const used = this.props.parcel?.budget.count(type)

    const copy = this.isNotAvailable(type) ? 'This feature is not available in sandbox' : `${used}/${this.props.parcel?.budget.remaining(type)}`
    return <span class="meta">{copy}</span>
  }

  renderFeature = (feature: FeatureMetadata) => {
    if (this.isNotAvailable(feature.type)) {
      return null
    }

    return (
      <li className={!this.isSelectable(feature.type) && ('selectable' as any)} onClick={() => this.spawn({ ...featureTemplates[feature.type] })}>
        <div className={'middle-container'}>
          {feature.title}
          <small>{feature.subtitle}</small>
        </div>
        {this.metaText(feature.type)}
      </li>
    )
  }

  render() {
    return (
      <section>
        <div class={`FeatureSpawnList`}>
          <h4>Features</h4>
          <ul className="add-buttons">{featuresInfo.filter((x) => !x.modOnly || app.state.moderator).map(this.renderFeature)}</ul>
        </div>
      </section>
    )
  }
}
