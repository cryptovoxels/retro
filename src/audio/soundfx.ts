const SOUNDS_URL = '/sounds'

interface SoundInfo {
  url: string
  options: BABYLON.ISoundOptions
  sound?: BABYLON.Sound
}

// avatar sounds come from other players and should be spatial
type AvatarSound = 'avatar.arrive' | 'avatar.leave' | 'avatar.chat' | 'avatar.emote'

type BuildSound = 'build.place' | 'build.extend' | 'build.select' | 'build.start'

export type SoundName = AvatarSound | BuildSound | 'avatar.jump' | 'avatar.click' | 'avatar.step'

const alertOptions = {
  spatialSound: false,
  loop: false,
  autoplay: false,
}
const spatialOptions = {
  rolloffFactor: 2,
  maxDistance: 24,
  spatialSound: true,
  loop: false,
  autoplay: false,
}

const url = (path: string) => SOUNDS_URL + (path.startsWith('/') ? path : `/${path}`)

export const soundFx: Record<SoundName, SoundInfo> = {
  'avatar.step': { url: url('avatar/footsteps.wav'), options: alertOptions },
  'avatar.jump': { url: url('avatar/jump.wav'), options: alertOptions },
  'avatar.click': { url: url('avatar/click.wav'), options: alertOptions },
  'avatar.arrive': {
    url: url('avatar/teleport-in.wav'),
    options: spatialOptions,
  },
  'avatar.chat': {
    url: url('avatar/chat-message.wav'),
    options: spatialOptions,
  },
  'avatar.emote': {
    url: url('avatar/emote.wav'),
    options: spatialOptions,
  },
  'avatar.leave': {
    url: url('avatar/teleport-out.wav'),
    options: spatialOptions,
  },
  'build.place': {
    url: url('build/place.wav'),
    options: alertOptions,
  },
  'build.extend': {
    url: url('build/extend.wav'),
    options: alertOptions,
  },
  'build.start': {
    url: url('build/start.wav'),
    options: alertOptions,
  },
  'build.select': {
    url: url('build/select.wav'),
    options: alertOptions,
  },
}
