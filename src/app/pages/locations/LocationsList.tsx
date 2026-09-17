import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { mostUsedLocations } from '../../../db/repo'
import { db } from '../../../db/schema'
import './locations.css'

const TYPE_LABELS: Record<string, string> = {
  hospital_pharmacy: 'Hospital pharmacy',
  storage: 'Storage',
  external_hospital: 'External hospital',
  civilian_pharmacy: 'Civilian pharmacy',
}

export function LocationsList() {
  const navigate = useNavigate()
  const locations = useLiveQuery(() => mostUsedLocations(db), [])

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">Locations</span>
        <Link to="/locations/new" className="btn btn--ghost">
          + Add
        </Link>
      </div>

      {locations === undefined && <p className="empty-state">Loading…</p>}
      {locations && locations.length === 0 && (
        <p className="empty-state">No locations yet. Add pharmacies, storage and transfer points.</p>
      )}

      <ul className="location-list">
        {locations?.map((loc) => (
          <li key={loc.id}>
            <Link to={`/locations/${loc.id}/edit`} className="location-list__item">
              <div>
                <span className="location-list__name">{loc.name}</span>
                <span className="location-list__type">{TYPE_LABELS[loc.type] ?? loc.type}</span>
              </div>
              <div className="location-list__flags">
                {loc.needsTransferSlip && <span className="badge badge--muted">slip</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
