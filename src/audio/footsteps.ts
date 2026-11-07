import { RUN, WALK } from '../controls/utils/player-body'

export class Footsteps {
  private phase = 1
  private slice = 0
  static readonly gain = 0.02

  constructor(public readonly sound: BABYLON.Sound) {}

  update(distance: number, dt: number) {
    const speed = distance / dt
    if (!(dt > 0 && dt <= 0.1 && speed > 0.1 && speed <= RUN * 1.5)) {
      this.reset()
      return
    }

    const running = Math.max(0, Math.min(1, (speed - WALK) / (RUN - WALK)))
    const stride = 1.7 + (running * 3.1) / 1.5
    this.phase += distance / stride
    if (this.phase < 1) return
    this.phase %= 1
    if (!this.sound.isReady()) return
    this.sound.setVolume(Footsteps.gain)
    this.sound.setPlaybackRate(1 + running * 0.15)
    this.sound.play(0, this.slice * 0.125, 0.125)
    this.slice = (this.slice + 1) % 4
  }

  reset() {
    this.phase = 1
  }

  land(speed: number) {
    this.phase = 0
    if (speed < 2 || !this.sound.isReady()) return
    this.sound.setVolume(Footsteps.gain)
    this.sound.setPlaybackRate(1)
    this.sound.play(0, 0.5, 0.125)
  }

  dispose() {
    this.sound.dispose()
  }
}
