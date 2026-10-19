import { expect, test } from 'vitest'
import Favorites from '../favorite-parcel'

test('Favorites#object', () => {
  const p = new Favorites({ id: 42, parcel_id: 670 })
  expect(p).toBeTruthy()
  expect(p.parcel_id).toBe(670)
})

test('Favorites#IsNotFavorite', async () => {
  expect(await Favorites.loadFromWalletAndParcelId('a', 670)).toBeFalsy()
})

test('Favorites#Create', async () => {
  const p = new Favorites({ wallet: 'a', parcel_id: 670 })
  const response = await p.create()
  expect(response).toBeTruthy()
  expect(response.success).toBeTruthy()
})

test('Favorites#IsFavorite', async () => {
  const favoriteObject = await Favorites.loadFromWalletAndParcelId('a', 670)
  expect(favoriteObject).toBeTruthy()
  expect(favoriteObject.parcel_id).toBe(670)
  expect(favoriteObject.wallet).toBe('a')
})

test('Favorites#UnFavorite', async () => {
  const favoriteObject = await Favorites.loadFromWalletAndParcelId('a', 670)
  expect(favoriteObject).toBeTruthy()
  const response = await favoriteObject.remove()
  expect(response).toBeTruthy()
  expect(response.success).toBeTruthy()
  expect(await Favorites.loadFromWalletAndParcelId('a', 670)).toBeFalsy()
})
