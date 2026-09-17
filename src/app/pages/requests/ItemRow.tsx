import { useState } from 'react'
import { knownLocationFor } from '../../../db/cases'
import { db } from '../../../db/schema'
import type { Item, ItemStatus, Location } from '../../../db/types'
import { LocationPicker } from './LocationPicker'
import { TransferSlipSheet } from './TransferSlipSheet'
import { STATUS_LABELS, STATUS_ORDER } from './statusMeta'

export interface StatusOpts {
  locationId?: number
  transferSlipRef?: string
}

interface ItemRowProps {
  item: Item
  label: string
  flags?: { fridge: boolean; controlled: boolean }
  locationNames: Map<number, string>
  onSetStatus: (status: ItemStatus, previous: ItemStatus, opts?: StatusOpts) => void
}

type LocatedStatus = 'found' | 'transferred'

function isLocated(status: ItemStatus): status is LocatedStatus {
  return status === 'found' || status === 'transferred'
}

// Status is a native dropdown (the iOS picker wheel): one tap to open, one to
// choose. Found / Transferred reuse the pharmacy this drug was last found at or
// sent to, so the location is only asked the first time.
export function ItemRow({ item, label, flags, locationNames, onSetStatus }: ItemRowProps) {
  const [picking, setPicking] = useState<LocatedStatus | null>(null)
  const [slipFor, setSlipFor] = useState<Location | null>(null)

  const apply = (status: ItemStatus, opts?: StatusOpts) => onSetStatus(status, item.status, opts)

  const handleSelect = async (status: ItemStatus) => {
    if (status === item.status) return
    if (!isLocated(status)) {
      apply(status)
      return
    }
    // A transferred med is found where it was transferred to.
    const remembered =
      status === 'found' && item.status === 'transferred' && item.transferToLocationId != null
        ? item.transferToLocationId
        : await knownLocationFor(db, item.presentationId, status)
    if (remembered != null) apply(status, { locationId: remembered })
    else setPicking(status)
  }

  const handlePicked = (status: LocatedStatus, location: Location | null) => {
    setPicking(null)
    if (status === 'transferred' && location?.needsTransferSlip) {
      setSlipFor(location)
      return
    }
    apply(status, { locationId: location?.id })
  }

  const locationId =
    item.status === 'found'
      ? item.foundAtLocationId
      : item.status === 'transferred'
        ? item.transferToLocationId
        : item.status === 'delivered'
          ? item.foundAtLocationId
          : undefined
  const locationName = locationId != null ? locationNames.get(locationId) : undefined

  return (
    <li className="item-row">
      <div className="item-row__main">
        <span className="item-row__label">
          {label}
          {flags?.fridge && <span aria-label="requires fridge"> ❄️</span>}
          {flags?.controlled && <span aria-label="controlled drug"> ⚠️</span>}
          <span className="item-row__qty"> ×{item.qty}</span>
        </span>
        <label className={`status-select item-row__status--${item.status}`}>
          <span className="visually-hidden">Status of {label}</span>
          <select value={item.status} onChange={(e) => handleSelect(e.target.value as ItemStatus)}>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLocated(item.status) && (
        <button
          type="button"
          className="item-row__location"
          onClick={() => setPicking(item.status as LocatedStatus)}
        >
          {locationName
            ? `${item.status === 'transferred' ? 'to' : 'at'} ${locationName} · change`
            : `Set ${item.status === 'transferred' ? 'destination' : 'pharmacy'}`}
        </button>
      )}
      {item.status === 'delivered' && locationName && (
        <span className="item-row__location item-row__location--static">from {locationName}</span>
      )}

      {picking && (
        <LocationPicker
          title={picking === 'found' ? `${label} found at…` : `Transfer ${label} to…`}
          onClose={() => setPicking(null)}
          onPick={(location) => handlePicked(picking, location)}
          onSkip={() => handlePicked(picking, null)}
        />
      )}

      {slipFor && (
        <TransferSlipSheet
          locationName={slipFor.name}
          onClose={() => setSlipFor(null)}
          onConfirm={(slipRef) => {
            apply('transferred', { locationId: slipFor.id, transferSlipRef: slipRef })
            setSlipFor(null)
          }}
        />
      )}
    </li>
  )
}
