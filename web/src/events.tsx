import { useEffect, useState } from 'preact/hooks'

import { Event } from '../../common/messages/event'
import Head from './components/head'
import { AvatarLink } from './components/avatar-link'
import { useListControls } from './components/list-controls'
import { fmt } from './components/date-field'
import { truncate } from './lib/string-utils'
import { Spinner } from './spinner'
import cachedFetch from './helpers/cached-fetch'
import { fetchOptions } from './utils'

export interface Props {
  path?: string
}

function TimeCard({ date }: { date: Date }) {
  const day = date.toLocaleDateString('en-US', { day: 'numeric' })
  const month = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).split(' ')[0]

  return (
    <div class="timecard">
      <b>{day}</b>
      <br />
      <sub>{month}</sub>
    </div>
  )
}

export default function Events(props: Props) {
  const [events, setEvents] = useState<Event[]>([])
  const [loaded, setLoaded] = useState(false)
  const [controls, controlsEl] = useListControls()

  async function doFetch() {
    setLoaded(false)
    // todo: verify events API supports sort param
    const r = await cachedFetch(`/api/events.json?sort=${controls.sort}`, fetchOptions()).then((r) => r.json())
    if (!r) {
      setLoaded(true)
      return
    }
    setEvents(r.events)
    setLoaded(true)
  }

  useEffect(() => {
    doFetch()
  }, [controls.sort])

  return (
    <section class="columns">
      <article>
        {controlsEl}
        <table class="events">
          <thead>
            <tr>
              <th scope="col" style="width: 10%"></th>
              <th scope="col" style="width: 60%">
                Name
              </th>
              <th scope="col" style="width: 20%">
                Location
              </th>
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr>
                <td colSpan={4}>
                  <Spinner />
                </td>
              </tr>
            ) : (
              events.slice(0, 10).map((event) => {
                const time = fmt(event.starts_at as any)

                return (
                  <>
                    <tr>
                      <td width="120">
                        <TimeCard date={new Date(event.starts_at)} />
                      </td>
                      <td>
                        <a href={`/events/${event.id}`}>{truncate(event.name)}</a>

                        {' by '}
                        <AvatarLink avatar={event.author} />
                        <br />
                        <small>{truncate(event.description, 80)}</small>
                      </td>
                      <td>
                        {time}, {event.parcel_name}
                      </td>
                    </tr>
                  </>
                )
              })
            )}
          </tbody>
        </table>
      </article>
      <aside>
        <a href="/events/new">New event</a>
      </aside>
    </section>
  )
}
