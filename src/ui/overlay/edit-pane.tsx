import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useSignalEffect } from '@preact/signals'
import Feature from '../../features/feature'
import Group from '../../features/group'
import type Parcel from '../../parcel'
import { nearestEditableParcel, selectSelectedFeature } from '../../store'
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
}

function FeatureTreeRow({ feature, selected }: RowProps) {
  const ui = window.ui
  const isSelected = selected?.uuid === feature.uuid
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
      <ul>
        {hasMore ? (
          <AncestorBranch chain={chain} depth={depth + 1} selected={selected} />
        ) : (
          (selected.group ? selected.group.children : [selected]).map((f) => <FeatureTreeRow key={f.uuid} feature={f} selected={selected} />)
        )}
      </ul>
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
        <ul>
          {chain.length ? (
            <AncestorBranch chain={chain} depth={0} selected={selected} />
          ) : (
            <FeatureTreeRow feature={selected} selected={selected} />
          )}
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
    bump((n) => n + 1)
  })
  const selected = props.feature || selectSelectedFeature()
  const Component = props.editor as any
  const feature = props.feature

  return (
    <FeatureContext.Provider value={{ templateFromFeature }}>
      <section class="edit-pane">
        {Component && feature && (
          <div class="edit-pane-inspector editor" key={feature.uuid}>
            {h(Component, {
              feature,
              parcel: props.parcel,
              scene: props.scene,
            })}
          </div>
        )}
        <div class="edit-pane-tree">
          <SelectionTree selected={selected} />
        </div>
      </section>
    </FeatureContext.Provider>
  )
}
