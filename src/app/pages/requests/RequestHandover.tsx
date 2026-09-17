import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { setFeeRefunded, setItemStatus } from '../../../db/repo'
import { db } from '../../../db/schema'
import { useToast } from '../../../ui/Toast'
import './requests.css'

// Handover screen — VISION §5.2: tick found items being handed over now
// (plus any already-delivered items whose fee hasn't been collected yet),
// then a single action delivers + refunds everything ticked.
export function RequestHandover() {
  const { requestId } = useParams()
  const id = Number(requestId)
  const navigate = useNavigate()
  const { showToast } = useToast()

  const request = useLiveQuery(() => db.requests.get(id), [id])
  const person = useLiveQuery(
    () => (request ? db.people.get(request.personId) : undefined),
    [request],
  )
  const items = useLiveQuery(
    () =>
      db.items
        .where('requestId')
        .equals(id)
        .filter((i) => i.status === 'found' || (i.status === 'delivered' && !i.feeRefunded))
        .toArray(),
    [id],
  )
  const labels = useLiveQuery(async () => {
    if (!items || items.length === 0) return new Map<number, string>()
    const presentationIds = [...new Set(items.map((i) => i.presentationId))]
    const presentations = await db.presentations.bulkGet(presentationIds)
    const productIds = [...new Set(presentations.filter(Boolean).map((p) => p!.productId))]
    const products = await db.products.bulkGet(productIds)
    const productById = new Map(products.filter(Boolean).map((p) => [p!.id!, p!]))
    const presentationById = new Map(presentations.filter(Boolean).map((p) => [p!.id!, p!]))
    const map = new Map<number, string>()
    for (const item of items) {
      const pres = presentationById.get(item.presentationId)
      const prod = pres ? productById.get(pres.productId) : undefined
      map.set(item.id!, [prod?.nameEn ?? 'Unknown', pres?.strength, pres?.form].filter(Boolean).join(' '))
    }
    return map
  }, [items])

  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [processing, setProcessing] = useState(false)

  // Default every item to ticked the first time the list loads.
  const [initialized, setInitialized] = useState(false)
  if (items && !initialized) {
    setTicked(new Set(items.map((i) => i.id!)))
    setInitialized(true)
  }

  const toggle = (itemId: number) => {
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const tickedItems = (items ?? []).filter((i) => ticked.has(i.id!))
  const collectTotal = request ? tickedItems.length * request.feePerItem : 0

  const handleDeliverAndRefund = async () => {
    if (!request || tickedItems.length === 0) return
    setProcessing(true)
    try {
      for (const item of tickedItems) {
        if (item.status === 'found') {
          await setItemStatus(db, item.id!, 'delivered', { locationId: item.foundAtLocationId })
        }
        await setFeeRefunded(db, item.id!, true)
      }
      showToast(`Delivered + refunded ${tickedItems.length} item${tickedItems.length === 1 ? '' : 's'}`)
      navigate(`/requests/${id}`)
    } finally {
      setProcessing(false)
    }
  }

  if (request === undefined) return <div className="page">Loading…</div>
  if (!request) {
    return (
      <div className="page">
        <p className="empty-state">Request not found.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">Handover — {person?.name || person?.cardNumber || '…'}</span>
      </div>

      {items && items.length === 0 && (
        <p className="empty-state">Nothing ready to hand over yet.</p>
      )}

      <ul className="item-row-list">
        {items?.map((item) => (
          <li key={item.id} className="item-row-wrap">
            <label className="request-checkbox" style={{ padding: 'var(--space-3) 0' }}>
              <input
                type="checkbox"
                checked={ticked.has(item.id!)}
                onChange={() => toggle(item.id!)}
              />
              <span>
                {labels?.get(item.id!) ?? '…'} ×{item.qty}
                {item.status === 'delivered' && (
                  <span className="badge badge--muted" style={{ marginLeft: 'var(--space-2)' }}>
                    fee outstanding
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {items && items.length > 0 && (
        <>
          <p className="request-summary__plan">
            Collect: {tickedItems.length} × {request.feePerItem} EGP = {collectTotal} EGP
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={tickedItems.length === 0 || processing}
            onClick={handleDeliverAndRefund}
          >
            {processing ? 'Saving…' : 'Delivered + refunded'}
          </button>
        </>
      )}
    </div>
  )
}
