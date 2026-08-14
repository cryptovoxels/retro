import { useEffect, useRef, useState } from 'preact/hooks'
import type Selector from '../tools/voxel'
import { SelectionMode } from '../tools/voxel'

const STEPS = [
  { id: 'b', label: 'Press B', hint: 'Turns on the voxel toolbelt. The mouse locks to the world -- press Escape to free the mouse.' },
  { id: 'place', label: 'Place a block', hint: 'Click in the world. Drag for a wall or floor.' },
  { id: 'delete', label: 'Delete a block', hint: 'Hold shift, then click or drag.' },
  { id: 'color', label: 'Pick a color', hint: 'Press Escape to release the mouse, then pick a swatch on the toolbelt. Or press 1-9 while building.' },
  { id: 'paint', label: 'Paint a block', hint: 'Hold ctrl, then click a block with your color.' },
  {
    id: 'features',
    label: 'See the features',
    hint: 'Press Tab or click Add in the menu to browse signs, images, video, showboxes, portals, and more. On your parcel or space you can place them for real.',
    upsell: true,
  },
] as const

type StepId = (typeof STEPS)[number]['id']
type StepStatus = 'pending' | 'done' | 'skipped'

function initialSteps(): Record<StepId, StepStatus> {
  return { b: 'pending', place: 'pending', delete: 'pending', color: 'pending', paint: 'pending', features: 'pending' }
}

export type ScratchpadGuideProps = {
  voxelTool: Selector
  onComplete: () => void
}

export function ScratchpadGuide({ voxelTool, onComplete }: ScratchpadGuideProps) {
  const [steps, setSteps] = useState(initialSteps)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const colorBaselineRef = useRef({ texture: voxelTool.texture, tint: voxelTool.tint })

  const finishIfDone = (next: Record<StepId, StepStatus>) => {
    if (STEPS.every((s) => next[s.id] !== 'pending')) {
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

  const skipAll = () => {
    setSteps((prev) => {
      const next = { ...prev }
      for (const s of STEPS) {
        if (next[s.id] === 'pending') next[s.id] = 'skipped'
      }
      setTimeout(() => onCompleteRef.current(), 0)
      return next
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
    return () => {
      onB.remove()
      onAction.remove()
      onTintTexture.remove()
    }
  }, [voxelTool])

  const current = STEPS.find((s) => steps[s.id] === 'pending')

  return (
    <div class="scratchpad-guide">
      <div class="scratchpad-guide-head">
        <span>learn voxels</span>
        <button type="button" class="linkish" onClick={skipAll}>
          skip all
        </button>
      </div>
      <ul>
        {STEPS.map((step) => {
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
                  {'upsell' in step && step.upsell && (
                    <p class="hint">
                      <a href="https://opensea.io/collection/cryptovoxels" target="_top">
                        get a parcel
                      </a>
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

export type ScratchpadGuideMiniProps = {
  onGotIt: () => void
  onStartOver: () => void
}

export function ScratchpadGuideMini({ onGotIt, onStartOver }: ScratchpadGuideMiniProps) {
  return (
    <div class="scratchpad-guide scratchpad-guide-mini">
      <button type="button" class="linkish" onClick={onGotIt}>
        Got it!
      </button>
      <button type="button" class="linkish" onClick={onStartOver}>
        start over
      </button>
    </div>
  )
}
