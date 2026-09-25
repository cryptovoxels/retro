import makeBlockie from 'ethereum-blockies-base64'

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
      <img width={size} height={size} style={{ width: size, height: size }} src={makeBlockie(props.wallet)} />
    </a>
  )
}

export default AvatarTile
