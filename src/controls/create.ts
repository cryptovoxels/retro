import { isDesktop, isMobile, isTablet, wantsGateway, wantsXR } from '../../common/helpers/detector'
import DesktopControls from './desktop/controls'
import MobileControls from './mobile/controls'
import type Controls from './controls'
import XROverlay from './webxr'

export let xr: XROverlay | undefined

export const CreateControls = (scene: BABYLON.Scene, canvas: HTMLCanvasElement): Controls => {
  let controls: Controls | undefined

  if (isMobile() || isTablet()) {
    controls = new MobileControls(scene, canvas)
  } else if (isDesktop()) {
    controls = new DesktopControls(scene, canvas)
  }

  if (wantsXR() && !wantsGateway()) {
    xr = new XROverlay(scene, canvas, controls!)
    navigator.xr?.addEventListener('sessiongranted', () => xr?.start())

    canvas.addEventListener('click', (e: any) => {
      if (xr) {
        e.preventDefault()
        xr.start()
      }
    })
  }

  return controls!
}
