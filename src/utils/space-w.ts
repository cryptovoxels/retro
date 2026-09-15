/** Stable w>0 slice from space uuid. Real x,y,z,w assignment later. */
export function spaceW(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  return (Math.abs(h) % 0x7fffffff) + 1
}
