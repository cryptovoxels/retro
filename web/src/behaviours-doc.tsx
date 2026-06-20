import { Component } from 'preact'
import { readFileSync } from 'fs'
import { join } from 'path'
import { micromark } from 'micromark'
import Head from './components/head'

let html = ''
try {
  const md = readFileSync(join(process.cwd(), 'BEHAVIOURS.md'), 'utf8')
  html = micromark(md)
} catch (err) {
  html = '<p>Behaviours documentation is missing.</p>'
}

export default class BehavioursDoc extends Component<any, any> {
  render() {
    return (
      <section>
        <Head title={'Behaviours'} />
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </section>
    )
  }
}
