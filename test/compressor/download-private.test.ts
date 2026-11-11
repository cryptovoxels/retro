import { expect, it } from 'vitest'
import { diskFetch } from '../../compiler/src/download'

it.each(['127.0.0.1', '[::1]', '169.254.169.254', 'localhost'])('blocks private asset host %s', async (host) => {
  const result = await diskFetch(`http://${host}/asset`)
  expect(result).toMatchObject({ error: expect.stringContaining('Private asset address') })
})
