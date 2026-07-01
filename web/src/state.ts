import { signal } from '@preact/signals'
import { EventEmitter } from 'events'
import Cookies from 'js-cookie'
import { decodeJwt } from 'jose'
import { ApiAvatar, type ApiAvatarMessage } from '../../common/messages/api-avatars'
import type { AvatarRef } from '../../common/messages/avatar-ref'
import Snackbar from './components/snackbar'

const jsonHeaders = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
}

export interface Message {
  type: 'visit' | 'chat' | 'join' | 'leave' | 'navigate' | 'teleport' | 'reconnect'
  sender?: string
  createdAt?: Date
  data?: string
}

const VOXELS_TEAM = ['0x2D891ED45C4C3EAB978513DF4B92a35Cf131d2e2', '0x86b6Dcc9eb556e55485d627e5D4393b616A8Afb8', '0xa13b052759aC009D4b7643f61E77FeC54492f446', '0x0fA074262d6AF761FB57751d610dc92Bac82AEf9'].map((w) => w.toLowerCase())

const MESSAGE_CHANNEL = 'channel'

type NamesObject = {
  names: string[]
  name: string
}

export enum AppEvent {
  Load = 'load',
  Login = 'login',
  Logout = 'logout',
  AvatarLoad = 'avatar-load', // event for when we got all the user info from the db
  ErrorLogin = 'error-login',
  Change = 'change',
  ProviderMessage = 'provider-message',
  CanvasEngaged = 'canvas-engaged',
  Exploring = 'exploring',
}

export interface StateObject {
  loading?: boolean
  wallet: string | null
  moderator?: boolean
  name?: string
  unverifiedWallet?: string
  unreadMailCount: number
  key?: string
  costume?: any
  settings?: { quietMails?: boolean }
  hideInstructions?: boolean
}

export interface RequestArguments {
  method: string
  params?: unknown[] | object
}

class State extends EventEmitter {
  state: StateObject
  stateLoadedCallbacks: Array<(state: StateObject) => void> = []
  avatarRef: AvatarRef = 'anon'

  constructor() {
    super()

    this.state = {
      wallet: null,
      unreadMailCount: 0,
      key: null!,
      costume: {},
      settings: {},
    }
  }

  setState(args: Partial<StateObject>) {
    Object.assign(this.state, args)
    this.emit(AppEvent.Change)

    if (args.loading === false) {
      while (this.stateLoadedCallbacks.length) {
        const callback = this.stateLoadedCallbacks.shift()
        if (!callback) continue
        callback(this.state)
      }
    }
  }
}

export class Appstate extends State {
  rememberSignIn = false
  showSnackbar = Snackbar.show ?? console.log
  playPreview = signal<{ returnPath: string } | null>(null)
  // the world the "Play" button enters: set by the parcel/womp page you're viewing
  visitUrl = signal<string | undefined>(undefined)
  private lastOnlineIntervalHandle: NodeJS.Timeout | null = null

  constructor() {
    super()

    try {
      if (typeof window === 'undefined') {
        return
      }
      if (typeof localStorage === 'undefined') {
        return
      }
    } catch (e) {
      // sandboxed iframe
      console.log('sandboxed iframe')
    }

    this.on(AppEvent.AvatarLoad, () => {
      this.subscribeLastOnline()
    })
    this._initiate()

    window.addEventListener('storage', this.onStorage)
  }

  isAdmin() {
    return VOXELS_TEAM.includes(this.state.wallet?.toLowerCase() ?? '')
  }

  get hasMetamask(): boolean {
    return !!window.ethereum && window.ethereum?.isMetaMask
  }

  get hasWeb3Extension() {
    return !!window.ethereum && !this.hasMetamask
  }

  get signedIn() {
    return !!this.state.wallet
  }

  get isMobile() {
    return typeof navigator !== 'undefined' && navigator.userAgent.match(/mobile/i)
  }

  get wallet() {
    return this.state.wallet
  }

  isOwner(ref: AvatarRef | null | undefined): boolean {
    if (!this.state.wallet || !ref) return false
    const w = typeof ref === 'object' ? ref.owner : ref
    return w.toLowerCase() === this.state.wallet.toLowerCase()
  }

  onStorage = (e: StorageEvent) => {
    if (e.key == MESSAGE_CHANNEL && e.newValue) {
      const msg = JSON.parse(e.newValue) as Message
      if (msg.type == 'teleport' && msg.data?.match('/play')) {
        const coords = msg.data.slice(5)
        window.persona.teleport(coords)
      }
      if (msg.type == 'reconnect') {
        this.loadAvatar()
        ;(window as any).connector?.reconnect()
      }
    }
  }

  send(message: Message) {
    const nonce = Math.random()
    this.localStorage?.setItem(MESSAGE_CHANNEL, JSON.stringify({ ...message, nonce }))
  }

  get localStorage(): Storage | undefined {
    try {
      return localStorage
    } catch (e) {
      // sandboxed iframe
      console.log('sandboxed iframe')
      return
    }
  }

  async setKey(key: string) {
    try {
      const payload = decodeJwt(key) as any
      const wallet: string | undefined = payload?.wallet?.toLowerCase()

      this.setState({
        key,
        wallet,
      })

      let fetchPing, resultPing
      try {
        fetchPing = await fetch('/api/ping')
        resultPing = await fetchPing.json()
      } catch {
        console.debug('Signin fetch failed')
        this.signout()
        return
      }

      if (!resultPing.success) {
        console.debug('Signin, ', resultPing)
        return this.signout()
      }

      await this.loadAvatar()
    } catch (e) {
      console.debug('Signin error, ', e)
      this.signout()
    }
  }

