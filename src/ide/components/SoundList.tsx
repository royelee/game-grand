import type { Project } from '../../shared/project'

interface Props {
  project: Project
  ready: boolean
  onAdd: () => void
  onPlay: (source: string) => void
  onRename: (index: number) => void
  onDelete: (index: number) => void
}

export function SoundList({ project, ready, onAdd, onPlay, onRename, onDelete }: Props) {
  return (
    <div className="asset-list sound-list">
      {project.sounds.length === 0 && <p className="empty-note">No sounds yet.</p>}
      {project.sounds.map((sound, index) => (
        <div key={`${index}-${sound.source}`} className="asset-row sound-row">
          <button className="sound-play" onClick={() => onPlay(sound.source)}>▶ Play</button>
          <span>{sound.name}</span>
          <button onClick={() => onRename(index)}>Rename</button>
          <button onClick={() => onDelete(index)}>Delete</button>
        </div>
      ))}
      <button onClick={onAdd} disabled={!ready}>+ Add sound</button>
    </div>
  )
}
