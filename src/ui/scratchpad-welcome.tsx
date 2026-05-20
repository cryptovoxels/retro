const CTA_HINT = 'This turns on build mode. Press B anytime to open or close it.'

export type ScratchpadWelcomeProps = {
  onStartBuilding: () => void
  onOpenHelp: () => void
  onDismiss: () => void
}

export function ScratchpadWelcome({ onStartBuilding, onOpenHelp, onDismiss }: ScratchpadWelcomeProps) {
  return (
    <section class="scratchpad-welcome help-overlay">
      <header>
        <h2>Welcome to Scratchpad</h2>
      </header>

      <p class="intro">This is a practice space. Learn how to build in Voxels here before you buy your own parcel.</p>

      <h3>Quick start</h3>
      <ol class="quick-start">
        <li>
          <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> to move. Hold <kbd>Shift</kbd> to run.
        </li>
        <li>
          Press <kbd>B</kbd> to start building voxels. Click to place a block. Drag to place a wall.
        </li>
        <li>
          Press <kbd>H</kbd> anytime to see all controls.
        </li>
      </ol>

      <p class="note">Your build is saved only for this visit. Reloading the page clears it. This is just for practice.</p>

      <div class="actions">
        <button type="button" class="primary" title={CTA_HINT} onClick={onStartBuilding}>
          Start building <kbd>B</kbd>
        </button>
        <p class="cta-hint">{CTA_HINT}</p>
        <button type="button" class="secondary" onClick={onOpenHelp}>
          See all controls
        </button>
        <button type="button" class="linkish" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </section>
  )
}
