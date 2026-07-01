import { WompRecord } from '../../../common/messages/feature'
import { app } from '../../../web/src/state'
import { fetchOptions } from '../../../web/src/utils'
import Portal from '../../features/portal'
import { updateHighlight } from './common'
import { UrlSourceComponent, UrlSourceComponentProps, UrlSourceComponentState, WompsTab } from './urlSourceComponent'

type UrlSourcePortalWompProps = UrlSourceComponentProps & {
  feature: Portal
  handleStateChange?: (url?: string, womp?: WompRecord) => void
}
type UrlSourcePortalWompState = UrlSourceComponentState & {
  womps: WompRecord[]
  womp?: WompRecord
  loading: boolean
}

export class UrlSourcePortalWomp extends UrlSourceComponent<UrlSourcePortalWompProps, UrlSourcePortalWompState> {
  constructor(props: UrlSourcePortalWompProps) {
    super(props)
    this.state = {
      ...this.initialUrlSourceComponentState,
      womps: [],
      loading: false,
    }
  }

  componentDidMount() {
    this.fetchWomps()
  }

  componentDidUpdate(prevProps: UrlSourcePortalWompProps, prevState: UrlSourcePortalWompState) {
    if (this.state.url == prevState.url && this.state.womp == prevState.womp) {
      return
    }
    if (this.state.url) {
      this.props.feature.set({ url: this.state.url, womp: this.state.womp })
      updateHighlight()
    }
    if (this.props.handleStateChange) this.props.handleStateChange(this.state.url, this.state.womp)
  }

  fetchWomps() {
    this.setState({ loading: true, womps: [] })
    fetch(`${process.env.API}/womps/by/${app.state.wallet}`, fetchOptions())
      .then((r) => r.json())
      .then((r) => {
        if (!r.success) throw new Error('failed fetching womps')
        this.setState({ loading: false, womps: r.womps || [] })
      })
      .catch(console.error)
  }

  returnWomp(womp: WompRecord) {
    this.setState({ womp, url: womp.image_url })
  }

  render() {
    return (
      <>
        <dd class="full">
          <div class="button-tabs">
            <button class="active">Womps</button>
          </div>
        </dd>

        <WompsTab urlTab={'womps'} returnWomp={this.returnWomp.bind(this)} onRefresh={this.fetchWomps.bind(this)} loading={this.state.loading} womps={this.state.womps} />
      </>
    )
  }
}
