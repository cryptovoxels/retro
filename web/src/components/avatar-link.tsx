import { AvatarRef, avatarName, avatarSlug } from '../../../common/messages/avatar-ref'

export const AvatarLink = ({ avatar }: { avatar: AvatarRef | null | undefined }) => {
  if (!avatar) return null
  return <a href={`/u/${avatarSlug(avatar)}`}>{avatarName(avatar)}</a>
}

export const AvatarIcon = ({ name }: { name: string }) => (
  <span class="avatar-initials" aria-hidden="true">
    {(name.trim().replace(/^0x/i, '') || 'anon').slice(0, 2).toLowerCase()}
  </span>
)
