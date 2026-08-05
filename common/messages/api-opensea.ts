////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Types for img.crvox.com messages

import * as t from 'io-ts'

import { NullableNum, NullableStr } from './feature'

export const ContractRecord = t.type(
  {
    address: t.string,
    asset_contract_type: t.string,
    created_date: t.string,
    name: t.string,
    nft_version: t.string,
    opensea_version: NullableStr,
    owner: t.number,
    schema_name: t.string,
    symbol: t.string,
    total_supply: t.string,
    description: NullableStr,
    external_link: NullableStr,
    image_url: NullableStr,
    defautl_to_fiat: t.boolean,
    dev_buyer_fee_basis_points: t.number,
    dev_seller_fee_basis_points: t.number,
    only_proxied_transfers: t.boolean,
    opensea_buyer_fee_basis_points: t.number,
    opensea_seller_fee_basis_points: t.number,
    buyer_fee_basis_points: t.number,
    seller_fee_basis_points: t.number,
    payout_address: t.string,
    chain: t.union([t.string, t.undefined]),
  },
  'ContractRecord',
)
export type ContractRecord = t.TypeOf<typeof ContractRecord>

export const MinimalContractRecord = t.type(
  {
    address: ContractRecord.props.address,
    chain: ContractRecord.props.chain,
    asset_contract_type: ContractRecord.props.asset_contract_type,
    name: ContractRecord.props.name,
    schema_name: ContractRecord.props.schema_name,
    symbol: ContractRecord.props.symbol,
  },
  'MinimalContractRecord',
)

export type MinimalContractRecord = t.TypeOf<typeof MinimalContractRecord>

export const OwnerRecord = t.type(
  {
    user: t.union([
      t.type({
        username: NullableStr,
      }),
      t.null,
    ]),
    profile_img_url: t.string,
    address: t.string,
    config: t.string,
  },
  'OwnerRecord',
)
export type OwnerRecord = t.TypeOf<typeof OwnerRecord>

export const OwnershipRecord = t.type(
  {
    owner: OwnerRecord,
    quantity: t.string,
  },
  'OwnershipRecord',
)
export type OwnershipRecord = t.TypeOf<typeof OwnershipRecord>

export const TraitRecord = t.type(
  {
    trait_type: t.string,
    value: t.union([t.string, t.number]),
    display_type: t.union([t.string, t.null, t.undefined]),
    max_value: t.union([t.string, t.null, t.undefined]),
    trait_count: t.union([t.number, t.null, t.undefined]),
    order: t.union([t.number, t.string, t.null, t.undefined]),
  },
  'TraitRecord',
)
export type TraitRecord = t.TypeOf<typeof TraitRecord>

export const ApiAssetOpensea = t.type(
  {
    id: t.number,
    token_id: t.string,
    num_sales: t.number,
    background_color: NullableStr,
    image_url: NullableStr,
    image_preview_url: t.union([NullableStr, t.undefined]),
    image_original_url: t.union([NullableStr, t.undefined]),
    animation_url: NullableStr,
    animation_original_url: NullableStr,
    name: NullableStr,
    description: NullableStr,
    external_link: NullableStr,
    asset_contract: t.union([ContractRecord, MinimalContractRecord]),
    permalink: t.string,
    collection: t.type({ name: t.string }),
    decimals: NullableNum,
    token_metadata: t.union([t.string, t.null]),
    owner: t.unknown,
    sell_orders: t.unknown,
    creator: t.unknown,
    traits: t.union([t.array(TraitRecord), t.null]),
    last_sale: t.unknown,
    top_bid: t.unknown,
    listing_date: t.unknown,
    is_presale: t.boolean,
    transfer_fee_payment_token: t.unknown,
    transfer_fee: t.unknown,
    related_assets: t.unknown,
    order: t.unknown,
    auctions: t.unknown,
    supports_wyvern: t.boolean,
    top_ownerships: t.union([t.array(OwnershipRecord), t.undefined]),
    ownership: t.union([OwnershipRecord, t.null, t.undefined]),
    highest_buyer_commitment: t.unknown,

    // Error detail
    detail: t.union([t.string, t.undefined]),
  },
  'ApiAssetOpensea',
)
export type ApiAssetOpensea = t.TypeOf<typeof ApiAssetOpensea>

export const MinimalAssetOpensea = t.type(
  {
    token_id: ApiAssetOpensea.props.token_id,
    traits: ApiAssetOpensea.props.traits,
    image_url: ApiAssetOpensea.props.image_url,
    animation_url: ApiAssetOpensea.props.animation_url,
    name: ApiAssetOpensea.props.name,
    description: ApiAssetOpensea.props.description,
    external_link: ApiAssetOpensea.props.external_link,
    asset_contract: ApiAssetOpensea.props.asset_contract,
    owner: ApiAssetOpensea.props.owner,
    creator: ApiAssetOpensea.props.creator,
  },
  'MinimalAssetOpensea',
)

