import { wantsAudio } from '../common/helpers/detector'

export type SceneConfig = BABYLON.DeepImmutableObject<{
  isGrid: boolean
  isSpace: boolean
  spaceId?: string
  isBot: boolean
  coords?: string
  isNight: boolean
  wantsAudio?: boolean
  wantsURL: boolean
  isMultiuser: boolean
}>

export const isScratchpad = () => (typeof document !== 'undefined' ? document.location.pathname.includes('scratchpad') : false)
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
  isMultiuser: false,
}

export const sceneConfigFromURL = (): SceneConfig => {
  const pathName = document.location.pathname
  const searchParams = new URLSearchParams(document.location.search.substring(1))

  const spaceMatch = pathName.match(/\/(assets|spaces)\/([^/]+)(?:\/play)?$/)
  const scratch = pathName.includes('scratchpad')
  const _isSpace = (): boolean => !!spaceMatch || scratch
  const isBot = (): boolean => !!document.location.pathname.match(/capture/) || searchParams.get('bot') === 'true'
  const isNight = (): boolean => searchParams.get('time') === 'night'
  const wantsURL = (): boolean => !_isSpace() && !isBot()
  const getSpaceId = (): string | null => (scratch ? 'scratchpad' : spaceMatch ? spaceMatch[2] : null)
  const isMultiuser = (): boolean => !scratch && searchParams.get('mp') !== 'off'
  const isGrid = !_isSpace()

  return Object.assign({}, defaultConfig, {
    isGrid,
    isSpace: _isSpace(),
    spaceId: getSpaceId(),
    isBot: isBot(),
    isNight: isNight(),
    wantsAudio: wantsAudio(),
    wantsURL: wantsURL(),
    isMultiuser: isMultiuser(),
  })
}
