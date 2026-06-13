import { useEffect } from 'preact/hooks'
import { app } from './state'

export default function Logout(props: { path?: string }) {
  useEffect(() => {
    app.signout()
    window.location.replace('/')
  }, [])

  return null
}
