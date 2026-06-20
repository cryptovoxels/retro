import { isIOS } from './detector'

export type ShowboxAudioMode = 'voice' | 'presenter' | 'loud' | 'headphones' | 'external'

export const SHOWBOX_ROOM_OPTIONS: { value: ShowboxAudioMode; label: string; hint: string }[] = [
  { value: 'voice', label: 'quiet — just talking', hint: 'home, office, or gallery. start here.' },
  { value: 'presenter', label: 'speakers on — I talk too', hint: 'PA or monitors on, but you talk between songs.' },
  { value: 'headphones', label: 'headset — quiet spot', hint: 'earbuds or gaming mic. no speaker bleed.' },
  { value: 'loud', label: 'party — music or crowd', hint: 'the room sound is the show. not for talking much.' },
  { value: 'external', label: 'OBS or mixer', hint: 'audio already mixed elsewhere. not this mic.' },
]

export function showboxRoomHint(mode: ShowboxAudioMode): string {
  return SHOWBOX_ROOM_OPTIONS.find((o) => o.value === mode)?.hint ?? ''
}

export function showboxAudioConstraints(mode: ShowboxAudioMode, deviceId?: string): Record<string, any> {
  const c: Record<string, any> = {}
  if (deviceId) c.deviceId = { exact: deviceId }
  if (mode === 'voice') {
    // iOS Safari crackles when the mic opens at a rate that doesn't match the hardware
    // (WebKit #154538/#221334). Pin native 48k/mono so the pipeline doesn't resample, but
    // KEEP echo cancellation - phones are held FaceTime-style on speaker, so AEC must stay on.
    // Desktop is unaffected, so leave its voice mode on browser defaults.
    if (isIOS()) {
      c.echoCancellation = true
      c.noiseSuppression = true
      c.autoGainControl = true
      c.channelCount = 1
      c.sampleRate = 48000
    }
    return c
  }
  // presenter: PA/speakers on but you still talk - no echo cancel, auto-level voice when music drops
  if (mode === 'presenter' || mode === 'headphones') {
    c.echoCancellation = false
    c.noiseSuppression = true
    c.autoGainControl = true
    c.channelCount = 1
    c.sampleRate = 48000
    return c
  }
  c.echoCancellation = false
  c.noiseSuppression = false
  c.autoGainControl = false
  c.voiceIsolation = false
  c.channelCount = 2
  c.sampleRate = 48000
  return c
}
