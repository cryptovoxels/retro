import type { AvatarRef } from '../../../common/messages/avatar-ref'
import { AvatarLink } from './avatar-link'
import { NftLink, type NftRef } from './nft-link'

export type WompMetadataData = {
  avatars?: { avatar: AvatarRef; x?: number; y?: number }[]
  art?: (NftRef & { x?: number; y?: number })[]
}

export function WompMetadata({ metadata }: { metadata?: WompMetadataData | null }) {
  if (!metadata) return null
  const avatars = metadata.avatars ?? []
  const art = metadata.art ?? []
  if (!avatars.length && !art.length) return null

  return (
    <ul>
      {avatars.map((a, i) => (
        <li key={`a${i}`}>
          <AvatarLink avatar={a.avatar} />
        </li>
      ))}
      {art.map((a, i) => (
        <li key={`n${i}`}>
          <NftLink nft={{ name: a.name, src: a.src }} />
        </li>
      ))}
    </ul>
  )
}
