// ABOUTME: Slot pools for parcel compilers and shared GET/PUT workers.

export class SlotPool {
  private free: number[]
  private wait: Array<(slot: number) => void> = []
  readonly size: number

  constructor(size: number) {
    this.size = size
    this.free = Array.from({ length: size }, (_, i) => i)
  }

  acquire(): Promise<number> {
    if (this.free.length) return Promise.resolve(this.free.pop()!)
    return new Promise((resolve) => this.wait.push(resolve))
  }

  release(slot: number) {
    const next = this.wait.shift()
    if (next) next(slot)
    else this.free.push(slot)
  }

  async run<T>(fn: (slot: number) => Promise<T>): Promise<T> {
    const slot = await this.acquire()
    try {
      return await fn(slot)
    } finally {
      this.release(slot)
    }
  }
}

export type CompileFarm = {
  compilers: SlotPool
  downloaders: SlotPool
  uploaders: SlotPool
}

export function createFarm(parcels = 8, workers = 40): CompileFarm {
  return {
    compilers: new SlotPool(parcels),
    downloaders: new SlotPool(workers),
    uploaders: new SlotPool(workers),
  }
}
