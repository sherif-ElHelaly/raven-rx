import { useState } from 'react'

interface TransferSlipSheetProps {
  locationName: string
  onConfirm: (slipRef: string | undefined) => void
  onClose: () => void
}

export function TransferSlipSheet({ locationName, onConfirm, onClose }: TransferSlipSheetProps) {
  const [slipRef, setSlipRef] = useState('')

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__handle" />
        <p className="sheet__title">Transfer slip for {locationName}</p>
        <label className="field">
          <span className="field__label">Slip ref (optional)</span>
          <input
            className="field__input"
            autoFocus
            value={slipRef}
            onChange={(e) => setSlipRef(e.target.value)}
            placeholder="e.g. slip #142"
          />
        </label>
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => onConfirm(slipRef.trim() || undefined)}
        >
          Confirm transfer
        </button>
        <button type="button" className="sheet__cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
