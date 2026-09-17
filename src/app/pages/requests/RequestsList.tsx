import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../../../db/schema'
import { maskCardNumber } from '../../../ui/format'
import { CLOSED_STATUSES } from './statusMeta'
import './requests.css'

export function RequestsList() {
  const requests = useLiveQuery(
    () => db.requests.orderBy('createdAt').reverse().toArray(),
    [],
  )
  const people = useLiveQuery(() => db.people.toArray(), [])
  const items = useLiveQuery(() => db.items.toArray(), [])

  const personById = new Map((people ?? []).map((p) => [p.id!, p]))

  const openCountByRequestId = new Map<number, number>()
  for (const item of items ?? []) {
    if (!CLOSED_STATUSES.includes(item.status)) {
      openCountByRequestId.set(item.requestId, (openCountByRequestId.get(item.requestId) ?? 0) + 1)
    }
  }

  return (
    <div className="page">
      <div className="drugs-header">
        <h1 className="page__title">Requests</h1>
        <Link to="/add" className="btn btn--primary drugs-header__add">
          + New
        </Link>
      </div>

      {requests && requests.length === 0 && (
        <p className="empty-state">No requests yet. Tap + New to log one.</p>
      )}

      <ul className="request-list">
        {requests?.map((r) => {
          const person = personById.get(r.personId)
          const openCount = openCountByRequestId.get(r.id!) ?? 0
          return (
            <li key={r.id}>
              <Link to={`/requests/${r.id}`} className="request-list__item">
                <div>
                  <span className="request-list__name">
                    {person?.name || (person ? maskCardNumber(person.cardNumber) : '…')}
                  </span>
                  <span className="request-list__meta">
                    {r.plan === 'monthly' ? 'Monthly' : 'Bimonthly'} ·{' '}
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="request-list__flags">
                  {openCount > 0 && <span className="badge badge--warn">{openCount} open</span>}
                  {r.registered && <span title="Registered">✓R</span>}
                  {r.approved && <span title="Approved">✓A</span>}
                  {r.paid && <span title="Paid">✓P</span>}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
