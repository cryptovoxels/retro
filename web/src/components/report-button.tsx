import { Component, ComponentChildren, render, VNode } from 'preact'
import { unmountComponentAtNode } from 'preact/compat'
import { useEffect, useState } from 'preact/hooks'
import Connector, { messageList } from '../../../src/connector'
import { app } from '../state'
import { PanelType } from './panel'

type ModerationReportType = 'avatar' | 'library-asset' | 'collectible' | 'parcel' | 'womps'

interface Props {
  item: Partial<{ id: number | string; owner: string }>
  type: ModerationReportType
  callback?: Function
}

interface State {
  fetching: boolean
  reported: boolean
  reason: string
  extra?: string
  showFormWindow: boolean
}

export default class ReportButton extends Component<Props, State> {
  static windowElement: HTMLDivElement

  constructor() {
    super()
    this.state = {
      fetching: false,
      reported: false,
      reason: null!,
      extra: null!,
      showFormWindow: false,
    }
  }

  get connector(): Connector {
    return window.connector
  }

  reportItem = async () => {
    if (this.state.fetching) {
      return
    }

    this.setState({ reported: true, fetching: true })

    const chat = messageList.value.slice()

    const body = {
      reported_id: this.props.type == 'avatar' ? this.props.item.owner : this.props.item.id,
      reason: this.state.reason,
      extra: this.state.extra + '\n' + (chat.length ? '\n' + chat : ''),
      type: this.props.type,
    }
    this.hideReportForm()
    const p = await fetch(`${process.env.API}/reports/create`, {
      method: 'post',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const r = await p.json()
    if (!r.success) {
      const message = `[SYSTEM ERROR]`
      app.showSnackbar(r.message || message, PanelType.Danger)
      this.setState({ reported: false })
    } else {
      const message = `Good work citizen`
      app.showSnackbar(message, PanelType.Success)
      this.props.callback && this.props.callback(message)
    }
    this.setState({ fetching: false })
  }

  showReportForm = () => {
    this.hideReportForm()
    const div = document.createElement('div')
    div.className = 'pointer-lock-close'
    document.body.appendChild(div)
    ReportButton.windowElement = div

    render(
      <ReportOptions setState={this.setState.bind(this)} submit={this.reportItem.bind(this)} onClose={this.hideReportForm}>
        {this.props.children}
      </ReportOptions>,
      div,
    )
  }

  hideReportForm = () => {
    if (ReportButton.windowElement) {
      ReportButton.windowElement && unmountComponentAtNode(ReportButton.windowElement)
      ReportButton.windowElement.remove()
      ReportButton.windowElement = null!
    }
  }

  render({}: Props, {}: State) {
    if (!app.signedIn) {
      return null
    }

    return (
      <button
        onClick={() => {
          !this.state.fetching && this.showReportForm()
        }}
        title={'Report this'}
      >
        Report
      </button>
    )
  }
}

function ReportOptions(props: { children: ComponentChildren | VNode[] | string | number | null; setState: (dict: any) => void; onClose: () => void; submit: () => void }) {
  const { children, setState, submit, onClose } = props
  const [reason, setReason] = useState<string>(null!)
  const validateAndSubmit = () => {
    if (reason) {
      submit()
    }
  }

  useEffect(() => {
    if (reason) {
      setState({ reason })
    }
  }, [reason])

  return (
    <div>
      <header>
        <h3>
          Report
          <button onClick={onClose}>&times;</button>
        </h3>
      </header>

      <section>
        <div>
          <label for="report_reason">Reason for report</label>
        </div>
        <div>
          <select id="report_reason" onChange={(e) => setReason(e.currentTarget.value)}>
            <option value={null!}></option>
            {children}
          </select>
        </div>
        <div>
          <label for="report_optional">Extra information</label>
        </div>
        <div>
          <textarea id="report_optional" cols={60} rows={5} placeholder="optional" onInput={(e) => setState({ extra: e.currentTarget.value })} />
        </div>
        <div>
          <button
            disabled={!reason}
            onClick={() => {
              validateAndSubmit()
            }}
          >
            Report
          </button>
        </div>
      </section>
    </div>
  )
}
