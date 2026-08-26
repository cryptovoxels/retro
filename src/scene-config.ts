import { wantsAudio } from '../common/helpers/detector'

export type SceneConfig = any

export const isWorld = () => true

const defaultConfig: SceneConfig = {
  isGrid: true,
  isBot: false,
  isNight: false,
  wantsAudio: true,
  wantsURL: true,
  isMultiuser: false,
}

export const sceneConfigFromURL = (): SceneConfig => {
  const searchParams = new URLSearchParams(document.location.search.substring(1))

  const isBot = (): boolean => !!document.location.pathname.match(/capture/) || searchParams.get('bot') === 'true'
  const isNight = (): boolean => searchParams.get('time') === 'night'
  const wantsURL = (): boolean => !isBot()
  const isMultiuser = (): boolean => searchParams.get('mp') !== 'off'

  return Object.assign({}, defaultConfig, {
    isGrid: true as const,
    isBot: isBot(),
    isNight: isNight(),
    wantsAudio: wantsAudio(),
    wantsURL: wantsURL(),
    isMultiuser: isMultiuser(),
  })
}