  setName(name: string | undefined) {
    this.setState({ name })
  }

  async markMailAsRead(mailId: number) {
    const r = await fetch(`${process.env.API}/mails/read`, {
      method: 'put',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: mailId,
      }),
    })
    const mail = await r.json()
    this.setState({ unreadMailCount: parseInt(mail.unreadCount) })
  }

  signout() {
    this.localStorage?.removeItem('cv-wearables-owned')
    try {
      sessionStorage.removeItem('showbox_guest_pass')
    } catch {}

    Cookies.remove('jwt')

    this.setState({
      wallet: null!,
      key: null!,
      moderator: false,
      unreadMailCount: 0,
      name: null!,
      costume: {},
    })

    this.unsubscribeLastOnline()
    this.emit(AppEvent.Logout)
  }

  async fetchNames(): Promise<NamesObject> {
    const f = await fetch(`/api/avatar/${this.state.wallet}/names`)
    if (!f.ok) throw new Error('Could not fetch names')

    return await f.json()
  }

  subscribeLastOnline() {
    this.updateLastOnline()
    if (this.lastOnlineIntervalHandle) clearInterval(this.lastOnlineIntervalHandle)
    this.lastOnlineIntervalHandle = setInterval(this.updateLastOnline.bind(this), 30e3)
  }

  unsubscribeLastOnline() {
    if (this.lastOnlineIntervalHandle) clearInterval(this.lastOnlineIntervalHandle)
  }

  updateLastOnline() {
    if (!this.state?.wallet) {
      console.log('no wallet in updateLastOnline')
      return
    }
    fetch(`/api/avatar/${this.state?.wallet}/online`, { method: 'POST', credentials: 'include' }).catch(console.error)
  }

  async onLoad() {
    this.loadAvatar()
  }

  async loadAvatar(nonce?: boolean) {
    if (!this.signedIn || !this.state.wallet) {
      console.error('Can not load avatar if not logged in')
      return
    }
    this.setState({ loading: true })
    let url = `/api/avatars/${this.state.wallet.toLowerCase()}.json`
    if (nonce) {
      url += '?nonce=' + Math.random() * 1000
    }

    const res = await fetch(url)
    if (!res.ok) throw res
    const data = (await res.json()) as ApiAvatarMessage

    const name = data.avatar?.name ?? undefined // || (data.avatar?.owner && data.avatar?.owner?.slice(0, 10) + '...') || 'anonymous'
    const moderator = (data.avatar && data.avatar.moderator) || false
    const costume = (data.avatar && data.avatar.costume) || {}
    const settings = (data.avatar && data.avatar.settings) || {}

    if (data.avatar?.id) {
      this.avatarRef = { id: data.avatar.id, name: data.avatar.name!, owner: data.avatar.owner, created_at: data.avatar.created_at! }
    }

    this.setState({ name, moderator, costume, settings, loading: false })
    this.emit(AppEvent.AvatarLoad)
  }

  async setAvatar(changes: Partial<ApiAvatar>) {
    const result = await fetch(process.env.API + `/avatar`, {
      method: 'post',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(changes),
    })

    await result.json()
    app.loadAvatar(true)

    console.log('Settings saved.')
  }

  /**
   * Await the state to ensure it is loaded before using
   */
  getState(): Promise<StateObject> {
    return new Promise((resolve) => {
      if (this.state.loading) {
        this.stateLoadedCallbacks.push(resolve)
      } else {
        resolve(this.state)
      }
    })
  }

  onToken(key: string, name: string | null, isNewUser: boolean): void {
    const payload = decodeJwt(key) as any
    if (!payload || typeof payload !== 'object') {
      console.error('Invalid JWT')
      return
    }
    const wallet = payload.wallet.toLowerCase()
    this.setState({ key, name: name ?? undefined, wallet })
    this.loadAvatar()
    this.emit(AppEvent.Login, isNewUser)
  }

  async emailSignin(email: string, code: string): Promise<{ token: string; name: string | null; isNewUser: boolean } | null> {
    let f
    try {
      f = await fetch(`${process.env.API}/signin`, {
        method: 'POST',
        credentials: 'include',
        headers: jsonHeaders,
        body: JSON.stringify({ email, code }),
      })
    } catch {
      this.emit(AppEvent.ErrorLogin)
      console.error('Network Error, please try again a few minutes')
      return null
    }
    const r = (await f.json()) as { success: boolean; name: string | null; token: string; isNewUser: boolean }
    if (!r.success) {
      this.emit(AppEvent.ErrorLogin)
      return null
    }
    return { token: r.token, name: r.name, isNewUser: r.isNewUser }
  }

  private async _initiate() {
    if (!document['addEventListener']) {
      return
    }

    try {
      var jwtKey = Cookies.get('jwt')
    } catch (e) {
      console.log('sandboxed iframe, no jwt')
    }

    if (jwtKey) {
      await this.setKey(jwtKey)
      // setKey only sets wallet/key; we still need to fetch name + costume + settings
      if (this.signedIn) {
        await this.loadAvatar()
      }
    } else {
      // clean name if we dont have a JWT
      this.setState({ name: undefined })
    }
  }

  enterPlayPreview(returnPath?: string) {
    this.playPreview.value = { returnPath: returnPath ?? location.pathname + location.search }
  }

  exitPlayPreview(): string {
    const path = this.playPreview.value?.returnPath || '/play'
    this.playPreview.value = null
    return path
  }
}

export const app = new Appstate()

// For debugging
if (typeof window !== 'undefined') {
  window.app = app
}
