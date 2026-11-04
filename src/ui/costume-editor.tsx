import { useEffect, useState } from 'preact/hooks'
import { BoneNames } from '../../common/messages/costumes'
import { costumeTool } from '../tools/costume'
import WearableSelector from '../../web/src/costumer/wearable-selector'
import { invalidateUrl } from '../../web/src/helpers/cached-fetch'
import { app } from '../../web/src/state'
import { VectorField } from '../../web/src/components/editor/fields/vector-field'
import WearableIcon from '../../web/src/components/wearable-icon'
import { getNextScale } from '../../web/src/components/editor/helpers/get-next-scale'

export function CostumeEditor() {
  const tool = costumeTool.value
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(true)
  const [fieldError, setFieldError] = useState<string | undefined>()
  useEffect(() => () => tool?.close(), [tool])
  if (!tool) return null
  tool.revision.value
  const attachment = tool.draft.attachments?.[tool.selected.value]
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const costume = { ...tool.draft, attachments: tool.draft.attachments?.filter((a) => a.wid).map(({ bone, wid, position, rotation, scaling }) => ({ bone, wid, position, rotation, scaling })) }
      const res = await fetch(`/api/costumes/${costume.id}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(costume) })
      if (!res.ok || !(await res.json()).success) throw new Error('save failed')
      await invalidateUrl(`/api/avatars/${app.state.wallet?.toLowerCase()}/costumes`)
      await invalidateUrl(`/api/costumes/${costume.id}`)
      if (app.state.costume?.id === costume.id) {
        app.setState({ costume: costume as any })
        window.connector.sendChangeCostume(costume.id)
      }
      tool.commit()
    } catch {
      setError('Could not save costume. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section class="costume-editor">
      <header>
        <h1>edit costume</h1>
        <div>
          <button disabled={busy} onClick={() => tool.close()}>
            Cancel
          </button>
          <button disabled={busy || !!fieldError} onClick={save}>
            {busy ? 'Saving...' : 'Done'}
          </button>
        </div>
      </header>
      <p>Drag to orbit. Scroll to zoom.</p>
      <fieldset disabled={busy}>
        <div class="f">
          <label>Name</label>
          <input
            type="text"
            value={tool.draft.name}
            onInput={(e) => {
              tool.draft.name = e.currentTarget.value
            }}
          />
        </div>
        {error && <p role="alert">{error}</p>}
        <h2>wearing</h2>
        <ul class="costume-layers">
          {tool.draft.attachments?.map((a, i) => (
            <li key={i}>
              <button
                aria-pressed={i === tool.selected.value}
                onClick={() => {
                  setFieldError(undefined)
                  tool.selected.value = i
                }}
              >
                <WearableIcon id={a.wid} title={a.wearable?.name || a.bone} />
                <span>
                  {a.wearable?.name || 'Choose wearable'}
                  <small>{a.bone}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div class="f">
          <label>Add</label>
          <select
            value=""
            disabled={(tool.draft.attachments?.length ?? 0) >= 12}
            onChange={(e) => {
              setFieldError(undefined)
              tool.add(e.currentTarget.value)
            }}
          >
            <option value="" disabled>
              Choose body part
            </option>
            {BoneNames.filter((b) => !b.includes('index')).map((b) => (
              <option value={b}>{b}</option>
            ))}
          </select>
        </div>
        {attachment && (
          <div key={tool.selected.value}>
            <h2>transform</h2>
            <div class="costume-modes" role="group" aria-label="Transform tool">
              <button aria-pressed={tool.modeValue.value === 'position'} onClick={() => tool.mode('position')}>
                Move
              </button>
              <button aria-pressed={tool.modeValue.value === 'rotation'} onClick={() => tool.mode('rotation')}>
                Rotate
              </button>
              <button aria-pressed={tool.modeValue.value === 'scale'} onClick={() => tool.mode('scale')}>
                Scale
              </button>
            </div>
            <dl class="props">
              {(['position', 'rotation', 'scaling'] as const).map((field) => (
                <>
                  <dt>{field === 'scaling' ? 'Scale' : field === 'rotation' ? 'Rotation' : 'Position'}</dt>
                  <dd class="vec3">
                    {attachment[field].map((value, axis) => (
                      <VectorField
                        key={axis}
                        title={'XYZ'[axis]}
                        value={value}
                        step={field === 'rotation' ? 5 : 0.01}
                        errorMessage={setFieldError}
                        setter={(value) => {
                          const values = [...attachment[field]]
                          if (field === 'scaling' && locked) {
                            const current = { x: values[0], y: values[1], z: values[2] }
                            const next = getNextScale((['x', 'y', 'z'] as const)[axis], true, ['x', 'y', 'z'], current, current, value)
                            tool.update({ ...attachment, scaling: [next.x, next.y, next.z] })
                          } else {
                            values[axis] = value
                            tool.update({ ...attachment, [field]: values })
                          }
                        }}
                      />
                    ))}
                  </dd>
                </>
              ))}
            </dl>
            <div class="costume-actions">
              <label>
                <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.currentTarget.checked)} /> Link scale
              </label>
              <button
                onClick={() => {
                  setFieldError(undefined)
                  tool.remove()
                }}
              >
                Remove
              </button>
            </div>
            {fieldError && <small role="alert">{fieldError}</small>}
            <h2>replace wearable</h2>
            <WearableSelector attachment={attachment} bone={attachment.bone} onPick={(w) => tool.update({ ...attachment, wid: w.id, wearable: { id: w.id, name: w.name } })} />
          </div>
        )}
      </fieldset>
    </section>
  )
}
