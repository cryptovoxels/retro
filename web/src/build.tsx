import { Component } from 'preact'
import Head from './components/head'
import { WorldAside } from './world-aside'
import SandboxesAside from './sandboxes'

export default class BuildPage extends Component {
  render() {
    return (
      <section class="columns">
        <Head title="Build" description="Learn voxels in a sandbox, then get a parcel in the shop." url="/build" />
        <article>
          <h1>Build</h1>
          <p>pick a sandbox from the list and start practicing.</p>
        </article>
        <WorldAside>
          <SandboxesAside />
        </WorldAside>
      </section>
    )
  }
}