export type MinimalAssetOpensea = t.TypeOf<typeof MinimalAssetOpensea>

export const ProxyAssetOpensea = t.type(
  {
    token_id: ApiAssetOpensea.props.token_id,
    image_url: ApiAssetOpensea.props.image_url,
    animation_url: ApiAssetOpensea.props.animation_url,
    name: ApiAssetOpensea.props.name,
    description: ApiAssetOpensea.props.description,
    external_link: ApiAssetOpensea.props.external_link,
    asset_contract: ApiAssetOpensea.props.asset_contract,
    owner: ApiAssetOpensea.props.owner,
    creator: ApiAssetOpensea.props.creator,
    ownership: ApiAssetOpensea.props.ownership,
    image_original_url: ApiAssetOpensea.props.image_original_url,
    image_preview_url: ApiAssetOpensea.props.image_preview_url,
    top_ownerships: ApiAssetOpensea.props.top_ownerships,
    permalink: ApiAssetOpensea.props.permalink,
  },
  'ImageAssetOpensea',
)

export type ProxyAssetOpensea = t.TypeOf<typeof ProxyAssetOpensea>

// -------------------- OPENSEA API V2 (seaport) -----------------------------------

export const OpenSeaNftModelV2 = t.type(
  {
    identifier: t.string, // The NFT's unique identifier within the smart contract (also referred to as token_id)
    collection: t.string, // Collection slug. A unique string to identify a collection on OpenSea
    contract: t.string, // The unique public blockchain identifier for the contract
    token_standard: t.string, // ERC standard of the token (erc721, erc1155)
    name: t.string, // Name of the NFT
    description: t.string, // Description of the NFT
    image_url: t.union([t.string, t.undefined]), // Link to the image associated with the NFT
    metadata_url: t.union([t.string, t.undefined]), // Link to the offchain metadata store
    created_at: t.union([t.string, t.undefined]), // Deprecated Field
    updated_at: t.string, // Last time that the NFT's metadata was updated by OpenSea
    is_disabled: t.boolean, // If the item is currently able to be bought or sold using OpenSea
    is_nsfw: t.boolean, // If the item is currently classified as 'Not Safe for Work' by OpenSea
  },
  'OpenSeaNftModelV2',
)
export type OpenSeaNftModelV2 = t.TypeOf<typeof OpenSeaNftModelV2>

// combination of OpenseaNFTModelV2 and our own fields
export const OpenSeaNFTV2Extended = t.intersection([
  OpenSeaNftModelV2,
  t.type({
    // Our own fields
    owner: t.string,
    chain: t.literal('ethereum'), // only ethereum supported for now
    permalink: t.string,
  }),
])

export type OpenSeaNFTV2Extended = t.TypeOf<typeof OpenSeaNFTV2Extended>

const CreatedAtEnum = t.union([t.string, t.undefined])

const OwnerModel = t.type({
  address: t.string,
  quantity: t.number,
})

const RankingFeatures = t.type({
  // deprecated
  unique_attribute_count: t.number,
})

const RarityDataModel = t.union([
  t.type({
    rank: t.number,
  }),
  t.partial({
    strategy_id: t.literal('openrarity'),
    strategy_version: t.string,
    score: t.number,
    calculated_at: t.string,
    max_rank: t.number,
    total_supply: t.number,
    ranking_features: RankingFeatures,
  }),
])

export const OpenSeaNftModelDetailedV2 = t.type(
  {
    identifier: t.string,
    collection: t.string,
    contract: t.string,
    token_standard: t.string,
    name: NullableStr,
    description: NullableStr,
    updated_at: t.string,
    is_disabled: t.boolean,
    is_nsfw: t.boolean,
    is_suspicious: t.boolean,
    creator: t.string,
    traits: t.union([t.array(TraitRecord), t.null]),
    //  The owners field will be null if the NFT has more than 50 owners..
    owners: t.union([t.array(OwnerModel), t.null]),

    rarity: t.union([RarityDataModel, t.null]),
    // optional fields

    image_url: t.union([t.string, t.undefined]),
    metadata_url: NullableStr,
    created_at: CreatedAtEnum,
    animation_url: t.union([t.string, t.null]),

    // Additional fields from actual API responses
    display_image_url: t.union([t.string, t.null, t.undefined]),
    display_animation_url: t.union([t.string, t.null, t.undefined]),
    opensea_url: t.union([t.string, t.undefined]),
  },
  'OpenSeaNftModelDetailedV2',
)

export type OpenSeaNftModelDetailedV2 = t.TypeOf<typeof OpenSeaNftModelDetailedV2>

export const OpenSeaNftModelDetailedV2Extended = t.intersection([
  OpenSeaNftModelDetailedV2,
  t.type({
    // Our own fields
    chain: t.union([t.literal('ethereum'), t.literal('matic'), t.literal('base')]),
  }),
])

export type OpenSeaNftModelDetailedV2Extended = t.TypeOf<typeof OpenSeaNftModelDetailedV2Extended>
