import type Parcel from './parcel'
import Feature from './features/feature'
import Group from './features/group'
import { signal } from '@preact/signals'
import { paneFromPath, routePane } from '../web/src/helpers/coords-nav'
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

  currentParcel.value = grid.currentParcel() || undefined
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

    const groups = selection.filter((f) => f.type === 'group') as Group[]
    const rest = selection.filter((f) => f.type !== 'group')
    const done = () => {
      actions.setCheckedFeatures([])
      window.ui?.featureTool.unHighlight()
    }

    if (groups.length === 0) {
      if (selection.length < 2) return
      window.ui?.featureTool.createGroup(selection as any)
      done()
      return
    }

    if (groups.length === 1) {
      const target = groups[0]
      const toAdd = rest.filter((f) => f.groupId !== target.uuid)
      if (!toAdd.length) return
      target.addChildren(toAdd)
      done()
      window.ui?.showEditBrowse()
      return
    }

    const groupIds = new Set(groups.map((g) => g.uuid))
    const toWrap = [...groups, ...rest.filter((f) => !f.groupId || !groupIds.has(f.groupId))]
    window.ui?.featureTool.createGroup(toWrap as any)
    done()
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

export const currentParcel = signal<Parcel | undefined>(undefined)

export const selectCurrentParcel = () => {
  return currentParcel.value
}

export const selectedFeature = signal<Feature | undefined>(undefined)

export const selectSelectedFeature = () => {
  return selectedFeature.value
}

export const checkedFeatures = signal<CheckedFeatures>({})

export const selectCheckedFeatures = (): CheckedFeatures => {
  return checkedFeatures.value
}

export const uiAsideTick = signal(0)
export const broadcastShowboxUuid = signal<string | undefined>(undefined)
// when the local broadcast went live; the closed-sidebar "live" tab reads this for its timer
export const broadcastLiveStartedAt = signal<number | undefined>(undefined)
// the imperative broadcast dock element. preact tears the sidebar mount down whenever the
// /live route leaves, which orphans the dock DOM - the mount re-adopts it from here on remount
// so reopening via the live tab doesn't show an empty pane mid-broadcast.
export const broadcastDockEl: { el: HTMLDivElement | null } = { el: null }

export const closeBroadcastSidebar = () => {
  broadcastShowboxUuid.value = undefined
  if (paneFromPath() === 'broadcast') routePane()
  uiAsideTick.value++
}

export type PendingWomp = {
  coords: string
  parcel: Parcel
  image: string
}

export const pendingWomp = signal<PendingWomp | null>(null)

export const closeTakeWomp = () => {
  pendingWomp.value = null
  if (paneFromPath() === 'takeWomp') routePane()
  uiAsideTick.value++
}
