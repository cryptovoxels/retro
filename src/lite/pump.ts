// at most N parcels generating at once so a burst of Loaded messages does not stall the frame
const MAX = 4
const queue: Array<() => Promise<void>> = []
let running = 0

export function pumpAdd(job: () => Promise<void>) {
  queue.push(job)
  next()
}

function next() {
  while (running < MAX && queue.length) {
    running++
    queue.shift()!()
      .catch((e) => console.warn('[lite] parcel failed', e))
      .finally(() => {
        running--
        next()
      })
  }
}
