import type Parcel from './parcel'
import Feature from './features/feature'
import Group from './features/group'
import { signal } from '@preact/signals'
import Grid from './grid'
import { app } from '../web/src/state'
import { PanelType } from '../web/src/components/panel'

export type CheckedFeatures = Record<string, Feature>

const TICK = 500

const featuresAreRoot = (features: Feature[]) => features.every((f) => !f.groupId)

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
  setCheckedFeatures: (features: Array<Feature>) => {
    const checked: CheckedFeatures = {}
    features.forEach((feature: any) => {
      checked[feature.uuid] = feature
    })
    checkedFeatures.value = checked
    window.ui?.featureTool.setSecondarySelection(Object.values(checked))
  },
  toggleCheckedFeature: (feature: Feature, seed?: Feature) => {
    if (!feature) return

    let list = Object.values(checkedFeatures.value)
    if (!list.length && seed && seed.uuid !== feature.uuid) list = [seed]

    const on = list.some((f) => f.uuid === feature.uuid)
    if (on) {
      list = list.filter((f) => f.uuid !== feature.uuid)
    } else if (!featuresAreRoot([...list, feature])) {
      app.showSnackbar('Multi-select currently works for ungrouped features only.', PanelType.Danger)
      return
    } else {
      list = [...list, feature]
    }

    actions.setCheckedFeatures(list)
  },
  deleteCheckedFeatures: () => {
    const checked = Object.values(checkedFeatures.value)
    if (!checked.length) return

    const amount = checked.reduce((n, f) => {
      n++
      if (f.type == 'group') n += (f as Group).children.length
      return n
    }, 0)
    if (amount >= 2 && !window.confirm(`Delete ${amount} features?`)) return

    checked.forEach((f) => f.delete())
    actions.setCheckedFeatures([])
    window.ui?.featureTool.unHighlight()
  },
  groupCheckedFeatures: () => {
    const selection = Object.values(checkedFeatures.value)
    if (!selection.length) return
    if (selection.some((f) => f.description.type === 'spawn-point')) return
    window.ui?.featureTool.createGroup(selection as any)
    actions.setCheckedFeatures([])
  },
}

export const { setSelectedFeature, setCheckedFeatures, toggleCheckedFeature, deleteCheckedFeatures, groupCheckedFeatures } = actions

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

export const authoring = signal<Set<number>>(new Set())

export const enterAuthoring = (id: number) => {
  const s = new Set(authoring.value)
  s.add(id)
  authoring.value = s
}

export const isAuthoring = (id?: number) => {
  const pid = id ?? selectNearestEditableParcel()?.id
  return pid != null && authoring.value.has(pid)
}
