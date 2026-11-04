import { useEffect, useRef, useState } from 'preact/hooks'
import { Costume } from '../../../common/messages/costumes'
import cachedFetch, { invalidateUrl } from '../../../web/src/helpers/cached-fetch'
import { onListArrowKeys } from '../../../web/src/helpers/keynav'
import { app } from '../../../web/src/state'
import CostumeTool from '../../tools/costume'

export function CostumePane({ onEdit }: { onEdit: () => void }) {
  const editing = useRef(false)
  const firstPerson = useRef(false)
  const [costumes, setCostumes] = useState<Costume[] | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [highlighted, setHighlighted] = useState<number | null>(null)
  const original = useRef<Costume | undefined>(undefined)
  const list = useRef<HTMLUListElement>(null)
  const wallet = app.state.wallet?.toLowerCase()

  useEffect(() => {
    const controls = window.connector?.controls
    const manager = window.connector?.persona?.avatar?.attachmentManager
    const changedView = controls?.enterThirdPerson()
    firstPerson.current = !!changedView
    original.current = manager?.costume ?? app.state.costume
    return () => {
      if (editing.current) return
      manager?.generateCostume(original.current, true)
      if (changedView) controls?.enterFirstPerson()
    }
  }, [])

  const preview = (costume: Costume) => {
    if (busy || highlighted === costume.id) return
    setHighlighted(costume.id)
    window.connector?.persona?.avatar?.attachmentManager?.generateCostume(costume, true)
  }

  useEffect(() => {
    if (!app.signedIn || !wallet) return
    let cancelled = false
    Promise.all([cachedFetch(`/api/avatars/${wallet}/costumes`), cachedFetch(`/api/avatars/${wallet}.json`)])
      .then(async ([res, avatarRes]) => {
        const data = await res.json()
        const avatar = await avatarRes.json()
        if (!data.success) throw new Error('Could not load costumes')
        if (cancelled) return
        setCostumes(data.costumes)
        setSelected(avatar.avatar?.costume_id ?? null)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load costumes. Close and try again.')
      })
    return () => {
      cancelled = true
    }
  }, [wallet])

  useEffect(() => {
    ;(list.current?.querySelector<HTMLElement>('.selected') ?? list.current?.querySelector<HTMLElement>('[tabindex]'))?.focus({ preventScroll: true })
  }, [costumes])

  const wear = async (id: number) => {
    if (!app.signedIn || busy || selected === id) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/avatar/appearance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ costume_id: id }),
      })
      if (!response.ok) throw new Error('Could not wear costume')
      await invalidateUrl(`/api/avatars/${wallet}.json`)
      await app.loadAvatar(true)
      original.current = app.state.costume
      window.connector?.sendChangeCostume(id)
      await window.connector?.persona?.avatar?.attachmentManager?.loadCostume(undefined, id)
      setSelected(id)
    } catch {
      setError('Could not wear that costume. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section onKeyDown={onListArrowKeys}>
      <h2>Costumes</h2>
      <button
        type="button"
        disabled={busy || !costumes?.some((c) => c.id === (highlighted ?? selected))}
        onClick={() => {
          const costume = costumes?.find((c) => c.id === (highlighted ?? selected))
          const avatar = window.connector?.persona?.avatar
          const controls = window.connector?.controls
          if (!costume || !avatar?.attachmentManager || !avatar.avatarMesh || !controls || !window.ui) return
          if (avatar.src || controls.vehicleFeature || controls.congaTarget) {
            setError('Leave your vehicle or conga and use the voxel avatar to edit a costume.')
            return
          }
          editing.current = true
          avatar.attachmentManager.generateCostume(original.current, true)
          if (firstPerson.current) controls.enterFirstPerson()
          onEdit()
          window.ui.setTool(new CostumeTool(costume))
          window.ui.setPane('costume')
        }}
      >
        edit
      </button>
      {error && <div role="alert">{error}</div>}
      {!costumes && !error && <div>Loading costumes...</div>}
      {costumes?.length === 0 && <div>No costumes yet.</div>}
      <ul ref={list} class="costume-list" aria-busy={busy}>
        {costumes?.map((costume) => (
          <li
            key={costume.id}
            role="button"
            tabIndex={0}
            class={(highlighted ?? selected) === costume.id ? 'selected' : ''}
            aria-pressed={selected === costume.id}
            aria-disabled={busy}
            onMouseEnter={() => preview(costume)}
            onFocus={() => preview(costume)}
            onClick={() => wear(costume.id)}
          >
            {costume.name || `Costume #${costume.id}`}
          </li>
        ))}
      </ul>
    </section>
  )
}
