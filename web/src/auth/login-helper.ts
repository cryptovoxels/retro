import { MetaMaskInpageProvider } from '@metamask/providers'
import { supportedChains } from '../../../common/helpers/chain-helpers'
import { ssrFriendlyWindow } from '../../../common/helpers/utils'

export const resolveName = async (name: string) => {
  if (!ssrFriendlyWindow?.ethereum) {
    throw new Error('No ethereum provider found')
  }

  const address = (await ssrFriendlyWindow.ethereum.request({ method: 'eth_resolveName', params: [name] })) as string
  return address
}

export const hasMetamask = (): boolean => {
  return !!ssrFriendlyWindow?.ethereum?.isMetaMask
}

const MM_LOGIN_KEY = 'voxels_mm_login'
const MM_LOGIN_PARAM = 'mm_login'

export function markMetamaskLoginPending() {
  try {
    sessionStorage.setItem(MM_LOGIN_KEY, '1')
  } catch {}
}

// After metamask.app.link opens the in-app browser, auto-start wallet login instead of making users tap again.
export function consumeMetamaskLoginPending(): boolean {
  try {
    const urlPending = new URL(location.href).searchParams.get(MM_LOGIN_PARAM) === '1'
    const storePending = sessionStorage.getItem(MM_LOGIN_KEY) === '1'
    if (!urlPending && !storePending) return false
    sessionStorage.removeItem(MM_LOGIN_KEY)
    const u = new URL(location.href)
    if (u.searchParams.has(MM_LOGIN_PARAM)) {
      u.searchParams.delete(MM_LOGIN_PARAM)
      const qs = u.searchParams.toString()
      history.replaceState(history.state, '', u.pathname + (qs ? `?${qs}` : '') + u.hash)
    }
    return true
  } catch {
    return false
  }
}

// Mobile Safari/Chrome have no injected provider - open this page in MetaMask's in-app browser instead.
export function openMetamaskMobileDapp() {
  const loc = ssrFriendlyWindow?.location
  if (!loc) return
  markMetamaskLoginPending()
  const u = new URL(loc.href)
  u.searchParams.set(MM_LOGIN_PARAM, '1')
  const dapp = `${u.host}${u.pathname}${u.search}`
  loc.href = `https://metamask.app.link/dapp/${dapp}`
}

// ------------------------------------------
// Chain Interaction helpers

/**
 * Retrieve the user's addresses given the provider
 * @param provider A web3Provider.
 * @returns
 */
export async function getUserAccounts(provider: MetaMaskInpageProvider | null | undefined): Promise<string[]> {
  if (!provider || typeof (provider as { request?: unknown }).request !== 'function') {
    return []
  }
  let accounts: (string | undefined)[] = []
  try {
    // Try the good RPC method first, as per standards.
    if (!accounts.length) {
      accounts = (await provider.request<string[]>({ method: 'eth_requestAccounts' })) ?? []
    }
    // Try the old RPC method then.
    if (!accounts.length) {
      accounts = (await provider.request({ method: 'eth_accounts' })) ?? []
    }
  } catch (e) {
    // User refused to link their wallet.
    console.log('Could not get user accounts\n', e)
    return []
  }

  return accounts.filter((x) => !!x) as string[]
}

/**
 * Retrieve the chainId of the currently selected chain.
 * @param provider A web3Provider.
 * @returns
 */
export async function getCurrentChainId(provider: MetaMaskInpageProvider): Promise<number> {
  let chainId
  try {
    if ('request' in provider) {
      chainId = await provider.request({ method: 'net_version' })
    }
  } catch (e) {
    // Could not get network?
    console.error(e)
  }
  return chainId ? parseInt(chainId as string, 10) : 1
}

/**
 * Requests user to sign a message. Returns null when user refuses to sign.
 * @param provider a Web3Provider
 * @param wallet a string of 38 - 41 character starting wih 0x
 * @param message a message.
 * @returns string or null
 */
export async function signMessage(provider: MetaMaskInpageProvider, wallet: string, message: string): Promise<string | null> {
  let signature: string | null
  try {
    const opts = { method: 'personal_sign', params: [message, wallet], jsonrpc: '2.0' }
    signature = (await provider.request<string>(opts)) ?? null
  } catch (e) {
    // User refused to sign.
    console.error(e)
    signature = null
  }
  if (signature == '0x') {
    signature = null
  }

  return signature
}

export async function changeNetwork(
  provider: MetaMaskInpageProvider,
  chainId: number,
): Promise<{
  success: boolean
  error?: string
}> {
  // Check if requested network change is supported.
  const supportedChain = supportedChains.find((chain) => parseInt(chain.chainId) == chainId)
  if (!supportedChain) {
    return { success: false, error: 'Network is unsupported' }
  }

  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: supportedChain.chainId }] })
  } catch (switchError: any) {
    if (switchError.code === 4902) {
      // Network has not been added by user.
      let error
      try {
        error = await provider.request({ method: 'wallet_addEthereumChain', params: [supportedChain] })
      } catch (addError: any) {
        error = addError
        return { success: false, error: error?.message ?? 'Could not add Ethereum chain' }
      }
      if (!error) {
        // We successfully added a Network
        return { success: true }
      }
    } else if (switchError.code === 4001) {
      // user refused switching
      return { success: false, error: 'User refused switching network' }
    }
    // Something went wrong
    return { success: false, error: 'Something went wrong.' }
  }
  return { success: true }
}
