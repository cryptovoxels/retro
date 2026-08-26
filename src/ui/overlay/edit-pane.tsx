import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useSignalEffect } from '@preact/signals'
import Feature from '../../features/feature'
import Group from '../../features/group'
import type Parcel from '../../parcel'
import { checkedFeatures, deleteCheckedFeatures, groupCheckedFeatures, nearestEditableParcel, selectCheckedFeatures, selectNearestEditableParcel, selectSelectedFeature } from '../../store'
import { FeatureContext } from '../features/context'
import { templateFromFeature } from '../../tools/feature'
import type { FeatureTemplate } from '../../features/_metadata'
import { SceneContext } from '@babylonjs/lite'

function featureLabel(feature: Feature) {
  const id = feature.description?.id
  if (id) return id
  return feature.type.replace(/-/g, ' ')
}

type EditPaneProps = {
  parcel: Parcel | null
  scene: SceneContext
  feature?: Feature
  editor?: any
  publishAsset?: FeatureTemplate | string
  onClosePublish?: () => void
}

export default function EditPane(props: EditPaneProps) {
  const [, bump] = useState(0)
  const treeRef = useRef<HTMLUListElement>(null)

  useSignalEffect(() => {
    nearestEditableParcel.value
    checkedFeatures.value
    bump((n) => n + 1)
  })

  const checked = selectCheckedFeatures()
  const multi = Object.keys(checked).length > 0
  const checkedList = Object.values(checked)
  const selected = props.feature || selectSelectedFeature()
  const roots = (selectNearestEditableParcel()?.featuresList || []).filter((f: Feature) => !!f && !f.groupId)
  const Component = props.editor as any
  const feature = props.feature
  const spawn = checkedList.some((f) => f.description.type === 'spawn-point')

  useEffect(() => {
    const id = selected?.uuid
    if (!id || !treeRef.current) return
    treeRef.current.querySelector(`[data-uuid="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, [selected?.uuid])

  function tree(features: Feature[]) {
    const out = []
    for (const feature of features) {
      const kids = feature.type === 'group' ? (feature as Group).children : []
      const isSelected = !!checked[feature.uuid] || selected?.uuid === feature.uuid
      out.push(
        <li data-uuid={feature.uuid} class={isSelected ? 'selected' : ''}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              feature.openEditor()
            }}
            onMouseOver={() => window.ui?.featureTool?.highlightFeature(feature)}
          >
            {featureLabel(feature)}
          </a>
          {kids.length > 0 && <ul>{tree(kids)}</ul>}
        </li>,
      )
    }
    return out
  }

  return (
    <FeatureContext.Provider value={{ templateFromFeature }}>
      <section>
        <div class="edit-pane-tree" style={{ height: '20rem', overflow: 'auto' }}>
          {roots.length ? (
            <ul class="feature-tree" ref={treeRef}>
              {tree(roots)}
            </ul>
          ) : (
            <p>Loading...</p>
          )}
          {multi && (
            <div class="edit-pane-multi-actions">
              <button disabled={spawn || !checkedList.length} onClick={() => groupCheckedFeatures()}>
                Group
              </button>
              <button disabled={!checkedList.length} onClick={() => deleteCheckedFeatures()}>
                Delete
              </button>
            </div>
          )}
        </div>

        {!multi && !props.publishAsset && Component && feature && (
          <div class="edit-pane-inspector editor" key={feature.uuid}>
            {h(Component, {
              feature,
              parcel: props.parcel,
              scene: props.scene,
            })}
          </div>
        )}
      </section>
    </FeatureContext.Provider>
  )
}
