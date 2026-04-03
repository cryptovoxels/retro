import { useState } from 'preact/hooks'
import AddTab from '../add-tab'
import { AssetLibraryBrowser } from '../../asset-library/asset-library'
import type { Scene } from '../../../scene'
import Parcel from '../../../parcel'
import { BuildTabNavTabs, MainTabs } from './build-tab.tabs'
import EditTab from '../edit-tab'

interface Props {
  parcel?: Parcel
  scene: Scene
}
export const BuildTab = ({ scene, parcel }: Props) => {
  const [currentTab, setCurrentTab] = useState<BuildTabNavTabs>('add')

  return (
    <section class="build-tab">
      <MainTabs currentTab={currentTab} setCurrentTab={setCurrentTab} />
      {currentTab === 'add' ? <AddTab parcel={parcel} scene={scene} /> : currentTab === 'assets' ? <AssetLibraryBrowser scene={scene} /> : <EditTab parcel={parcel || null} scene={scene} />}
    </section>
  )
}
