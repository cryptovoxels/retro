import { Component } from 'preact'

import Head from './components/head'
import WompsList from './womps-list'

interface Props {
  path?: string
}

export default class WompsPage extends Component<Props> {
  render() {
    return (
      <section>
        <Head title={'Womps'} />

        <header>
          <h1>Womps</h1>
          <p>Recent snapshots from around the world. Click one to teleport.</p>
        </header>

        <WompsList hint={'No womps found'} numberToShow={42} collapsed={false} fetch="/womps.json" ttl={600} />
      </section>
    )
  }
}
