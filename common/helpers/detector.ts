import { canUseDom, ssrFriendlyDocument } from './utils'

let searchParams: URLSearchParams = null!
let location = ''
let pathName = ''

try {
  if (!canUseDom) {
    // completely nerfs detectors in ssr
    throw new Error()
  }
  location = document.location.toString()
  pathName = document.location.pathname
  searchParams = new URLSearchParams(document.location.search.substring(1))
} catch (e) {}

// hopefully we're in test - todo replace with process.env.NODE_ENV=test
if (process.env.NODE_ENV == 'test') {
  searchParams = {
    get: () => null,
    has: () => false,
  } as unknown as URLSearchParams
  ;(global as any)['navigator'] = {
    userAgent: '',
    vendor: '',
    getVRDisplays: (): any => null,
  }
  ;(global as any)['localStorage'] = {
    getItem: (): any => null,
  }
}

type EnvironmentFlagSpec<Value> = {
  searchParamKey: string
  defaultValues: Record<'local' | 'uat' | 'prod', Value>
  tryParseValue(str: string): null | Value
}

namespace EnvironmentFlagSpec {
  export const string = (spec: Omit<EnvironmentFlagSpec<string>, 'tryParseValue'>): EnvironmentFlagSpec<string> => ({
    ...spec,
    tryParseValue: (str) => str,
  })

  export const boolean = (spec: Omit<EnvironmentFlagSpec<boolean>, 'tryParseValue'>): EnvironmentFlagSpec<boolean> => ({
    ...spec,
    tryParseValue: (str) => {
      if (str === '0' || str === 'false') return false
      if (str === '1' || str === 'true') return true
      return null
    },
  })

  export const valueOf = <Value>(spec: EnvironmentFlagSpec<Value>): Value => {
    const environment: keyof EnvironmentFlagSpec<unknown>['defaultValues'] = isLocal() ? 'local' : 'prod'
    const defaultValue = spec.defaultValues[environment]
    const rawValue = searchParams.get(spec.searchParamKey)
    const parsedValue = rawValue === null ? null : spec.tryParseValue(rawValue)
    return parsedValue === null ? defaultValue : parsedValue
  }
}

export const drawDistanceOverride = (): number | null => {
  const min = 32
  const max = 512
  if (isOrbit()) {
    return 96
  }
  const distanceParam = searchParams.get('distance')
  if (distanceParam === 'close') {
    return 64
  } else if (distanceParam === 'extended') {
    return 256
  } else if (distanceParam === 'far') {
    return max
  } else if (distanceParam && parseInt(distanceParam)) {
    // allow user to specify draw distance, but clamped to maximum
    return Math.min(max, Math.max(min, parseInt(distanceParam)))
  }
  return null
}

export const isInWorld = (): boolean => {
  return !!location?.match('/play')?.length
}

export const isMobile = () => {
  return !!(navigator.userAgent.match(/mobile/i) || isAndroid())
}
/**
 * An alternative isMobile which uses media queries to determine if the screen is small
 */
export const isMobileMedia = () => {
  return typeof window == 'undefined' ? isMobile() : window.matchMedia('(max-width: 700px)').matches
}

export const isDesktop = () => {
  return !isMobile()
}

export const isTablet = () => {
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

export const isIOS = () => {
  return !!(navigator.userAgent.match(/iPad/i) || navigator.userAgent.match(/iPhone/i))
}

export const isChrome = () => {
  return /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor)
}

export const wantsEmbeddedUI = () => {
  return searchParams.get('ui') === 'embedded'
}

export const isAndroid = () => {
  return navigator.userAgent.match(/android/i)
}

export const wantsIsolate = () => {
  return searchParams.get('isolate') === 'true'
}

export const isDebug = () => {
  return process.env.NODE_ENV !== 'production' || searchParams.get('debug') === 'true'
}

export const isInspect = () => {
  return searchParams.get('inspect') === 'true'
}

export const isLocal = () => {
  return ssrFriendlyDocument?.location?.hostname.match(/\.local/) || ssrFriendlyDocument?.location?.hostname == 'localhost'
}

export const isSafari = () => {
  return navigator.userAgent.match(/Safari/) && !navigator.userAgent.match(/Chrome/)
}

export const defaultInteractBar = () => {
  return searchParams.get('interact')
}

export const regionalEffectsEnabled = () => {
  return true
}

export const customSkyboxesEnabled = () => {
  return true
}

export const wantsXR = (): boolean => {
  return isOculusQuest() || searchParams.get('xr') === 'true'
}

export const supportsXR = (): boolean => {
  if (typeof navigator == 'undefined') {
    return false
  }

  const ua = navigator.userAgent.toLowerCase()
  return (ua.includes('quest') || ua.includes('oculus') || !!ua.match(/windows.+chrome/)) && !!navigator.xr
}

export const isOculusQuest = (): boolean => {
  const ua = navigator.userAgent.toLowerCase()
  return ua.includes('quest') || ua.includes('oculus')
}

export const wantsEmail = (): boolean => {
  return searchParams.get('email') === 'true'
}

export const isOrbit = (): boolean => searchParams.get('mode') === 'orbit'

export const wantsAudio = (): boolean => {
  if (isOrbit()) return false
  const audio = searchParams.get('audio')
  if (audio === 'off' || audio === '0' || audio === 'false') return false
  if (audio === 'on' || audio === '1' || audio === 'true') return true
  // iframe embeds default silent - pass audio=on if you want sound
  if (isEmbedded()) return false
  return true
}

export const isBatterySaver = (): boolean => {
  return searchParams.get('battery') === 'true' || isMobile()
}
export const isAsset = () => location.match(/asset/)

export const debugPumpEnabled = (): boolean => {
  return searchParams.get('debug_pump') === 'true'
}

export const forceMainThreadWorkers = (): boolean => {
  return isEmbedded()
}

// Embedded mode is used to render a parcel in an iframe
export const isEmbedded = (): boolean => {
  return searchParams.get('embedded') === 'true'
}
