import { MetaMaskInpageProvider } from '@metamask/providers'
import { Contract, BrowserProvider, Signer } from 'ethers'
import { ssrFriendlyWindow } from '../../../common/helpers/utils'
import { PanelType } from '../components/panel'
import Snackbar from '../components/snackbar'
import { app, AppEvent, Appstate } from '../state'
import { changeNetwork, getCurrentChainId, getUserAccounts, signMessage } from './login-helper'

const jsonHeaders = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
}

const ParcelContract = require('../../../common/contracts/parcel.json')

export class StateLogin {
  signer: Signer | null = null
  provider: MetaMaskInpageProvider | null = null
  contract: Contract | null = null
  showSnackbar = Snackbar.show ?? console.log
  private message: string | null = null
  #app: Appstate

  constructor(state: Appstate) {
    this.#app = state
  }

  get state() {
    return this.#app.state
  }

  get signedIn() {
    return this.#app.signedIn
  }

  get hasMetamask(): boolean {
    return !!window.ethereum && window.ethereum?.isMetaMask
  }

  onToken(key: string, name: string | null, isNewUser: boolean): void {
    this.#app.onToken(key, name, isNewUser)
  }

  async emailSignin(email: string, code: string) {
    return this.#app.emailSignin(email, code)
  }

  async switchNetwork(chainId: number, callback?: () => void) {
    if (!this.provider) {
      console.error('No provider or login selected')
      app.showSnackbar('No provider or login selected', PanelType.Danger)
      return
    }
    const current = await this.getChainId()
    if (chainId == current || chainId == 0) {
      if (callback) callback()
      return true
    }
    const r = await changeNetwork(this.provider, chainId)
    const { success, error } = r
    const newEthersJSProvider = this.ethersWeb3Provider()
    this.signer = newEthersJSProvider.getSigner() as any
    if (success) {
      !!callback && callback()
    } else {
      console.log(error)
    }
    return success
  }

  async getChainId() {
    await this.refreshProvider()
    if (!this.provider) throw new Error('Provider not available')
    return await getCurrentChainId(this.provider)
  }

  getSigner() {
    if (!this.signer) throw new Error('Signer not available')
    return this.signer
  }

  ethersWeb3Provider(): BrowserProvider {
    const provider = this.provider
    if (provider && provider instanceof BrowserProvider) return provider as BrowserProvider
    return new BrowserProvider(provider as any)
  }

  async refreshProvider() {
    if (!this.provider) {
      await this.setProvider()
      return true
    }
    const accounts = await getUserAccounts(this.provider)
    if (!accounts) return false
    if (!this.provider) return false
    const prov = this.ethersWeb3Provider()
    this.signer = prov.getSigner() as any
    return true
  }

  async signin() {
    if (!this.state.unverifiedWallet || !this.provider) {
      this.setProvider()
      return
    }

    this.message = this.generateMessage()

    if (this.signer) {
      const signature = await signMessage(this.provider, this.state.unverifiedWallet, this.message)
      if (!signature) {
        console.error('Signature could not be generated')
        this.#app.emit(AppEvent.ErrorLogin)
        return
      }
      this.onSignature(signature)
    }
  }

  async onSignature(signature: string) {
    if (!this.provider) console.warn('Provider missing')

    const message = this.message
    const wallet = this.state.unverifiedWallet
    const options = { rememberSignIn: this.#app.rememberSignIn, providerName: 'Metamask' }
    let f
    try {
      f = await fetch(`${process.env.API}/signin`, {
        method: 'POST',
        credentials: 'include',
        headers: jsonHeaders,
        body: JSON.stringify({ wallet, message, signature, options }),
      })
    } catch {
      this.#app.emit(AppEvent.ErrorLogin)
      console.error('Network Error, please try again a few minutes')
      return
    }
    const r = (await f.json()) as { success: boolean; name: string | null; token: string; isNewUser: boolean }
    if (r.success) {
      this.#app.onToken(r.token, r.name, r.isNewUser)
    } else {
      this.#app.emit(AppEvent.ErrorLogin)
      console.error('Could not log in', r)
    }
  }

  handleEvents = async () => {
    if (!this.provider) return
    this.provider.on('disconnect', () => {
      this.#app.emit(AppEvent.ProviderMessage, 'Web3 provider disconnected.')
    })
    this.provider.on('chainChanged', (chainId) => {
      this.#app.emit(AppEvent.ProviderMessage, 'Switched to chain to ' + chainId)
      console.info('Switched to chain ', chainId)
    })
  }

  async setSigner() {
    if (!this.provider) {
      console.warn('No selected login')
      return
    }
    const prov = this.ethersWeb3Provider()
    this.signer = prov.getSigner() as any
  }

  private async setProvider() {
    this.provider = ssrFriendlyWindow?.ethereum as MetaMaskInpageProvider

    if (this.signedIn) {
      this.handleEvents()
      return
    }

    if (!this.provider || typeof this.provider.request !== 'function') {
      this.provider = null
      return false
    }

    const accounts = await getUserAccounts(this.provider)
    if (!accounts || !accounts[0]) {
      this.#app.emit(AppEvent.ErrorLogin)
      return false
    }

    this.#app.setState({ unverifiedWallet: accounts[0] })
    this.handleEvents()
    await this.setSigner()
    this.signin()
    return true
  }

  private generateMessage() {
    const d = new Date().toUTCString()
    return `# Terms of Service

I agree to the terms of service (and any future revisions) detailed at:

  https://www.voxels.com/terms

I agree to follow the code of conduct detailed at

  https://www.voxels.com/conduct

  Date: ${d}`
  }
}

export const login = new StateLogin(app)
export const provider = login
