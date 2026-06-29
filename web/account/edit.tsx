import { Login } from '../src/auth/login'
import EditAccountForm from '../src/components/avatar-profile/edit-account-form'
import { app } from '../src/state'

export default function EditAccount() {
  if (!app.signedIn) return <Login reason="edit your account" />

  const wallet = app.state?.wallet

  return (
    <section class="columns">
      <hgroup>
        <h1>edit account</h1>
        <a href={`/avatar/${wallet}`}>back to profile</a>
      </hgroup>
      <article>
        <EditAccountForm redirectTo={`/avatar/${wallet}`} />
      </article>
    </section>
  )
}
