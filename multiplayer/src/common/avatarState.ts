export type AvatarState =
  | AvatarState.BeforeLogin
  | AvatarState.AfterLogin
  | AvatarState.AfterFirstUpdate
  | AvatarState.AfterLeave

export namespace AvatarState {
  export type BeforeLogin = {
    type: AvatarStateType.beforeLogin
    payload: AvatarStateFacets.Empty
  }

  export type AfterLogin = {
    type: AvatarStateType.afterLogin
    payload: AvatarStateFacets.AfterLogin
  }

  export type AfterFirstUpdate = {
    type: AvatarStateType.afterFirstUpdate
    payload: AvatarStateFacets.AfterLogin & AvatarStateFacets.AfterFirstUpdate
  }

  export type AfterLeave = {
    type: AvatarStateType.afterLeave
    payload: AvatarStateFacets.Empty
  }
}

export const enum AvatarStateType {
  beforeLogin = 0,
  afterLogin = 1,
  afterCreated = 2,
  afterFirstUpdate = 3,
  afterLeave = 4,
}

export namespace AvatarStateFacets {
  export type Empty = {}

  export type AfterLogin = {
    identity: {
      name: string
      wallet?: string
    }
  }

  export type AfterFirstUpdate = {
    position: [number, number, number]
    orientation: [number, number, number, number]
    animation: number
    lastMoved: number
    inConga?: boolean
  }
}
