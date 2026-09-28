import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db } from '../../../db/schema'
import { unregisteredMeds } from '../../../db/scanCase'
import { RemoveMedSheet, type RemoveTarget } from './RemoveMedSheet'
import './drugs.css'

// Meds a case-sheet scan couldn't find in the database. Each one is already
// usable in cases; filling in its details (and saving) takes it off this list.
// A misread one can be replaced by the right med, or deleted.
export function UnregisteredMeds() {
  const navigate = useNavigate()
  const entries = useLiveQuery(() => unregisteredMeds(db), [])
  const [removing, setRemoving] = useState<RemoveTarget | null>(null)

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">Unregistered meds</span>
      </div>

      <p className="unregistered__intro">
        Added from scanned case sheets. Edit one to fill in its English name, ingredients and
        strength. If a scan misread it, Remove lets you replace it with the right med.
      </p>

      {entries && entries.length === 0 && <p className="empty-state">All caught up — nothing to fill in.</p>}

      <ul className="drug-list">
        {entries?.flatMap(({ product, presentations }) =>
          product.unregistered
            ? [
                <li key={`p-${product.id}`} className="unregistered-entry">
                  <Link to={`/drugs/${product.id}`} className="drug-list__item">
                    <div className="drug-list__names">
                      <span className="drug-list__name-en" dir="auto">
                        {product.nameAr}
                      </span>
                      <span className="drug-list__name-ar">
                        New drug · {presentations.map((p) => `${p.strength ?? 'no strength'} ${p.form}`).join(', ')}
                      </span>
                    </div>
                    <div className="drug-list__flags">
                      <span className="badge badge--warn">drug</span>
                    </div>
                  </Link>
                  <div className="unregistered-entry__actions">
                    <Link to={`/drugs/${product.id}/edit`} className="btn btn--ghost">
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setRemoving({ kind: 'drug', product })}
                    >
                      Remove
                    </button>
                  </div>
                </li>,
              ]
            : presentations.map((pres) => (
                <li key={`s-${pres.id}`} className="unregistered-entry">
                  <Link to={`/drugs/${product.id}?pres=${pres.id}`} className="drug-list__item">
                    <div className="drug-list__names">
                      <span className="drug-list__name-en" dir="auto">
                        {product.nameEn}
                      </span>
                      <span className="drug-list__name-ar">
                        Check strength: {pres.strength ?? 'not set'} {pres.form}
                      </span>
                    </div>
                    <div className="drug-list__flags">
                      <span className="badge badge--warn">strength</span>
                    </div>
                  </Link>
                  <div className="unregistered-entry__actions">
                    <Link
                      to={`/drugs/${product.id}/presentations/${pres.id}/edit`}
                      className="btn btn--ghost"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setRemoving({ kind: 'strength', product, presentation: pres })}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              )),
        )}
      </ul>

      {removing && <RemoveMedSheet target={removing} onClose={() => setRemoving(null)} />}
    </div>
  )
}
