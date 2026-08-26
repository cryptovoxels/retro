import { Component } from 'preact'
import type Connector from '../connector'
import type Grid from '../grid'
import { isLocal } from '../../common/helpers/detector'
import { ConnectionState } from '../utils/socket-client'
import { SceneContext } from '@babylonjs/lite'
interface Props {
  grid: Grid
  connector: Connector
  scene: SceneContext
}

interface State {
  grid: ConnectionState
  multiplayer: ConnectionState
  userStatus: ConnectionStatus
}

export default class ConnectionStatusUI extends Component<Props, State> {
  constructor(props: Props) {
    super(props)

    this.state = {
      grid: props.grid.connectionState,
      multiplayer: props.connector.connectionState,
      userStatus: 'gridAndMultiplayerOk',
    }
  }

  componentDidMount() {
    this.props.grid.onConnectionStateChanged.add(this.onGridConnectionStateChange)
    this.props.connector.onConnectionStateChanged.add(this.onMultiplayerConnectionStateChange)
  }

  componentWillUnmount() {
    this.props.grid.onConnectionStateChanged.removeCallback(this.onGridConnectionStateChange)
    this.props.connector.onConnectionStateChanged.removeCallback(this.onMultiplayerConnectionStateChange)
  }

  render() {
    return <ConnectionStatusPresentational connectionStatus={this.state.userStatus} />
  }

  private onGridConnectionStateChange = (state: ConnectionState) => {
    this.setState((prev) => {
      return {
        grid: state,
        userStatus: this.connectionStatus(state, prev.multiplayer),
      }
    })
  }

  private onMultiplayerConnectionStateChange = (state: ConnectionState) => {
    if (!isLocal()) {
      // We disabled the notification system for the multiplayer server after players confused it with the grid server going down
      state = { status: 'connected' }
    }

    this.setState((prev) => {
      return {
        multiplayer: state,
        userStatus: this.connectionStatus(prev.grid, state),
      }
    })
  }

  private connectionStatus(gridConnectionState: ConnectionState, multiplayerConnectionState: ConnectionState): ConnectionStatus {
    return inferConnectionStatus(gridConnectionState, multiplayerConnectionState)
  }
}

type ConnectionStatusPresentationalProps = {
  connectionStatus: ConnectionStatus
}

function ConnectionStatusPresentational({ connectionStatus }: ConnectionStatusPresentationalProps) {
  const connectionStatusRecipe = RECIPE_BY_STATUS[connectionStatus]

  const { connectionStatusReduced, message, title } = connectionStatusRecipe

  return <div className={`ConnectionStatus -${connectionStatusReduced}`} title={`${title}\n\n${message}`}></div>
}

type ConnectionStatus =
  | 'gridAndMultiplayerOk'
  | 'gridDisconnectedGeneric'
  | 'multiplayerDisconnectedGeneric'
  | 'multiplayerDisconnectedSpaceAtCapacity'
  | 'multiplayerDisconnectedWorldAtCapacity'
  | 'gridAndMultiplayerDisconnectedGeneric'
  | 'gridReconnecting'
  | 'multiplayerReconnecting'
  | 'gridAndMultiplayerReconnecting'

type ConnectionStatusRecipe = {
  connectionStatusReduced: 'connected' | 'disconnected' | 'reconnecting'
  title: string
  message: string
}

const RECIPE_BY_STATUS: { [S in ConnectionStatus]: ConnectionStatusRecipe } = {
  gridAndMultiplayerOk: {
    connectionStatusReduced: 'connected',
    title: 'Connection re-established',
    message: 'Everything is online. Your changes will be saved as normal.',
  },

  gridAndMultiplayerDisconnectedGeneric: {
    connectionStatusReduced: 'disconnected',
    title: 'Connection to servers lost',
    message: "Any changes will not be saved, parts of the world may not load, and you won't see any nearby players. Try reloading the page or check your internet connection.",
  },

  gridAndMultiplayerReconnecting: {
    connectionStatusReduced: 'reconnecting',
    title: 'Reconnecting to servers...',
    message: 'If the problem persists, please check your internet connection.',
  },

  gridDisconnectedGeneric: {
    connectionStatusReduced: 'disconnected',
    title: 'Connection to the Grid is lost',
    message: "We can't connect you to the world at the moment. Try reloading the page or check your internet connection.",
  },

  gridReconnecting: {
    connectionStatusReduced: 'reconnecting',
    title: 'Reconnecting to the Grid',
    message: 'One moment. Changes may not be saved for a minute, and parts of the world may not load.',
  },

  multiplayerDisconnectedGeneric: {
    connectionStatusReduced: 'disconnected',
    title: 'Connection to nearby players lost',
    message: "We can't connect you to your friends at the moment.",
  },

  multiplayerDisconnectedSpaceAtCapacity: {
    connectionStatusReduced: 'disconnected',
    title: 'Space at capacity',
    message: "This space has reached its capacity. You're still able to interact with the space, but from a ghostly parallel universe where no other players exist.",
  },

  multiplayerDisconnectedWorldAtCapacity: {
    connectionStatusReduced: 'disconnected',
    title: 'Oh no the party is overflowing!',
    message: "Sorry we are full! You're still able to interact, but from a ghostly parallel universe where no other players exist.",
  },

  multiplayerReconnecting: {
    connectionStatusReduced: 'reconnecting',
    title: 'Reconnecting to nearby players',
    message: "One moment. Reconnecting you to your friends. For now you'll walk the world as a nomad.",
  },
}

function inferConnectionStatus(grid: ConnectionState, multiplayer: ConnectionState): ConnectionStatus {
  if (grid.status === 'disconnected' && multiplayer.status === 'disconnected') {
    return 'gridAndMultiplayerDisconnectedGeneric'
  } else if (grid.status === 'disconnected') {
    return 'gridDisconnectedGeneric'
  } else if (multiplayer.status === 'disconnected') {
    if (multiplayer.lastCloseCode === 4001) {
      return 'multiplayerDisconnectedWorldAtCapacity'
    } else {
      return 'multiplayerDisconnectedGeneric'
    }
  } else if (grid.status === 'reconnecting' && multiplayer.status === 'reconnecting') {
    return 'gridAndMultiplayerReconnecting'
  } else if (grid.status === 'reconnecting') {
    return 'gridReconnecting'
  } else if (multiplayer.status === 'reconnecting') {
    return 'multiplayerReconnecting'
  } else {
    return 'gridAndMultiplayerOk'
  }
}
