import { Component, render } from 'preact'
import Panel, { PanelType } from '../components/panel'
import { unmountComponentAtNode, useEffect, useState } from 'preact/compat'
import { ParcelSettings, SingleParcelRecord, tokensToEnter } from '../../../common/messages/parcel'
import { AlchemyNFTWithMetadata } from '../../../common/messages/api-alchemy'
import { fetchMetadataViaAlchemy, typeOfContract } from '../../../common/helpers/apis'
import { AssetType, saveAsset } from '../helpers/save-helper'
import { app } from '../state'
import { md5 } from '../../../common/helpers/utils'

import { loadingBox } from '../components/loading-icon'
import { isAddress } from 'ethers'

const stableHash = md5

export interface Props {
  parcel: SingleParcelRecord
  onClose?: () => void
  onUpdate?: () => void
}

type idTokenToEnter = tokensToEnter & { hash?: string }

export interface State {
  settings: ParcelSettings
  tokensToEnter: idTokenToEnter[] // hash is a computed key of the content
  description?: string
  error: string | null
  success: boolean
}

const hashNFT = (nft: tokensToEnter) => {
  return stableHash(JSON.stringify(nft))
}

export class NFTGatingSettingsWindow extends Component<Props, State> {
  static currentElement: Element

  constructor(props: any) {
    super()

    const hashify = (token: idTokenToEnter) => {
      token.hash = hashNFT(token)
      return token
    }

    this.state = {
      settings: props.parcel.settings || {},
      tokensToEnter: props.parcel?.settings?.tokensToEnter?.map(hashify) || [],
      error: null,
      success: false,
    }
  }

  setStateAsync(state: any): Promise<void> {
    return new Promise((resolve) => {
      this.setState(state, resolve)
    })
  }

  componentWillUnmount() {
    this.clean()
  }

  clean() {
    this.setState({ tokensToEnter: [], description: undefined, error: null })
  }

  addNftInput = () => {
    const newToken = { address: '0x' + Math.floor(Math.random() * 100), chain: 1 }
    ;(newToken as any).hash = hashNFT(newToken as any)
    this.setState({ tokensToEnter: [...this.state.tokensToEnter, newToken as any] })
  }

  saveNewToken = async (nft: idTokenToEnter) => {
    const tokenList = [...this.state.tokensToEnter]
    const prevToken = tokenList.find((t) => t.hash == nft.hash)
    if (prevToken) {
      // remove old token if it's been edited
      tokenList.splice(tokenList.indexOf(prevToken), 1)
    }
    delete nft.hash // delete old hash
    nft.hash = hashNFT(nft) // create new hash of content
    tokenList.push(nft)
    //non-hashed list of tokens because we don't save the hashes on the DB
    const nonHashedList = [...tokenList].map((t) => {
      delete t.hash
      return t
    })
    await this.setStateAsync({
      tokensToEnter: tokenList,
      settings: { ...this.state.settings, tokensToEnter: nonHashedList },
      success: false,
    })

    const result = await saveAsset(AssetType.Parcel, this.props.parcel.id, { settings: this.state.settings })
    if (result.success) {
      this.setState({ success: true })
      this.props.onUpdate && this.props.onUpdate()
    } else {
      this.setState({ success: false })

      app.showSnackbar(result.message || 'Settings could not be saved', PanelType.Danger)
    }
  }

  onRemoveToken = async (hash: string) => {
    const tokenList = [...this.state.tokensToEnter]
    const prevToken = tokenList.find((t) => t.hash == hash)
    if (prevToken) {
      // remove old token if it's been edited
      tokenList.splice(tokenList.indexOf(prevToken), 1)
    } else {
      return
    }
    //non-hashed list of tokens because we don't save the hashes on the DB
    const nonHashedList = [...tokenList].map((t) => {
      delete t.hash
      return t
    })
    await this.setStateAsync({
      tokensToEnter: tokenList,
      settings: { ...this.state.settings, tokensToEnter: nonHashedList },
      success: false,
    })

    const result = await saveAsset(AssetType.Parcel, this.props.parcel.id, { settings: this.state.settings })
    if (result.success) {
      this.setState({ success: true })
      this.props.onUpdate && this.props.onUpdate()
    } else {
      app.showSnackbar(result.message || 'Settings could not be saved', PanelType.Danger)
    }
  }

