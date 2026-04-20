import { useState } from 'preact/hooks'
import { Costume } from '../../../common/types'
import { Client } from '../parcel'

type ViewTab = 'client' | 'map' | 'orbit'

interface Props {
  costumes?: Costume[]
  visitUrl?: string
  viewTab?: ViewTab
  onViewTab?: (tab: ViewTab) => void
}

const modes: { mode: ViewTab; label: string }[] = [
  { mode: 'client', label: 'Explore' },
  { mode: 'orbit', label: 'Orbit' },
  { mode: 'map', label: 'Map' },
]

export default function ClientBar({ costumes, visitUrl, viewTab, onViewTab }: Props) {
  const [selectedCostumeId, setSelectedCostumeId] = useState<number | null>(null)

  const onFullscreen = () => {
    Client.wrapper?.querySelector('iframe')?.requestFullscreen()
  }

  return (
    <figcaption>
      <button class="secondary" onClick={onFullscreen}>
        Fullscreen
      </button>

      {onViewTab &&
        modes.map((m) => (
          <button key={m.mode} class={`secondary ${viewTab === m.mode ? 'contrast' : ''}`} onClick={() => onViewTab(m.mode)}>
            {m.label}
          </button>
        ))}

      {visitUrl && (
        <a class="buttonish" href={visitUrl}>
          Teleport
        </a>
      )}

      {costumes && costumes.length > 0 && (
        <>
          <select
            onChange={(e) => {
              const id = parseInt((e.target as HTMLSelectElement).value, 10)
              setSelectedCostumeId(id)
              const costume = costumes!.find((c) => c.id === id)
              if (!costume) return
              const iframe = Client.wrapper?.querySelector('iframe')
              ;(iframe?.contentWindow as any)?.persona?.avatar?.setCostume(costume)
            }}
          >
            {costumes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {' '}
          <a href={`/costumer/${selectedCostumeId ?? costumes[0]?.id}`}>edit</a>
        </>
      )}
    </figcaption>
  )
}
