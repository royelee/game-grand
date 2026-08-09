import type { Project } from '../../shared/project'

interface Props {
  project: Project
  assetUrl: (source: string) => string
  ready: boolean
  onAdd: () => void
  onStartHere: (index: number) => void
  onRename: (index: number) => void
  onDelete: (index: number) => void
}

/**
 * "Starts here" rather than "showing": the IDE's stage only draws during a run,
 * so there is no live preview to promise. What `currentBackdrop` actually means
 * is the backdrop the game opens on.
 */
export function BackdropList({
  project, assetUrl, ready, onAdd, onStartHere, onRename, onDelete,
}: Props) {
  const { backdrops, currentBackdrop } = project.stage
  const only = backdrops.length === 1

  return (
    <div className="asset-list backdrop-list">
      {backdrops.map((backdrop, index) => (
        <div
          key={`${index}-${backdrop.source}`}
          className={`asset-row backdrop-row${index === currentBackdrop ? ' selected' : ''}`}
        >
          <img src={assetUrl(backdrop.source)} alt="" />
          <span>{backdrop.name}</span>
          {index === currentBackdrop ? (
            <em className="asset-badge">✓ Starts here</em>
          ) : (
            <button onClick={() => onStartHere(index)}>Start here</button>
          )}
          <button onClick={() => onRename(index)}>Rename</button>
          <button
            onClick={() => onDelete(index)}
            disabled={only}
            title={only ? 'Your game needs at least one backdrop.' : undefined}
          >
            Delete
          </button>
        </div>
      ))}
      {only && <p className="empty-note">Your game always keeps at least one backdrop.</p>}
      <button onClick={onAdd} disabled={!ready}>+ Add backdrop</button>
    </div>
  )
}
