import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { dueSoon, OPEN_STATUSES, staleItems } from '../../db/repo'
import { db } from '../../db/schema'
import type { Item } from '../../db/types'
import { maskCardNumber } from '../../ui/format'
import { STATUS_LABELS } from './requests/statusMeta'
import './pages.css'
import './requests/requests.css'

type Filter = 'open' | 'due' | 'stale' | 'owed'

const TITLES: Record<Filter, string> = {
  open: 'Open items',
  due: 'Due for renewal',
  stale: 'Stale items',
  owed: 'Money owed',
}

async function itemsForFilter(filter: Filter): Promise<Item[]> {
  if (filter === 'open') return db.items.where('status').anyOf(OPEN_STATUSES).toArray()
  if (filter === 'stale') return staleItems(db, 3)
  if (filter === 'owed') {
    return db.items
      .where('status')
      .equals('delivered')
      .filter((i) => !i.feeRefunded)
      .toArray()
  }
  return []
}

export function ItemsFiltered() {
  const { filter } = useParams<{ filter: Filter }>()
  const navigate = useNavigate()
  const f = (filter ?? 'open') as Filter

  const dueEntries = useLiveQuery(() => (f === 'due' ? dueSoon(db, 5) : Promise.resolve([])), [f])
  const items = useLiveQuery(() => (f === 'due' ? Promise.resolve([]) : itemsForFilter(f)), [f])

  const rows = useLiveQuery(async () => {
    if (!items || items.length === 0) return []
    const requestIds = [...new Set(items.map((i) => i.requestId))]
    const requests = await db.requests.bulkGet(requestIds)
    const requestById = new Map(requests.filter((r): r is NonNullable<typeof r> => !!r).map((r) => [r.id!, r]))
    const personIds = [...new Set([...requestById.values()].map((r) => r.personId))]
    const people = await db.people.bulkGet(personIds)
    const personById = new Map(people.filter((p): p is NonNullable<typeof p> => !!p).map((p) => [p.id!, p]))
    const presentationIds = [...new Set(items.map((i) => i.presentationId))]
    const presentations = await db.presentations.bulkGet(presentationIds)
    const presentationById = new Map(
      presentations.filter((p): p is NonNullable<typeof p> => !!p).map((p) => [p.id!, p]),
    )
    const productIds = [...new Set([...presentationById.values()].map((p) => p.productId))]
    const products = await db.products.bulkGet(productIds)
    const productById = new Map(products.filter((p): p is NonNullable<typeof p> => !!p).map((p) => [p.id!, p]))

    return items.map((item) => {
      const request = requestById.get(item.requestId)
      const person = request ? personById.get(request.personId) : undefined
      const pres = presentationById.get(item.presentationId)
      const prod = pres ? productById.get(pres.productId) : undefined
      return {
        item,
        requestId: item.requestId,
        personLabel: person ? person.name || maskCardNumber(person.cardNumber) : '…',
        drugLabel: [prod?.nameEn ?? 'Unknown', pres?.strength, pres?.form].filter(Boolean).join(' '),
      }
    })
  }, [items])

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">{TITLES[f]}</span>
      </div>

      {f === 'due' && (
        <ul className="request-list">
          {dueEntries?.map((entry) => (
            <li key={entry.request.id}>
              <Link to={`/people/${entry.person.id}`} className="request-list__item">
                <span className="request-list__name">
                  {entry.person.name || maskCardNumber(entry.person.cardNumber)}
                </span>
                <span className="request-list__meta">
                  Due {new Date(entry.request.nextDueDate).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
          {dueEntries && dueEntries.length === 0 && (
            <p className="empty-state">Nobody due for renewal in the next 5 days.</p>
          )}
        </ul>
      )}

      {f !== 'due' && (
        <ul className="request-list">
          {rows?.map((row) => (
            <li key={row.item.id}>
              <Link to={`/requests/${row.requestId}`} className="request-list__item">
                <div>
                  <span className="request-list__name">{row.drugLabel}</span>
                  <span className="request-list__meta">{row.personLabel}</span>
                </div>
                <span className={`badge item-row__status item-row__status--${row.item.status}`}>{STATUS_LABELS[row.item.status]}</span>
              </Link>
            </li>
          ))}
          {rows && rows.length === 0 && <p className="empty-state">Nothing here.</p>}
        </ul>
      )}
    </div>
  )
}
