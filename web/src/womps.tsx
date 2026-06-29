import { Component } from 'preact'

import Head from './components/head'
import WompsList from './womps-list'
import { isSplit } from './helpers/coords-nav'

interface Props {
  path?: string
}

export default class WompsPage extends Component<Props> {
  render() {
    if (isSplit()) {
      return (
        <section class="sidebar-view">
          <WompsList hint={'No womps found'} numberToShow={42} collapsed={true} fetch="/womps.json" ttl={600} />
        </section>
      )
    }

    return (
      <section>
        <Head title={'Womps'} />

        <WompsList hint={'No womps found'} numberToShow={42} collapsed={false} fetch="/womps.json" ttl={600} />
      </section>
    )
  }
}