  render({}: Props, { tokensToEnter, error, success }: State) {
    const nftsViews = tokensToEnter.map((t) => {
      //@ts-expect-error the type of token is incompatible, i dont know if that was intentionally by the previous author
      return <TokenToEnterView key={t.hash} onSubmit={this.saveNewToken} onRemoveToken={this.onRemoveToken} hash={t.hash} address={t.address} tokenId={t.tokenId} chain={t.chain} type={t.type} />
    })
    return (
      <dialog className={`-auto-height -fixed`}>
        <header>
          <h3>Limit entry to NFT holders.</h3>
          <button onClick={this.props.onClose}>&times;</button>
        </header>
        <section>
          <div>
            <p>This tool lets you block users from entering your parcel if they do not own certain NFTs.</p>
            <Panel>This feature is currently in Beta.</Panel>
            {!!error && <Panel type="danger">{error}</Panel>}
            {success && <Panel type="success">Settings Saved!</Panel>}
            <b>Add/Remove NFTs:</b>
            <ul>{nftsViews}</ul>
          </div>
          {tokensToEnter.length < 1 && (
            <div>
              <button onClick={() => this.addNftInput()}>Add NFT</button>
            </div>
          )}
        </section>
      </dialog>
    )
  }
}

type TokenToEnterProps = idTokenToEnter & { onSubmit: (nft: idTokenToEnter) => void; onRemoveToken: (hash: string) => void }

