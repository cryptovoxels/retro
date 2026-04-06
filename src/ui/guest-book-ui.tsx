import { Component, ComponentChildren, Fragment, render } from 'preact'
import { unmountComponentAtNode } from 'preact/compat'
import { useEffect, useState } from 'preact/hooks'
import { getAvatarNameFromWallet } from '../../common/helpers/apis'
import { pluralize } from '../../common/helpers/english-helper'
import { exitPointerLock, requestPointerLockIfNoOverlays } from '../../common/helpers/ui-helpers'
import { copyTextToClipboard } from '../../common/helpers/utils'
import { PanelType } from '../../web/src/components/panel'
import { OwnerAndCollaboratorOnly } from '../../web/src/components/parcels/permissions'
import { app, AppEvent } from '../../web/src/state'
import GuestBook from '../features/guest-book'
import type Parcel from '../parcel'
import type { Scene } from '../scene'

interface Props {
  onClose?: (e: MouseEvent) => void
  guestBook: GuestBook
  scene: Scene
}

interface State {
  signing: boolean
  signedIn?: boolean
  wallets: string[]
}

export class GuestBookUi extends Component<Props, State> {
  static currentElement: Element
  static lastGuestBookId: string
  static namesByWallet: Record<string, string> = {}

  constructor(props: Props) {
    super()

    this.state = {
      signing: false,
      wallets: props.guestBook.getVerifiedWallets(),
    }
  }

  get connector() {
    return window.connector
  }

  get guestBookFeature() {
    return this.props.guestBook as GuestBook
  }

  get parcelName() {
    return this.props.guestBook.parcel.name || this.props.guestBook.parcel.address
  }

  get hasUserSigned() {
    if (!app.signedIn || !app.state.wallet) {
      return false
    }
    return !!this.wallets.find((w) => app.state.wallet && w.toLowerCase() === app.state.wallet.toLowerCase())
  }

  get signature() {
    return this.guestBookFeature?.description.signature_text
  }

  get wallets() {
    return this.state.wallets
  }

  get walletsCount() {
    return this.wallets?.length || 0
  }

  currentParcel = () => {
    return this.connector.currentParcel()
  }

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
    if (GuestBookUi.lastGuestBookId !== this.props.guestBook.uuid) {
      // Guestbook has changed (we clicked on another one) nerf saved names
      GuestBookUi.namesByWallet = {}
      GuestBookUi.lastGuestBookId = this.props.guestBook.uuid
    }

    /**
     * GuestBookUi.namesByWallet is set by WalletBox on name fetch.
     * This is to avoid spamming of name queries on re-open
     */
  }

  onAppChange = () => {
    const { signedIn } = app

    this.setState({ signedIn })
  }

  componentWillUnmount() {
    app.removeListener('change', this.onAppChange)
  }

  async signGuestBook() {
    if (!app.signedIn) {
      return
    }

    if (!this.guestBookFeature) {
      return
    }

    if (this.guestBookFeature?.hasUserSigned) {
      return
    }
    if (this.state.signing) {
      return
    }
    this.setState({ signing: true })

    try {
      const success = await this.guestBookFeature.signGuestBook()

      if (success) {
        app.showSnackbar(`You have signed this parcel's Guestbook`, PanelType.Success)
      }
    } catch (e: any) {
      console.error(e)
      app.showSnackbar(`Error signing guestbook: ${e?.message}`, PanelType.Warning)
    } finally {
      this.setState({
        signing: false,
        wallets: this.guestBookFeature.getVerifiedWallets(),
      })
    }
  }

  cleanBook = () => {
    if (!confirm('Are you sure you want to reset your guest book?')) {
      return
    }
    this.guestBookFeature.clearSignatures()
    this.setState({ wallets: this.guestBookFeature.getVerifiedWallets() })
  }

  render() {
    return (
      <div className="OverlayWindow -auto-height -small-width">
        <header>
          <h3>{this.parcelName}: Guest book</h3>
          <button className="close" onClick={this.props.onClose}>
            &times;
          </button>
        </header>
        <p>
          This guest book currently has {this.walletsCount} {pluralize(this.walletsCount, 'signature')}.
        </p>
        <section className="Panel">
          <div style="align-self: center;margin: 5px;">
            {app.signedIn ? (
              this.hasUserSigned ? (
                <p>You have signed this guest book</p>
              ) : (
                <Fragment>
                  <button onClick={() => this.signGuestBook()}>
                    Sign this guest book <br /> {!!this.guestBookFeature.signChatCommandEnabled && <small>You can sign this Guestbook with the "/sign" command</small>}
                  </button>
                </Fragment>
              )
            ) : (
              <p>Sign-in to sign this guest-book</p>
            )}
          </div>
          <Signers wallets={this.wallets} currentParcel={this.currentParcel} cleanBook={this.cleanBook} scene={this.props.scene} />
        </section>
      </div>
    )
  }
}

