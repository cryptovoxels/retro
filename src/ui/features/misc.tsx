import { debounce, isEqual, throttle } from 'lodash'
import { Component } from 'preact'
import { Dispatch, StateUpdater, useEffect, useState } from 'preact/hooks'
import { JSXInternal } from 'preact/src/jsx'
import { CostumeAttachment } from '../../../common/messages/costumes'
import type { AnimationDestination, ButtonRecord, EasingDescription, ImageMode, KeyFrame } from '../../../common/messages/feature'
import { ColorInput } from '../../../web/src/components/ColorInput'
import { axisValues, ScaleInput, ScaleKeyframe } from '../../../web/src/components/editor'
import { VectorField } from '../../../web/src/components/editor/fields/vector-field'
import { Keyframe } from '../../../web/src/components/editor/keyframe'

import { app } from '../../../web/src/state'
import { AvatarAttachmentManager } from '../../attachment-manager'
import type Avatar from '../../avatar'
import CollectibleModel from '../../features/collectible-model'
import Feature from '../../features/feature'
import Group from '../../features/group'
import type Parcel from '../../parcel'
import { bindGizmosToFeature, unbindGizmosFromFeature } from '../../tools/gizmos'
import { round, XYZ } from '../../utils/helpers'
import CreateFeatureAsLibraryAsset from '../create-asset-for-library'
import { degToRad, floatArray, RADIAN_DP, radToDeg, truncate } from './common'
import { useFeatureContext } from './context'

export const LOADING = 'Loading...'
export const NO_PARCEL_FOUND = 'No parcels found.'

export function FeatureID(props: { feature: Feature }) {
  //@todo: Once upgraded to preact 10, use hooks
  const update = throttle(
    (id: string) => {
      props.feature.set({ id })
    },
    100,
    { leading: false, trailing: true },
  )

  return (
    <div className="f">
      <label>Name</label>
      <input value={props.feature.description.id} onInput={(e) => update(e.currentTarget.value)} type="text" />
    </div>
  )
}

export function SetParentDropdown(props: { feature: Feature }) {
  const forbiddenGroups = new Set<Feature>(props.feature.type === 'group' ? (props.feature as Group).descendants() : [])
  const groups = props.feature.parcel.featuresList.filter((group) => {
    // a parent shouldn't become the child of one of its descendants
    // that just plain wont work
    if (props.feature.type === 'group' && forbiddenGroups.has(group)) {
      return false
    }

    return group.type === 'group' && group.uuid !== props.feature.uuid
  })

  if (!groups.length) return null

  const NO_PARENT_NAME = 'No group'
  const getGroupName = (feature: Feature | undefined) => {
    if (!feature) return NO_PARENT_NAME
    const idType = feature.description.id ? 'id' : 'uuid'
    return feature.description[idType]
  }

  const groupsWithName = new Map()
  groups.forEach((group: Feature) => {
    groupsWithName.set(getGroupName(group), group)
  })

  const groupNames = [NO_PARENT_NAME, ...Array.from(groupsWithName.keys())]

  const options = groupNames.map((name: string) => {
    return (
      <option key={name} value={name}>
        {name}
      </option>
    )
  })

  const setParent = (newGroupName: string) => {
    const newGroup = groupsWithName.get(newGroupName)
    const oldGroup = props.feature.group

    if (oldGroup?.uuid === newGroup?.uuid) return // job done

    oldGroup?.abandonChild(props.feature)
    newGroup?.addChild(props.feature)
  }

  return (
    <div className="f">
      <label>{`Add to Group`}</label>
      <select value={getGroupName(props.feature.group)} onInput={(e) => setParent(e.currentTarget.value)}>
        {options}
      </select>
    </div>
  )
}

export function BlendMode(props: { handleStateChange?: (blendMode: string) => void; feature: Feature }) {
  //@todo: Once upgraded to preact 10, use hooks
  const update = (blendMode: string) => {
    if (props.feature.description.blendMode != blendMode) {
      props.feature.set({ blendMode: blendMode as ImageMode })
      if (props.handleStateChange) {
        props.handleStateChange(blendMode)
      } // Opacity on Image Feature needs State Updated directly
    }
  }

  return (
    <div className="f">
      <label>Blend</label>
      <select onInput={(e) => update(e.currentTarget.value)} value={props.feature.description.blendMode}>
        <option value="Multiply">Multiply</option>
        <option value="Combine">Combine</option>
        <option value="Screen">Screen</option>
      </select>
    </div>
  )
}

