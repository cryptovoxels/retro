import { duckRadio, unduckRadio } from '../../../web/src/radio/global'

export const AUTOPLAY_FADE_TIME = 3

export interface AudioFeature {
  autoStopTimeout: NodeJS.Timeout | null
  rolloffFactor: number
  fadeOut: (timeConstant: number) => void
  fadeIn: (timeConstant: number) => void
  stop: () => void
  play: () => void
  volume: number
  playing: boolean
}

export const audioFadeOutAndStop = (feature: AudioFeature) => {
  feature.autoStopTimeout && clearTimeout(feature.autoStopTimeout)

  const fadeoutTime = feature.rolloffFactor > 0 ? AUTOPLAY_FADE_TIME : 0.5

  // start fading out sound when leaving parcel, only remove once zero, fade back in on reentry (if not too late)
  feature.fadeOut(fadeoutTime)

  unduckRadio(feature)

  // give them 10 seconds to come back before restarting audio
  feature.autoStopTimeout = setTimeout(() => {
    feature.stop()
  }, fadeoutTime * 8000)
}

export const audioFadeInAndPlay = (feature: AudioFeature) => {
  feature.autoStopTimeout && clearTimeout(feature.autoStopTimeout)

  if (feature.playing) {
    feature.volume > 0 && duckRadio(feature)
    // fade it back in!
    feature.fadeIn(AUTOPLAY_FADE_TIME)
  } else {
    feature.play()
  }
}
