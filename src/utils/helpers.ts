import { ColorRecord, Vec3Description } from '../../common/messages/feature'
import { FetchOptions } from '../../web/src/utils'
import { decodeCoords } from '../../common/helpers/utils'

/**
 * Get coordinates from the ?coords= flag in the URL.
 * @returns {string} coordinates, eg: 45W,253N,
 */
export const getCoordsFromURL = (url?: string) => {
  const search = url ? url.replace(/^.+?\?/, '') : document.location.search.substring(1)
  const searchParams = new URLSearchParams(search)
  return searchParams.get('coords')
}

export const decodeCoordsFromURL = (url?: string) => {
  return decodeCoords(getCoordsFromURL(url))
}

/**
 * loads an audio sample from the given Path and returns it.
 * @param {AudioContext} ctx the audio context
 * @param {string} path the path of the audio resource.
 * @returns {AudioBuffer} AudioBuffer of the audio.
 */
export async function loadSample(ctx: AudioContext, path: string): Promise<AudioBuffer | null> {
  try {
    const opts: FetchOptions = { priority: 'low' } // low priority for audio to reduce contention
    const body = await window.fetch(path, opts)
    const buffer = await body.arrayBuffer()
    return await ctx.decodeAudioData(buffer)
  } catch {
    return null
  }
}

/**
 * Convert string | number | null | undefined to a number, given a default value
 */
export function tidyFloat(input: string | number | null | undefined, defaultValue: number): number {
  if (input === null || input === undefined) {
    return defaultValue
  }
  if (typeof input == 'string') {
    return parseFloat(input)
  }
  return input
}

/**
 * Convert string | number | null | undefined to a number, given a default value
 */
export function tidyInt(input: string | number | null | undefined, defaultValue: number): number {
  if (input === null || input === undefined) {
    return defaultValue
  }
  if (typeof input == 'string') {
    return parseInt(input)
  }
  return input
}

/**
 * Convert string | [number,number,number] | null | undefined to a Babylon Color3, given a default value
 */
export function tidyColor3(input: ColorRecord | undefined, defaultValue: string) {
  if (typeof input == 'string' && input != '') {
    return (undefined as any /* todo(lite): BABYLON.Color3.FromHexString(input) */)
  }
  if (Array.isArray(input) && input.length == 3) {
    return (undefined as any /* todo(lite): BABYLON.Color3.FromArray(input) */)
  }
  return (undefined as any /* todo(lite): BABYLON.Color3.FromHexString(defaultValue) */)
}

export function tidyVec3(input: Vec3Description | undefined): [number, number, number] {
  if (input == undefined) {
    return [0, 0, 0] // Catch rare undefined cases. Also present in assets from the library
  }

  if (Array.isArray(input)) {
    return input.map((x) => x || 0) as [number, number, number]
  }
  return [input.x, input.y, input.z]
}

/**
 * urls from the json can be a bit wonky, especially from the parcel features, so this helper tries to find the URL
 * @param urlCandidate
 */
export const tidyURL = (urlCandidate: any): string | undefined => {
  if (!urlCandidate) return undefined
  const trim = (v: any) => (typeof v === 'string' ? v.trim() : v)

  if (typeof urlCandidate == 'string') return trim(urlCandidate)
  if (Array.isArray(urlCandidate) && urlCandidate.length > 0) return tidyURL(urlCandidate[0])
  if (urlCandidate.url) return trim(urlCandidate.url)

  return undefined
}

export const resolveUgc = (url?: string) => {
  if (!url) return url
  return url.startsWith('ugc://') ? 'https://ugc.crvox.com/' + url.slice(6) : url
}

/**
 * Returns true if the second bounding box is completely within the first, in absolute coordinates
 */
export function bboxCompletelyWithin(container: any, contents: any) {
  const contMin = container.minimumWorld
  const contMax = container.maximumWorld

  const objMin = contents.minimumWorld
  const objMax = contents.maximumWorld

  return contMin.x <= objMin.x && contMin.y <= objMin.y && contMin.z <= objMin.z && contMax.x >= objMax.x && contMax.y >= objMax.y && contMax.z >= objMax.z
}

/*
 * Create an type-checker for the given enum+type
 * E.g. const isMyEnum = makeIsEnum<MyEnum>(MyEnum)
 */
export function makeIsEnum<Type extends string>(enumType: { [s: string]: Type }) {
  return (value: string): value is Type => Object.keys(enumType).includes(value)
}

/**
 * TypeScript-friendly runtime check for property existence
 */
export function hasProp<Prop extends string>(obj: unknown, prop: Prop): obj is { [prop in Prop]: unknown } {
  return (typeof obj === 'object' && obj?.hasOwnProperty(prop)) || false
}

/**
 * TypeScript-friendly runtime check for string property existence
 */
export function hasStringProp<Prop extends string>(obj: unknown, prop: Prop): obj is { [prop in Prop]: string } {
  return !!(hasProp(obj, prop) && typeof obj[prop] === 'string')
}

/**
 * TypeScript-friendly runtime check for boolean property existence
 */
export function hasBooleanProp<Prop extends string>(obj: unknown, prop: Prop): obj is { [prop in Prop]: boolean } {
  return !!(hasProp(obj, prop) && typeof obj[prop] === 'boolean')
}

/**
 * TypeScript-friendly runtime check for  number property existence
 */
export function hasNumberProp<Prop extends string>(obj: unknown, prop: Prop): obj is { [prop in Prop]: number } {
  return !!(hasProp(obj, prop) && typeof obj[prop] === 'number')
}

export const isURL = (value: string | URL | any) => {
  try {
    if (value instanceof URL) {
      value = value.toString()
    }
    new URL(value).toString()
    return true
  } catch {
    return false
  }
}

export const limitAbsoluteValue = (value: number, maximumAbsolute = 25) => {
  if (value > maximumAbsolute) {
    return maximumAbsolute
  } else if (value < -maximumAbsolute) {
    return -maximumAbsolute
  } else {
    return value
  }
}

export const imageUrlViaProxy = (url: string, width = 1024) => {
  return `https://proxy.crvox.com/image/unsecure/rs:fill:${width}/plain/` + (url && isURL(url) ? url : `${process.env.ASSET_PATH}/images/no-image.png`)
}

export const round = (value: number, dp: number) => {
  const multiplier = Math.pow(10, dp)
  return Math.floor(value * multiplier) / multiplier
}

export type XYZ = 'x' | 'y' | 'z'
export const axisNames3D: XYZ[] = ['x', 'y', 'z']
export const axisNames2D: XYZ[] = ['x', 'y']
