import { useEffect, useRef, useState } from 'preact/hooks'
import { effect } from '@preact/signals'
import type Selector from '../tools/voxel'
import { SelectionMode } from '../tools/voxel'
import { uiPane } from '../store'

export const SANDBOX_LEARN_STEPS = [
  { id: 'b', label: 'Press B', hint: 'Turns on the voxel toolbelt. The mouse locks to the world -- press Escape to free the mouse and click the belt.' },
  { id: 'place', label: 'Place a block', hint: 'Click in the world. Drag for a wall or floor.' },
  { id: 'delete', label: 'Delete a block', hint: 'Hold shift, then click or drag.' },
  { id: 'color', label: 'Pick a color', hint: 'Press Escape, then click a swatch on the toolbelt. Or press 1-9 while building.' },
  { id: 'paint', label: 'Paint a block', hint: 'Hold ctrl, then click a block with your color. Or press P on the toolbelt.' },
  {
    id: 'features',
    label: 'See the features',
    hint: 'Press Tab, click + on the toolbelt, or Add in the menu. When you are done practicing, grab a parcel in the shop.',
    shop: true,
  },
] as const

type StepId = (typeof SANDBOX_LEARN_STEPS)[number]['id']
type StepStatus = 'pending' | 'done' | 'skipped'

function initialSteps(): Record<StepId, StepStatus> {
  return { b: 'pending', place: 'pending', delete: 'pending', color: 'pending', paint: 'pending', features: 'pending' }
}

export type SandboxGuideProps = {
  voxelTool: Selector
  onComplete: () => void
}

export function SandboxGuide({ voxelTool, onComplete }: SandboxGuideProps) {
  const [steps, setSteps] = useState(initialSteps)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const colorBaselineRef = useRef({ texture: voxelTool.texture, tint: voxelTool.tint })

  const finishIfDone = (next: Record<StepId, StepStatus>) => {
    if (SANDBOX_LEARN_STEPS.every((s) => next[s.id] !== 'pending')) {
      setTimeout(() => onCompleteRef.current(), 0)
    }
    return next
  }

  const markDoneRef = useRef<(id: StepId) => void>(() => {})
  markDoneRef.current = (id: StepId) => {
    setSteps((prev) => {
      if (prev[id] !== 'pending') return prev
      return finishIfDone({ ...prev, [id]: 'done' })
    })
  }

  const skipStep = (id: StepId) => {
    setSteps((prev) => {
      if (prev[id] !== 'pending') return prev
      return finishIfDone({ ...prev, [id]: 'skipped' })
    })
  }

  useEffect(() => {
    const onB = voxelTool.onBuildToolActivate.add(() => markDoneRef.current('b'))
    const onAction = voxelTool.onVoxelAction.add(({ mode }) => {
      if (mode === SelectionMode.Add) markDoneRef.current('place')
      else if (mode === SelectionMode.Remove) markDoneRef.current('delete')
      else if (mode === SelectionMode.Paint) markDoneRef.current('paint')
    })
    const onTintTexture = voxelTool.onCurrentTextureTintUpdate.add(({ texture, tint }) => {
      const base = colorBaselineRef.current
      if (texture !== base.texture || tint !== base.tint) {
        markDoneRef.current('color')
      }
    })
    const unsubPane = effect(() => {
      if (uiPane.value === 'add') markDoneRef.current('features')
    })
    return () => {
      onB.remove()
      onAction.remove()
      onTintTexture.remove()
      unsubPane()
    }
  }, [voxelTool])

  const current = SANDBOX_LEARN_STEPS.find((s) => steps[s.id] === 'pending')

  return (
    <div class="sandbox-guide">
      <h3>You found a sandbox!</h3>
      <ul>
        {SANDBOX_LEARN_STEPS.map((step) => {
          const status = steps[step.id]
          const isCurrent = current?.id === step.id
          const mark = status === 'done' ? '[x]' : status === 'skipped' ? '[-]' : '[ ]'
          return (
            <li class={isCurrent ? 'current' : status}>
              <span class="mark">{mark}</span>
              <span class="label">{step.label}</span>
              {isCurrent && (
                <>
                  <p class="hint">{step.hint}</p>
                  {'shop' in step && step.shop && (
                    <p class="hint">
                      <a href="/shop">get a parcel in the shop</a>
                    </p>
                  )}
                  <button type="button" class="linkish" onClick={() => skipStep(step.id)}>
                    {step.id === 'features' ? 'got it' : 'skip'}
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export type SandboxGuideMiniProps = {
  onGotIt: () => void
  onStartOver: () => void
}

export function SandboxGuideMini({ onGotIt, onStartOver }: SandboxGuideMiniProps) {
  return (
    <div class="sandbox-guide sandbox-guide-mini">
      <a href="/shop">get a parcel in the shop</a>
      <button type="button" class="linkish" onClick={onGotIt}>
        Got it!
      </button>
      <button type="button" class="linkish" onClick={onStartOver}>
        start over
      </button>
    </div>
  )
}
