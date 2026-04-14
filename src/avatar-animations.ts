export enum Animations {
  Idle = 0,
  Walk = 2,
  Dance = 3,
  Run = 4,
  Floating = 5,
  Sitting = 6,
  Spin = 7,
  Savage = 8,
  Kick = 9,
  Uprock = 10,
  Floss = 11,
  Backflip = 12,
  Celebration = 13,
  Orange = 14,
  Hype = 15,
  Shocked = 16,
  Wipe = 17,
  Applause = 18,
  Jump = 19,
  Flyingkick = 20,
  Tpose = 21,
}

export function AnimationYOffset(animation: Animations): number {
  if (animation === Animations.Sitting) {
    return -0.8
  }
  return 0
}

/** Emotes/dances to mirror when following someone in a conga line (not locomotion/base poses). */
export function isCongaSyncedDance(a: Animations): boolean {
  switch (a) {
    case Animations.Dance:
    case Animations.Spin:
    case Animations.Savage:
    case Animations.Kick:
    case Animations.Uprock:
    case Animations.Floss:
    case Animations.Backflip:
    case Animations.Celebration:
    case Animations.Orange:
    case Animations.Hype:
    case Animations.Shocked:
    case Animations.Wipe:
    case Animations.Applause:
    case Animations.Jump:
    case Animations.Flyingkick:
      return true
    default:
      return false
  }
}

export class AvatarAnimations {
  static rootAnimationGroups: BABYLON.AnimationGroup[] = []
  animationGroups: (BABYLON.AnimationGroup | undefined)[] = []
  activeAnimationGroup: BABYLON.AnimationGroup | undefined

  private _state: Animations | null = null

  public get state() {
    return this._state ?? Animations.Idle
  }

  public set state(v: Animations) {
    this._state = v
  }

  public get name() {
    if (this._state === null) {
      return ''
    }
    return Animations[this._state]
  }

  public is(v: Animations): boolean {
    return this._state == v
  }

  public dispose() {
    this.animationGroups.forEach((g) => {
      if (!g) return
      g.stop()
      g.dispose()
    })
  }

  public set(v: Animations): boolean | undefined {
    if (this._state === v) {
      return false
    }
    this.state = v

    if (this.activeAnimationGroup) {
      this.activeAnimationGroup.stop()
    }

    const nextAnimation = this.animationGroups.find((ag) => ag && ag.name === this.name)

    if (!nextAnimation) {
      return
    }
    // if (nextAnimation?.targetedAnimations.length == 0) {
    //   console.warn(`trying to switch to the '${nextAnimation?.name}' animation that has zero (0) animations`)
    // }

    if (nextAnimation === this.activeAnimationGroup) {
      return false
    }

    this.activeAnimationGroup = nextAnimation

    let speedRatio = 1.0
    // @todo this is not a very elegant way of doing it, change to use the velocity in relation to the forward facing
    // direction and that would allow running speed and walking/running backwards. Ideally animation stride length
    // would be another scaling factor
    if (this.state === Animations.Walk) {
      speedRatio = 2.0 // handcrafted number that doesnt look too crap at the moment
    }
    let loop = true

    if (!this.activeAnimationGroup) return
    // These animations are just one-shot (no looping) and need to be slowed down to match amount of time avatar is airborne
    if (['Flyingkick', 'Jump'].includes(this.activeAnimationGroup.name)) {
      loop = false
      speedRatio = 0.4
    }

    this.activeAnimationGroup.start(loop, speedRatio)
  }

  /**
   * Copy a group of animations from the skeleton to the destination Mesh.
   * @param {BABYLON.Mesh} from the from mesh
   * @returns {BABYLON.AnimationGroup[]}
   */
  copy(from: BABYLON.Skeleton) {
    // to avoid a loop-in-a-loop we make a lookup hash for any node having a mixamoring name
    const lookup: Record<string, BABYLON.TransformNode> = {}
    from.bones.forEach((bone) => {
      lookup[bone.name] = bone.getTransformNode()!
    })
    const groups: BABYLON.AnimationGroup[] = []
    AvatarAnimations.rootAnimationGroups.forEach((anim) => {
      //const group = anim.clone(anim.name, (target) => lookup[target.name]) as BABYLON.AnimationGroup
      const group = anim.clone(anim.name)
      if (!group) {
        return
      }
      group.targetedAnimations.forEach((targetedAnimationsKey) => {
        targetedAnimationsKey.animation.blendingSpeed = 0.1
        targetedAnimationsKey.animation.enableBlending = true
        const boneNode = lookup[targetedAnimationsKey.target.name]
        if (!!boneNode) {
          if (boneNode!.id.split('.')[0] == 'Clone of mixamorig:Hips') {
            // If its the hip bone, copy bone rotation and position (everything BUT scaling)
            if (targetedAnimationsKey.animation.targetProperty != 'scaling') {
              targetedAnimationsKey.target = boneNode
            }
          } else {
            // Only copy bone rotation
            if (targetedAnimationsKey.animation.targetProperty == 'rotationQuaternion') {
              targetedAnimationsKey.target = boneNode
            }
          }
        }
      })
      groups.push(group)
    })
    this.animationGroups = groups
  }
}

export async function loadAnimation(scene: BABYLON.Scene): Promise<void> {
  const basicAnimationsPromise = loadBasicAnimations(scene)

  const EXTRA_AVATAR_ANIMATIONS = ['Sitting', 'Spin', 'Savage', 'Kick', 'Uprock', 'Floss', 'Backflip', 'Celebration', 'Orange', 'Hype', 'Shocked', 'Wipe', 'Applause'] as const
  const extraAnimationsPromise = Promise.all(EXTRA_AVATAR_ANIMATIONS.map((name) => loadExtraAnimation(scene, name)))

  const [basicAnimations, extraAnimations] = await Promise.all([basicAnimationsPromise, extraAnimationsPromise])

  AvatarAnimations.rootAnimationGroups = [...basicAnimations, ...extraAnimations]
}

const loadBasicAnimations = (scene: BABYLON.Scene): Promise<ReadonlyArray<BABYLON.AnimationGroup>> => loadAnimations(scene, 'all-actions')

const loadExtraAnimation = async (scene: BABYLON.Scene, name: string): Promise<BABYLON.AnimationGroup> => {
  const animationGroups = await loadAnimations(scene, name)

  const animationGroup = animationGroups[0]
  animationGroup.name = name // e.g. 'Floss'

  return animationGroup
}

const loadAnimations = async (scene: BABYLON.Scene, glbName: string): Promise<ReadonlyArray<BABYLON.AnimationGroup>> => {
  const imported = await BABYLON.SceneLoader.ImportMeshAsync(null, '/animations/', `${glbName.toLowerCase()}.glb`, scene)

  // Discard any meshes - we just want the animations
  imported.meshes.forEach((m) => m.dispose())

  return imported.animationGroups
}
