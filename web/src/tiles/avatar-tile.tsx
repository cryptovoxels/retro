import { AvatarIcon } from '../components/avatar-link'

interface AvatarTileProps {
  wallet?: string
  size?: number
}

export function AvatarTile(props: AvatarTileProps) {
  const size = props.size || 32
  const link = `/u/${props.wallet}`

  if (!props.wallet) {
    return (
      <span class="tile avatar-tile">
        <img width={size} height={size} style={{ width: size, height: size }} src="/images/no-image.png" />
      </span>
    )
  }

  return (
    <a class="tile avatar-tile" href={link}>
      <AvatarIcon name={props.wallet} />
    </a>
  )
}

export default AvatarTile
