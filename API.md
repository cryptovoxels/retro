# Voxels public read API

The public Voxels API. Most of this is unauthenticated GET.

Write routes for collection create / deploy / mint writeback are documented here. Sign-in, admin, moderation, livekit, radio, metrics, guest passes and the internal /grid/* routes are deliberately not described.

Most handlers answer with an envelope: `{"success": true, "<field>": ...}`, where `<field>` is plural for a list and singular for one record. A failed lookup answers `{"success": false}`, usually with status 400 and sometimes with 200, so check the flag rather than the status.

Base url is `https://www.voxels.com`. Most routes are unauthenticated GETs; write routes need a session.

Generated from `server/openapi.yaml` by `npm run docs:api`. Edit the spec, not this page.

## what is in here

- [parcels](#parcels), 20 routes
- [womps](#womps), 6 routes
- [avatars](#avatars), 13 routes
- [collectibles](#collectibles), 3 routes
- [collections](#collections), 9 routes
- [wearables](#wearables), 8 routes
- [islands](#islands), 3 routes
- [spaces](#spaces), 2 routes
- [events](#events), 6 routes
- [search](#search), 1 route
- [ghosts](#ghosts), 1 route
- [chat](#chat), 1 route
- [schemas](#schemas), 23 shapes

## parcels

- [`GET /api/parcels.json`](#get-apiparcelsjson) List parcels, or fetch a batch by id
- [`GET /api/parcels/cached.json`](#get-apiparcelscachedjson) Every visible parcel
- [`GET /api/parcels/summary.json`](#get-apiparcelssummaryjson) id, address, island and name for every visible parcel
- [`GET /api/parcels/xyz.json`](#get-apiparcelsxyzjson) Bounds and geometry only, for every parcel
- [`GET /api/parcels/map.json`](#get-apiparcelsmapjson) The map layer's parcel list
- [`GET /api/parcels/search.json`](#get-apiparcelssearchjson) Search minted, non-common parcels
- [`GET /api/parcels/favorites.json`](#get-apiparcelsfavoritesjson) Parcels somebody has favorited
- [`GET /api/parcels/{id}.json`](#get-apiparcelsidjson) One parcel with its build
- [`GET /api/parcels/{id}.vox`](#get-apiparcelsidvox) The parcel's build as a MagicaVoxel file
- [`GET /api/parcels/{id}.png`](#get-apiparcelsidpng) Redirect to the parcel preview renderer
- [`GET /api/parcels/{id}/query`](#get-apiparcelsidquery) Re-read the parcel's owner from the contract, then return it
- [`GET /api/parcels/by/{wallet}/query`](#get-apiparcelsbywalletquery) Re-read every parcel a wallet owns
- [`GET /api/parcels/{id}/history.json`](#get-apiparcelsidhistoryjson) Saved versions of a parcel, newest first
- [`GET /api/parcels/{id}/history-count.json`](#get-apiparcelsidhistory-countjson) How many versions a parcel has
- [`GET /api/parcels/{id}/history/{version}.json`](#get-apiparcelsidhistoryversionjson) One saved version of a parcel
- [`GET /api/parcels/{id}/snapshots.json`](#get-apiparcelsidsnapshotsjson) Versions the owner marked as snapshots
- [`GET /api/suburbs/{suburb_id}/popular.json`](#get-apisuburbssuburb_idpopularjson) The busiest parcels in a suburb
- [`GET /api/wallet/{address}/parcels.json`](#get-apiwalletaddressparcelsjson) Parcels a wallet owns
- [`GET /api/wallet/{address}/contributing-parcels.json`](#get-apiwalletaddresscontributing-parcelsjson) Parcels a wallet can build on but does not own
- [`GET /api/sandboxes.json`](#get-apisandboxesjson) All sandbox parcels for learning to build

### GET /api/parcels.json

List parcels, or fetch a batch by id

Without `parcel_ids` this lists minted parcels and each row carries `parcel_users`, `owner`, `suburb` and `hash`. With `parcel_ids` it runs a different query whose rows are narrower (no owner avatar, no suburb, no hash) and whose `y2` is the height, not the top of the box. Ids that are not integers are dropped rather than rejected.

**parameters**

- `parcel_ids` (query) array of integer: Repeat once per parcel id.
- `limit` (query) integer: Only read when `parcel_ids` is absent.

**answers**

- `200` object
  - `success` boolean
  - `parcels` array of [`ParcelSummary`](#parcelsummary)

### GET /api/parcels/cached.json

Every visible parcel

The whole visible world in one document, cached hard. `owner` here is a lowercased wallet string, not the avatar object the other parcel routes return.

**answers**

- `200` object
  - `success` boolean
  - `parcels` array of [`CachedParcel`](#cachedparcel)

### GET /api/parcels/summary.json

id, address, island and name for every visible parcel

**answers**

- `200` object
  - `success` boolean
  - `parcels` array of object
    - `id` integer
    - `address` string or null
    - `island` string
    - `name` string or null

### GET /api/parcels/xyz.json

Bounds and geometry only, for every parcel

Includes unminted and invisible parcels. `y2` is the height, not the top of the box.

**answers**

- `200` object
  - `success` boolean
  - `parcels` array of object
    - `id` integer
    - `height` number
    - `geometry` [`ParcelGeometry`](#parcelgeometry)
    - `x1` number
    - `x2` number
    - `y1` number
    - `y2` number
    - `z1` number
    - `z2` number

### GET /api/parcels/map.json

The map layer's parcel list

**answers**

- `200` object
  - `success` boolean
  - `parcels` array of object

### GET /api/parcels/search.json

Search minted, non-common parcels

`q` matches address, island, parcel name, owner wallet or owner avatar name. A bare wallet or a bare integer take their own code paths. Each row carries `pagination_count`, the total the filter matched.

**parameters**

- `q` (query, required) string: Missing `q` is a 400.
- `limit` (query) integer: Capped at 50.
- `page` (query) integer: Zero-based, multiplied by `limit` for the offset.
- `sort` (query) string, one of `id`, `name`, `height`, `island`, `distance`, defaults to `id`: Anything else falls back to `id` descending.
- `asc` (query) string: The string `true` flips the order.

**answers**

- `200` object
  - `success` boolean
  - `parcels` array of [`ParcelSummary`](#parcelsummary) plus object
    - everything in [`ParcelSummary`](#parcelsummary)
    - `pagination_count` integer or string: Total rows the filter matched, before limit.
- `400` The lookup did not land. Some handlers send this with status 200.

### GET /api/parcels/favorites.json

Parcels somebody has favorited

`q` matches the wallet that favorited the parcel, not the parcel itself. Empty `q` matches every wallet, so the default answer is every favorited parcel. The rows come from a join against `favorites` with no grouping, so a parcel favorited by several wallets appears once per favorite.

**parameters**

- `q` (query) string: Favoriting wallet, matched with `like`. Empty matches all.
- `limit` (query) integer: No cap. Missing means no limit.
- `page` (query) integer: Zero-based, multiplied by `limit` for the offset.
- `sort` (query) string, one of `id`, `name`, `height`, `island`, `suburb`, `distance`, defaults to `id`: Anything else falls back to `id` descending.
- `asc` (query) string: The string `true` flips the order.

**answers**

- `200` object
  - `success` boolean
  - `parcels` array of [`ParcelSummary`](#parcelsummary)

### GET /api/parcels/{id}.json

One parcel with its build

The only parcel route that returns `content`, which holds the voxels, the palette, the tileset and every feature on the plot. A non-numeric id is a 400. A parcel that is neither minted nor visible is a 400 as well.

**parameters**

- `id` (path, required) integer

**answers**

- `200` object
  - `success` boolean
  - `parcel` [`Parcel`](#parcel)
- `400` The lookup did not land. Some handlers send this with status 200.

### GET /api/parcels/{id}.vox

The parcel's build as a MagicaVoxel file

**parameters**

- `id` (path, required) integer

**answers**

- `200` `application/octet-stream`, bytes
- `404` The lookup did not land. Some handlers send this with status 200.

### GET /api/parcels/{id}.png

Redirect to the parcel preview renderer

302 to `/renderer/v1/parcel/{id}.png`, which renders on demand then redirects to the CDN thumb when UGC storage is configured.

**parameters**

- `id` (path, required) integer

**answers**

- `302` Redirect to the png preview
- `404` The lookup did not land. Some handlers send this with status 200.

### GET /api/parcels/{id}/query

Re-read the parcel's owner from the contract, then return it

A read with a side effect: it asks the contract who owns the parcel and writes the answer back before answering. The `parcel` it returns is the model object, not the `/api/parcels/{id}.json` shape.

**parameters**

- `id` (path, required) integer

**answers**

- `200` object
  - `success` boolean
  - `parcel` object
- `404` The lookup did not land. Some handlers send this with status 200.

### GET /api/parcels/by/{wallet}/query

Re-read every parcel a wallet owns

Reads the subgraph for every parcel the wallet owns, then re-queries the contract for each one as a just-to-make-sure step. Answers `{"success": false}` when the subgraph is unreachable or returns nothing, on the theory that an owner seeing no parcels is worse than an owner seeing a stale list.

**parameters**

- `wallet` (path, required) string

**answers**

- `404` The lookup did not land. Some handlers send this with status 200.

### GET /api/parcels/{id}/history.json

Saved versions of a parcel, newest first

**parameters**

- `id` (path, required) integer
- `limit` (query) integer
- `page` (query) integer
- `asc` (query) string: The string `true` flips the order.
- `start_date` (query) integer
- `end_date` (query) integer

**answers**

- `200` object
  - `success` boolean
  - `versions` array of object

### GET /api/parcels/{id}/history-count.json

How many versions a parcel has

**parameters**

- `id` (path, required) integer

**answers**

- `200` object
  - `success` boolean
  - `info` object

### GET /api/parcels/{id}/history/{version}.json

One saved version of a parcel

**parameters**

- `id` (path, required) integer
- `version` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `version` object

### GET /api/parcels/{id}/snapshots.json

Versions the owner marked as snapshots

**parameters**

- `id` (path, required) integer
- `autosave` (query) string: The string `include` folds autosaves in.

**answers**

- `200` object
  - `success` boolean
  - `snapshots` array of object

### GET /api/suburbs/{suburb_id}/popular.json

The busiest parcels in a suburb

**parameters**

- `suburb_id` (path, required) integer
- `days` (query) integer: Window in days, 7 when absent or unparseable.

**answers**

- `200` object
  - `success` boolean
  - `parcels` array of object

### GET /api/wallet/{address}/parcels.json

Parcels a wallet owns

**parameters**

- `address` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `parcels` array of object

### GET /api/wallet/{address}/contributing-parcels.json

Parcels a wallet can build on but does not own

**parameters**

- `address` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `parcels` array of object

### GET /api/sandboxes.json

All sandbox parcels for learning to build

Parcels with properties.sandbox = true. Used by /build.

**answers**

- `200` object
  - `success` boolean
  - `sandboxes` array of object

## womps

- [`GET /api/womps.json`](#get-apiwompsjson) The newest womps across the world
- [`GET /api/womps/{id}.json`](#get-apiwompsidjson) One womp
- [`GET /api/womps/{id}.jpg`](#get-apiwompsidjpg) The photograph itself, when it lives in the database
- [`GET /api/womps/at/parcel/{parcelId}.json`](#get-apiwompsatparcelparcelidjson) Womps taken on one parcel
- [`GET /api/womps/at/space/{spaceId}.json`](#get-apiwompsatspacespaceidjson) Womps taken in one space
- [`GET /api/womps/by/{wallet}`](#get-apiwompsbywallet) Womps one citizen took

### GET /api/womps.json

The newest womps across the world

A womp is a photograph somebody took in world. The feed carries the `public` and `broadcast` kinds; `profile` womps, which their author kept off the public feed, and `report` womps are not listed here.

**parameters**

- `limit` (query) integer, defaults to `50`
- `kind` (query) string, one of `broadcast`: The only accepted value is `broadcast`, which narrows the feed to broadcasts. Anything else is ignored and you get both kinds.

**answers**

- `200` object
  - `success` boolean
  - `womps` array of [`Womp`](#womp)
- `404` The lookup did not land. Some handlers send this with status 200.

### GET /api/womps/{id}.json

One womp

**parameters**

- `id` (path, required) integer

**answers**

- `200` object
  - `success` boolean
  - `womp` [`Womp`](#womp)
- `404` The lookup did not land. Some handlers send this with status 200.

### GET /api/womps/{id}.jpg

The photograph itself, when it lives in the database

Only womps whose bytes were uploaded to Voxels answer here. The rest are hosted elsewhere and only have `image_url`; `image_supplied` on the womp record tells you which is which.

**parameters**

- `id` (path, required) integer

**answers**

- `200` `image/jpeg`, bytes
- `404` The lookup did not land. Some handlers send this with status 200.

### GET /api/womps/at/parcel/{parcelId}.json

Womps taken on one parcel

Reports are filtered out.

**parameters**

- `parcelId` (path, required) integer
- `limit` (query) integer, defaults to `50`

**answers**

- `200` object
  - `success` boolean
  - `womps` array of [`Womp`](#womp)
- `404` The lookup did not land. Some handlers send this with status 200.

### GET /api/womps/at/space/{spaceId}.json

Womps taken in one space

**parameters**

- `spaceId` (path, required) string, a uuid
- `limit` (query) integer, defaults to `50`

**answers**

- `200` object
  - `success` boolean
  - `womps` array of [`Womp`](#womp)
- `404` The lookup did not land. Some handlers send this with status 200.

### GET /api/womps/by/{wallet}

Womps one citizen took

Matches `womps.author` exactly, so the wallet has to be cased the way it was stored. Reports are filtered out.

**parameters**

- `wallet` (path, required) string
- `limit` (query) integer, defaults to `50`

**answers**

- `200` object
  - `success` boolean
  - `womps` array of [`Womp`](#womp)
- `404` The lookup did not land. Some handlers send this with status 200.

## avatars

- [`GET /api/avatars/{wallet}.json`](#get-apiavatarswalletjson) One citizen by wallet
- [`GET /api/avatars/by/{nameOrWallet}.json`](#get-apiavatarsbynameorwalletjson) One citizen by name or wallet
- [`GET /api/avatars/search`](#get-apiavatarssearch) Name or wallet substring match, ten at most
- [`GET /api/avatars/{wallet}/assets`](#get-apiavatarswalletassets) Wearables this wallet can wear or authored
- [`GET /api/avatars/{wallet}/wearables`](#get-apiavatarswalletwearables) The collectibles in this citizen's current costume
- [`GET /api/avatars/{wallet}/costume.json`](#get-apiavatarswalletcostumejson) The costume this citizen is wearing
- [`GET /api/avatars/{wallet}/costumes`](#get-apiavatarswalletcostumes) Every costume this citizen has saved
- [`GET /api/avatars/{wallet}/score.json`](#get-apiavatarswalletscorejson) This citizen's scores
- [`GET /api/costumes/{id}`](#get-apicostumesid) One costume by id
- [`GET /api/avatar/{wallet}/name.json`](#get-apiavatarwalletnamejson) This citizen's display name
- [`GET /api/avatar/{wallet}/names`](#get-apiavatarwalletnames) Every name this wallet holds
- [`GET /api/names/exists/{name}`](#get-apinamesexistsname) Whether a name is taken
- [`GET /api/avatar/owns/{chain_identifier}/{contract}/{token_id}`](#get-apiavatarownschain_identifiercontracttoken_id) Whether a wallet holds a token

### GET /api/avatars/{wallet}.json

One citizen by wallet

**parameters**

- `wallet` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `avatar` [`Avatar`](#avatar)
- `400` The lookup did not land. Some handlers send this with status 200.

### GET /api/avatars/by/{nameOrWallet}.json

One citizen by name or wallet

Both comparisons are case-insensitive.

**parameters**

- `nameOrWallet` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `avatar` [`Avatar`](#avatar)
- `400` The lookup did not land. Some handlers send this with status 200.

### GET /api/avatars/search

Name or wallet substring match, ten at most

The odd one out: it answers with a bare array, no envelope, and an empty `q` gives `[]`.

**parameters**

- `q` (query) string

**answers**

- `200` array of object
  - `name` string or null
  - `wallet` string

### GET /api/avatars/{wallet}/assets

Wearables this wallet can wear or authored

Merge of (1) Alchemy holdings on known collection contracts, (2) `is_free` wearables, (3) wearables this wallet authored including unminted drafts. Dedupe by collection_id + token_id (drafts by uuid).

**parameters**

- `wallet` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `assets` array of [`Wearable`](#wearable)

### GET /api/avatars/{wallet}/wearables

The collectibles in this citizen's current costume

One row per costume attachment, joined to the wearable its wid names. An attachment whose wearable has no token_id is dropped, so this can return fewer rows than the costume has attachments.

**parameters**

- `wallet` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `wearables` array of object
    - `wearable_id` integer: The token id, not the uuid, whatever the name suggests. The uuid is `wid`.
    - `wid` string, a uuid: The wearable, which is the wid the attachment carried. Pair a row back to its attachment on this rather than on `bone`, since two attachments can share a bone.
    - `collection_id` integer
    - `issues` integer or null: The edition size.
    - `name` string or null
    - `bone` string or null: The bone the piece hangs off.
    - `collection_name` string or null
    - `chain_id` integer or null
    - `collection_address` string or null

### GET /api/avatars/{wallet}/costume.json

The costume this citizen is wearing

**parameters**

- `wallet` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `costume` [`Costume`](#costume)

### GET /api/avatars/{wallet}/costumes

Every costume this citizen has saved

**parameters**

- `wallet` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `costumes` array of [`Costume`](#costume)

### GET /api/avatars/{wallet}/score.json

This citizen's scores

**parameters**

- `wallet` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `scores` array of object

### GET /api/costumes/{id}

One costume by id

Answers `{"success": true, "costume": null}` for an id that does not exist rather than a 404.

**parameters**

- `id` (path, required) string, a uuid

**answers**

- `200` object
  - `success` boolean
  - `costume` [`Costume`](#costume)

### GET /api/avatar/{wallet}/name.json

This citizen's display name

**parameters**

- `wallet` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `name` object

### GET /api/avatar/{wallet}/names

Every name this wallet holds

No `success` on the happy path, just `name` and `names`.

**parameters**

- `wallet` (path, required) string

**answers**

- `200` object
  - `name` string or null
  - `names` array of string
- `400` The lookup did not land. Some handlers send this with status 200.

### GET /api/names/exists/{name}

Whether a name is taken

**parameters**

- `name` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `exists` boolean

### GET /api/avatar/owns/{chain_identifier}/{contract}/{token_id}

Whether a wallet holds a token

Rate limited to five calls per thirty seconds per client, because it costs a chain read. A missing or malformed `wallet` answers 200 with `{"success": false}`, not a 400.

**parameters**

- `chain_identifier` (path, required) string, one of `eth`, `matic`
- `contract` (path, required) string
- `token_id` (path, required) string
- `wallet` (query, required) string

**answers**

- `200` object
  - `success` boolean
  - `ownsToken` boolean
- `400` The lookup did not land. Some handlers send this with status 200.
- `429` Too many requests

## collectibles

- [`GET /api/collectibles.json`](#get-apicollectiblesjson) Search minted collectibles
- [`GET /api/collectibles/{uuid}/vox`](#get-apicollectiblesuuidvox) A collectible's MagicaVoxel model
- [`GET /api/collectibles/wearable/{uuid}.json`](#get-apicollectibleswearableuuidjson) One wearable by uuid

### GET /api/collectibles.json

Search minted collectibles

Forty rows a page, fixed in the query. There is no `limit` parameter.

**parameters**

- `q` (query) string
- `page` (query) integer: One-based, and one is subtracted before the query sees it.
- `sort` (query) string, defaults to `updated_at`
- `asc` (query) string: The string `true` flips the order.

**answers**

- `200` object
  - `success` boolean
  - `collectibles` array of [`Collectible`](#collectible)

### GET /api/collectibles/{uuid}/vox

A collectible's MagicaVoxel model

The geometry behind the wid on an avatar attachment, which is all an attachment carries besides its bone and transform. For what the piece is called, who made it and which collection it belongs to, put the same wid through `/api/collectibles/wearable/{uuid}.json`.

**parameters**

- `uuid` (path, required) string, a uuid

**answers**

- `200` `application/octet-stream`, bytes
- `404` The lookup did not land. Some handlers send this with status 200.

### GET /api/collectibles/wearable/{uuid}.json

One wearable by uuid

**parameters**

- `uuid` (path, required) string, a uuid

**answers**

- `200` object
  - `success` boolean
  - `wearable` [`Wearable`](#wearable)
- `400` The lookup did not land. Some handlers send this with status 200.

## collections

- [`GET /api/helper/typeOfContract/{chain_identifier}/{contract}`](#get-apihelpertypeofcontractchain_identifiercontract) Whether a contract is ERC721 or ERC1155
- [`GET /api/collections`](#get-apicollections) Wearable collections
- [`POST /api/collections`](#post-apicollections) Create a collection (parcel owners only)
- [`GET /api/collections/{id}`](#get-apicollectionsid) One collection
- [`PUT /api/collections/{id}`](#put-apicollectionsid) Edit collection name and description
- [`POST /api/collections/{id}/deployed`](#post-apicollectionsiddeployed) Stamp the on-chain contract address after MetaMask deploy
- [`GET /api/collections/{id}/collectibles`](#get-apicollectionsidcollectibles) Everything in a collection
- [`GET /api/collections/{collection_id}/collectibles/{token_id}`](#get-apicollectionscollection_idcollectiblestoken_id) One collectible by collection id and token id
- [`GET /api/collections/{chain_identifier}/{collection_address}/c/{token_id}.json`](#get-apicollectionschain_identifiercollection_addressctoken_idjson) One collectible by chain, contract and token id

### GET /api/helper/typeOfContract/{chain_identifier}/{contract}

Whether a contract is ERC721 or ERC1155

**parameters**

- `chain_identifier` (path, required) string, one of `eth`, `matic`
- `contract` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `type` string or null
- `400` The lookup did not land. Some handlers send this with status 200.

### GET /api/collections

Wearable collections

**parameters**

- `q` (query) string: Substring match on the collection name.
- `sort` (query) string, one of `popular`, `newest`, `oldest`, defaults to `popular`
- `limit` (query) integer, defaults to `15`
- `page` (query) integer, defaults to `0`: Zero-based.
- `owner` (query) string: Exact match, so the wallet has to be cased as stored.

**answers**

- `200` object
  - `success` boolean
  - `collections` array of [`Collection`](#collection)

### POST /api/collections

Create a collection (parcel owners only)

JWT required. Caller must own a minted parcel. Creates an undeployed Polygon ERC1155 collection row (`chainid` 137, `address` null).

**body**

- `application/json` object
  - `name` string
  - `description` string

**answers**

- `200` object
  - `success` boolean
  - `collection_id` integer
- `403` The lookup did not land. Some handlers send this with status 200.

### GET /api/collections/{id}

One collection

**parameters**

- `id` (path, required) integer

**answers**

- `200` object
  - `success` boolean
  - `collection` [`Collection`](#collection)
- `400` The lookup did not land. Some handlers send this with status 200.

### PUT /api/collections/{id}

Edit collection name and description

JWT required. Collection owner only. Name and description only.

**parameters**

- `id` (path, required) integer

**body**

- `application/json` object
  - `name` string
  - `description` string

**answers**

- `200` object
  - `success` boolean
- `403` The lookup did not land. Some handlers send this with status 200.

### POST /api/collections/{id}/deployed

Stamp the on-chain contract address after MetaMask deploy

JWT required. Collection owner only. `address` must still be null. Called after `launchCollection` on the Polygon factory succeeds.

**parameters**

- `id` (path, required) integer

**body**

- `application/json` object
  - `address` string

**answers**

- `200` object
  - `success` boolean
  - `address` string
- `403` The lookup did not land. Some handlers send this with status 200.

### GET /api/collections/{id}/collectibles

Everything in a collection

At most 256 rows a page. Unlike the other collectible routes this one filters neither `suppressed` nor unminted, so hidden wearables and wearables with a null `token_id` both come back.

**parameters**

- `id` (path, required) integer
- `page` (query) integer, defaults to `0`: Zero-based.
- `limit` (query) integer, defaults to `256`: Capped at 256, which is also the default.

**answers**

- `200` object
  - `success` boolean
  - `collectibles` array of [`Collectible`](#collectible)

### GET /api/collections/{collection_id}/collectibles/{token_id}

One collectible by collection id and token id

**parameters**

- `collection_id` (path, required) integer
- `token_id` (path, required) integer

**answers**

- `200` object
  - `success` boolean
  - `collectible` [`Collectible`](#collectible)
- `400` The lookup did not land. Some handlers send this with status 200.

### GET /api/collections/{chain_identifier}/{collection_address}/c/{token_id}.json

One collectible by chain, contract and token id

An unrecognised chain identifier falls back to ethereum rather than erroring.

**parameters**

- `chain_identifier` (path, required) string, one of `eth`, `matic`
- `collection_address` (path, required) string
- `token_id` (path, required) integer

**answers**

- `200` object
  - `success` boolean
  - `collectible` [`Collectible`](#collectible)
- `400` The lookup did not land. Some handlers send this with status 200.

## wearables

- [`POST /api/wearables/{uuid}/minted`](#post-apiwearablesuuidminted) Stamp token_id after MetaMask mint
- [`GET /api/wearables/search`](#get-apiwearablessearch) Wearable name substring match, fifty at most
- [`GET /api/wearables/suggest`](#get-apiwearablessuggest) Thirty wearables, the ones for a given bone first
- [`GET /api/wearables/free.json`](#get-apiwearablesfreejson) Wearables anyone can put on
- [`GET /api/wearables/{wearable_id}/vox`](#get-apiwearableswearable_idvox) A wearable's MagicaVoxel model, by wearable uuid
- [`GET /api/wearables/{address}/{token}/vox`](#get-apiwearablesaddresstokenvox) A wearable's MagicaVoxel model, by contract and token id
- [`GET /w/{hash}/{format}`](#get-whashformat) A wearable's model by content hash
- [`GET /c/v2/{chain_identifier}/{collection_address}/{token_id}/{format}`](#get-cv2chain_identifiercollection_addresstoken_idformat) A wearable's model by chain, contract and token id

### POST /api/wearables/{uuid}/minted

Stamp token_id after MetaMask mint

JWT required. Wearable author or collection owner. Wearable must still have null `token_id` and its collection must have an address. `issues` is the edition count from the form (1-9). No on-chain verify in v1.

**parameters**

- `uuid` (path, required) string, a uuid

**body**

- `application/json` object
  - `token_id` integer
  - `issues` integer

**answers**

- `200` object
  - `success` boolean
  - `token_id` integer
  - `issues` integer
- `403` The lookup did not land. Some handlers send this with status 200.

### GET /api/wearables/search

Wearable name substring match, fifty at most

**parameters**

- `q` (query) string

**answers**

- `200` [`WearablePickList`](#wearablepicklist)

### GET /api/wearables/suggest

Thirty wearables, the ones for a given bone first

**parameters**

- `bone` (query) string: An exact bone name sorts its wearables to the top.

**answers**

- `200` [`WearablePickList`](#wearablepicklist)

### GET /api/wearables/free.json

Wearables anyone can put on

**answers**

- `200` object
  - `success` boolean
  - `wearables` array of [`Wearable`](#wearable)

### GET /api/wearables/{wearable_id}/vox

A wearable's MagicaVoxel model, by wearable uuid

**parameters**

- `wearable_id` (path, required) string, a uuid

**answers**

- `200` `application/octet-stream`, bytes
- `404` The lookup did not land. Some handlers send this with status 200.

### GET /api/wearables/{address}/{token}/vox

A wearable's MagicaVoxel model, by contract and token id

Two-segment sibling of the route above. Express matches whichever arity the request has, so a single segment goes to `{wearable_id}` and two go here. The address is matched case-insensitively against the collection.

**parameters**

- `address` (path, required) string
- `token` (path, required) integer

**answers**

- `200` `application/octet-stream`, bytes
- `404` The lookup did not land. Some handlers send this with status 200.

### GET /w/{hash}/{format}

A wearable's model by content hash

`format` has to be `vox` or `.vox`; every other value is a 404. The hash has to be longer than 39 characters or the lookup is skipped.

**parameters**

- `hash` (path, required) string
- `format` (path, required) string, one of `vox`, `.vox`

**answers**

- `200` `application/octet-stream`, bytes
- `404` The lookup did not land. Some handlers send this with status 200.

### GET /c/v2/{chain_identifier}/{collection_address}/{token_id}/{format}

A wearable's model by chain, contract and token id

Same handler as `/w/{hash}/{format}`. `token_id` is read as hex when it looks like hex and as decimal otherwise.

**parameters**

- `chain_identifier` (path, required) string, one of `eth`, `matic`
- `collection_address` (path, required) string
- `token_id` (path, required) string
- `format` (path, required) string, one of `vox`, `.vox`

**answers**

- `200` `application/octet-stream`, bytes
- `400` The lookup did not land. Some handlers send this with status 200.
- `404` The lookup did not land. Some handlers send this with status 200.

## islands

- [`GET /api/islands.json`](#get-apiislandsjson) Every island with its shoreline
- [`GET /api/islands-metadata.json`](#get-apiislands-metadatajson) Island names and positions
- [`GET /api/islands/{slug}.json`](#get-apiislandsslugjson) One island and every parcel on it

### GET /api/islands.json

Every island with its shoreline

The heavy one: it carries the shore polygon plus the holes and lakes cut out of it. Use `/api/islands-metadata.json` if you only need names and positions.

**answers**

- `200` object
  - `success` boolean
  - `islands` array of [`Island`](#island)

### GET /api/islands-metadata.json

Island names and positions

**answers**

- `200` object
  - `success` boolean
  - `islands` array of [`IslandMetadata`](#islandmetadata)

### GET /api/islands/{slug}.json

One island and every parcel on it

The slug is the island name lowercased with runs of whitespace turned into single hyphens, so `Origin City` is `origin-city`. `parcels` holds whole property rows.

**parameters**

- `slug` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `island` object
    - `id` integer
    - `name` string
    - `position` [`GeoJsonPoint`](#geojsonpoint)
    - `parcels` array of object
- `400` The lookup did not land. Some handlers send this with status 200.

## spaces

- [`GET /api/spaces/{id}.json`](#get-apispacesidjson) Archived space JSON download
- [`GET /api/wallet/{address}/spaces.json`](#get-apiwalletaddressspacesjson) Archived spaces a wallet owns

### GET /api/spaces/{id}.json

Archived space JSON download

Spaces are deprecated. This returns the archived content for download. A malformed uuid throws inside the handler and comes back as a 400.

**parameters**

- `id` (path, required) string, a uuid

**answers**

- `200` object
  - `success` boolean
  - `space` object
- `400` The lookup did not land. Some handlers send this with status 200.

### GET /api/wallet/{address}/spaces.json

Archived spaces a wallet owns

Spaces are deprecated. List is for archive download links only.

**parameters**

- `address` (path, required) string
- `page` (query) integer, defaults to `1`: One-based.

**answers**

- `200` object
  - `success` boolean
  - `spaces` array of object

## events

- [`GET /api/events.json`](#get-apieventsjson) Events people have put on their parcels
- [`GET /api/events/on.json`](#get-apieventsonjson) Events happening now or soon
- [`GET /api/events/on/{limit}/{page}.json`](#get-apieventsonlimitpagejson) Paged version of the above
- [`GET /api/events/{id}.json`](#get-apieventsidjson) One event
- [`GET /api/parcels/{id}/event.json`](#get-apiparcelsideventjson) The event on a parcel
- [`GET /api/parcels/{id}/events/history.json`](#get-apiparcelsideventshistoryjson) Events a parcel has already held

### GET /api/events.json

Events people have put on their parcels

**answers**

- `200` [`EventList`](#eventlist)

### GET /api/events/on.json

Events happening now or soon

**parameters**

- `live` (query) string: The string `true` narrows this to what is on right now.

**answers**

- `200` [`EventList`](#eventlist)

### GET /api/events/on/{limit}/{page}.json

Paged version of the above

**parameters**

- `limit` (path, required) integer: Three when it will not parse.
- `page` (path, required) integer: Zero-based.

**answers**

- `200` [`EventList`](#eventlist)

### GET /api/events/{id}.json

One event

**parameters**

- `id` (path, required) string

**answers**

- `200` object
  - `success` boolean
  - `event` object
- `400` The lookup did not land. Some handlers send this with status 200.

### GET /api/parcels/{id}/event.json

The event on a parcel

**parameters**

- `id` (path, required) integer

**answers**

- `200` object
  - `success` boolean
  - `event` object
- `400` The lookup did not land. Some handlers send this with status 200.

### GET /api/parcels/{id}/events/history.json

Events a parcel has already held

**parameters**

- `id` (path, required) integer

**answers**

- `200` [`EventList`](#eventlist)

## search

- [`GET /api/search`](#get-apisearch) Full text search across the world

### GET /api/search

Full text search across the world

Reads a materialised view that mixes parcels, wearables and the rest, so `type` tells you what each hit is. Fifty results, no paging: `limit` and `page` are fixed in the handler. `q` is lowercased, stripped of percent signs and cut to eighty characters. An empty `q` returns an empty list with `success: true`.

**parameters**

- `q` (query) string

**answers**

- `200` object
  - `success` boolean
  - `results` array of [`SearchResult`](#searchresult)

## ghosts

- [`GET /api/ghosts`](#get-apighosts) Random path fragments that touched a parcel

### GET /api/ghosts

Random path fragments that touched a parcel

Returns up to 10 anonymous movement fragments whose start or end parcel matches. Each `path` is base64 of a little-endian Float32Array packed as `t,x,y,z` per sample (`t` seconds from the fragment start). `type` is 0 walk, 1 conga, 2 fly, 3 drive. No identity and no created_at.

**parameters**

- `parcel` (query, required) integer

**answers**

- `200` object
  - `success` boolean
  - `ghosts` array of [`Ghost`](#ghost)
- `400` The lookup did not land. Some handlers send this with status 200.

## chat

- [`GET /api/chat.json`](#get-apichatjson) Recent chat messages

### GET /api/chat.json

Recent chat messages

Returns up to 200 unmoderated chat messages in chronological order. Used by the client on connect instead of replaying history over the multiplayer websocket.

**answers**

- `200` object
  - `messages` array of object
    - `id` string
    - `uuid` string
    - `text` string
    - `avatar` anything: AvatarRef snapshot at send time
    - `moderated` boolean

## schemas

The shapes the routes above hand back.

### Failure

- `success` boolean, always `false`
- `message` string

### AvatarRef

A citizen, or the bare lowercased wallet string when no avatar row matches. Anywhere an owner or author appears, expect either shape, and in the same array: `parcel_users` on a parcel mixes objects and strings.

- string
- object
  - `id` string, a uuid
  - `name` string or null
  - `owner` string
  - `created_at` string or null

### GeoJsonPoint

- `type` string, always `Point`
- `crs` object
- `coordinates` array of number

### ParcelGeometry

The parcel footprint as GeoJSON, in EPSG:3857, hundredths of the world unit.

- `type` string, always `Polygon`
- `crs` object
- `coordinates` array of array of array of number

### ParcelBounds

The parcel's box in metres. x and z are world position, y1 is the floor and y2 the ceiling. Watch out for `y2` on the list routes, where several queries alias `y2 - y1` to `y2` and hand you the height instead.

- `x1` number
- `x2` number
- `y1` number
- `y2` number
- `z1` number
- `z2` number
- `height` number

### ParcelContent

The build. Only `/api/parcels/{id}.json` returns this.

- `voxels` string or null: The structure, as base64 of a zlib stream over a flat little-endian Uint16 grid. Nothing in the payload says how to read it.

  The grid is `((x2-x1)*2, (y2-y1)*2, (z2-z1)*2)`, two voxels to the metre, and it runs z fastest, then y, then x. Read it any other way and the build shears into diagonal ribbons that still fill the right box, which looks like a render bug rather than a decode one. The check that settles the ordering is the ground: every parcel has a full slab at y=0, and only this ordering produces one.

  Each cell is a packed integer. The low five bits are the tile index into the tileset atlas, a 4x4 grid of material textures, so a cell of 0 is empty air. Bits 5 to 7 index `palette`. Bit 15 is set on solid voxels and the mesher ignores it.
- `palette` array of string or null: Eight hex colours the builder tints the atlas materials with. Null when the builder never touched them, and a missing entry falls back to the default for that slot.
- `tileset` string or null or boolean: Path to a custom atlas image, relative to the Voxels image host, or null and false for the built-in one.
- `features` array of [`Feature`](#feature) or null
- `scripting` string or boolean or null
- `lightmap_url` string or null
- `brightness` number or null
- `environment` string or null

### Feature

Something hung on the plot: an image, screen, sign, text, light, portal, spawn point or collectible model. Voxels are only the structure, so a build with the features stripped out is a grey shell.

`type` is an open set, and the union in the code runs to about thirty members. Read what you know and skip the rest.

- `type` string
- `uuid` string: Missing on some old features.
- `position` [`Vec3`](#vec3): Parcel-local metres. x and z are measured from the MIDDLE of the plot, not a corner, so they go negative. y is measured up from the floor.
- `rotation` [`Vec3`](#vec3): Radians, composed yaw, pitch, roll. Degrees are what a wearable attachment uses, not this.
- `scale` [`Vec3`](#vec3): For a flat feature such as an image, the rectangle's width and height in metres.
- `groupId` string or null: The uuid of a `group` feature. Nesting is by reference, not by embedding: the array is flat and a group can name another group as its parent, so walk the chain to get a feature's world transform.
- `url` string or array of string or object or null: A string, a one-element array or an object with a `url` key, depending on the feature's age.
- `collidable` boolean
- `link` string or null

### Vec3

Either a three-element array or an object with x, y and z.

- array of number or null
- object
  - `x` number
  - `y` number
  - `z` number

### Parcel

One parcel with its build. What `/api/parcels/{id}.json` returns.

- everything in [`ParcelBounds`](#parcelbounds)
- `id` integer
- `token` integer or null
- `name` string or null
- `label` string or null
- `description` string or null
- `address` string or null: The street address. About ten parcels have none.
- `island` string
- `suburb` string or null
- `kind` string, one of `plot`, `inner`, `outer`, `unit`, `basement`, `asset`
- `geometry` [`ParcelGeometry`](#parcelgeometry)
- `owner` [`AvatarRef`](#avatarref)
- `parcel_users` array of [`AvatarRef`](#avatarref) or null
- `content` [`ParcelContent`](#parcelcontent)
- `settings` object or null
- `lightmap_url` string or null
- `traffic_visits` integer
- `distance_to_center` number
- `distance_to_ocean` number
- `distance_to_closest_common` number
- `is_common` boolean
- `minted` boolean
- `visible` boolean
- `updated_at` string

### ParcelSummary

A row from the parcel list routes. No `content`.

- everything in [`ParcelBounds`](#parcelbounds)
- `id` integer
- `name` string or null
- `label` string or null
- `address` string or null
- `island` string
- `suburb` string or null
- `geometry` [`ParcelGeometry`](#parcelgeometry)
- `owner` [`AvatarRef`](#avatarref)
- `parcel_users` array of object or null
- `hash` string or null
- `lightmap_url` string or null
- `visible` boolean
- `distance_to_center` number
- `distance_to_ocean` number
- `distance_to_closest_common` number

### CachedParcel

A row from `/api/parcels/cached.json`.

- everything in [`ParcelBounds`](#parcelbounds)
- `id` integer
- `name` string or null
- `address` string or null
- `island` string
- `suburb` string or null
- `kind` string
- `geometry` [`ParcelGeometry`](#parcelgeometry)
- `owner` string: A lowercased wallet, not an avatar object.
- `parcel_users` array of object
  - `wallet` string
  - `role` string, one of `owner`, `contributor`, `excluded`
- `hash` string or null
- `lightmap_url` string or null
- `settings` object or null
- `is_common` boolean
- `visible` boolean
- `distance_to_center` number
- `distance_to_ocean` number
- `distance_to_closest_common` number

### Womp

A photograph somebody took in world.

- `id` integer
- `author` [`AvatarRef`](#avatarref)
- `content` string: The caption.
- `coords` string: Where the shot was taken, in the same string the play URL uses, for example `SW@3558E,2017S,3U`: heading, then east/west, north/south and an optional height above ground.
- `parcel_id` integer or null
- `space_id` string or null
- `parcel_name` string or null
- `parcel_address` string or null
- `parcel_island` string or null
- `space_name` string or null
- `image_url` string or null
- `image_supplied` boolean: True when the bytes are in the database, which is what makes `/api/womps/{id}.jpg` work. False means the picture only lives at `image_url`. Absent on `/api/womps/{id}.json`.
- `created_at` string
- `updated_at` string

### Avatar

A citizen.

- `id` string, a uuid
- `owner` string: The wallet.
- `name` string or null: The display name, one of `names`.
- `names` array of string: Every name the wallet holds.
- `description` string or null
- `social_link_1` string or null
- `social_link_2` string or null
- `moderator` boolean
- `type` string or null, one of `woody`, `vidda`, `zuck`, `bnolan`, `null`: Which body the citizen wears. Everything but `woody` is deprecated and you are unlikely to meet one.
- `settings` object or null
- `costume_id` string or null
- `costume` [`Costume`](#costume)
- `home_id` integer or null
- `src` string or null: UGC VRM url (ugc://...) when wearing a custom avatar mesh.
- `created_at` string or null: Pacific/Auckland, not UTC.
- `last_online` string or null: Pacific/Auckland, not UTC.

### Costume

What a citizen is wearing. `attachments` name a bone and a wearable; an attachment's position and scale are in bone-local space and its rotation is in degrees, which is the opposite of a parcel feature.

- `id` string, a uuid
- `name` string or null
- `attachments` array of object
  - `bone` string: The bone the piece hangs off, `Head` or `Spine1` and so on.
  - `wid` string, a uuid: The wearable. Both `/api/collectibles/{uuid}/vox` and `/api/collectibles/wearable/{uuid}.json` take this.
  - `position` array of number: Three numbers, bone-local.
  - `rotation` array of number: Three numbers, in degrees, applied yaw then pitch then roll. A parcel feature's rotation is in radians.
  - `scaling` array of number: Three numbers.
  - `chain` integer: The chain the wearable is on. Not on every attachment.
- `wallet` string or null: Whose costume it is.
- `skin` string or null: The body texture as an SVG document, inline, not a url. Runs to tens of kilobytes, so a caller that only wants the attachments pays for this too.
- `default_color` string or null: Hex, the colour worn where nothing covers the body.

### Wearable

A wearable collectible.

- `id` string, a uuid: The wid. This is what `/api/collectibles/{uuid}/vox` takes.
- `name` string or null
- `description` string or null
- `author` [`AvatarRef`](#avatarref)
- `token_id` integer or null: Null until the wearable is minted.
- `collection_id` integer or null
- `collection_name` string or null
- `collection_address` string or null
- `chain_id` integer or null
- `category` string or null
- `default_bone` string or null
- `default_settings` object or null
- `custom_attributes` object or null
- `offer_prices` object or null
- `issues` integer or null: How many were minted.
- `is_free` boolean
- `hash` string or null
- `suppressed` boolean
- `rejected_at` string or null
- `created_at` string or null
- `updated_at` string or null

### WearablePickList

The trimmed shape the wearable pickers use.

- `success` boolean
- `wearables` array of object
  - `id` string, a uuid
  - `name` string or null
  - `is_free` boolean

### Collectible

A minted wearable, as the collectible routes return it.

- everything in [`Wearable`](#wearable)

### Collection

A wearable collection.

- `id` integer
- `name` string
- `description` string or null
- `image_url` string or null
- `owner` string or null
- `address` string or null: The contract. Null for a collection that was never deployed.
- `slug` string or null
- `type` string or null: ERC721 or ERC1155.
- `chainid` integer or null: 1 for ethereum, 137 for polygon.
- `settings` object or null
- `suppressed` boolean
- `rejected_at` string or null
- `created_at` string or null
- `total_wearables` integer or string: A count, which postgres hands back as a string on the list route.

### Island

- `id` integer
- `name` string
- `texture` string or null
- `geometry` object: The shoreline, as GeoJSON.
- `holes_geometry_json` object or null: Land cut out of the island.
- `lakes_geometry_json` object or null
- `position` [`GeoJsonPoint`](#geojsonpoint)
- `content` object or null

### IslandMetadata

- `id` integer
- `name` string
- `other_name` string or null
- `position` [`GeoJsonPoint`](#geojsonpoint)

### SearchResult

- `id` string: A parcel id, a wearable uuid and so on, depending on `type`.
- `name` string or null
- `type` string: What kind of thing this is, for example `wearable`.
- `description` string or null
- `created_at` string or null
- `rank` number

### Ghost

- `start_parcel` integer
- `end_parcel` integer
- `type` integer: 0 walk, 1 conga, 2 fly, 3 drive
- `path` string: Base64 of Float32Array samples packed as t,x,y,z

### EventList

- `success` boolean
- `events` array of object
