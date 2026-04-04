import { Animations } from './avatar-animations'
import Controls from './controls/controls'
import Persona from './persona'
import { VoxelSize } from '../common/voxels/mesher'
import { Action } from '../common/messages'

export interface Transition {
  // if state is null, it's a sign to the FSM to pop the current running state
  state: CharacterState | null
}

const isNotMoving = (persona: Persona): boolean => !persona.isMoving()
const isMoving = (persona: Persona): boolean => persona.isMoving()

export abstract class CharacterState {
  enter(persona: Persona, controls: Controls) {
    // Base implementation - override in subclasses as needed
  }

  // if an empty [] is returned, it's a signal to the FSM that this state would like to exit
  // and the FSM can pop it from the state stack. It's a bit weird, but we don't have an easy way to do double return
  // values with out adding an object return
  abstract handleControls(persona: Persona, controls: Controls): Transition | void

  update(persona: Persona, controls: Controls) {
    // Base implementation - override in subclasses as needed
  }

  exit(persona: Persona, controls: Controls) {
    // Base implementation - override in subclasses as needed
  }
}

// this is the basic standing still state and should in general always be the 'bottom' state
export class Idle extends CharacterState {
  // default camera mode
  firstPersonView = true

  enter(persona: Persona, controls: Controls) {
    persona.animation = Animations.Idle

    // switch back to first person view if we were in first person before animating
    if (this.firstPersonView) {
      // controls.enterFirstPerson()
    }
  }

  handleControls(persona: Persona, controls: Controls): Transition | void {
    if (controls.flying) {
      return { state: new Flying() }
    }
    if (controls.swimming) {
      return { state: new Swimming() }
    }
    if (isMoving(persona)) {
      return { state: new Moving() }
    }
    if (controls.jumping) {
      return { state: new Jumping() }
    }

    this.firstPersonView = controls.firstPersonView
  }
}

export class Moving extends CharacterState {
  enter(persona: Persona) {
    persona.animation = Animations.Walk
    persona.audio?.footstepSounds?.walk()
  }

  handleControls(persona: Persona, controls: Controls): Transition | void {
    if (isNotMoving(persona) || controls.swimming || controls.flying) {
      return { state: null }
    }
    if (controls.jumping) {
      if (controls.running) {
        return { state: new RunningJumping() }
      } else {
        return { state: new Jumping() }
      }
    }
    if (!controls.isOnGround(VoxelSize)) {
      return { state: new Falling() }
    }
    if (controls.running) {
      return { state: new Running() }
    }
  }

  exit(persona: Persona) {
    persona.audio?.footstepSounds?.noStep()
  }
}

class Running extends Moving {
  enter(persona: Persona) {
    persona.animation = Animations.Run
    persona.audio?.footstepSounds?.running()
  }

  handleControls(persona: Persona, controls: Controls): Transition | void {
    const transition = super.handleControls(persona, controls)
    if (!persona.controls.running) {
      return { state: null }
    }
    if (transition && transition.state instanceof Running) {
      return
    }
    return transition
  }
}

abstract class JumpState extends CharacterState {
  handleControls(persona: Persona, controls: Controls): Transition | void {
    if (controls.isOnGround() || controls.swimming || controls.flying) {
      return { state: null }
    }
  }
}

class RunningJumping extends JumpState {
  enter(persona: Persona, controls: Controls) {
    if ('jump' in controls.camera) {
      controls.camera?.jump()
    }
    persona.animation = Animations.Jump
    persona.audio?.footstepSounds?.noStep()
  }
}

class Jumping extends JumpState {
  enter(persona: Persona, controls: Controls) {
    if ('jump' in controls.camera) {
      controls.camera?.jump()
    }
    persona.animation = Animations.Floating
    persona.audio?.footstepSounds?.noStep()
  }
}

class Falling extends JumpState {
  private fallingDistance = 0

  enter(persona: Persona) {
    persona.animation = Animations.Floating
  }

  update(persona: Persona, controls: Controls) {
    this.fallingDistance += persona.position.y - controls.camera.position.y
  }

  exit(persona: Persona) {
    persona.audio?.footstepSounds?.hitGround(this.fallingDistance)
  }
}

class Flying extends CharacterState {
  enter(persona: Persona) {
    persona.animation = Animations.Floating
  }

  handleControls(persona: Persona, controls: Controls): Transition | void {
    if (!controls.flying) {
      return { state: null }
    }
    if (isMoving(persona)) {
      return { state: new FloatMoving() }
    }
  }
}

class Swimming extends CharacterState {
  enter(persona: Persona) {
    persona.animation = Animations.Floating
  }

  handleControls(persona: Persona, controls: Controls): Transition | void {
    if (!controls.swimming) {
      return { state: null }
    }
    if (isMoving(persona)) {
      return { state: new FloatMoving() }
    }
  }
}

class FloatMoving extends Moving {
  // needed to revert animations correctly when animating underwater or in the sky

  enter(persona: Persona) {
    persona.animation = Animations.Floating
  }

  handleControls(persona: Persona, controls: Controls): Transition | void {
    if ((!controls.swimming && !controls.flying) || !isMoving(persona)) {
      return { state: null }
    }
  }
}

export class EmoteAnimation extends CharacterState {
  private readonly animation: Animations
  private readonly id: string

  constructor(animation: Animations) {
    super()
    this.animation = animation
    this.id = Math.random().toString(36).substring(7)
  }

  enter(persona: Persona, controls: Controls) {
    persona.animation = this.animation
    controls.enterThirdPerson()

    persona.connector.sendMetric(Action.Dance)
  }

  handleControls(persona: Persona, controls: Controls): Transition | void {
    // stay in this emote forever until null animation is set
    if (!this.animation) {
      return { state: null }
    }

    if (isMoving(persona)) {
      if (controls.swimming || controls.flying) {
        return { state: new FloatMoving() }
      } else {
        return { state: new Moving() }
      }
    }

    // stop animation if we switch back to first person
    if (controls.firstPersonView) {
      return { state: null }
    }

    return undefined
  }
}
