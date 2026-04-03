export type BuildTabNavTabs = 'add' | 'assets' | 'edit'

export const MainTabs = ({ currentTab, setCurrentTab }: { currentTab: BuildTabNavTabs; setCurrentTab: (tab: BuildTabNavTabs) => void }) => {
  return (
    <nav class="build-main-tabs">
      <button data-active={currentTab === 'add'} onClick={() => setCurrentTab('add')}>
        Add
      </button>
      <div class="separator" />
      <button data-active={currentTab === 'assets'} onClick={() => setCurrentTab('assets')}>
        Assets
      </button>
      <div class="separator" />
      <button data-active={currentTab === 'edit'} onClick={() => setCurrentTab('edit')}>
        Edit
      </button>
    </nav>
  )
}
