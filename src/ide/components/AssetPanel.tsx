import { useState } from 'react'
import type { Project } from '../../shared/project'
import { BackdropList } from './BackdropList'
import { SoundList } from './SoundList'
import { SpriteList } from './SpriteList'

const TABS = [
  { key: 'sprites', label: 'Sprites' },
  { key: 'backdrops', label: 'Backdrops' },
  { key: 'sounds', label: 'Sounds' },
] as const

type AssetTab = (typeof TABS)[number]['key']

interface Props {
  project: Project
  selectedTab: string
  assetUrl: (source: string) => string
  /** The asset library has loaded, so the "+ Add" buttons have somewhere to go. */
  ready: boolean
  sprites: {
    onSelect: (name: string) => void
    onAdd: () => void
    onRename: (name: string) => void
    onDelete: (name: string) => void
  }
  backdrops: {
    onAdd: () => void
    onStartHere: (index: number) => void
    onRename: (index: number) => void
    onDelete: (index: number) => void
  }
  sounds: {
    onAdd: () => void
    onPlay: (source: string) => void
    onRename: (index: number) => void
    onDelete: (index: number) => void
  }
}

/**
 * One list at a time, under the stage. Tabs rather than three stacked sections
 * because the stage is a fixed 384px and what is left is roughly 420px at a
 * 900px viewport — enough for one list, not for three.
 *
 * The active tab lives here rather than in the reducer: it isn't part of the
 * saved document, and it must survive the library dialog opening over the top,
 * which it does because App renders this panel unconditionally.
 */
export function AssetPanel({
  project, selectedTab, assetUrl, ready, sprites, backdrops, sounds,
}: Props) {
  const [tab, setTab] = useState<AssetTab>('sprites')

  return (
    <div className="asset-panel">
      <div className="asset-tabs">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            className={key === tab ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sprites' ? (
        <SpriteList
          project={project}
          selectedTab={selectedTab}
          assetUrl={assetUrl}
          ready={ready}
          onSelect={sprites.onSelect}
          onAdd={sprites.onAdd}
          onRename={sprites.onRename}
          onDelete={sprites.onDelete}
        />
      ) : tab === 'backdrops' ? (
        <BackdropList
          project={project}
          assetUrl={assetUrl}
          ready={ready}
          onAdd={backdrops.onAdd}
          onStartHere={backdrops.onStartHere}
          onRename={backdrops.onRename}
          onDelete={backdrops.onDelete}
        />
      ) : (
        <SoundList
          project={project}
          ready={ready}
          onAdd={sounds.onAdd}
          onPlay={sounds.onPlay}
          onRename={sounds.onRename}
          onDelete={sounds.onDelete}
        />
      )}
    </div>
  )
}
