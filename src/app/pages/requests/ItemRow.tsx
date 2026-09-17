import { useRef, useState } from 'react'
import type { Item, ItemStatus, Location } from '../../../db/types'
import { nextStatus, setFeeRefunded } from '../../../db/repo'
import { db } from '../../../db/schema'
import { LocationPicker } from './LocationPicker'
import { StatusSheet } from './StatusSheet'
import { TransferSlipSheet } from './TransferSlipSheet'
import { STATUS_LABELS } from './statusMeta'

export interface StatusOpts {
  locationId?: number
  transferSlipRef?: string
}

interface ItemRowProps {
  item: Item
  label: string
  flags?: { fridge: boolean; controlled: boolean }
  onSetStatus: (status: ItemStatus, previous: ItemStatus, opts?: StatusOpts) => void
}

const NEEDS_LOCATION: ItemStatus[] = ['found', 'transferred']

const SWIPE_THRESHOLD = 72
const LONG_PRESS_MS = 500
const MOVE_CANCEL_THRESHOLD = 10

export function ItemRow({ item, label, flags, onSetStatus }: ItemRowProps) {
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<ItemStatus | null>(null)
  const [pendingTransferLocation, setPendingTransferLocation] = useState<Location | null>(null)

  const startX = useRef(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  const advanceTarget = nextStatus(item.status)

  const applyStatus = (status: ItemStatus, opts?: StatusOpts) => {
    onSetStatus(status, item.status, opts)
  }

  const pickStatus = (status: ItemStatus) => {
    if (NEEDS_LOCATION.includes(status)) {
      setPendingStatus(status)
    } else {
      applyStatus(status)
    }
  }

  const handleLocationPicked = (status: ItemStatus, location: Location) => {
    if (status === 'transferred' && location.needsTransferSlip) {
      setPendingTransferLocation(location)
      setPendingStatus(null)
      return
    }
    applyStatus(status, { locationId: location.id })
    setPendingStatus(null)
  }

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!advanceTarget) return
    startX.current = e.clientX
    longPressFired.current = false
    setDragging(true)
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      setDragging(false)
      setDragX(0)
      setSheetOpen(true)
    }, LONG_PRESS_MS)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging || longPressFired.current) return
    const delta = e.clientX - startX.current
    if (Math.abs(delta) > MOVE_CANCEL_THRESHOLD) clearLongPress()
    // Only allow rightward swipe (advance), clamp for a bit of resistance.
    setDragX(Math.max(0, Math.min(delta, SWIPE_THRESHOLD * 1.4)))
  }

  const finishDrag = () => {
    clearLongPress()
    setDragging(false)
    if (!longPressFired.current && dragX >= SWIPE_THRESHOLD && advanceTarget) {
      pickStatus(advanceTarget)
    }
    setDragX(0)
  }

  const handlePointerUp = () => finishDrag()
  const handlePointerCancel = () => {
    clearLongPress()
    setDragging(false)
    setDragX(0)
  }

  // Long-press also available via a dedicated button, since real long-press
  // via mouse-hold doesn't work well with automated/keyboard interaction.
  const openMenu = () => setSheetOpen(true)

  return (
    <li className="item-row-wrap">
      {advanceTarget && (
        <div className="item-row__swipe-hint" aria-hidden="true">
          → {STATUS_LABELS[advanceTarget]}
        </div>
      )}
      <div
        className="item-row"
        style={{ transform: `translateX(${dragX}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={dragging ? handlePointerCancel : undefined}
      >
        <div className="item-row__main">
          <span className="item-row__label">
            {label}
            {flags?.fridge && <span aria-label="requires fridge"> ❄️</span>}
            {flags?.controlled && <span aria-label="controlled drug"> ⚠️</span>}
          </span>
          <span className="item-row__qty">×{item.qty}</span>
        </div>
        <div className="item-row__footer">
          <span className={`badge item-row__status item-row__status--${item.status}`}>
            {STATUS_LABELS[item.status]}
          </span>
          {item.status === 'delivered' && (
            <label className="item-row__refund">
              <input
                type="checkbox"
                checked={item.feeRefunded}
                onChange={(e) => setFeeRefunded(db, item.id!, e.target.checked)}
              />
              Refunded
            </label>
          )}
          <button type="button" className="item-row__menu-btn" onClick={openMenu}>
            ⋯
          </button>
        </div>
      </div>

      {sheetOpen && (
        <StatusSheet
          current={item.status}
          onClose={() => setSheetOpen(false)}
          onPick={(status) => {
            setSheetOpen(false)
            pickStatus(status)
          }}
        />
      )}

      {pendingStatus && (
        <LocationPicker
          title={pendingStatus === 'found' ? 'Found at…' : 'Transfer to…'}
          onClose={() => setPendingStatus(null)}
          onPick={(location) => handleLocationPicked(pendingStatus, location)}
        />
      )}

      {pendingTransferLocation && (
        <TransferSlipSheet
          locationName={pendingTransferLocation.name}
          onClose={() => setPendingTransferLocation(null)}
          onConfirm={(slipRef) => {
            applyStatus('transferred', {
              locationId: pendingTransferLocation.id,
              transferSlipRef: slipRef,
            })
            setPendingTransferLocation(null)
          }}
        />
      )}
    </li>
  )
}
