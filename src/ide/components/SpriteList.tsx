import type { Project } from '../../shared/project'

interface Props {
  project: Project
  selectedTab: string
  assetUrl: (source: string) => string
  ready: boolean
  onSelect: (name: string) => void
  onAdd: () => void
  onRename: (from: string) => void
  onDelete: (name: string) => void
}

export function SpriteList({
  project, selectedTab, assetUrl, ready, onSelect, onAdd, onRename, onDelete,
}: Props) {
  return (
    <div className="asset-list sprite-list">
      {project.sprites.length === 0 && <p className="empty-note">No sprites yet.</p>}
      {project.sprites.map(sprite => (
        <div
          key={sprite.name}
          className={`asset-row sprite-row${selectedTab === sprite.name ? ' selected' : ''}`}
          onClick={() => onSelect(sprite.name)}
        >
          <img src={assetUrl(sprite.costumes[sprite.currentCostume]?.source ?? '')} alt="" />
          <span>{sprite.name}</span>
          <button onClick={e => { e.stopPropagation(); onRename(sprite.name) }}>Rename</button>
          <button onClick={e => { e.stopPropagation(); onDelete(sprite.name) }}>Delete</button>
        </div>
      ))}
      <button onClick={onAdd} disabled={!ready}>+ Add sprite</button>
    </div>
  )
}
