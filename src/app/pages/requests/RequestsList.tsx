import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useSearchParams } from 'react-router-dom'
import { loadCases } from '../../../db/cases'
import { db } from '../../../db/schema'
import { CaseRow } from './CaseRow'
import './requests.css'

export function RequestsList() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'finished' ? 'finished' : 'active'
  const cases = useLiveQuery(() => loadCases(db), [])

  const active = (cases ?? []).filter((c) => !c.finished)
  const finished = (cases ?? [])
    .filter((c) => c.finished)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  const shown = tab === 'active' ? active : finished

  return (
    <div className="page">
      <div className="drugs-header">
        <h1 className="page__title">Requests</h1>
        <Link to="/add" className="btn btn--primary drugs-header__add">
          + New
        </Link>
      </div>

      <div className="segmented" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          className={`segmented__option${tab === 'active' ? ' segmented__option--active' : ''}`}
          onClick={() => setParams({}, { replace: true })}
        >
          Active <span className="segmented__count">{active.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'finished'}
          className={`segmented__option${tab === 'finished' ? ' segmented__option--active' : ''}`}
          onClick={() => setParams({ tab: 'finished' }, { replace: true })}
        >
          Finished <span className="segmented__count">{finished.length}</span>
        </button>
      </div>

      {cases && shown.length === 0 && (
        <p className="empty-state">
          {tab === 'active'
            ? 'No active cases. Tap + New to log one.'
            : 'Finished cases show up here once every med is closed and the fee is collected.'}
        </p>
      )}

      <ul className="request-list">
        {shown.map((c) => (
          <CaseRow key={c.request.id} summary={c} />
        ))}
      </ul>
    </div>
  )
}
