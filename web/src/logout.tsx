import { useEffect } from 'preact/hooks'
import { app } from './state'

export default function Logout() {
  useEffect(() => {
    app.signout()
    window.location.replace('/')
  }, [])

  return null
}