export function Sound(props: { feature: Feature<ButtonRecord> }) {
  const soundId = props.feature.description.soundId || 0

  const update = (newSoundId: string) => {
    const id = Number(newSoundId)
    if (soundId != id) {
      props.feature.set({ soundId: id })
    }
  }

  const options = [<option value="-1">None</option>]

  for (let i = 0; i < 16; i++) {
    options.push(<option value={i}>Sound {i}</option>)
  }

  return (
    <div className="f">
      <label>Sound</label>
      <select value={soundId} onInput={(e) => update(e.currentTarget.value)}>
        {options}
      </select>
    </div>
  )
}

export type FeatureEditorProps<T extends Feature = Feature> = {
  feature: T
  parcel: Parcel
  scene: BABYLON.Scene
}

export class FeatureEditor<T extends Feature = Feature> extends Component<FeatureEditorProps<T>, any> {
  static openedEditor: FeatureEditor
  throttledSet?: (p: any) => void

  get ui() {
    return window.ui
  }

  get isAddMode() {
    return this.ui?.featureTool.selection.mode === 'add'
  }

  /**
   * Set the state of the currently opened Editor.
   * @param {object} props An object reflecting a state of the editor to change.
   * @returns void
   */
  static setOpenedEditorState(props: Partial<FeatureEditorProps>) {
    if (!FeatureEditor.openedEditor) {
      return
    }
    if (typeof props !== 'object') {
      return
    }
    FeatureEditor.openedEditor.setState(props)
  }

  merge(props: any) {
    Object.keys(props).forEach((key) => {
      if ((this.props.feature.description as any)[key] === props[key]) {
        delete props[key]
      }
    })

    if (!this.throttledSet) {
      this.throttledSet = throttle(
        (p: any) => {
          this.props.feature.set(p)
        },
        100,
        { leading: false, trailing: true },
      )
    }

    this.throttledSet(props)
  }

  componentWillMount() {
    bindGizmosToFeature(this.props.feature)
  }

  componentDidMount() {
    this.props.feature.addEventListener('dragged', this.featureWasDragged.bind(this))
  }

  componentWillUnmount() {
    FeatureEditor.openedEditor = null!
    unbindGizmosFromFeature(this.props.feature)
    this.props.feature.removeEventListener('dragged', this.featureWasDragged.bind(this))
  }

  featureWasDragged() {
    this.forceUpdate()
  }

  onBackClick = () => {
    if (this.props.feature.groupId) {
      this.ui?.editFeature(this.props.feature.group)
    } else {
      this.ui?.closeWithPointerLock()
      this.ui?.featureTool.unHighlight()
    }
  }

  render() {
    return <div />
  }
}

export function Toolbar(props: { feature: Feature; scene: BABYLON.Scene }) {
  if (!props.scene) {
    // some where in the stack the types are not correct, and a scene is not provided
    console.debug(new Error('Toolbar: No scene provided'))
    // but never fear, we can just get it from the feature anyway :)
    props.scene = props.feature.scene
  }

  const ui = window.ui

  const { templateFromFeature } = useFeatureContext()

  const hideEditor = () => {
    ui?.closeWithPointerLock()
  }

  const onClone = () => {
    ui?.copyFeature(props.feature)
    hideEditor()
  }

  const onMove = () => {
    ui?.moveFeature(props.feature)
    hideEditor()
  }

  const onDelete = () => {
    props.feature.delete()
    ui?.deactivateToolsAndUnHighlightSelection()
    hideEditor()
  }

  // Do not allow sharing of single spawn-point and boombox. (cause there is almost nothing to edit)
  const showShareToLibrary = () => {
    const type = props.feature.type
    switch (type) {
      case 'spawn-point':
      case 'boombox':
      case 'guest-book':
        return false
      default:
        return true
    }
  }

  const createLibraryAsset = async () => {
    if (window.ui) {
      unbindGizmosFromFeature(props.feature)
      const engine = props.scene.getEngine()
      window.ui.featureTool?.unHighlight()
      await CreateFeatureAsLibraryAsset.Capture(engine, props.feature.scene, templateFromFeature)
      window.ui.featureTool?.highlight()
      bindGizmosToFeature(props.feature)
    }
  }

  return (
    <div class="editor-toolbar">
      <div class="help">{props.feature.whatIsThis()}</div>
      <ul className="toolbar">
        <li>
          <button class="replicate" onClick={onClone}>
            Duplicate
          </button>
        </li>
        <li>
          <button class="move" onClick={onMove}>
            Move
          </button>
        </li>
        <li>
          <button class="delete" onClick={onDelete}>
            Delete
          </button>
        </li>
        {app.signedIn && showShareToLibrary() && (
          <li>
            <button onClick={createLibraryAsset}>Library</button>
          </li>
        )}
      </ul>
    </div>
  )
}

