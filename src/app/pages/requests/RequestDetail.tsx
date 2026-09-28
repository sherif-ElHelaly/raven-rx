import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  closeCase,
  deleteCase,
  describeItems,
  markAllFound,
  restoreCase,
  saveCaseAsRegularMeds,
  setCaseFeeRefunded,
  summarizeCase,
} from '../../../db/cases'
import { addItem, removeItem, setItemQty, setItemStatus, setRegularMeds } from '../../../db/repo'
import { db } from '../../../db/schema'
import type { Item, ItemStatus } from '../../../db/types'
import { personTitle } from '../../../ui/format'
import { useToast } from '../../../ui/Toast'
import { MedPicker } from '../drugs/MedPicker'
import { AlternateSheet } from './AlternateSheet'
import { ItemRow, type StatusOpts } from './ItemRow'
import { LocationPicker } from './LocationPicker'
import './requests.css'

export function RequestDetail() {
  const { requestId } = useParams()
  const id = Number(requestId)
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [pickForItems, setPickForItems] = useState<number[] | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeCollected, setCloseCollected] = useState(true)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const request = useLiveQuery(() => db.requests.get(id), [id])
  const person = useLiveQuery(
    () => (request ? db.people.get(request.personId) : undefined),
    [request],
  )
  const items = useLiveQuery(() => db.items.where('requestId').equals(id).toArray(), [id])
  const locations = useLiveQuery(() => db.locations.toArray(), [])
  const locationNames = new Map((locations ?? []).map((l) => [l.id!, l.name]))

  const itemDisplay = useLiveQuery(() => describeItems(db, items ?? []), [items])

  const [alternateFor, setAlternateFor] = useState<number | null>(null)
  const [editingItem, setEditingItem] = useState<number | null>(null)
  const [addingMed, setAddingMed] = useState(false)

  if (request === undefined || items === undefined) return <div className="page">Loading…</div>
  if (!request) {
    return (
      <div className="page">
        <p className="empty-state">Request not found.</p>
      </div>
    )
  }

  const summary = summarizeCase(request, person, items)
  const findable = items.filter((i) => i.status === 'searching' || i.status === 'transferred')

  const toggleFlag = (flag: 'registered' | 'approved' | 'paid') => {
    const now = Date.now()
    const isOn = request[flag]
    const patch: Partial<typeof request> = { [flag]: !isOn } as never
    if (flag === 'registered') patch.registeredAt = !isOn ? now : undefined
    if (flag === 'approved') patch.approvedAt = !isOn ? now : undefined
    if (flag === 'paid') patch.paidAt = !isOn ? now : undefined
    db.requests.update(id, patch)
  }

  const handleSetStatus = async (
    itemId: number,
    status: ItemStatus,
    previous: ItemStatus,
    opts?: StatusOpts,
  ) => {
    await setItemStatus(db, itemId, status, opts)
    showToast(`Marked ${status}`, () => {
      setItemStatus(db, itemId, previous)
    })
  }

  const undoStatuses = (before: Item[]) => () => {
    for (const item of before) {
      setItemStatus(db, item.id!, item.status, {
        locationId: item.status === 'transferred' ? item.transferToLocationId : item.foundAtLocationId,
      })
    }
  }

  const handleMarkAllFound = async () => {
    const before = findable
    const unknown = await markAllFound(db, id)
    const done = before.length - unknown.length
    if (unknown.length > 0) {
      setPickForItems(unknown)
      if (done > 0) showToast(`Marked ${done} found at their usual pharmacy`)
      return
    }
    showToast(`Marked ${done} found`, undoStatuses(before))
  }

  const applyFoundToPicked = async (locationId: number | undefined) => {
    const ids = pickForItems ?? []
    setPickForItems(null)
    const before = items.filter((i) => ids.includes(i.id!))
    for (const itemId of ids) await setItemStatus(db, itemId, 'found', { locationId })
    showToast(`Marked ${ids.length} found`, undoStatuses(before))
  }

  const toggleCollected = async () => {
    const next = !summary.feeRefunded
    await setCaseFeeRefunded(db, id, next)
    showToast(next ? `Collected ${summary.totalFee} EGP` : 'Fee marked as not collected', () => {
      setCaseFeeRefunded(db, id, !next)
    })
  }

  const handleClose = async () => {
    setClosing(false)
    await closeCase(db, id, { feeCollected: closeCollected || summary.feeRefunded })
    const after = await db.requests.get(id)
    const afterItems = await db.items.where('requestId').equals(id).toArray()
    if (after && summarizeCase(after, person, afterItems).finished) {
      showToast('Case finished')
      navigate('/requests?tab=finished', { replace: true })
    }
  }

  const prescribedLabel = (item: Item) =>
    itemDisplay?.get(item.id!)?.substituteFor ?? itemDisplay?.get(item.id!)?.label ?? 'this med'

  const handleAddMed = async (presentationId: number, label: string) => {
    setAddingMed(false)
    const itemId = await addItem(db, id, presentationId, 1)
    showToast(`Added ${label}`, () => {
      db.items.delete(itemId)
    })
  }

  const handleRemoveItem = async (itemId: number) => {
    setEditingItem(null)
    const removed = await removeItem(db, itemId)
    if (removed) {
      showToast('Med removed from case', () => {
        db.items.put(removed)
      })
    }
  }

  const handleSaveRegular = async () => {
    const previous = await saveCaseAsRegularMeds(db, id)
    if (previous) {
      showToast(`Saved as ${personTitle(person)}’s regular meds`, () => {
        if (person) setRegularMeds(db, person.id!, previous)
      })
    }
  }

  const editing = editingItem !== null ? items.find((i) => i.id === editingItem) : undefined
  const alternateItem = alternateFor !== null ? items.find((i) => i.id === alternateFor) : undefined

  const handleDelete = async () => {
    setConfirmingDelete(false)
    const deleted = await deleteCase(db, id)
    navigate('/requests', { replace: true })
    if (deleted) {
      showToast('Case deleted', () => {
        restoreCase(db, deleted)
      })
    }
  }

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        {person ? (
          <Link to={`/people/${person.id}`} className="top-bar__title top-bar__title--link">
            {personTitle(person)}
          </Link>
        ) : (
          <span className="top-bar__title">…</span>
        )}
        {!summary.finished && items.length > 0 && (
          <Link to={`/requests/${id}/handover`} className="btn btn--ghost">
            Handover
          </Link>
        )}
      </div>

      {summary.finished && <p className="case-finished-banner">✓ Finished case</p>}

      <div className="request-summary">
        <p className="request-summary__card">Card •••• {person?.cardNumber.slice(-4) ?? ''}</p>
        <p className="request-summary__plan">
          {request.plan === 'monthly' ? 'Monthly' : 'Bimonthly'} ·{' '}
          {new Date(request.createdAt).toLocaleDateString()}
        </p>

        <div className="request-checkboxes">
          <label className="request-checkbox">
            <input type="checkbox" checked={request.registered} onChange={() => toggleFlag('registered')} />
            Registered
          </label>
          <label className="request-checkbox">
            <input type="checkbox" checked={request.approved} onChange={() => toggleFlag('approved')} />
            Approved
          </label>
          <label className="request-checkbox">
            <input type="checkbox" checked={request.paid} onChange={() => toggleFlag('paid')} />
            Paid
          </label>
        </div>

        {items.length > 0 && (
          <div className={`case-fee${summary.feeRefunded ? ' case-fee--collected' : ''}`}>
            <div>
              <span className="case-fee__amount">{summary.totalFee} EGP</span>
              <span className="case-fee__breakdown">
                {items.length} med{items.length === 1 ? '' : 's'} × {request.feePerItem} EGP ·{' '}
                {summary.feeRefunded ? 'collected' : 'owed to you'}
              </span>
            </div>
            <button type="button" className="btn case-fee__toggle" onClick={toggleCollected}>
              {summary.feeRefunded ? 'Undo' : 'Collected'}
            </button>
          </div>
        )}
      </div>

      <div className="case-items-header">
        <h2 className="product-detail__section-title">Meds</h2>
        {findable.length > 0 && (
          <button type="button" className="btn btn--ghost" onClick={handleMarkAllFound}>
            Mark all found
          </button>
        )}
      </div>
      <ul className="item-row-list">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            display={itemDisplay?.get(item.id!)}
            locationNames={locationNames}
            onSetStatus={(status, previous, opts) => handleSetStatus(item.id!, status, previous, opts)}
            onAlternate={() => setAlternateFor(item.id!)}
            onEdit={() => setEditingItem(item.id!)}
          />
        ))}
      </ul>
      {items.length === 0 && <p className="empty-state">No meds in this case.</p>}

      <div className="case-secondary-actions">
        <button type="button" className="btn btn--ghost" onClick={() => setAddingMed(true)}>
          + Add med
        </button>
        {items.length > 0 && person && (
          <button type="button" className="btn btn--ghost" onClick={handleSaveRegular}>
            Save as regular meds
          </button>
        )}
      </div>

      {alternateItem && (
        <AlternateSheet
          item={alternateItem}
          prescribedLabel={prescribedLabel(alternateItem)}
          onClose={() => setAlternateFor(null)}
        />
      )}

      {addingMed && (
        <MedPicker
          mode="presentation"
          title="Add to this case"
          onClose={() => setAddingMed(false)}
          onPick={(pres, product) =>
            handleAddMed(pres.id!, [product.nameEn, pres.strength, pres.form].filter(Boolean).join(' '))
          }
        />
      )}

      {editing && (
        <div className="sheet-backdrop" onClick={() => setEditingItem(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__handle" />
            <p className="sheet__title">{itemDisplay?.get(editing.id!)?.label ?? 'Med'}</p>
            <div className="qty-stepper">
              <span>Quantity</span>
              <span className="qty-stepper__controls">
                <button
                  type="button"
                  className="btn"
                  disabled={editing.qty <= 1}
                  onClick={() => setItemQty(db, editing.id!, editing.qty - 1)}
                  aria-label="Less"
                >
                  −
                </button>
                <span className="qty-stepper__value">{editing.qty}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setItemQty(db, editing.id!, editing.qty + 1)}
                  aria-label="More"
                >
                  +
                </button>
              </span>
            </div>
            <button
              type="button"
              className="sheet__option sheet__option--danger"
              onClick={() => handleRemoveItem(editing.id!)}
            >
              Remove from case
              <span className="sheet__option-hint">
                For a line added by mistake. To give up on a med, set it Unavailable instead.
              </span>
            </button>
            <button type="button" className="sheet__cancel" onClick={() => setEditingItem(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {!summary.finished && items.length > 0 && (
        <button
          type="button"
          className="btn btn--block case-close-btn"
          onClick={() => {
            setCloseCollected(!summary.feeRefunded)
            setClosing(true)
          }}
        >
          Close case…
        </button>
      )}

      <button
        type="button"
        className="btn btn--danger btn--block case-delete-btn"
        onClick={() => setConfirmingDelete(true)}
      >
        Delete case…
      </button>

      {confirmingDelete && (
        <div className="sheet-backdrop" onClick={() => setConfirmingDelete(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__handle" />
            <p className="sheet__title">Delete this case?</p>
            <p className="settings-section__hint">
              Removes this case and its {items.length} med{items.length === 1 ? '' : 's'}
              {summary.owed > 0 ? `, including the ${summary.owed} EGP owed` : ''}.{' '}
              {personTitle(person)}’s card, name and rank are kept. You can undo right after.
            </p>
            <button type="button" className="btn btn--danger btn--block" onClick={handleDelete}>
              Delete case
            </button>
            <button type="button" className="sheet__cancel" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {pickForItems && (
        <LocationPicker
          title={`Found ${pickForItems.length} med${pickForItems.length === 1 ? '' : 's'} at…`}
          onClose={() => setPickForItems(null)}
          onPick={(location) => applyFoundToPicked(location.id)}
          onSkip={() => applyFoundToPicked(undefined)}
        />
      )}

      {closing && (
        <div className="sheet-backdrop" onClick={() => setClosing(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__handle" />
            <p className="sheet__title">Close this case?</p>
            <p className="settings-section__hint">
              {summary.openCount > 0
                ? `${summary.openCount} med${summary.openCount === 1 ? '' : 's'} still open will be marked Unavailable.`
                : 'Every med is already closed.'}
            </p>
            {summary.counts.found > 0 && (
              <p className="warning-banner">
                {summary.counts.found} med{summary.counts.found === 1 ? ' is' : 's are'} Found — if
                the person got {summary.counts.found === 1 ? 'it' : 'them'}, use Handover instead so{' '}
                {summary.counts.found === 1 ? 'it counts' : 'they count'} as delivered.
              </p>
            )}
            {!summary.feeRefunded && (
              <label className="request-checkbox case-close__collected">
                <input
                  type="checkbox"
                  checked={closeCollected}
                  onChange={(e) => setCloseCollected(e.target.checked)}
                />
                I collected the {summary.totalFee} EGP fee
              </label>
            )}
            <button type="button" className="btn btn--primary btn--block" onClick={handleClose}>
              Close case
            </button>
            <button type="button" className="sheet__cancel" onClick={() => setClosing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
