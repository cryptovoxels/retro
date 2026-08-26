import { useState } from 'preact/hooks'
import AddTab from '../add-tab'
import { AssetLibraryBrowser } from '../../asset-library/asset-library'
import Parcel from '../../../parcel'
import { BuildTabNavTabs, MainTabs } from './build-tab.tabs'
import { SceneContext } from '@babylonjs/lite'

interface Props {
  parcel?: Parcel
  scene: SceneContext
}
export const BuildTab = ({ scene, parcel }: Props) => {
  const [currentTab, setCurrentTab] = useState<BuildTabNavTabs>('add')

  return (
    <section class="build-tab">
      <MainTabs currentTab={currentTab} setCurrentTab={setCurrentTab} />
      {currentTab === 'add' ? <AddTab parcel={parcel} scene={scene} /> : <AssetLibraryBrowser scene={scene} />}
    </section>
  )
}
