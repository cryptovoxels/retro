import { isTablet } from '../../../common/helpers/detector'
import Connector from '../../connector'
import { MinimapSettings } from '../../minimap'
import { SceneContext } from '@babylonjs/lite'

export default function MobileButtons({ connector, scene, minimapSettings }: { connector: Connector; scene: SceneContext; minimapSettings: MinimapSettings }) {
  return (
    <div class="mobile-buttons">
      <div style={(isTablet() && window.config.isGrid && { bottom: '200px' }) as any} className="mobile-controls-container">
        <button className="camera-view-button hex-button" onClick={() => connector.controls.togglePerspective()}>
          Zoom
        </button>
        <button className="fly-button hex-button" onClick={() => connector.controls.toggleFlying()}>
          Fly
        </button>
        <button type="button" className="drive-button hex-button" style={{ display: 'none' }} onClick={() => (connector.controls as any).tryEnterVehicle?.()}>
          Drive
        </button>
      </div>
    </div>
  )
}