interface AnimationProps {
  feature: Feature
  scaleAspectRatioAlwaysLocked?: boolean
}

export const Animation = (props: AnimationProps) => {
  const [scaleAspectRatioLocked, setScaleAspectRatioLocked] = useState<boolean>(!!props.scaleAspectRatioAlwaysLocked)
  const animation = props.feature.description.animation || { keyframes: [], destination: undefined, easing: {} }
  // for the sake of typescript and also to avoid sending unnecessary updates:
  if (!animation.destination) {
    animation.destination = undefined
  }

  const [destination, setDestination] = useState<AnimationDestination>(animation.destination)

  const [keyframes, setKeyframes] = useState<KeyFrame[]>(animation.keyframes || [])
  const [easing, setEasing] = useState<EasingDescription>(animation.easing || {})

  useEffect(() => {
    let animationFromProps = props.feature.description.animation
    animationFromProps = {
      destination: animationFromProps?.destination || undefined,
      keyframes: animationFromProps?.keyframes || [],
      easing: animationFromProps?.easing || {},
    }

    const newAnimationSummary = {
      destination,
      keyframes,
      easing,
    }

    if (isEqual(animationFromProps, newAnimationSummary)) return
    props.feature.set({ animation: newAnimationSummary })
  }, [keyframes, destination, easing])

  const setKeyframe = (index: number, value: KeyFrame): void => {
    const nextKeyframes = [...keyframes]
    nextKeyframes[index] = value

    setKeyframes(nextKeyframes)
  }

  const removeKeyframe = (index: number): void => {
    const nextKeyframes = [...keyframes]
    nextKeyframes.splice(index)

    setKeyframes(nextKeyframes)
  }

  const addKeyframe = () => {
    if (!destination) {
      return
    }

    const nextKeyframes = [...keyframes]
    const nextFrame: KeyFrame = { frame: 0, value: [0, 0, 0] }

    // if we have a previous keyframe, will reuse its value and push the next keyframe one sec after
    const previousFrame = nextKeyframes[nextKeyframes.length - 1]
    if (previousFrame) {
      nextFrame.frame = (previousFrame.frame || 0) + 30
      nextFrame.value = previousFrame.value
    }
    nextKeyframes.push(nextFrame)
    setKeyframes(nextKeyframes)
  }

  const destinations = [undefined, 'position', 'scaling', 'rotation'].map((destination) => (
    <option key={destination} value={destination!}>
      {destination}
    </option>
  ))

  const keys = keyframes.map((keyFrame: KeyFrame, i: number) => {
    return destination === 'scaling' ? (
      <ScaleKeyframe destination={destination} setKeyframe={setKeyframe} removeKeyframe={removeKeyframe} key={i} index={i} keyframe={keyFrame} scaleAspectRatioLocked={scaleAspectRatioLocked} featureScaleAxis={props.feature.scaleAxes()} />
    ) : (
      <Keyframe destination={destination} setKeyframe={setKeyframe} removeKeyframe={removeKeyframe} key={i} index={i} keyframe={keyFrame} />
    )
  })

  const toggleScaleAspectRatioLocked = () => setScaleAspectRatioLocked(!scaleAspectRatioLocked)

  const renderLockScaleAspectRatio = () => {
    return props.scaleAspectRatioAlwaysLocked ? (
      <i className={`aspect-ratio-permanent-lock fi-lock`}></i>
    ) : (
      <button className={`lock-aspect-ratio-keyframe`} onClick={toggleScaleAspectRatioLocked} title={`${scaleAspectRatioLocked ? 'Locked' : 'Unlocked'}`}>
        {scaleAspectRatioLocked ? 'Aspect Ratio Locked' : 'Aspect Ratio Unlocked'}
      </button>
    )
  }

  return (
    <div className="f">
      <label>Animation</label>

      <select value={destination as string} onInput={(e) => setDestination(e.currentTarget.value as AnimationDestination)}>
        {destinations}
      </select>
      {destination && (
        <>
          {easingDropdown(easing, setEasing)}

          {destination === 'scaling' && !!keys.length && renderLockScaleAspectRatio()}

          <div className="keyframes">
            <strong>Frame</strong>
            <strong></strong>
            <div style={{ justifySelf: 'center' }}>X</div>
            <div style={{ justifySelf: 'center' }}>Y</div>
            <div style={{ justifySelf: 'center' }}>Z</div>
            <div style={{ justifySelf: 'center' }}>action</div>
            {keys}
          </div>
          <button disabled={!(keyframes.length < 20 && destination)} onClick={() => addKeyframe()}>
            + Add Keyframe
          </button>
        </>
      )}
    </div>
  )
}

