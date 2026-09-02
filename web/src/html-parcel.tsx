import { SingleParcelRecord } from '../../common/messages/parcel'

const trunc = (x: any) => {
  return x.length > 45 ? x.slice(0, 45) + '...' : x
}

function Description(props: any) {
  if (!props.feature) {
    return null
  }
  if (props.feature.type === 'image') {
    return (
      <li>
        Image <a href={props.feature.url}>{trunc(props.feature.url)}</a>
      </li>
    )
  }
  if (props.feature.type === 'vox-model') {
    return (
      <li>
        Vox model: <a href={props.feature.url}>{trunc(props.feature.url)}</a>
      </li>
    )
  }
  if (props.feature.type === 'nft-image') {
    if (!props.feature.url) {
      return null
    }
    return (
      <li>
        NFT:{' '}
        <a href={props.feature.url} target="_blank">
          {trunc(props.feature.url)}
        </a>
      </li>
    )
  }
  if (props.feature.type === 'sign') {
    return (
      <li>
        Sign:{' '}
        <a href={props.feature.url} target="_blank">
          {props.feature.text}
        </a>
      </li>
    )
  }
  if (props.feature.type === 'richtext') {
    return (
      <li>
        Richtext: <span>{props.feature.text}</span>
      </li>
    )
  }
  if (props.feature.type === 'polytext' || props.feature.type === 'polytext-v2') {
    return <li>Polytext: {props.feature.text}</li>
  }

  if (props.feature.type === 'audio') {
    return (
      <li>
        Audio:{' '}
        <a href={props.feature.url} target="_blank">
          {trunc(props.feature.url)}
        </a>
      </li>
    )
  }
  return null
}

export default function (props: { parcel: SingleParcelRecord }) {
  // @ts-expect-error there is no type for the content part in the parcel record
  const features = props.parcel.content?.features?.map((f) => <Description key={f.uuid} feature={f} />)
  return <ul>{features}</ul>
}
