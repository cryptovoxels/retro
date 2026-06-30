import type Parcel from './parcel'
import Feature from './features/feature'
import { signal } from '@preact/signals'
import Grid from './grid'

export type CheckedFeatures = Record<string, Feature>

const TICK = 500

setInterval(() => {
  const grid = window.grid as Grid

  if (!grid) {
    return
  }

  const mutable = grid.nearestEditableParcel()

  if (mutable) {
    nearestEditableParcel.value = mutable
  } else {
    nearestEditableParcel.value = undefined
  }

  const nearest = grid.currentOrNearestParcel()

  if (nearest) {
    currentOrNearestParcel.value = nearest
  } else {
    currentOrNearestParcel.value = undefined
  }
}, TICK)

const actions = {
  setSelectedFeature: (feature: Feature) => {
    selectedFeature.value = feature
  },
  toggleCheckFeature: (feature: Feature) => {
    if (!feature) return

    const features = { ...checkedFeatures.value }
    if (features[feature.uuid]) {
      delete features[feature.uuid]
    } else {
      features[feature.uuid] = feature
    }

    checkedFeatures.value = features
    window.ui?.featureTool.setSecondarySelection(Object.values(features))
  },
  uncheckFeature: (feature: Feature) => {
    if (!feature) return

    const features = { ...checkedFeatures.value }
    delete features[feature.uuid]

    checkedFeatures.value = features
    window.ui?.featureTool.setSecondarySelection(Object.values(features))
  },
  setCheckedFeatures: (features: Array<Feature>) => {
    const checked: CheckedFeatures = {}
    features.forEach((feature: any) => {
      checked[feature.uuid] = feature
    })
    checkedFeatures.value = checked
    window.ui?.featureTool.setSecondarySelection(Object.values(checked))
  },
}

export const { setSelectedFeature, toggleCheckFeature, uncheckFeature, setCheckedFeatures } = actions

export const nearestEditableParcel = signal<Parcel | undefined>(undefined)

export const selectNearestEditableParcel = () => {
  return nearestEditableParcel.value
}

export const currentOrNearestParcel = signal<Parcel | undefined>(undefined)

export const selectCurrentOrNearestParcel = () => {
  return currentOrNearestParcel.value
}

export const selectedFeature = signal<Feature | undefined>(undefined)

export const selectSelectedFeature = () => {
  return selectedFeature.value
}

export const checkedFeatures = signal<CheckedFeatures>({})

export const selectCheckedFeatures = (): CheckedFeatures => {
  return checkedFeatures.value
}

export const uiPane = signal<string | undefined>(undefined)
export const uiAsideTick = signal(0)
