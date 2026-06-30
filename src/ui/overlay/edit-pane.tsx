import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useSignalEffect } from '@preact/signals'
import Feature from '../../features/feature'
import Group from '../../features/group'
import type Parcel from '../../parcel'
import { CheckedFeatures, checkedFeatures, nearestEditableParcel, selectCheckedFeatures, selectNearestEditableParcel, selectSelectedFeature, setCheckedFeatures, toggleCheckFeature } from '../../store'
import { FeatureContext } from '../features/context'
import { templateFromFeature } from '../../tools/feature'
import CustomizeVoxels from './customize-voxels'

const allSelected = (features: Feature[], sel: CheckedFeatures) => {
  return features.length === Object.keys(sel).length
}

function featureIcon(feature: Feature) {
  const isImage = feature.type == 'nft-image' || feature.type == 'image'
  if (isImage && feature.url) {
    const url = 'https://cdn.cryptovoxels.com/node/img?mode=color&url=' + encodeURIComponent(feature.url)
    return <img title={feature.type} src={url} />
  }
  return <img title={feature.type} src={`/icons/${feature.type}.png`} />
}

function featureLabel(feature: Feature) {
  const id = feature.description?.id
  if (id) return id
  return feature.type.replace(/-/g, ' ')
}

type TreeNodeProps = {
  feature: Feature
  selected?: Feature
  selectionMode: boolean
  checkedFeatures: CheckedFeatures
}

function FeatureTreeNode({ feature, selected, selectionMode, checkedFeatures }: TreeNodeProps) {
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
      <div
        class="feature-tree-row"
        onClick={
          selectionMode
            ? () => toggleCheckFeature(feature)
            : () => {
                feature.openEditor()
              }
        }
        onMouseOver={() => ui?.featureTool?.highlightFeature(feature)}
      >
        {featureIcon(feature)}
        <input class="feature-checkbox checkbox" checked={!!checkedFeatures[feature.uuid]} onInput={() => toggleCheckFeature(feature)} onClick={(e) => e.stopPropagation()} type="checkbox" />
        <span class="feature-tree-label">{featureLabel(feature)}</span>
      </div>
      {kids.length > 0 && (
        <ul>
          {kids.map((child) => (
            <FeatureTreeNode key={child.uuid} feature={child} selected={selected} selectionMode={selectionMode} checkedFeatures={checkedFeatures} />
          ))}
        </ul>
      )}
    </li>
  )
}

function FeatureTree({ roots, selected }: { roots: Feature[]; selected?: Feature }) {
  const [, bump] = useState(0)
  useSignalEffect(() => {
    checkedFeatures.value
    bump((n) => n + 1)
  })
  const checked = selectCheckedFeatures()
  const selectionMode = Object.values(checked).length > 0

  const deleteConfirm = () => {
    const amountFeatures = Object.values(checked).reduce((accumulator, feature) => {
      accumulator++
      if (feature.type == 'group') {
        accumulator += (feature as Group).children.length
      }
      return accumulator
    }, 0)
    return amountFeatures >= 2 ? window.confirm(`Delete ${amountFeatures} features?`) : true
  }

  const deleteSelection = () => {
    if (!deleteConfirm()) return
    Object.values(checked).forEach((feature) => feature.delete())
    setCheckedFeatures([])
    window.ui?.featureTool.unHighlight()
  }

  const onSelectAll = () => {
    if (allSelected(roots, checked)) {
      setCheckedFeatures([])
    } else {
      setCheckedFeatures(roots)
    }
  }

  const selection = Object.values(checked)
  const amountSelected = selection.length
  const _allSelected = allSelected(roots, checked)
  const selectionContainsASpawnPoint = selection.some((feature) => feature.description.type === 'spawn-point')
  const disableGroupButton = !!(selectionContainsASpawnPoint || !amountSelected)
  const showDeleteButton = !!amountSelected

  const createGroup = () => {
    window.ui?.featureTool.createGroup(selection)
    setCheckedFeatures([])
  }

  if (!roots.length) {
    return <p>Loading...</p>
  }

  return (
    <>
      <ul class="feature-tree">
        {roots.map((feature) => (
          <FeatureTreeNode key={feature.uuid} feature={feature} selected={selected} selectionMode={selectionMode} checkedFeatures={checked} />
        ))}
      </ul>
      <div class="inspector-bottom-bar">
        <div class="inspector-bottom-bar-buttons">
          <button disabled={disableGroupButton} onClick={createGroup}>
            Create Group
          </button>
          {showDeleteButton && <button onClick={deleteSelection}>Delete</button>}
        </div>
        <div class="inspector-bottom-bar-checkbox-container">
          Select All
          <input class="checkbox inspector-select-all-checkbox" checked={_allSelected} onInput={onSelectAll} type="checkbox" />
        </div>
      </div>
    </>
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
        <header>
          <h1>edit</h1>
        </header>
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
        {props.parcel && (
          <div class="edit-pane-voxels">
            <CustomizeVoxels parcel={props.parcel} scene={props.scene} />
          </div>
        )}
      </section>
    </FeatureContext.Provider>
  )
}
