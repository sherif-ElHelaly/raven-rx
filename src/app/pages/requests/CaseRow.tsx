import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { CaseSummary } from '../../../db/cases'
import { maskCardNumber, personTitle } from '../../../ui/format'
import { STATUS_LABELS, STATUS_ORDER } from './statusMeta'

interface CaseRowProps {
  summary: CaseSummary
  // Optional extra line, e.g. which drug matched a search.
  detail?: ReactNode
}

// One row per case — the whole request with all its meds, never one row per med.
export function CaseRow({ summary, detail }: CaseRowProps) {
  const { request, person, items, counts, owed, finished } = summary
  const progress = STATUS_ORDER.filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${STATUS_LABELS[s].toLowerCase()}`)
    .join(' · ')

  return (
    <li>
      <Link to={`/requests/${request.id}`} className="request-list__item case-row">
        <div className="case-row__body">
          <span className="request-list__name">{personTitle(person)}</span>
          <span className="request-list__meta">
            {person && (person.name || person.rank) ? `${maskCardNumber(person.cardNumber)} · ` : ''}
            {request.plan === 'monthly' ? 'Monthly' : 'Bimonthly'} ·{' '}
            {new Date(request.createdAt).toLocaleDateString()} · {items.length} med
            {items.length === 1 ? '' : 's'}
          </span>
          {progress && <span className="case-row__progress">{progress}</span>}
          {detail && <span className="case-row__detail">{detail}</span>}
        </div>
        <div className="case-row__side">
          {owed > 0 && <span className="badge badge--warn case-row__owed">{owed} EGP</span>}
          {finished && <span className="badge badge--done">Finished</span>}
          {!finished && owed === 0 && items.length > 0 && (
            <span className="badge badge--muted">Collected</span>
          )}
        </div>
      </Link>
    </li>
  )
}