const TokenToEnterView = ({ address, chain, type, tokenId, hash, onSubmit, onRemoveToken }: TokenToEnterProps) => {
  const [contract, setContract] = useState<string | undefined>(address || undefined)
  const [chainId, setChain] = useState<1 | 137>((chain || 1) as 1 | 137)
  const [id, setId] = useState<string | undefined>(tokenId || undefined)
  const [ercTypeOfContract, setTypeOfContract] = useState<'erc721' | 'erc1155' | 'erc20' | null>(type || null)
  const [metadata, setMetadata] = useState<(AlchemyNFTWithMetadata & { success: boolean }) | null>(null)
  // States:
  const [error, setError] = useState<string | null>(null)
  const [fetchingType, setFetchingType] = useState<boolean>(false)

  const getMetadata = async () => {
    if (!contract) {
      return
    }
    const p = await fetchMetadataViaAlchemy({ address: contract, chain: chainId, tokenId: id })
    if (p?.success && p?.metadata) {
      setMetadata(p)
    }
  }
  const getContractType = async () => {
    if (!contract) {
      return
    }
    setFetchingType(true)
    const p = await typeOfContract(contract, chainId == 1 ? 'eth' : 'matic')
    setTypeOfContract(p)
    setFetchingType(false)
  }

  const name = () => {
    if (!id) {
      return ''
    }
    return metadata?.metadata.name || `Token id ${id.length > 8 ? id?.substring(0, 8) + '...' : id}`
  }

  const image = () => {
    let image = metadata?.metadata.image || metadata?.metadata.image_url || '/images/no-image.png'

    if (image.startsWith('ipfs://')) {
      const params = image.split('/')
      params.splice(0, 2)
      image = 'https://ipfs.io/ipfs/' + params.join('/')
    }
    return image
  }

  const website = () => {
    return metadata?.metadata.external_url || metadata?.metadata.url
  }

  const validation = () => {
    if (!chainId) {
      setError('Chain is invalid')
      return false
    }
    if (!contract || !isAddress(contract)) {
      setError('Contract is invalid')
      return false
    }
    switch (ercTypeOfContract) {
      case 'erc1155':
        if (!id) {
          setError('ERC1155 contract: TokenId is required')
          return false
        }
        break
      case null:
        setError('Type of contract is unknown')
        return false
      case 'erc20':
        setId(undefined)
        break
      case 'erc721':
        break
      default:
        break
    }
    // save new setting
    return true
  }
  useEffect(() => {
    id && getMetadata()
  }, [])

  useEffect(() => {
    if (id && contract && chainId) {
      getMetadata()
    }
  }, [id, contract])

  useEffect(() => {
    if (contract && isAddress(contract)) {
      getContractType()
    }
  }, [contract, chainId])

  const submitToken = (evt: any) => {
    evt.preventDefault()
    if (!validation()) return
    onSubmit({ hash, address: contract as string, chain: chainId, tokenId: id, type: ercTypeOfContract as any })
  }

  const removeToken = () => {
    if (!confirm('Are you sure you want to remove this token?')) return
    if (!hash) {
      app.showSnackbar('This NFT is broken, try reloading the page')
      return
    }
    onRemoveToken(hash)
  }

  return (
    <li>
      {error && <Panel type="danger">{error}</Panel>}
      <form>
        <div>
          <label>Chain</label>
          <select value={chainId} onChange={(e) => setChain(parseInt(e.currentTarget.value) as 1 | 137)} required>
            <option value={1}>Ethereum</option>
            <option value={137}>Polygon</option>
          </select>
        </div>
        <div>
          <label>Contract address</label>
          <input type="text" onChange={(e) => setContract(e.currentTarget.value)} placeholder="0xdwd15..." required value={contract} />
        </div>
        <div>
          <label>Type</label>
          {fetchingType && <span>Checking contract type ... </span>}
          {!fetchingType && (
            <select value={ercTypeOfContract as any} disabled={true} required>
              <option value={null!}></option>
              <option value={'erc721'}>ERC721</option>
              <option value={'erc1155'}>ERC1155</option>
              <option value={'erc20'}>ERC20</option>
            </select>
          )}
        </div>
        {ercTypeOfContract !== 'erc20' && (
          <div>
            <label>Token Id</label>
            <input
              type="text"
              onInput={(e) => {
                !e.currentTarget.value ? setId(e.currentTarget.value) : !!e.currentTarget.value.match(/^[0-9]*$/g) && setId(e.currentTarget.value)
              }}
              value={id}
            />
          </div>
        )}
        <div>
          <button onClick={submitToken}>Submit</button>
          <button onClick={removeToken}>Remove</button>
        </div>
      </form>
      {contract && chainId && ercTypeOfContract && id && metadata ? (
        <div>
          <b>NFT view:</b>
          <br />

          {!fetchingType && <img src={image()} width={48} />}
          <div id="description">
            <p>
              User has to own <b>{name()}</b> from Collection {contract.substring(0, 15) + '...'}
            </p>
            {website() && (
              <button
                onClick={() => {
                  window.open(website(), '_blank')
                }}
                title={!!website() ? `View on Website` : 'No Link found for this item'}
              >
                View item
              </button>
            )}
          </div>
        </div>
      ) : contract && chainId && ercTypeOfContract && !id ? (
        <div>
          <b>NFT view:</b>
          <br />
          <div id="description">
            <p>
              User has to own <b>any NFT</b> from Collection {contract.substring(0, 15) + '...'}
            </p>
          </div>
        </div>
      ) : (
        <div>
          <b>NFT view:</b>
          <br />
          {fetchingType && loadingBox(48)}
          <p>Once you've added enough information we'll show what the condition is.</p>
        </div>
      )}
    </li>
  )
}

export function toggleNFTGatingManager(parcel: SingleParcelRecord, onUpdate?: () => void, onClose?: () => void) {
  if (NFTGatingSettingsWindow.currentElement) {
    unmountComponentAtNode(NFTGatingSettingsWindow.currentElement) // unmount the component
    NFTGatingSettingsWindow.currentElement = null!
  } else {
    const div = document.createElement('div')
    document.body.appendChild(div)
    NFTGatingSettingsWindow.currentElement = div

    render(
      <NFTGatingSettingsWindow
        parcel={parcel}
        onUpdate={onUpdate}
        onClose={() => {
          !!NFTGatingSettingsWindow.currentElement && unmountComponentAtNode(NFTGatingSettingsWindow.currentElement) // unmount the component
          NFTGatingSettingsWindow.currentElement = null!
          onClose && onClose()
          div?.remove()
        }}
      />,
      div,
    )
  }
}
