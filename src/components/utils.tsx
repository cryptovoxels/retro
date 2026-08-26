import { ComponentChildren } from 'preact'
import { isDesktop, isMobile } from '../../common/helpers/detector'
import { SceneContext } from '@babylonjs/lite'

export function ViewOnCondition({ condition, children }: { condition: boolean; children?: ComponentChildren }) {
  if (condition) {
    return children as any
  } else {
    return null
  }
}

export function OnlyDesktop({ children }: { children?: ComponentChildren }) {
  if (isDesktop()) {
    return children as any
  } else {
    return null
  }
}

export function OnlyMobile({ children }: { children?: ComponentChildren }) {
  if (isMobile()) {
    return children as any
  } else {
    return null
  }
}

export function DesktopOrMobile({ children }: { children?: ComponentChildren }) {
  if (isDesktop() || isMobile()) {
    return children as any
  } else {
    return null
  }
}

export function OnlyOnGrid({ scene, children }: { scene: SceneContext; children?: ComponentChildren }) {
  if (window.config.isGrid) {
    return children as any
  } else {
    return null
  }
}
