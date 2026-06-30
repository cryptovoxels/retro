import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useSignalEffect } from '@preact/signals'
import Feature from '../../features/feature'
import Group from '../../features/group'
import type Parcel from '../../parcel'
import { nearestEditableParcel, selectNearestEditableParcel, selectSelectedFeature } from '../../store'
import { FeatureContext } from '../features/context'
import { templateFromFeature } from '../../tools/feature'

function featureLabel(feature: Feature) {
  const id = feature.description?.id
  if (id) return id
  return feature.type.replace(/-/g, ' ')
}

type TreeNodeProps = {
  feature: Feature
  selected?: Feature
}

function FeatureTreeNode({ feature, selected }: TreeNodeProps) {
  const ui = window.ui
  const isSelected = selected?.uuid === feature.uuid
  const liRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!isSelected || !liRef.current) return
    liRef.current.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, [isSelected, feature.uuid])

  const kids = feature.type === 'group' ? (feature as Group).children : []

  return (
    <li ref={liRef} data-uuid={feature.uuid} class={isSelected ? '-selected' : ''}>
      <div class="feature-tree-row" onClick={() => feature.openEditor()} onMouseOver={() => ui?.featureTool?.highlightFeature(feature)}>
        <span class="feature-tree-label">{featureLabel(feature)}</span>
      </div>
      {kids.length > 0 && (
        <ul>
          {kids.map((child) => (
            <FeatureTreeNode key={child.uuid} feature={child} selected={selected} />
          ))}
        </ul>
      )}
    </li>
  )
}

function FeatureTree({ roots, selected }: { roots: Feature[]; selected?: Feature }) {
  if (!roots.length) {
    return <p>Loading...</p>
  }

  return (
    <ul class="feature-tree">
      {roots.map((feature) => (
        <FeatureTreeNode key={feature.uuid} feature={feature} selected={selected} />
      ))}
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
  const featuresList = selectNearestEditableParcel()?.featuresList
  const roots = (featuresList || []).filter((f: Feature) => !!f && !f.groupId)
  const Component = props.editor as any
  const feature = props.feature

  return (
    <FeatureContext.Provider value={{ templateFromFeature }}>
      <section class="edit-pane">
        <div class="edit-pane-tree">
          <FeatureTree roots={roots} selected={selected} />
        </div>
        {Component && feature && (
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
