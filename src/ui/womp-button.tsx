import { app } from '../../web/src/state'

export default function WompButton({ onClick }: { onClick: () => void }) {
  if (!app.signedIn) return null
  return (
    <button type="button" class="womp-button" title="womp [P]" onClick={onClick}>
      WOMP
    </button>
  )
}
