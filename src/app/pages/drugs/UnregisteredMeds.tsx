import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { db } from '../../../db/schema'
import { unregisteredMeds } from '../../../db/scanCase'
import './drugs.css'

// Meds a case-sheet scan couldn't find in the database. Each one is already
// usable in cases; filling in its details (and saving) takes it off this list.
export function UnregisteredMeds() {
  const navigate = useNavigate()
  const entries = useLiveQuery(() => unregisteredMeds(db), [])

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">Unregistered meds</span>
      </div>

      <p className="unregistered__intro">
        Added from scanned case sheets. Tap one to fill in its English name, ingredients and strength when you have time.
      </p>

      {entries && entries.length === 0 && <p className="empty-state">All caught up — nothing to fill in.</p>}

      <ul className="drug-list">
        {entries?.map(({ product, presentations }) => (
          <li key={product.id}>
            <Link
              to={product.unregistered ? `/drugs/${product.id}/edit` : `/drugs/${product.id}`}
              className="drug-list__item"
            >
              <div className="drug-list__names">
                <span className="drug-list__name-en" dir="auto">
                  {product.unregistered ? product.nameAr : product.nameEn}
                </span>
                <span className="drug-list__name-ar">
                  {product.unregistered
                    ? 'New drug · needs details'
                    : `Check strength: ${presentations
                        .map((p) => `${p.strength ?? 'not set'} ${p.form}`)
                        .join(', ')}`}
                </span>
              </div>
              <div className="drug-list__flags">
                <span className="badge badge--warn">{product.unregistered ? 'drug' : 'strength'}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
