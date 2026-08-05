import { Fragment } from 'preact'
import ParcelHelper from '../../../../common/helpers/parcel-helper'
import { ParcelRecord } from '../../../../common/messages/parcel'
import { AvatarLink } from '../avatar-link'

interface ParcelDetailsProps {
  parcel: ParcelRecord & { traffic_visits?: number } // special case
}

export function ParcelDetails(props: ParcelDetailsProps) {
  const p = props.parcel.height ? props.parcel : Object.assign(props.parcel, { height: props.parcel.y2 })
  const helper = new ParcelHelper(p)
  const attributes = []

  if (props.parcel.y1 < 0) {
    attributes.push('Basement')
  }

  if (helper.isWaterFront) {
    attributes.push('Waterfront')
  }

  if (props.parcel.kind == 'inner') {
    attributes.push('Prebuilt')
  }

  return (
    <dl>
      <dt>Address</dt>
      <dd>
        {props.parcel.address}
        <br />
        {props.parcel.suburb != props.parcel.island ? (
          <span>
            {props.parcel.suburb}
            <br />
          </span>
        ) : (
          ''
        )}
        <span>{props.parcel.island}</span>
      </dd>
      <dt>Token ID</dt>
      <dd>
        <a href={helper.tokenUri}>#{props.parcel.id}</a>
      </dd>
      {props.parcel.traffic_visits && <dt>Traffic</dt>}
      {props.parcel.traffic_visits && <dd>{props.parcel.traffic_visits} Visits</dd>}
      <dt>Owner</dt>
      <dd>
        <AvatarLink avatar={props.parcel.owner} />
      </dd>
      <dt>Size</dt>
      <dd>
        {`${helper.width}m`} wide &times; {`${helper.depth}m`} deep &times; {`${helper.height}m`} tall.
      </dd>
      {props.parcel.y1 > 0 && (
        <Fragment>
          <dt>Elevation</dt>
          <dd>{props.parcel.y1}m.</dd>
        </Fragment>
      )}
      {attributes.length > 0 && (
        <Fragment>
          <dt>Attributes</dt>
          <dd>{attributes.join(', ')}</dd>
        </Fragment>
      )}
    </dl>
  )
}
