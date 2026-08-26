import { Component } from 'preact'
import { onDragStart } from '../dialog'
import { SceneContext } from '@babylonjs/lite'

interface Props {
  onClose?: () => void
  scene: SceneContext
  onShowSandboxGuide?: () => void
}

export class HelpOverlay extends Component<Props> {
  constructor(props: Props) {
    super(props)

    this.state = {}
  }

  close() {
    this.props.onClose!()
  }

  render() {
    const showSandboxHelp = new URLSearchParams(location.search).get('learn') === 'true'
    return (
      <section class="help-overlay">
        <h2>Help</h2>

        <div class="colos">
          <ul class="bindings">
            <li>
              <span>W</span> Forward
            </li>
            <li>
              <span>S</span> Backward
            </li>
            <li>
              <span>A</span> Step Left
            </li>
            <li>
              <span>D</span> Step Right
            </li>
            <li>
              <span>⇧</span> Run
            </li>
            <li>
              <span>F</span> Fly
            </li>
            <li>
              <span>Space</span> Jump
            </li>
            <li>
              <span>Enter</span> Chat
            </li>
            <li>
              <span>C</span> Switch camera
            </li>
            <li>
              <span>G</span> Dance
            </li>
            <li>
              <span>T</span> Emote
            </li>
            <li>
              <span>/e dance</span> Dance by name
            </li>
            <li>
              <span>P</span> Capture Womp
            </li>
          </ul>

          <ul class="bindings">
            <li>
              <span>Tab</span> Build Menu
            </li>
            <li>
              <span>
                1<small>..</small>9
              </span>{' '}
              Set texture
            </li>
            <li>
              <span>B</span> Build voxels
            </li>
            <li>
              <span>X</span> Delete
            </li>
            <li>
              <span>R</span> Copy feature
            </li>
            <li>
              <span>M</span> Move feature
            </li>
            <li>
              <span>E</span> Edit feature
            </li>
            <li>
              <u>Click</u> <p>Place blocks</p>
            </li>
            <li>
              <u>Drag</u> <p>Place wall</p>
            </li>
            <li>
              <u>Shift Click</u> <p>Remove blocks</p>
            </li>
            <li>
              <u>Ctrl Click</u> <p>Paint blocks</p>
            </li>
            <li>
              <u>Shift Drag</u> <p>Remove wall</p>
            </li>
          </ul>
        </div>

        <h2>Build instructions</h2>

        <p>
          Use the <b>Add</b> tool to add new content to your build.
        </p>

        <p>
          <b>Right Click</b> in world to edit existing content.
        </p>

        {showSandboxHelp && (
          <>
            <h2>Learn voxels: build, delete, paint</h2>
            <p>
              Practice in a sandbox first. Press <b>B</b>, then:
            </p>
            <p>
              The mouse locks while you build. Press <b>Escape</b> to release it and use the toolbelt.
            </p>
            <ol class="sandbox-help-steps">
              <li>
                <b>Build</b> -- click one block, or drag a wall.
              </li>
              <li>
                <b>Delete</b> -- shift-click or shift-drag.
              </li>
              <li>
                <b>Color</b> -- Escape, then pick a swatch on the toolbelt. Or press 1-9 while building.
              </li>
              <li>
                <b>Paint</b> -- ctrl-click to apply that color to a block.
              </li>
            </ol>
            <h2>Once you have a parcel</h2>
            <p>
              Open <b>Add</b> or press <b>Tab</b> to browse features: signs, images, video, showboxes, portals, and the rest.
            </p>
            <p class="sandbox-help-outro">
              Pick a sandbox from <a href="/build">/build</a>, then grab a parcel in the <a href="/shop">shop</a>.
            </p>
            {this.props.onShowSandboxGuide && (
              <p>
                <button type="button" class="linkish" onClick={this.props.onShowSandboxGuide}>
                  start over
                </button>
              </p>
            )}
          </>
        )}
      </section>
    )
  }
}
