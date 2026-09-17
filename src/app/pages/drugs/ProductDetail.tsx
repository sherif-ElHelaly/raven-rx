import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db } from '../../../db/schema'
import {
  type AlternativeItem,
  getAlternatives,
  getIngredientNamesForProduct,
  lastFoundWhere,
} from '../../../db/repo'
import { BlobImage } from '../../../ui/BlobImage'
import './drugs.css'

const TIER_LABELS: Record<AlternativeItem['tier'], string> = {
  exact: '🟢 Exact',
  close: '🟡 Close',
  class: '🔴 Same class — needs prescriber approval',
}

export function ProductDetail() {
  const { productId } = useParams()
  const id = Number(productId)
  const navigate = useNavigate()
  const [openAlternativesFor, setOpenAlternativesFor] = useState<number | null>(null)

  const product = useLiveQuery(() => db.products.get(id), [id])
  const presentations = useLiveQuery(
    () => db.presentations.where('productId').equals(id).toArray(),
    [id],
  )
  const ingredientNames = useLiveQuery(() => getIngredientNamesForProduct(db, id), [id])
  const lastFound = useLiveQuery(() => lastFoundWhere(db, id), [id])
  const alternatives = useLiveQuery(
    () =>
      openAlternativesFor !== null ? getAlternatives(db, openAlternativesFor) : Promise.resolve(null),
    [openAlternativesFor],
  )

  if (product === undefined) return <div className="page">Loading…</div>
  if (product === null || !product) {
    return (
      <div className="page">
        <p className="empty-state">Medication not found.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">{product.nameEn}</span>
        <Link to={`/drugs/${id}/edit`} className="btn btn--ghost">
          Edit
        </Link>
      </div>

      <div className="product-detail">
        <div className="product-detail__names">
          {product.photo && (
            <BlobImage blob={product.photo} alt={product.nameEn} className="product-detail__photo" />
          )}
          <h1 className="page__title">{product.nameEn}</h1>
          <p className="product-detail__ar" dir="rtl">
            {product.nameAr}
          </p>
        </div>

        {!product.verified && <span className="badge badge--muted">unverified</span>}

        {ingredientNames && ingredientNames.length > 0 && (
          <p className="product-detail__ingredients">{ingredientNames.join(' + ')}</p>
        )}

        {product.categories.length > 0 && (
          <div className="chip-row">
            {product.categories.map((c) => (
              <span key={c} className="chip">
                {c}
              </span>
            ))}
          </div>
        )}

        {product.manufacturer && (
          <p className="product-detail__meta">Manufacturer: {product.manufacturer}</p>
        )}
        {product.notes && <p className="product-detail__meta">{product.notes}</p>}

        <p className="product-detail__meta">
          {lastFound === undefined && 'Loading last-found history…'}
          {lastFound === null && 'Never found in the hospital yet.'}
          {lastFound && (
            <>
              Last found: {lastFound.locationName} ·{' '}
              {new Date(lastFound.lastAt).toLocaleDateString()} ({lastFound.count}× total)
            </>
          )}
        </p>

        <div className="product-detail__section-head">
          <h2 className="product-detail__section-title">Presentations</h2>
          <Link to={`/drugs/${id}/presentations/new`} className="btn btn--ghost">
            + Add
          </Link>
        </div>

        {presentations && presentations.length === 0 && (
          <p className="empty-state">No presentations yet.</p>
        )}

        <ul className="presentation-list">
          {presentations?.map((pres) => (
            <li key={pres.id} className="presentation-list__entry">
              <div className="presentation-list__row">
                <BlobImage
                  blob={pres.photo ?? product.photo}
                  alt=""
                  className="photo-thumb"
                />
                <Link
                  to={`/drugs/${id}/presentations/${pres.id}/edit`}
                  className="presentation-list__item"
                >
                  <span className="presentation-list__strength">
                    {pres.strength ? `${pres.strength} ` : ''}
                    {pres.form}
                  </span>
                  <span className="presentation-list__flags">
                    {pres.fridge && <span aria-label="requires fridge">❄️</span>}
                    {pres.controlled && <span aria-label="controlled drug">⚠️</span>}
                  </span>
                </Link>
                <button
                  type="button"
                  className="btn btn--ghost presentation-list__alt-toggle"
                  onClick={() =>
                    setOpenAlternativesFor(openAlternativesFor === pres.id ? null : pres.id!)
                  }
                >
                  بديل
                </button>
              </div>

              {openAlternativesFor === pres.id && (
                <div className="alternatives-panel">
                  {alternatives === undefined && (
                    <p className="empty-state">Loading…</p>
                  )}
                  {alternatives && alternatives.length === 0 && (
                    <p className="empty-state">No known alternatives yet.</p>
                  )}
                  {alternatives && alternatives.length > 0 && (
                    <ul className="alternatives-list">
                      {alternatives.map((alt) => (
                        <li key={`${alt.product.id}-${alt.presentation.id}`}>
                          <Link
                            to={`/drugs/${alt.product.id}`}
                            className={`alternatives-list__item alternatives-list__item--${alt.tier}`}
                          >
                            <span className="alternatives-list__tier">
                              {TIER_LABELS[alt.tier]}
                            </span>
                            <span className="alternatives-list__name">
                              {alt.product.nameEn} — {alt.presentation.strength}{' '}
                              {alt.presentation.form}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
