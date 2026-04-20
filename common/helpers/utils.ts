import { Animations, Poses } from '../../src/avatar-animations'

export const simpleHash = (data: string): string => {
  let hash = 2166136261
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

// MD5 helper for stable filenames / cache keys.
// Note: MD5 is not secure; do not use for auth/crypto.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const md5Impl: (data: string) => string = require('md5')
export const md5 = (data: string): string => md5Impl(data)

export const randomBytes = (size: number): Uint8Array => {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('crypto.getRandomValues is not available in this environment')
  }
  const bytes = new Uint8Array(size)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

const toUint8 = (input: string | ArrayBuffer | Uint8Array): Uint8Array => {
  if (typeof input === 'string') return new TextEncoder().encode(input)
  if (input instanceof Uint8Array) return input
  return new Uint8Array(input)
}

export const sha256Hex = async (input: string | ArrayBuffer | Uint8Array): Promise<string> => {
  if (!globalThis.crypto?.subtle?.digest) {
    throw new Error('crypto.subtle.digest is not available in this environment')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', toUint8(input))
  const bytes = new Uint8Array(digest)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const similarity = (s1: string, s2: string) => {
  let longer = s1
  let shorter = s2
  if (s1.length < s2.length) {
    longer = s2
    shorter = s1
  }
  const longerLength = longer.length
  if (longerLength == 0) {
    return 1.0
  }
  return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength as any)
}

export const editDistance = (s1: string, s2: string) => {
  s1 = s1.toLowerCase()
  s2 = s2.toLowerCase()

  const costs = []
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i
    for (let j = 0; j <= s2.length; j++) {
      if (i == 0) costs[j] = j
      else {
        if (j > 0) {
          let newValue = costs[j - 1]
          if (s1.charAt(i - 1) != s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1
          costs[j - 1] = lastValue
          lastValue = newValue
        }
      }
    }
    if (i > 0) costs[s2.length] = lastValue
  }
  return costs[s2.length]
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// SOCKETS

/**
 * converts a websocket url (wss://test.com) to a https://test.com URL taking into account if it's secure domain
 * and preserves the path (ws://test.com/path => http://test.com/path)
 * @param url
 * @constructor
 */
export const WS2HTTPBaseURL = (url: string): string => {
  const hostURL = new URL(url)
  const protocol = hostURL.protocol.replace('ws', 'http') // switch from ws to http protocol
  const pathname = hostURL.pathname === '/' ? '' : hostURL.pathname
  return `${protocol}//${hostURL.host}${pathname}`
}
/**
 * converts a https url (https://test.com) to a wss://test.com URL taking into account if it's secure domain
 * and also strips any extra path stuff (ws://test.com/asdasd => http://test.com/)
 * @param url
 * @constructor
 */
export const HTTP2WSBaseURL = (url: string): string => {
  const hostURL = new URL(url)
  const protocol = hostURL.protocol.replace('http', 'ws') // switch from http to ws protocol
  return `${protocol}//${hostURL.host}${hostURL.pathname || ''}`
}

/**
 * Centralized utility for fetching data from multiplayer server APIs
 * Handles URL construction, error logging, and JSON parsing consistently
 * @param apiPath the API path (e.g., '/api/users.json', '/api/parcels/123.json')
 * @param options standard fetch options (method, signal, headers, etc.)
 * @returns parsed JSON response or null on error
 */
export const fetchFromMPServer = async <T>(apiPath: string, options: RequestInit = {}): Promise<T | null> => {
  let mpServerHost = process.env.NODE_ENV === 'production' ? '' : 'https://voxels.com'
  /**
   * /mp is a route set by Digitalocean reverse proxy to route to the multiplayer server
   */
  const url = `${mpServerHost}/mp` + apiPath

  try {
    const res = await fetch(url, options)

    if (!res.ok) {
      return null
    }
    return res.json() as T
  } catch (e) {
    return null
  }
}
/////////////////////////////////////////////////////////////////////////////////////////////////////////
// COORDS

// offset to apply to spawn height from actual camera
export const CAMERA_HEIGHT = 2.5

export interface coords {
  position: BABYLON.Vector3
  rotation?: BABYLON.Vector3
  pose?: Animations
  flying?: boolean
}

const headings = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N']

/**
 * Converts encoded coordinates such as 45W,253N, to a position object
 * @param {string} coords the coordinates, eg: 45W,253N,
 * @returns {coords} Position object {position:{x,y,z},rotation:{x,y,z},flying:{boolean}}
 */
export const decodeCoords = (coords: string | null): coords => {
  const result = new BABYLON.Vector3(0, CAMERA_HEIGHT, 0)
  const rotation = new BABYLON.Vector3(0, 0, 0)
  var pose = Animations.Idle

  if (coords) {
    const terms = coords.split(/[,@\/]/)

    terms.forEach((t) => {
      if (t.match(/\dU$/)) {
        result.y = parseFloat(t) + CAMERA_HEIGHT
      } else if (t.match(/\F$/)) {
        result.y = parseFloat(t) + CAMERA_HEIGHT
      } else if (t.match(/\dN$/)) {
        result.z = parseFloat(t)
      } else if (t.match(/\dS$/)) {
        result.z = -parseFloat(t)
      } else if (t.match(/\dE$/)) {
        result.x = parseFloat(t)
      } else if (t.match(/\dW$/)) {
        result.x = -parseFloat(t)
      } else if (t.match(/^[NESW]{1,2}$/)) {
        rotation.y = (headings.indexOf(t) * 45 * Math.PI) / 180
      }
    })

    if (terms.includes('SIT')) {
      pose = Animations.Sitting
    }
  }

  return { position: result, rotation, pose }
}

/**
 * Converts coords x: y: to string coordinates such as 45W,253N,
 * @returns {string} coordinates
 */
export const encodeCoords = (coords: coords): string => {
  let { x, z } = coords.position.floor()

  // include 0.5 in
  let y = Math.round((coords.position.y - CAMERA_HEIGHT) * 2) / 2

  const result = []

  if (x === 0) {
    x = null!
  } else {
    result.push(x < 0 ? Math.abs(x) + 'W' : x + 'E')
  }

  if (z === 0) {
    z = null!
  } else {
    result.push(z < 0 ? Math.abs(z) + 'S' : z + 'N')
  }

  if (y === 0) {
    y = null!
  } else {
    // append F if we are flying instead of U
    result.push(y + (coords.flying ? 'F' : 'U'))
  }

  let heading

  if (coords.rotation) {
    let r = (coords.rotation.y * 180) / Math.PI

    while (r < 0) {
      r += 360
    }

    const i = Math.max(0, Math.min(360, Math.round((r % 360) / 45)))
    heading = headings[i]

    return result.length === 0 ? heading : heading + '@' + result.join(',')
  } else {
    return result.length === 0 ? '' : result.join(',')
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// CLIPBOARD

function fallbackCopyTextToClipboard(text: string): boolean {
  const textArea = document.createElement('textarea')
  textArea.value = text

  // Avoid scrolling to bottom
  textArea.style.top = '0'
  textArea.style.left = '0'
  textArea.style.position = 'fixed'

  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  let result = false
  try {
    const successful = document.execCommand('copy')
    result = !!successful
  } catch (err) {
    result = false
  }
  document.body.removeChild(textArea)
  return result
}

export function copyTextToClipboard(text: string, onSuccess?: () => void, onFail?: () => void): void {
  if (!navigator.clipboard) {
    const copied = fallbackCopyTextToClipboard(text)
    copied ? onSuccess && onSuccess() : onFail && onFail()
    return
  }
  navigator.clipboard.writeText(text).then(onSuccess, onFail)
}

export function seededShuffle(array: Array<any>, seed: number) {
  let currentIndex = array.length,
    temporaryValue,
    randomIndex
  seed = seed || 1
  const random = function () {
    const x = Math.sin(seed++) * 10000
    return x - Math.floor(x)
  }
  // While there remain elements to shuffle...
  while (0 !== currentIndex) {
    // Pick a remaining element...
    randomIndex = Math.floor(random() * currentIndex)
    currentIndex -= 1
    // And swap it with the current element.
    temporaryValue = array[currentIndex]
    array[currentIndex] = array[randomIndex]
    array[randomIndex] = temporaryValue
  }
  return array
}

export function isStringHex(num: string) {
  return Boolean(num.match(/^0x[0-9a-f]+$/i)) || (num.startsWith('0x') && Boolean(num.length >= 63))
}

export function isHex(num: string) {
  return Boolean(num.length > 63)
}

export function isValidUrl(url?: string) {
  try {
    new URL(url ?? '').toString()
  } catch {
    return false
  }
  return true
}

export const web3ExtractErrorMessage = (e: { code?: any; message?: string; data?: { code?: any; data?: string; message?: string } }) => {
  if (!e.code) {
    return e.message || 'Unknown error'
  }
  const error = Object.assign({}, e || {})
  switch (error.code) {
    case -32603:
      if (!!error.message?.startsWith('[ethjs-query] while formatting')) {
        error.data = {}
        try {
          const d = JSON.parse(error.message.substring(`[ethjs-query] while formatting outputs from RPC '`.length, error.message.length - 1))
          error.data.message = d.value?.data?.message
        } catch {}
      }
      if (error.data?.code == 3 && error.data?.message?.match(/(Ownable)/i)) {
        return 'You are not the owner of this smart contract'
      }
      return error.data?.message || error.message || 'Internal JSON-RPC Error'
    case 4001:
    case 4100:
      return error.data?.message || error.message || 'User rejected the request'
    default:
      return error.data?.message || error.message || 'Unknown error'
  }
}
// derived from https://github.com/JedWatson/exenv
export const canUseDom = !!(typeof window !== 'undefined' && window.document && window.document.createElement)

export const ssrFriendlyDocument = canUseDom ? document : null
export const ssrFriendlyWindow = canUseDom ? window : null

export const isServerSide: false = !canUseDom as false

export const shorterWallet = (wallet: string, maxChars = 10) => {
  const result = new Array(maxChars)
  for (let i = 0; i < maxChars / 2; i++) {
    result[i] = wallet[i]
    result[result.length - 1 - i] = wallet[wallet.length - 1 - i]
  }
  result[Math.ceil(maxChars / 2)] = '…'
  return result.join('')
}

//TODO: REMOVE THIS EVENTUALLY (replace all appearances with "jobs"). Only needed while devs potentially need to run
// multiple different versions of the baker code ("lightmapper" repo) in the same DB without them stepping on each other.
// Tight regex to prevent SQL injection since this string is template-substituted directly into SQL query strings.
// export const JOBS_TABLE_NAME = 'jobs'
export const JOBS_TABLE_NAME = process.env.JOBS_TABLE_NAME !== undefined && process.env.JOBS_TABLE_NAME.match(/^jobs[a-z0-9_]*$/) ? process.env.JOBS_TABLE_NAME : 'jobs'

// For working with Express query parameters like req.query.foo, which may be a string, a QueryString.ParsedQ, or an array
// of either, when you expect just a single string parameter value.
export const firstStringParam = <T>(param: T): string | undefined => {
  if (typeof param === 'string') {
    return param
  } else if (Array.isArray(param) && typeof param[0] === 'string') {
    return param[0]
  } else {
    // Could theoretically be a complicated object type for values like "foo[bar]=baz". See https://www.npmjs.com/package/qs.
    return undefined
  }
}
