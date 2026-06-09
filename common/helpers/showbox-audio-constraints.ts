export type ShowboxAudioMode = 'voice' | 'loud' | 'headphones' | 'external'

export function showboxAudioConstraints(mode: ShowboxAudioMode, deviceId?: string): Record<string, any> {
  const c: Record<string, any> = {}
  if (deviceId) c.deviceId = { exact: deviceId }
  if (mode === 'voice') return c
  if (mode === 'headphones') {
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
