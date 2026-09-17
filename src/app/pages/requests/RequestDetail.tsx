import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  closeCase,
  markAllFound,
  setCaseFeeRefunded,
  summarizeCase,
} from '../../../db/cases'
import { setItemStatus } from '../../../db/repo'
import { db } from '../../../db/schema'
import type { Item, ItemStatus } from '../../../db/types'
import { personTitle } from '../../../ui/format'
import { useToast } from '../../../ui/Toast'
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

  const request = useLiveQuery(() => db.requests.get(id), [id])
  const person = useLiveQuery(
    () => (request ? db.people.get(request.personId) : undefined),
    [request],
  )
  const items = useLiveQuery(() => db.items.where('requestId').equals(id).toArray(), [id])
  const locations = useLiveQuery(() => db.locations.toArray(), [])
  const locationNames = new Map((locations ?? []).map((l) => [l.id!, l.name]))

  const itemDisplay = useLiveQuery(async () => {
    const labels = new Map<number, string>()
    const flags = new Map<number, { fridge: boolean; controlled: boolean }>()
    if (!items || items.length === 0) return { labels, flags }
    const presentations = await db.presentations.bulkGet(items.map((i) => i.presentationId))
    const presentationById = new Map(presentations.filter(Boolean).map((p) => [p!.id!, p!]))
    const products = await db.products.bulkGet([
      ...new Set([...presentationById.values()].map((p) => p.productId)),
    ])
    const productById = new Map(products.filter(Boolean).map((p) => [p!.id!, p!]))
    for (const item of items) {
      const pres = presentationById.get(item.presentationId)
      const prod = pres ? productById.get(pres.productId) : undefined
      labels.set(item.id!, [prod?.nameEn ?? 'Unknown', pres?.strength, pres?.form].filter(Boolean).join(' '))
      flags.set(item.id!, { fridge: pres?.fridge ?? false, controlled: pres?.controlled ?? false })
    }
    return { labels, flags }
  }, [items])

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
            label={itemDisplay?.labels.get(item.id!) ?? '…'}
            flags={itemDisplay?.flags.get(item.id!)}
            locationNames={locationNames}
            onSetStatus={(status, previous, opts) => handleSetStatus(item.id!, status, previous, opts)}
          />
        ))}
      </ul>
      {items.length === 0 && <p className="empty-state">No meds in this case.</p>}

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
