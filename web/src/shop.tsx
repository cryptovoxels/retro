import Classifieds from './components/classifieds'
import Head from './components/head'

export default function Shop(_props: { path?: string }) {
  return (
    <section>
      <Head title="Shop" url="/shop" />
      <Classifieds link={false} />
    </section>
  )
}