export function toggleGuestBookUi(guestBook: GuestBook, scene: Scene) {
  if (GuestBookUi.currentElement) {
    unmountComponentAtNode(GuestBookUi.currentElement)
    GuestBookUi.currentElement = null!
  } else {
    const div = document.createElement('div')
    div.className = 'pointer-lock-close'
    document.body.appendChild(div)
    GuestBookUi.currentElement = div

    const onClose = () => {
      !!GuestBookUi.currentElement && unmountComponentAtNode(GuestBookUi.currentElement)
      GuestBookUi.currentElement = null!
      div.remove()
      requestPointerLockIfNoOverlays()
    }

    render(<GuestBookUi onClose={onClose} guestBook={guestBook} scene={scene} />, div)
    exitPointerLock()
  }
}

function Signers(props: { wallets: string[]; currentParcel: () => Parcel | undefined; cleanBook: () => void; scene: Scene }) {
  const { wallets, currentParcel, cleanBook } = props

  const names = GuestBookUi.namesByWallet

  const parcel = currentParcel()

  const copyToClipBoard = () => {
    console.log(wallets)
    const exportText = wallets.join(',')
    copyTextToClipboard(
      exportText,
      () => {
        app.showSnackbar('Wallets copied !')
      },
      () => {
        app.showSnackbar('Could not copy')
      },
    )
  }

  return (
    <div className="WalletBoxes">
      <div className="ScrollPane">
        <ul className="wallets-lists">
          {wallets &&
            wallets.map((wallet) => {
              return <WalletBox wallet={wallet} username={names[wallet]} scene={props.scene}></WalletBox>
            })}
        </ul>
      </div>
      <OwnerAndCollaboratorOnly parcel={parcel}>
        {!!wallets.length && (
          <div className="Center -no-flex">
            <button onClick={cleanBook} title="Clean the guest book">
              Reset Book
            </button>

            <button onClick={copyToClipBoard} title="Copy all addresses separated by a comma">
              Copy to clipboard
            </button>
          </div>
        )}
      </OwnerAndCollaboratorOnly>
    </div>
  )
}

function WalletBox(props: { wallet: string; username?: string; children?: ComponentChildren; scene: Scene }) {
  const { wallet, username } = props
  const connector = window.connector

  const [name, setName] = useState<string | null>(username || null)

  const getName = async (cachebust = false) => {
    const name = await getAvatarNameFromWallet(wallet, cachebust)
    setName(name)
    GuestBookUi.namesByWallet[wallet] = name
  }

  useEffect(() => {
    if (!name) {
      getName(true)
    }
  }, [wallet])

  const getAvatar = (wallet: string) => {
    if (!connector) {
      return null
    }
    return connector?.findAvatarByWallet(wallet)
  }

  return (
    <li key={wallet} className="wallet-box">
      <div className="wallet-container">
        <div>{name || wallet}</div>
        {!!props.children && props.children}
      </div>
    </li>
  )
}
