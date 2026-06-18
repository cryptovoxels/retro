import { wantsAudio } from '../common/helpers/detector'

export type SceneConfig = BABYLON.DeepImmutableObject<{
  isGrid: boolean
  isSpace: boolean
  spaceId?: string
  isOrbit: boolean
  isBot: boolean
  coords?: string
  isNight: boolean
  wantsAudio?: boolean
  wantsURL: boolean
  isMultiuser: boolean
}>

export const isScratchpad = () => document.location.pathname.includes('scratchpad')
export const isSpace = () => window.config.isSpace
export const isWorld = () => window.config.isGrid

const defaultConfig: SceneConfig = {
  isGrid: true,
  isSpace: false,
  spaceId: undefined,
  isBot: false,
  isNight: false,
  wantsAudio: true,
  wantsURL: true,
  isOrbit: false,
  isMultiuser: false,
}

export const sceneConfigFromURL = (): SceneConfig => {
  const location = document.location.toString()
  const pathName = document.location.pathname
  const searchParams = new URLSearchParams(document.location.search.substring(1))

  const _isSpace = (): boolean => !!location?.match(/(assets|spaces).+play/)
  const isOrbit = (): boolean => searchParams.get('mode') === 'orbit'
  const isBot = (): boolean => !!document.location.pathname.match(/capture/) || searchParams.get('bot') === 'true'
  const isNight = (): boolean => searchParams.get('time') === 'night'
  const wantsURL = (): boolean => !_isSpace() && !isOrbit() && !isBot()

  const getSpaceId = (): string | null => {
    const match = pathName.match(/(assets|spaces)\/(.+)\/play$/)
    return match ? match[2] : null
  }

  const isMultiuser = (): boolean => !isOrbit() && searchParams.get('mp') !== 'off'

  const isGrid = !_isSpace() && !isScratchpad()

  return Object.assign({}, defaultConfig, {
    isGrid,
    isSpace: _isSpace(),
    spaceId: getSpaceId(),
    isBot: isBot(),
    isNight: isNight(),
    wantsAudio: wantsAudio(),
    wantsURL: wantsURL(),
    isOrbit: isOrbit(),
    isMultiuser: isMultiuser(),
  })
}
