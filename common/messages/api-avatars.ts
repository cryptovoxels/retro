////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Types for /api/avatars messages

import * as t from 'io-ts'

export const ApiAvatar = t.type(
  {
    id: t.number,
    owner: t.string,
    name: t.union([t.string, t.null]),
    type: t.union([t.literal('woody'), t.literal('vidda'), t.literal('zuck'), t.literal('bnolan')]), // all but woody are deprecated
    description: t.union([t.string, t.null]),
    names: t.union([t.array(t.string), t.null]),
    moderator: t.boolean,
    settings: t.partial({ quietMails: t.boolean }),
    created_at: t.union([t.string, t.null]),
    last_online: t.union([t.string, t.null]),
    costume_id: t.union([t.number, t.null]),
    home_id: t.union([t.number, t.null]),
    costume: t.any,
    social_link_1: t.union([t.string, t.null]),
    social_link_2: t.union([t.string, t.null]),
  },
  'ApiAvatar',
)

export type ApiAvatar = t.TypeOf<typeof ApiAvatar>

/**
 * /api/avatars/:wallet.json
 */
export const ApiAvatarMessage = t.type(
  {
    success: t.boolean,
    avatar: ApiAvatar,
  },
  'ApiAvatarMessage',
)
export type ApiAvatarMessage = t.TypeOf<typeof ApiAvatarMessage>

/**
 * /api/avatars/:wallet/name.json
 */
export const ApiAvatarName = t.type(
  {
    name: t.union([t.any, t.undefined]),
  },
  'ApiAvatarName',
)
export type ApiAvatarName = t.TypeOf<typeof ApiAvatarName>
