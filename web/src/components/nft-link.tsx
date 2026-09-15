import { openseaAssetsChainSlug, readNftUrl } from '../../../common/helpers/nft-url'

export type NftRef = { name: string | null; src: string }

export const NftLink = ({ nft }: { nft: NftRef | null | undefined }) => {
  if (!nft?.src) return null
  const parsed = readNftUrl(nft.src)
  const label = nft.name || (parsed ? `${parsed.contract.slice(0, 10)}.../${parsed.token}` : nft.src)
  if (!parsed) return <span>{label}</span>
  const href = `https://opensea.io/item/${openseaAssetsChainSlug(parsed.chain)}/${parsed.contract}/${parsed.token}`
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  )
}
