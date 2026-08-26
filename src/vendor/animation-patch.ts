(undefined as any /* todo(lite): BABYLON.Scene.prototype['_animationTimeLast'] = 0 */);
(undefined as any /* todo(lite): BABYLON.Scene.prototype['_animate'] = function(): void {
  if (!this.animationsEnabled) {
    return
  }

  // Getting time
  let now = Date.now()
  const windowObjectExists = ((typeof window) !== 'undefined')
  if (windowObjectExists && window.performance && window.performance.now) {
    now = window.performance.now()
  }

  if (!this._animationTimeLast) {
    if (this._pendingData.length > 0) {
      return
    }
    this._animationTimeLast = now
  }

  this.deltaTime = this.useConstantAnimationDeltaTime ? 16.0 : (now - this._animationTimeLast) * this.animationTimeScale
  this._animationTimeLast = now

  const animatables = this._activeAnimatables
  if (animatables.length === 0) {
    return
  }

  this._animationTime += this.deltaTime
  const animationTime = this._animationTime

  for (let index = 0; index < animatables.length; index++) {
    const animatable = animatables[index]

    if (!animatable._animate(animationTime) && animatable.disposeOnEnd) {
      index-- // Array was updated
    }
  }

  // Late animation bindings
  this._processLateAnimationBindings()
} */)
  