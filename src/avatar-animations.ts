export enum Animations {
  Idle = 0,
  Wave = 1,
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
    case Animations.Wave:
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

/** Mixamo short bone name (lowercase, after strip) -> VRM 1.0 humanoid bone name. */
const MIXAMO_TO_HUMANOID: Record<string, string> = {
  hips: 'hips',
  spine: 'spine',
  spine1: 'chest',
  spine2: 'upperChest',
  neck: 'neck',
  head: 'head',
  leftshoulder: 'leftShoulder',
  leftarm: 'leftUpperArm',
  leftforearm: 'leftLowerArm',
  lefthand: 'leftHand',
  rightshoulder: 'rightShoulder',
  rightarm: 'rightUpperArm',
  rightforearm: 'rightLowerArm',
  righthand: 'rightHand',
  leftupleg: 'leftUpperLeg',
  leftleg: 'leftLowerLeg',
  leftfoot: 'leftFoot',
  lefttoebase: 'leftToes',
  rightupleg: 'rightUpperLeg',
  rightleg: 'rightLowerLeg',
  rightfoot: 'rightFoot',
  righttoebase: 'rightToes',
  lefthandthumb1: 'leftThumbMetacarpal',
  lefthandthumb2: 'leftThumbProximal',
  lefthandthumb3: 'leftThumbDistal',
  lefthandindex1: 'leftIndexProximal',
  lefthandindex2: 'leftIndexIntermediate',
  lefthandindex3: 'leftIndexDistal',
  lefthandmiddle1: 'leftMiddleProximal',
  lefthandmiddle2: 'leftMiddleIntermediate',
  lefthandmiddle3: 'leftMiddleDistal',
  lefthandring1: 'leftRingProximal',
  lefthandring2: 'leftRingIntermediate',
  lefthandring3: 'leftRingDistal',
  lefthandpinky1: 'leftLittleProximal',
  lefthandpinky2: 'leftLittleIntermediate',
  lefthandpinky3: 'leftLittleDistal',
  righthandthumb1: 'rightThumbMetacarpal',
  righthandthumb2: 'rightThumbProximal',
  righthandthumb3: 'rightThumbDistal',
  righthandindex1: 'rightIndexProximal',
  righthandindex2: 'rightIndexIntermediate',
  righthandindex3: 'rightIndexDistal',
  righthandmiddle1: 'rightMiddleProximal',
  righthandmiddle2: 'rightMiddleIntermediate',
  righthandmiddle3: 'rightMiddleDistal',
  righthandring1: 'rightRingProximal',
  righthandring2: 'rightRingIntermediate',
  righthandring3: 'rightRingDistal',
  righthandpinky1: 'rightLittleProximal',
  righthandpinky2: 'rightLittleIntermediate',
  righthandpinky3: 'rightLittleDistal',
}

type WoodyRest = {
  world: BABYLON.Quaternion
  parentWorld: BABYLON.Quaternion
}

export class AvatarAnimations {
  static rootAnimationGroups: BABYLON.AnimationGroup[] = []
  static woodyRest: Record<string, WoodyRest> | null = null
  static woodyHipsHeight = 1
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
      speedRatio = 1.0 // handcrafted number that doesnt look too crap at the moment
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
    AvatarAnimations.cacheWoodyRest(from)
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
          if (boneNode!.id.split('.')[0] == 'Clone of hips') {
            // wave.glb is Mixamo Z-up: hips ~90deg on X and y~0. Skip those tracks or you wave on your back.
            if (anim.name === 'Wave') return
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

  /** Cache Woody bind-pose world quats for Mixamo->VRM retarget. */
  static cacheWoodyRest(skeleton: BABYLON.Skeleton) {
    if (AvatarAnimations.woodyRest) return
    skeleton.computeAbsoluteTransforms()
    const rest: Record<string, WoodyRest> = {}
    for (const bone of skeleton.bones) {
      const abs = bone.getAbsoluteTransform()
      const world = new BABYLON.Quaternion()
      abs.decompose(undefined, world)
      let parentWorld = BABYLON.Quaternion.Identity()
      const parent = bone.getParent()
      if (parent) {
        parent.getAbsoluteTransform().decompose(undefined, parentWorld)
      }
      rest[bone.name.toLowerCase()] = { world, parentWorld }
    }
    const hips = skeleton.bones.find((b) => b.name.toLowerCase() === 'hips')
    if (hips) AvatarAnimations.woodyHipsHeight = Math.max(0.1, hips.getAbsolutePosition().y)
    AvatarAnimations.woodyRest = rest
  }

  /**
   * Bind Mixamo animation clips onto a VRM skeleton via humanoid bone map.
   * Rotation keys are rest-pose corrected; hips position is scaled by height ratio.
   * Call cacheWoodyRest on a Woody skeleton first.
   */
  retargetVrm(from: BABYLON.Skeleton, humanoid: Record<string, string>, vrmHipsHeight: number) {
    const woodyRest = AvatarAnimations.woodyRest
    if (!woodyRest) {
      console.error('woody rest pose not cached; cannot retarget VRM')
      return
    }

    const byName: Record<string, BABYLON.TransformNode> = {}
    from.bones.forEach((bone) => {
      const tn = bone.getTransformNode()
      if (tn) byName[bone.name] = tn
    })

    const hipsScale = vrmHipsHeight / AvatarAnimations.woodyHipsHeight
    const groups: BABYLON.AnimationGroup[] = []

    AvatarAnimations.rootAnimationGroups.forEach((anim) => {
      const group = anim.clone(anim.name)
      if (!group) return

      group.targetedAnimations.forEach((ta) => {
        ta.animation.blendingSpeed = 0.1
        ta.animation.enableBlending = true

        const mixamoName = ta.target.name.toLowerCase()
        const humanoidName = MIXAMO_TO_HUMANOID[mixamoName]
        if (!humanoidName) return
        const vrmNodeName = humanoid[humanoidName]
        if (!vrmNodeName) return
        const boneNode = byName[vrmNodeName]
        if (!boneNode) return

        const prop = ta.animation.targetProperty
        if (mixamoName === 'hips') {
          if (anim.name === 'Wave') return
          if (prop === 'scaling') return
          if (prop === 'position') {
            const keys = ta.animation.getKeys()
            for (const key of keys) {
              const v = key.value as BABYLON.Vector3
              key.value = new BABYLON.Vector3(v.x * hipsScale, v.y * hipsScale, v.z * hipsScale)
            }
            ta.target = boneNode
            return
          }
          if (prop === 'rotationQuaternion') {
            // fall through to rest correction
          } else {
            return
          }
        } else if (prop !== 'rotationQuaternion') {
          return
        }

        const rest = woodyRest[mixamoName]
        if (rest && prop === 'rotationQuaternion') {
          const invRest = rest.world.clone()
          invRest.invert()
          const keys = ta.animation.getKeys()
          for (const key of keys) {
            const q = key.value as BABYLON.Quaternion
            key.value = rest.parentWorld.clone().multiply(q).multiply(invRest)
          }
        }
        ta.target = boneNode
      })
      groups.push(group)
    })
    this.animationGroups = groups
  }
}

export async function loadAnimation(scene: BABYLON.Scene): Promise<void> {
  const basicAnimationsPromise = loadBasicAnimations(scene)

  const EXTRA_AVATAR_ANIMATIONS = ['Wave', 'Sitting', 'Spin', 'Savage', 'Kick', 'Uprock', 'Floss', 'Backflip', 'Celebration', 'Orange', 'Hype', 'Shocked', 'Wipe', 'Applause'] as const
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
