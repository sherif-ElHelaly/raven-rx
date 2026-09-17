import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db } from '../../../db/schema'
import { setItemStatus } from '../../../db/repo'
import type { ItemStatus } from '../../../db/types'
import { maskCardNumber } from '../../../ui/format'
import { useToast } from '../../../ui/Toast'
import { ItemRow, type StatusOpts } from './ItemRow'
import './requests.css'

export function RequestDetail() {
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

  const itemDisplay = useLiveQuery(async () => {
    if (!items || items.length === 0) {
      return { labels: new Map<number, string>(), flags: new Map<number, { fridge: boolean; controlled: boolean }>() }
    }
    const presentationIds = [...new Set(items.map((i) => i.presentationId))]
    const presentations = await db.presentations.bulkGet(presentationIds)
    const productIds = [
      ...new Set(presentations.filter(Boolean).map((p) => p!.productId)),
    ]
    const products = await db.products.bulkGet(productIds)
    const productById = new Map(products.filter(Boolean).map((p) => [p!.id!, p!]))
    const presentationById = new Map(presentations.filter(Boolean).map((p) => [p!.id!, p!]))

    const labels = new Map<number, string>()
    const flags = new Map<number, { fridge: boolean; controlled: boolean }>()
    for (const item of items) {
      const pres = presentationById.get(item.presentationId)
      const prod = pres ? productById.get(pres.productId) : undefined
      const parts = [prod?.nameEn ?? 'Unknown', pres?.strength, pres?.form].filter(Boolean)
      labels.set(item.id!, parts.join(' '))
      flags.set(item.id!, { fridge: pres?.fridge ?? false, controlled: pres?.controlled ?? false })
    }
    return { labels, flags }
  }, [items])

  if (request === undefined) return <div className="page">Loading…</div>
  if (!request) {
    return (
      <div className="page">
        <p className="empty-state">Request not found.</p>
      </div>
    )
  }

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

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        {person ? (
          <Link to={`/people/${person.id}`} className="top-bar__title top-bar__title--link">
            {person.name || maskCardNumber(person.cardNumber)}
          </Link>
        ) : (
          <span className="top-bar__title">…</span>
        )}
        <Link to={`/requests/${id}/handover`} className="btn btn--ghost">
          Handover
        </Link>
      </div>

      <div className="request-summary">
        <p className="request-summary__card">Card •••• {person?.cardNumber.slice(-4) ?? ''}</p>
        <p className="request-summary__plan">
          {request.plan === 'monthly' ? 'Monthly' : 'Bimonthly'} · {request.feePerItem} EGP/item
        </p>

        <div className="request-checkboxes">
          <label className="request-checkbox">
            <input
              type="checkbox"
              checked={request.registered}
              onChange={() => toggleFlag('registered')}
            />
            Registered
          </label>
          <label className="request-checkbox">
            <input
              type="checkbox"
              checked={request.approved}
              onChange={() => toggleFlag('approved')}
            />
            Approved
          </label>
          <label className="request-checkbox">
            <input type="checkbox" checked={request.paid} onChange={() => toggleFlag('paid')} />
            Paid
          </label>
        </div>
      </div>

      <h2 className="product-detail__section-title">Items</h2>
      <ul className="item-row-list">
        {items?.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            label={itemDisplay?.labels.get(item.id!) ?? '…'}
            flags={itemDisplay?.flags.get(item.id!)}
            onSetStatus={(status, previous, opts) =>
              handleSetStatus(item.id!, status, previous, opts)
            }
          />
        ))}
      </ul>
      {items && items.length === 0 && <p className="empty-state">No items in this request.</p>}
    </div>
  )
}
