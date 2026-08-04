import { Component } from 'preact'
import { onDragStart } from '../dialog'

interface Props {
  onClose?: () => void
  scene: BABYLON.Scene
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
    return (
      <section class="help-overlay">
        <header onMouseDown={onDragStart}>
          <h2>Help</h2>
        </header>

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
              <span>PgUp</span> Fly Up
            </li>
            <li>
              <span>PgDn</span> Fly Down
            </li>
            <li>
              <span>G</span> Dance
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
      </section>
    )
  }
}
