import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { handOverCase, summarizeCase } from '../../../db/cases'
import { db } from '../../../db/schema'
import { personTitle } from '../../../ui/format'
import { useToast } from '../../../ui/Toast'
import './requests.css'

// Handover — tick the found meds being handed over now and collect the case
// fee (once per case). When nothing is left open the case moves to Finished.
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
  const items = useLiveQuery(() => db.items.where('requestId').equals(id).toArray(), [id])
  const labels = useLiveQuery(async () => {
    const map = new Map<number, string>()
    if (!items || items.length === 0) return map
    const presentations = await db.presentations.bulkGet(items.map((i) => i.presentationId))
    const presentationById = new Map(presentations.filter(Boolean).map((p) => [p!.id!, p!]))
    const products = await db.products.bulkGet([
      ...new Set([...presentationById.values()].map((p) => p.productId)),
    ])
    const productById = new Map(products.filter(Boolean).map((p) => [p!.id!, p!]))
    for (const item of items) {
      const pres = presentationById.get(item.presentationId)
      const prod = pres ? productById.get(pres.productId) : undefined
      map.set(item.id!, [prod?.nameEn ?? 'Unknown', pres?.strength, pres?.form].filter(Boolean).join(' '))
    }
    return map
  }, [items])

  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [collect, setCollect] = useState(true)
  const [processing, setProcessing] = useState(false)

  // Default every found med to ticked the first time the list loads.
  const [initialized, setInitialized] = useState(false)
  if (items && !initialized) {
    setTicked(new Set(items.filter((i) => i.status === 'found').map((i) => i.id!)))
    setInitialized(true)
  }

  if (request === undefined || items === undefined) return <div className="page">Loading…</div>
  if (!request) {
    return (
      <div className="page">
        <p className="empty-state">Request not found.</p>
      </div>
    )
  }

  const summary = summarizeCase(request, person, items)
  const ready = items.filter((i) => i.status === 'found')
  const stillOpen = items.filter((i) => i.status === 'searching' || i.status === 'transferred')
  const tickedIds = ready.filter((i) => ticked.has(i.id!)).map((i) => i.id!)
  const collecting = collect && !summary.feeRefunded

  const toggle = (itemId: number) => {
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const handleConfirm = async () => {
    if (tickedIds.length === 0 && !collecting) return
    setProcessing(true)
    try {
      await handOverCase(db, id, tickedIds, { collectFee: collecting })
      const after = await db.requests.get(id)
      const afterItems = await db.items.where('requestId').equals(id).toArray()
      if (after && summarizeCase(after, person, afterItems).finished) {
        showToast('Case finished — moved to Finished')
        navigate('/requests?tab=finished', { replace: true })
      } else {
        showToast(
          [
            tickedIds.length > 0 && `Handed over ${tickedIds.length}`,
            collecting && `collected ${summary.totalFee} EGP`,
          ]
            .filter(Boolean)
            .join(' · '),
        )
        navigate(`/requests/${id}`, { replace: true })
      }
    } finally {
      setProcessing(false)
    }
  }

  const actionLabel = [
    tickedIds.length > 0 && `Hand over ${tickedIds.length}`,
    collecting && `collect ${summary.totalFee} EGP`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">Handover — {personTitle(person)}</span>
      </div>

      <h2 className="product-detail__section-title">Ready to hand over</h2>
      {ready.length === 0 && <p className="empty-state">No found meds waiting.</p>}
      <ul className="item-row-list">
        {ready.map((item) => (
          <li key={item.id} className="item-row">
            <label className="request-checkbox">
              <input type="checkbox" checked={ticked.has(item.id!)} onChange={() => toggle(item.id!)} />
              <span>
                {labels?.get(item.id!) ?? '…'} <span className="item-row__qty">×{item.qty}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {stillOpen.length > 0 && (
        <p className="handover__still-open">
          Still open: {stillOpen.map((i) => labels?.get(i.id!) ?? '…').join(', ')}
        </p>
      )}

      <div className={`case-fee${summary.feeRefunded ? ' case-fee--collected' : ''}`}>
        {summary.feeRefunded ? (
          <span className="case-fee__breakdown">Fee of {summary.totalFee} EGP already collected.</span>
        ) : (
          <label className="request-checkbox">
            <input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} />
            <span>
              <span className="case-fee__amount">Collect {summary.totalFee} EGP</span>
              <span className="case-fee__breakdown">
                {items.length} med{items.length === 1 ? '' : 's'} × {request.feePerItem} EGP
              </span>
            </span>
          </label>
        )}
      </div>

      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={(tickedIds.length === 0 && !collecting) || processing}
        onClick={handleConfirm}
      >
        {processing ? 'Saving…' : actionLabel || 'Nothing to do'}
      </button>
    </div>
  )
}
