import { route } from 'preact-router'
import { Link } from 'preact-router/match'
import { sidebarClosed } from '../../src/store'
import Head from './components/head'
import { getCoords, withCoords } from './helpers/coords-nav'
import { app } from './state'

type Item = {
  label: string
  href?: string
  onClick?: (e: Event) => void
  external?: boolean
  when?: boolean
}

type Section = {
  title: string
  items: Item[]
  when?: boolean
}

function MenuLink({ item, href }: { item: Item; href: (p: string) => string }) {
  if (item.onClick) {
    return (
      <a href="#" onClick={item.onClick}>
        {item.label}
      </a>
    )
  }
  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener">
        {item.label}
      </a>
    )
  }
  return <Link href={href(item.href!)}>{item.label}</Link>
}

export default function Menu() {
  const signedIn = app.signedIn
  const admin = app.isAdmin()
  const wallet = app.wallet
  const coords = getCoords()
  const href = (p: string) => (coords ? withCoords(p) : p)

  const onPlay = (e: Event) => {
    e.preventDefault()
    if (coords) sidebarClosed.value = false
    route(app.visitUrl.value || (coords ? href('/play') : '/play?coords=0E,0N'))
  }

  const sections: Section[] = [
    {
      title: 'home',
      items: [
        { label: 'Home', href: '/' },
        { label: 'Blog', href: '/blog' },
        { label: signedIn ? 'Profile' : 'Login', href: '/account' },
        { label: 'Log out', href: '/logout', when: signedIn },
      ],
    },
    {
      title: 'world',
      items: [
        { label: 'Play', onClick: onPlay },
        { label: 'Map', href: '/map' },
        { label: 'Islands', href: '/islands' },
        { label: 'Parcels', href: '/parcels' },
        { label: 'Spaces', href: '/spaces' },
        { label: 'Womps', href: '/womps' },
        { label: 'Events', href: '/events' },
        { label: 'Scratchpad', href: '/scratchpad' },
      ],
    },
    {
      title: 'people',
      items: [
        { label: 'Chat', href: '/chat' },
        { label: 'Go live', href: '/golive' },
        { label: 'Mail', href: '/mail', when: signedIn },
        { label: 'Collabs', href: '/account/collaborations', when: signedIn },
        { label: 'Favorites', href: '/account/favorites', when: signedIn },
      ],
    },
    {
      title: 'create',
      items: [
        { label: 'Assets', href: '/assets' },
        { label: 'Collections', href: '/collections' },
        { label: 'Costume', href: '/costumer', when: signedIn },
        { label: 'Shop', href: '/shop' },
        { label: 'My assets', href: wallet ? `/u/${wallet}/assets` : '/assets', when: signedIn },
        { label: 'My parcels', href: '/account/parcels', when: signedIn },
        { label: 'My spaces', href: '/account/spaces', when: signedIn },
        { label: 'My womps', href: '/account/womps', when: signedIn },
      ],
    },
    {
      title: 'socials',
      items: [
        { label: 'Discord', href: 'https://discord.gg/3RSCZGr3fr', external: true },
        { label: 'Twitter', href: 'https://www.x.com/cryptovoxels', external: true },
        { label: 'Github', href: 'https://github.com/cryptovoxels/retro', external: true },
      ],
    },
    {
      title: 'etc',
      items: [
        { label: 'Search', href: '/search' },
        { label: 'Radio', href: '/radio' },
        { label: 'Conduct', href: '/conduct' },
        { label: 'Behaviours', href: '/behaviours' },
        { label: 'Privacy', href: '/privacy' },
        { label: 'Terms', href: '/terms' },
        { label: 'Admin', href: '/admin', when: admin },
      ],
    },
  ]

  return (
    <section class="menu">
      <Head title="Menu" />
      {sections.map((s) => {
        const items = s.items.filter((i) => i.when !== false)
        if (items.length === 0) return null
        return (
          <div class="menu-section" key={s.title}>
            <h3>{s.title}</h3>
            <div class="menu-grid">
              {items.map((i) => (
                <MenuLink key={i.label} item={i} href={href} />
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}
