import { Component } from 'preact'
import MailboxUI from './components/mailbox/mailbox-ui'

export interface Props {
  to?: string
  path?: string
}

export interface State {
  to?: string
}

export default class Mailbox extends Component<Props, State> {
  render() {
    return (
      <section class="columns">
        <article>
          <h1>Mailbox</h1>
          <MailboxUI addressTo={this.props.to ?? null} />
        </article>
      </section>
    )
  }
}
