import { isDesktop, isMobile, isTablet, wantsGateway, wantsXR } from '../../common/helpers/detector'
import DesktopControls from './desktop/controls'
import MobileControls from './mobile/controls'
import type Controls from './controls'
import XROverlay from './webxr'
import { SceneContext } from '@babylonjs/lite'

export let xr: XROverlay | undefined

export const CreateControls = (scene: SceneContext, canvas: HTMLCanvasElement): Controls => {
  let controls: Controls | undefined

  if (isMobile() || isTablet()) {
    controls = new MobileControls(scene, canvas)
  } else if (isDesktop()) {
    controls = new DesktopControls(scene, canvas)
  }

  if (wantsXR() && !wantsGateway()) {
    xr = new XROverlay(scene, canvas, controls!)
    let started = false

    navigator.xr?.addEventListener('sessiongranted', () => {
      console.log('onSessionGranted')
      started = true

      xr?.start()
    })

    canvas.addEventListener('click', (e: any) => {
      if (!started && xr) {
        started = true

        e.preventDefault()
        xr.start()
      }
    })
  }

  return controls!
}
