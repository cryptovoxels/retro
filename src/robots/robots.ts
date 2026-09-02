type WalkNode = {
  position: BABYLON.Vector3
  rotation: BABYLON.Quaternion
}

class Robot {
  private parent: BABYLON.TransformNode
  private path: WalkNode[] = []

  constructor(
    private scene: BABYLON.Scene,
    loader: BABYLON.ISceneLoaderAsyncResult,
  ) {
    this.parent = new BABYLON.TransformNode('robot', this.scene)
    // Random size
    // const s = Math.random() + 0.5
    // const t = Math.random() * 0.2 + 0.9

    // Add to scene
    for (const mesh of loader.meshes) {
      // mesh.scaling = new BABYLON.Vector3(s, s, t)
      mesh.position.set(0, 0, 0)
      // mesh.position.y += 1
      mesh.setParent(this.parent)
      this.scene.addMesh(mesh)
    }

    // Add animation
    const group = loader.animationGroups[0]
    // const animation = group.animation.animation.animations[0]

    // Play animation
    group.play(true)

    const position = new BABYLON.Vector3(0, 1, 0)
    const rotation = BABYLON.Quaternion.FromEulerAngles(0, Math.PI / 4, 0)

    this.parent.position = position
    this.parent.rotationQuaternion = rotation
    this.addNode({ position, rotation })
    // this.pathfind()
    // this.walk()

    console.log('Robot created')
    console.log(this.parent)
    console.log(this.parent.getChildMeshes())
  }

  private addNode(node: WalkNode) {
    console.log('Adding node', node.position.asArray(), node.rotation.asArray())
    this.path.push(node)
  }

  private get tail() {
    return this.path[this.path.length - 1]!
  }

  pathfind() {
    for (let i = 0; i < 10; i++) {
      if (!this.tail) {
        return
      }

      const source = this.tail.position

      // Cardinal directions
      const i = Math.floor(Math.random() * 4.0)
      const rotation = BABYLON.Quaternion.FromEulerAngles(0, (Math.PI / 2) * i, 0)

      // Walk 5m in a random direction
      const d = new BABYLON.Vector3(0, 0, 5).applyRotationQuaternion(rotation)
      const position = source.clone().add(d)

      this.addNode({ position, rotation })
    }

    // Remove the head node
    this.path.shift()
  }

  walk() {
    const node = this.path.shift()

    if (!node) {
      return false
    }

    // At 100fps
    const duration = 500

    const animation = new BABYLON.Animation('walk', 'position', 100, BABYLON.Animation.ANIMATIONTYPE_VECTOR3)
    animation.setKeys([
      {
        frame: 0,
        value: this.parent.position.clone(),
      },
      {
        frame: duration,
        value: node.position,
      },
    ])

    console.log(animation)

    this.parent.animations = [animation]
    this.parent.rotationQuaternion = node.rotation
    this.scene.beginAnimation(this.parent, 0, duration, false, 1, this.onComplete)

    return true
  }

  die() {
    console.log('Robot died')
    this.parent.dispose()
  }

  onComplete = () => {
    console.log('Animation complete')

    if (!this.walk()) {
      this.die()
    }
  }
}

export default class Robots {
  private scene: BABYLON.Scene
  disabled = true
  import: BABYLON.ISceneLoaderAsyncResult | null = null
  robots: Robot[] = []

  constructor(scene: BABYLON.Scene) {
    this.scene = scene
  }

  async spawn() {
    this.disabled = false
    await this.start()
    this.addRobot()
  }

  async start() {
    if (this.disabled) {
      return
    }

    if (!this.import) {
      // Import GLTF
      this.import = await BABYLON.SceneLoader.ImportMeshAsync(null, '/models/animations/standard-walk.glb', undefined, this.scene)
    }
  }

  private addRobot() {
    if (!this.import) {
      return
    }

    const robot = new Robot(this.scene, this.import)
    this.robots.push(robot)

    robot.pathfind()
    robot.walk()
    // Add to scene
    // this.scene.addMesh(robot)
  }
}
