import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { mostUsedLocations } from '../../../db/repo'
import { db } from '../../../db/schema'
import type { Location } from '../../../db/types'

interface LocationPickerProps {
  title: string
  onPick: (location: Location) => void
  onClose: () => void
  // Offer "No location" so a status change never blocks on picking one.
  onSkip?: () => void
}

export function LocationPicker({ title, onPick, onClose, onSkip }: LocationPickerProps) {
  const locations = useLiveQuery(() => mostUsedLocations(db), [])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__handle" />
        <p className="sheet__title">{title}</p>

        {locations && locations.length === 0 && (
          <p className="empty-state">
            No locations yet. <Link to="/locations/new">Add one</Link> first.
          </p>
        )}

        {locations?.map((loc) => (
          <button
            key={loc.id}
            type="button"
            className="sheet__option"
            onClick={() => onPick(loc)}
          >
            {loc.name}
            {loc.needsTransferSlip && ' 📋'}
          </button>
        ))}

        {onSkip && (
          <button type="button" className="sheet__option sheet__option--muted" onClick={onSkip}>
            No location
          </button>
        )}

        <button type="button" className="sheet__cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