interface EasingFunctions {
  [key: string]: EasingFunctionGenerator | VoidFunction
}

type EasingFunctionGenerator = (mode: number) => BABYLON.EasingFunction

export const easingFunctions: EasingFunctions = {
  None: () => {
    // No easing function - returns undefined (no easing applied)
  },
  Bounce: (mode: number) => {
    const easing = new BABYLON.BounceEase()
    easing.setEasingMode(mode)
    return easing
  },
  Back: (mode: number) => {
    const easing = new BABYLON.BackEase()
    easing.setEasingMode(mode)
    return easing
  },
  Circle: (mode: number) => {
    const easing = new BABYLON.CircleEase()
    easing.setEasingMode(mode)
    return easing
  },
  Cubic: (mode: number) => {
    const easing = new BABYLON.CubicEase()
    easing.setEasingMode(mode)
    return easing
  },
  Elastic: (mode: number) => {
    const easing = new BABYLON.ElasticEase()
    easing.setEasingMode(mode)
    return easing
  },
  Exponential: (mode: number) => {
    const easing = new BABYLON.ExponentialEase()
    easing.setEasingMode(mode)
    return easing
  },
  Power: (mode: number) => {
    const easing = new BABYLON.PowerEase()
    easing.setEasingMode(mode)
    return easing
  },
  Quadratic: (mode: number) => {
    const easing = new BABYLON.QuadraticEase()
    easing.setEasingMode(mode)
    return easing
  },
  Quartic: (mode: number) => {
    const easing = new BABYLON.QuarticEase()
    easing.setEasingMode(mode)
    return easing
  },
  Quintic: (mode: number) => {
    const easing = new BABYLON.QuinticEase()
    easing.setEasingMode(mode)
    return easing
  },
  Sine: (mode: number) => {
    const easing = new BABYLON.SineEase()
    easing.setEasingMode(mode)
    return easing
  },
}

interface EasingModes {
  [key: string]: number
}

export const easingModes: EasingModes = {
  'Start + End': BABYLON.EasingFunction.EASINGMODE_EASEINOUT,
  Start: BABYLON.EasingFunction.EASINGMODE_EASEIN,
  End: BABYLON.EasingFunction.EASINGMODE_EASEOUT,
}

export function easingDropdown(easing: EasingDescription, setEasing: Dispatch<StateUpdater<EasingDescription>>) {
  const functionOptions = Object.keys(easingFunctions).map((easingFunction, i) => {
    return (
      <option key={i} value={easingFunction}>
        {easingFunction}
      </option>
    )
  })

  const modeOptions = Object.keys(easingModes).map((easingMode, i) => {
    return (
      <option key={i} value={easingMode}>
        {easingMode}
      </option>
    )
  })

  const set = (part: 'function' | 'mode') => (value: string) => {
    const newEasing = { ...easing }
    newEasing[part] = value
    setEasing(newEasing)
  }

  const easingFunc = easing && 'function' in easing ? easing.function : ''
  const easingMode = easing && 'mode' in easing ? easing.mode : ''

  return (
    <div className="f easingContainer">
      <div className="easingElement">
        <label>{`Easing Function`}</label>
        <select value={easingFunc} onChange={(e) => set('function')(e.currentTarget.value)}>
          {functionOptions}
        </select>
      </div>
      <div className="easingElement">
        <label>{`Mode`}</label>
        <select value={easingMode} onChange={(e) => set('mode')(e.currentTarget.value)}>
          {modeOptions}
        </select>
      </div>
    </div>
  )
}

export function Hyperlink(props: { feature: Feature }) {
  const link = props.feature.description.link
  const update = throttle(
    (newLink: string) => {
      if (link != newLink) {
        props.feature.set({ link: newLink })
      }
    },
    200,
    { leading: false, trailing: true },
  )

  return (
    <div className="f">
      <label>Hyperlink</label>
      <input type="text" value={link || ''} onInput={(e) => update(e.currentTarget.value)} />
    </div>
  )
}

