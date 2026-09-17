import type { ItemStatus } from '../../../db/types'
import { STATUS_LABELS, STATUS_ORDER } from './statusMeta'

interface StatusSheetProps {
  current: ItemStatus
  onPick: (status: ItemStatus) => void
  onClose: () => void
}

export function StatusSheet({ current, onPick, onClose }: StatusSheetProps) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__handle" />
        <p className="sheet__title">Set status</p>
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            className={`sheet__option${status === current ? ' sheet__option--current' : ''}`}
            onClick={() => onPick(status)}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
        <button type="button" className="sheet__cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
