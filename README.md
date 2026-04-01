# Retro Voxels

This is the live code to retro.voxels.com. PRs are welcome. Read agents.md for coding
guidelines.

# Getting started

    * Clone repo
    * `brew install postgres@18`
    * `createdb voxels && cat db/import.sql | psql voxels`
    * `pnpm install`
    * `pnpm run dev`
    * Open project on localhost:9000

**Dev Container (Cursor / VS Code):** Reopen the folder in a container. Compose brings up PostgreSQL 18 and runs `pnpm install` plus `db/import.sql` on first create when `properties` is missing. Then `pnpm run dev` (API on port 9000; webpack client 9100, web 9200; multiplayer 3780).

# Infrastructure

Thie app is deployed to digitalocean app platform from `main` at https://retro.voxels.com

# Operations

PRs are reviewed by @bnolan and if merged will be deployed to production.

# License

This project is licensed under the [Business Source License 1.1 (BSL 1.1)](LICENSE). Please read the
license carefully. This is not an OSI compatible license.

### Contributor Agreement

By contributing to this repository, you agree that your contributions (commits) are licensed under this Business Source License 1.1, including the rolling transition to the MIT License three years after the date of your commit.