export function CollectibleTryPosition(props: { feature: CollectibleModel }) {
  const tryPosition = props.feature.description.tryPosition
  const [x, setX] = useState<number>(tryPosition ? truncate(tryPosition[0]) : 0)
  const [y, setY] = useState<number>(tryPosition ? truncate(tryPosition[1]) : 0)
  const [z, setZ] = useState<number>(tryPosition ? truncate(tryPosition[2]) : 0)
  const positions = [x, y, z]

  const throttledSet = throttle(
    (position: any) => {
      props.feature.set({ tryPosition: position })
      updateCollectibleBeingTriedOn(props.feature as any)
    },
    100,
    { leading: false, trailing: true },
  )

  useEffect(() => {
    if (isEqual(positions, tryPosition)) return
    const position = floatArray(x, y, z)

    if (position) {
      throttledSet(position)
    }
  }, [x, y, z])

  const step = 0.05
  const [error, setError] = useState<string | undefined>('')

  return (
    <>
      <dt>Try position</dt>
      <dd class="vec3">
        <VectorField title="X" step={step} errorMessage={setError} value={x} setter={setX} />
        <VectorField title="Y" step={step} errorMessage={setError} value={y} setter={setY} />
        <VectorField title="Z" step={step} errorMessage={setError} value={z} setter={setZ} />
      </dd>
    </>
  )
}

export function CollectibleTryRotation(props: { feature: CollectibleModel }) {
  const tryRotation = props.feature.description.tryRotation
  const [x, setX] = useState<number>(tryRotation ? truncate(tryRotation[0]) : 0)
  const [y, setY] = useState<number>(tryRotation ? truncate(tryRotation[1]) : 0)
  const [z, setZ] = useState<number>(tryRotation ? truncate(tryRotation[2]) : 0)
  const rotations = [x, y, z]

  const throttledSet = throttle(
    (tryRot: any) => {
      props.feature.set({ tryRotation: tryRot })
      updateCollectibleBeingTriedOn(props.feature as any)
    },
    100,
    { leading: false, trailing: true },
  )

  useEffect(() => {
    if (isEqual(rotations, tryRotation)) return
    const tryRot = floatArray(x, y, z, RADIAN_DP)

    if (tryRot) {
      throttledSet(tryRot)
    }
  }, [x, y, z])

  const step = 10
  const [error, setError] = useState<string | undefined>('')
  return (
    <>
      <dt>Try rotation</dt>
      <dd class="vec3">
        <VectorField title="X" step={step} errorMessage={setError} value={x} setter={setX} convert={radToDeg} unconvert={degToRad} />
        <VectorField title="Y" step={step} errorMessage={setError} value={y} setter={setY} convert={radToDeg} unconvert={degToRad} />
        <VectorField title="Z" step={step} errorMessage={setError} value={z} setter={setZ} convert={radToDeg} unconvert={degToRad} />
      </dd>
    </>
  )
}

export function CollectibleTryScale(props: { feature: CollectibleModel }) {
  const tryScale = props.feature.description.tryScale
  const [x, setX] = useState<number>(tryScale ? truncate(tryScale[0]) : 0.5)
  const [y, setY] = useState<number>(tryScale ? truncate(tryScale[1]) : 0.5)
  const [z, setZ] = useState<number>(tryScale ? truncate(tryScale[2]) : 0.5)
  const [aspectRatioLocked, setAspectRatioLocked] = useState<boolean>(false)

  const scaleValues = { x, y, z } as axisValues

  const throttledSet = throttle(
    (scale: [number, number, number]) => {
      props.feature.set({ tryScale: scale })
      updateCollectibleBeingTriedOn(props.feature as any)
    },
    100,
    { leading: false, trailing: true },
  )

  useEffect(() => {
    if (isEqual([scaleValues.x, scaleValues.y, scaleValues.z], tryScale)) return
    const scale = floatArray(x, y, z)

    if (scale) {
      throttledSet(scale)
    }
  }, [x, y, z])

  const setScale = (axisChanged: string) => (e: JSXInternal.TargetedEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value
    const parsedValue = parseFloat(value)

    // this only updates the state if the number parses without losing any info
    // to avoid dropping a trailing decimal while it is still being typed (or a negative sign)
    if (parsedValue.toString() !== value.toString()) {
      return
    }

    const axesToUpdate = aspectRatioLocked ? props.feature.scaleAxes() : [axisChanged]

    const newState = axesToUpdate.reduce((accumulator, axis) => {
      if (axis === axisChanged) {
        ;(accumulator as any)[axis] = parsedValue
      } else if ((scaleValues as any)[axisChanged] !== 0) {
        const aspectRatio = (scaleValues as any)[axis] / (scaleValues as any)[axisChanged]
        ;(accumulator as any)[axis] = round(parsedValue * aspectRatio, 6)
      }
      return accumulator
    }, {}) as any

    newState.x && setX(newState.x)
    newState.y && setY(newState.y)
    newState.z && setZ(newState.z)
  }

  const toggleAspectRatioLocked = () => {
    setAspectRatioLocked(!aspectRatioLocked)
  }

  return (
    <>
      <dt>Try scale</dt>
      <dd class="vec3">
        {props.feature.scaleAxes().map((axis: XYZ) => (
          <ScaleInput value={(scaleValues as axisValues)[axis]} axis={axis} setScale={setScale} />
        ))}
        <button className={`lock-aspect-ratio`} onClick={toggleAspectRatioLocked} title={`${aspectRatioLocked ? 'Locked' : 'Unlocked'}`}>
          <i className={aspectRatioLocked ? `fi-lock` : 'fi-unlock'}></i>
        </button>
      </dd>
    </>
  )
}

