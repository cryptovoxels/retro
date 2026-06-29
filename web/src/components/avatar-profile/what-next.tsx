import { ApiAvatar } from '../../../../common/messages/api-avatars'
import { SimpleSpaceRecord } from '../../../../common/messages/space'
import { Costume } from '../../../../common/types'
import EditAccountForm from './edit-account-form'

type Props = {
  avatar?: ApiAvatar
  costumes: Costume[]
  spaces: SimpleSpaceRecord[]
  onSaved?: (avatar: ApiAvatar) => void
}

export default function WhatNext(props: Props) {
  const needsName = !props.avatar?.name
  const steps: { label: string; href: string }[] = []

  if (props.costumes.length === 0) {
    steps.push({ label: 'create a costume', href: '/costumer' })
  }
  if (props.spaces.length === 0) {
    steps.push({ label: 'build your apartment', href: '/spaces/new' })
  }

  if (!needsName && steps.length === 0) return null

  if (steps.length > 0 || needsName) {
    steps.push({ label: 'join someone in world', href: '/' })
  }

  return (
    <>
      <p>welcome to voxels. awesome to have you. this is your home screen — here's how to set up camp.</p>
      <p>what next</p>
      <ol>
        {needsName && (
          <li>
            make your avatar
            <EditAccountForm onSaved={props.onSaved} />
          </li>
        )}
        {steps.map((s) => (
          <li key={s.href}>
            <a href={s.href}>{s.label}</a>
          </li>
        ))}
      </ol>
    </>
  )
}
