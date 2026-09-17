import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { isStaleCase, loadCases, type CaseSummary } from '../../db/cases'
import { dueSoon } from '../../db/repo'
import { db } from '../../db/schema'
import { personTitle } from '../../ui/format'
import { CaseRow } from './requests/CaseRow'
import './pages.css'
import './requests/requests.css'

type Filter = 'open' | 'due' | 'stale' | 'owed'

const TITLES: Record<Filter, string> = {
  open: 'Active cases',
  due: 'Due for renewal',
  stale: 'Stale cases',
  owed: 'Money owed',
}

const EMPTY: Record<Filter, string> = {
  open: 'No active cases.',
  due: 'Nobody due for renewal in the next 5 days.',
  stale: 'No case has been open for more than 3 days.',
  owed: 'Nothing owed — every fee is collected.',
}

function casesForFilter(cases: CaseSummary[], filter: Filter): CaseSummary[] {
  if (filter === 'owed') return cases.filter((c) => c.owed > 0)
  if (filter === 'stale') return cases.filter((c) => isStaleCase(c))
  if (filter === 'open') return cases.filter((c) => !c.finished)
  return []
}

export function ItemsFiltered() {
  const { filter } = useParams<{ filter: Filter }>()
  const navigate = useNavigate()
  const f: Filter = filter && filter in TITLES ? (filter as Filter) : 'open'

  const dueEntries = useLiveQuery(() => (f === 'due' ? dueSoon(db, 5) : Promise.resolve([])), [f])
  const cases = useLiveQuery(() => (f === 'due' ? Promise.resolve([]) : loadCases(db)), [f])
  const shown = casesForFilter(cases ?? [], f)
  const owedTotal = shown.reduce((sum, c) => sum + c.owed, 0)

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">{TITLES[f]}</span>
      </div>

      {f === 'owed' && shown.length > 0 && (
        <p className="case-list__total">
          {owedTotal} EGP across {shown.length} case{shown.length === 1 ? '' : 's'}
        </p>
      )}

      {f === 'due' ? (
        <ul className="request-list">
          {dueEntries?.map((entry) => (
            <li key={entry.request.id}>
              <Link to={`/people/${entry.person.id}`} className="request-list__item">
                <span className="request-list__name">{personTitle(entry.person)}</span>
                <span className="request-list__meta">
                  Due {new Date(entry.request.nextDueDate).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
          {dueEntries && dueEntries.length === 0 && <p className="empty-state">{EMPTY.due}</p>}
        </ul>
      ) : (
        <ul className="request-list">
          {shown.map((c) => (
            <CaseRow key={c.request.id} summary={c} />
          ))}
          {cases && shown.length === 0 && <p className="empty-state">{EMPTY[f]}</p>}
        </ul>
      )}
    </div>
  )
}
