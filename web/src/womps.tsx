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

        <WompsList hint={'No womps found'} numberToShow={42} collapsed={false} fetch="/womps.json" ttl={600} />
      </section>
    )
  }
}
