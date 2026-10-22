# skynet-mcp

Lets Claude (or any MCP client) build in Voxels through your own browser tab.

```
claude  <-stdio->  skynet-mcp  <-ws://127.0.0.1:3791->  play?...&agent=skynet
```

The page registers its tools (`src/skynet/tools.ts`) and dials this bridge.
The bridge lists whatever the page registered and forwards calls. The page
uses its own cookie session, so there are no tokens anywhere. If you can't
edit the parcel in that tab, neither can the agent.

## setup

```sh
cd tools/skynet-mcp && pnpm install --ignore-workspace
```

Claude Code:

```sh
claude mcp add skynet -- node /path/to/retro/tools/skynet-mcp/index.mjs
```

Claude Desktop (`claude_desktop_config.json`), or a project `.mcp.json`:

```json
{
  "mcpServers": {
    "skynet": {
      "command": "node",
      "args": ["/path/to/retro/tools/skynet-mcp/index.mjs"]
    }
  }
}
```

Then open the parcel in a browser logged in as the owner, with `&agent=skynet`:

```
http://localhost:9000/play?coords=292E,701S&agent=skynet
```

The page retries the bridge every 2s, so start them in any order. Point the
agent at `/skynet-agents.md` for the conventions.

## env

- `SKYNET_PORT` - websocket port, default `3791`. The page reads `&bridge=` if you change it.
- `SKYNET_ORIGINS` - comma separated origins allowed to connect, default
  `http://localhost:9000,https://www.voxels.com,https://voxels.com`. Other tabs
  on your machine can't register tools.
