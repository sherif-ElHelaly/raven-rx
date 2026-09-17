import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { homeTotals, loadCases } from '../../db/cases'
import { dueSoon } from '../../db/repo'
import { db } from '../../db/schema'
import { backUpNow } from '../../ui/backupExport'
import { daysSinceLastBackup } from '../../ui/localPrefs'
import './pages.css'

export function Home() {
  const totals = useLiveQuery(async () => homeTotals(await loadCases(db)), [])
  const due = useLiveQuery(() => dueSoon(db, 5), [])
  const hasOwnData = useLiveQuery(async () => (await db.requests.count()) > 0, [])
  const [backupAge, setBackupAge] = useState(daysSinceLastBackup)
  const [backingUp, setBackingUp] = useState(false)
  const showBackupNag = hasOwnData === true && (backupAge === null || backupAge > 7)

  const handleBackUpNow = async () => {
    setBackingUp(true)
    try {
      await backUpNow()
      setBackupAge(daysSinceLastBackup())
    } finally {
      setBackingUp(false)
    }
  }

  return (
    <div className="page">
      <div className="drugs-header">
        <h1 className="page__title">Home</h1>
        <Link to="/settings" className="btn btn--ghost">
          Settings
        </Link>
      </div>

      {showBackupNag && (
        <div className="warning-banner backup-nag">
          <span>
            {backupAge === null
              ? 'Your data isn’t backed up yet.'
              : `Last backup: ${backupAge} days ago.`}
          </span>
          <button
            type="button"
            className="btn btn--primary backup-nag__action"
            disabled={backingUp}
            onClick={handleBackUpNow}
          >
            {backingUp ? 'Preparing…' : 'Back up now'}
          </button>
        </div>
      )}

      <Link to="/items/owed" className="home-tile home-tile--link">
        <span className="home-tile__value">{totals?.owedTotal ?? 0} EGP</span>
        <span className="home-tile__label">
          Owed to you — {totals?.owedCases ?? 0} case{totals?.owedCases === 1 ? '' : 's'} not yet
          collected
        </span>
      </Link>

      <Link to="/items/open" className="home-tile home-tile--link">
        <span className="home-tile__value">{totals?.activeCases ?? 0}</span>
        <span className="home-tile__label">
          Active cases — meds: {totals?.openMeds.searching ?? 0} searching ·{' '}
          {totals?.openMeds.found ?? 0} found · {totals?.openMeds.transferred ?? 0} transferred
        </span>
      </Link>

      <Link to="/items/due" className="home-tile home-tile--link">
        <span className="home-tile__value">{due?.length ?? 0}</span>
        <span className="home-tile__label">Due for renewal in the next 5 days</span>
      </Link>

      <Link to="/items/stale" className="home-tile home-tile--link">
        <span className="home-tile__value">{totals?.staleCases ?? 0}</span>
        <span className="home-tile__label">Stale cases — open more than 3 days</span>
      </Link>

      <div className="home-links">
        <Link to="/shopping" className="btn btn--block">
          Shopping list
        </Link>
        <Link to="/locations" className="btn btn--block">
          Manage locations
        </Link>
      </div>
    </div>
  )
}
