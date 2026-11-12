import { Component } from 'preact'

import Head from './components/head'
import WompsList from './womps-list'
import type { Womp } from './tiles/womp-tile'

interface Props {
  womps?: Womp[]
  path?: string
}

export default class WompsPage extends Component<Props> {
  render() {
    return (
      <section>
        <Head title={'Womps'} />

        <header>
          <h1>Womps</h1>
          <p>Select a photo to visit.</p>
        </header>

        <WompsList womps={this.props.womps} hint={'No womps found'} numberToShow={42} collapsed={false} fetch="/womps.json" ttl={600} />
      </section>
    )
  }
}
