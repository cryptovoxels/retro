import { Costume } from '../../../../common/types'
import { SimpleSpaceRecord } from '../../../../common/messages/space'

type Props = {
  costumes: Costume[]
  spaces: SimpleSpaceRecord[]
}

export default function WhatNext(props: Props) {
  const steps: { label: string; href: string }[] = []

  if (props.costumes.length === 0) {
    steps.push({ label: 'create a costume', href: '/costumer' })
  }
  if (props.spaces.length === 0) {
    steps.push({ label: 'build your apartment', href: '/spaces/new' })
  }
  if (steps.length === 0) return null

  steps.push({ label: 'join someone in world', href: '/' })

  return (
    <>
      <p>what next</p>
      <ol>
        {steps.map((s) => (
          <li key={s.href}>
            <a href={s.href}>{s.label}</a>
          </li>
        ))}
      </ol>
    </>
  )
}
