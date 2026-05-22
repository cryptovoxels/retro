import { Component } from 'preact'
import { BoneNames } from '../../../common/messages/costumes'

const PLACEABLE = BoneNames.filter((b) => !b.includes('index'))

const GROUPS: { title: string; bones: string[] }[] = [
  { title: 'head & neck', bones: ['head', 'neck'] },
  { title: 'hands', bones: ['lefthand', 'righthand'] },
  { title: 'feet', bones: ['leftfoot', 'rightfoot'] },
  { title: 'torso', bones: ['hips'] },
]

export function normalizeBoneName(raw?: string | null): string | null {
  if (!raw) return null
  const b = raw.replace(/^mixamorig:/i, '').toLowerCase()
  return PLACEABLE.includes(b as (typeof PLACEABLE)[number]) ? b : null
}

export function boneLabel(bone: string): string {
  return bone.replace(/(left|right)(?=[a-z])/g, '$1 ')
}

export function bonesForPlacement(defaultBone?: string | null) {
  const suggested = normalizeBoneName(defaultBone)
  const groups = GROUPS.map((g) => ({
    title: g.title,
    bones: g.bones.filter((b) => PLACEABLE.includes(b as (typeof PLACEABLE)[number])),
  })).filter((g) => g.bones.length > 0)

  const shown = new Set(groups.flatMap((g) => g.bones))
  const more = PLACEABLE.filter((b) => !shown.has(b))

  return { suggested, groups, more }
}

interface Props {
  defaultBone?: string | null
  onPick: (bone: string) => void
}

export default class BonePlacementList extends Component<Props> {
  renderBone = (bone: string, className?: string) => (
    <li key={bone} class={className} onClick={() => this.props.onPick(bone)}>
      {boneLabel(bone)}
    </li>
  )

  render() {
    const { suggested, groups, more } = bonesForPlacement(this.props.defaultBone)

    return (
      <div class="bone-placement">
        {suggested && (
          <div class="bone-group suggested">
            <h4>suggested</h4>
            <ul class="bone-list">{this.renderBone(suggested, 'suggested')}</ul>
          </div>
        )}

        {groups.map((g) => {
          const bones = suggested ? g.bones.filter((b) => b !== suggested) : g.bones
          if (!bones.length) return null
          return (
            <div class="bone-group" key={g.title}>
              <h4>{g.title}</h4>
              <ul class="bone-list">{bones.map((b) => this.renderBone(b))}</ul>
            </div>
          )
        })}

        {more.length > 0 && (
          <details class="bone-more">
            <summary>more spots ({more.length})</summary>
            <ul class="bone-list">{more.map((b) => this.renderBone(b))}</ul>
          </details>
        )}
      </div>
    )
  }
}