export function CollectibleTryBone(props: { feature: CollectibleModel; scene: BABYLON.Scene }) {
  if (!window.connector.persona.avatar) {
    return <div className="f"></div>
  }

  if (!window.connector?.persona.avatar?.skeleton) {
    return <div className="f"></div>
  }

  const [skeleton, setSkeleton] = useState<BABYLON.Skeleton>(window.connector?.persona.avatar?.skeleton)

  if (!skeleton) {
    const isSpace = (): boolean => !!document.location.toString()?.match('/spaces')
    const rootURL = isSpace() ? `./models/` : `/models/`
    BABYLON.SceneLoader.ImportMesh(null, rootURL, 'avatar.glb', props.scene, (meshes, particleSystems, skeletons) => {
      setSkeleton(skeletons[0])
    })
  }
  const boneName = (b: any) => b.name.split(/:/)[1]
  const update = (bone: string) => {
    props.feature.set({ tryBone: bone })
    updateCollectibleBeingTriedOn(props.feature as any)
  }

  return (
    <div className="f">
      <label>Bone </label>

      <select value={props.feature.description.tryBone} onChange={(e) => update(e.currentTarget['value'])}>
        {skeleton?.bones.map((b) => (
          <option value={boneName(b)}>{boneName(b)}</option>
        ))}
      </select>
    </div>
  )
}

function updateCollectibleBeingTriedOn(feature: CollectibleModel) {
  const avatar = window.connector.persona.avatar
  const avatars = window.connector.avatars

  avatars?.forEach((a) => {
    refreshFromFeature(feature, a)
  })
  if (avatar) refreshFromFeature(feature, avatar)
}

function refreshFromFeature(feature: CollectibleModel, avatar: Avatar) {
  const asset = feature.description.collectible
  if (!asset || !avatar) {
    return
  }
  const avatarAttachmentManager = avatar.attachmentManager as AvatarAttachmentManager
  if (!avatarAttachmentManager) {
    return
  }
  const wearable = avatarAttachmentManager.getAttachmentByWid(feature.collectibleWid)
  if (!wearable) {
    return
  }

  wearable.position = feature.description.tryPosition || [0, 0, 0]
  wearable.rotation = feature.description.tryRotation || [0, 0, 0]
  wearable.scaling = feature.description.tryScale || [0.5, 0.5, 0.5]
  wearable.bone = feature.description.tryBone || 'Head'
  avatarAttachmentManager.refreshSingleAttachment(wearable.wid)
}

export function Advanced(props: any) {
  const [visible, setVisible] = useState(false)
  return <span class="advanced-block">{props.children}</span>
}

export function SpecularColorSetting(props: { feature: Feature & { description: { specularColor?: [number, number, number] } } }) {
  const update = debounce(
    (value: string) => {
      const rgb: BABYLON.Color3 = BABYLON.Color3.FromHexString(value)

      props.feature.set({ specularColor: rgb.asArray() as [number, number, number] })
    },
    100,
    { leading: false, trailing: true },
  )

  const defaultSpecularColor = [1, 1, 1]

  const color: string = BABYLON.Color3.FromArray(props.feature.description.specularColor || defaultSpecularColor).toHexString()

  return (
    <div className="f">
      <label>Specular color</label>
      <ColorInput onColorSelect={update} color={color} />
    </div>
  )
}
