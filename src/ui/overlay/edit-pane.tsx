import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useSignalEffect } from '@preact/signals'
import Feature from '../../features/feature'
import Group from '../../features/group'
import type Parcel from '../../parcel'
import { checkedFeatures, deleteCheckedFeatures, groupCheckedFeatures, nearestEditableParcel, selectCheckedFeatures, selectSelectedFeature } from '../../store'
import { FeatureContext } from '../features/context'
import { templateFromFeature } from '../../tools/feature'

function featureLabel(feature: Feature) {
  const id = feature.description?.id
  if (id) return id
  return feature.type.replace(/-/g, ' ')
}

function ancestors(feature: Feature): Group[] {
  const chain: Group[] = []
  let g = feature.group
  while (g) {
    chain.unshift(g)
    g = g.group
  }
  return chain
}

type RowProps = {
  feature: Feature
  selected?: Feature
  checked?: boolean
}

function FeatureTreeRow({ feature, selected, checked }: RowProps) {
  const ui = window.ui
  const isSelected = checked || selected?.uuid === feature.uuid
  const liRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!isSelected || !liRef.current) return
    liRef.current.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, [isSelected, feature.uuid])

  return (
    <li ref={liRef} data-uuid={feature.uuid} class={isSelected ? '-selected' : ''}>
      <div class="feature-tree-row" onClick={() => feature.openEditor()} onMouseOver={() => ui?.featureTool?.highlightFeature(feature)}>
        <span class="feature-tree-label">{featureLabel(feature)}</span>
      </div>
    </li>
  )
}

function AncestorBranch({ chain, depth, selected }: { chain: Group[]; depth: number; selected: Feature }) {
  const group = chain[depth]
  const hasMore = depth < chain.length - 1

  return (
    <li data-uuid={group.uuid}>
      <div class="feature-tree-row" onClick={() => group.openEditor()} onMouseOver={() => window.ui?.featureTool?.highlightFeature(group)}>
        <span class="feature-tree-label">{featureLabel(group)}</span>
      </div>
      <ul>{hasMore ? <AncestorBranch chain={chain} depth={depth + 1} selected={selected} /> : (selected.group ? selected.group.children : [selected]).map((f) => <FeatureTreeRow key={f.uuid} feature={f} selected={selected} />)}</ul>
    </li>
  )
}

function SelectionTree({ selected }: { selected?: Feature }) {
  if (!selected) {
    return (
      <ul class="feature-tree">
        <li class="feature-tree-parcel">
          <span class="feature-tree-label">parcel</span>
        </li>
      </ul>
    )
  }

  const chain = ancestors(selected)

  return (
    <ul class="feature-tree">
      <li class="feature-tree-parcel">
        <span class="feature-tree-label">parcel</span>
        <ul>{chain.length ? <AncestorBranch chain={chain} depth={0} selected={selected} /> : <FeatureTreeRow feature={selected} selected={selected} />}</ul>
      </li>
    </ul>
  )
}

function MultiSelectionTree({ features }: { features: Feature[] }) {
  return (
    <ul class="feature-tree">
      <li class="feature-tree-parcel">
        <span class="feature-tree-label">parcel</span>
        <ul>
          {features.map((f) => (
            <FeatureTreeRow key={f.uuid} feature={f} checked />
          ))}
        </ul>
      </li>
    </ul>
  )
}

type EditPaneProps = {
  parcel: Parcel | null
  scene: BABYLON.Scene
  feature?: Feature
  editor?: any
}

export default function EditPane(props: EditPaneProps) {
  const [, bump] = useState(0)
  useSignalEffect(() => {
    nearestEditableParcel.value
    checkedFeatures.value
    bump((n) => n + 1)
  })

  const checked = selectCheckedFeatures()
  const multi = Object.keys(checked).length > 0
  const checkedList = Object.values(checked)
  const selected = props.feature || selectSelectedFeature()
  const Component = props.editor as any
  const feature = props.feature
  const spawn = checkedList.some((f) => f.description.type === 'spawn-point')

  return (
    <FeatureContext.Provider value={{ templateFromFeature }}>
      <section class={'edit-pane' + (multi ? ' edit-pane-multi' : '')}>
        {!multi && Component && feature && (
          <div class="edit-pane-inspector editor" key={feature.uuid}>
            {h(Component, {
              feature,
              parcel: props.parcel,
              scene: props.scene,
            })}
          </div>
        )}
        <div class="edit-pane-tree">
          {multi ? <MultiSelectionTree features={checkedList} /> : <SelectionTree selected={selected} />}
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
      </section>
    </FeatureContext.Provider>
  )
}
