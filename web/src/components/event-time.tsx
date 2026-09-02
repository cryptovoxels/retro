import ParcelEvent from '../helpers/event'
import { isInPast, isLive } from '../../../common/helpers/time-helpers'
import { pluralize } from '../../../common/helpers/english-helper'
import { Event } from '../../../common/messages/event'
import { Fragment } from 'preact'
import { fetchFromMPServer } from '../../../common/helpers/utils'
import { useEffect, useState } from 'preact/hooks'

type EventTimeProps = {
  event: Event & { players_present?: number }
  showDownloadLink?: boolean
  onClick?: () => void
}

const fetchParticipants = async (id: number) => {
  const r = await fetchFromMPServer<{ users?: any[] }>(`/api/parcels/${id}.json`)
  if (!r) {
    throw new Error(`could not fetch number of participants in parcel ${id}`)
  }
  return r
}

export function EventTime(props: EventTimeProps) {
  const event = new ParcelEvent(props.event)

  const [participants, setParticipants] = useState<number>(0)
  const [live, setLive] = useState<boolean>(isLive(event.starts_at, event.expires_at))

  useEffect(() => {
    setLive(isLive(event.starts_at, event.expires_at))
  }, [props.event])

  useEffect(() => {
    if (!live) return
    fetchParticipants(props.event.parcel_id).then((data) => setParticipants(data?.users?.length ?? 0))
  }, [live])

  let timeClass = 'future'
  if (live) {
    timeClass = 'current'
  } else if (isInPast(event.expires_at)) {
    timeClass = 'past'
  }

  let content
  if (live) {
    const num = participants ?? 0
    content = (
      <Fragment>
        <div>Live</div>
        <div>{num}</div>
        <div>{pluralize(num, 'player')}</div>
      </Fragment>
    )
  } else {
    content = (
      <Fragment>
        <div>{event.toLocale({ month: 'short' })}</div>
        <div>{event.toLocale({ day: 'numeric' })}</div>
        <div>{event.toLocaleTimeString({ hour: 'numeric', minute: 'numeric' })}</div>
      </Fragment>
    )
  }

  let link = null
  if (props.showDownloadLink && !isInPast(event.expires_at)) {
    link = (
      <div>
        <a href={`/api/events/${props.event.id}.ics`} target="_blank">
          Add to calendar
        </a>
      </div>
    )
  }
  if (props.onClick) {
    content = <a onClick={() => props?.onClick?.()}>{content}</a>
  }
  return (
    <div class={`event-time ${timeClass}`}>
      {content}
      {link}
    </div>
  )
}
