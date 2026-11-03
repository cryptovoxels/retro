# Retro Voxels

This is the live code to retro.voxels.com. PRs are welcome. Read agents.md for coding
guidelines.

# Getting started

See [install.md](install.md) for Codespaces and local setup.

# Infrastructure

This app deploys to Digital Ocean App Platform from `main` at https://retro.voxels.com.
Deploy pre-job runs `npm run predeploy` (migrate).

# Client releases

esbuild builds the browser client. The server serves HTML and a small loader;
compiled client files live in `https://versions.voxels.com/<version>/`:
`client.js`, `monoworker.js`, `voxel-thumb.js`, `app.css`, `babylon.js`, fonts,
and `release.json` (version, git commit, build date).

Settings > client chooses Latest or pins a release in this browser. Switching
reloads the page. All files come from the selected directory. The server/API
is still the current deployment, so keep API compatibility with retained clients.

After committing and checking a release:

```sh
git tag v1.10.0
git push origin v1.10.0
```

The tag workflow publishes using a key scoped to `voxels-versions` in syd1.
It uploads all files before updating `releases.json`. Stable semver releases advance
Latest in semver order; prereleases are selectable without becoming Latest.
Named tags such as `4-nov-26` become Latest when published.
Published directories cannot be overwritten. Keep old releases for pinned
clients and rollback. Local publishing from a clean tagged checkout:

```sh
AWS_PROFILE=do-spaces pnpm client:publish 1.10.0
```

Publish the first stable release **before deploying the new server loader**.
The provisioned bucket starts with an empty release index. Publishing a tag
from the release branch before merging lets the old server keep serving clients
until the new loader is ready. Do not use build numbers or runtime git tags to
choose browser filenames anymore.

`pnpm build` checks all builds without uploading. `pnpm client:check` builds two
test versions and checks latest/pinned loading, CSS, Babylon, both cross-origin
workers, and load-failure recovery in Chromium. These test versions stay local.
Dev still uses `pnpm dev` and the esbuild watcher on port 9200.

A private `.publish-lock` serializes publishers. If a publisher is killed, verify
that no publish is running before deleting that lock with the S3 API. A partial
version is never listed; use a new tag rather than overwriting its files.

# Operations

PRs are reviewed by @bnolan and if merged will be deployed to production.

# License

This project is licensed under the [Business Source License 1.1 (BSL 1.1)](LICENSE). Please read the
license carefully. This is not an OSI compatible license.

### Contributor Agreement

By contributing to this repository, you agree that your contributions (commits) are licensed under this Business Source License 1.1, including the rolling transition to the MIT License three years after the date of your commit.
