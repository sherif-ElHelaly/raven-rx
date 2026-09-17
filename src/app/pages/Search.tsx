import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { OPEN_STATUSES } from '../../db/repo'
import { db } from '../../db/schema'
import { normalizeText } from '../../search/normalize'
import { search } from '../../search/searchIndex'
import { useSearchIndex } from '../../search/useSearchIndex'
import { maskCardNumber } from '../../ui/format'
import { STATUS_LABELS } from './requests/statusMeta'
import './pages.css'
import './requests/requests.css'

export function Search() {
  const [query, setQuery] = useState('')
  const index = useSearchIndex()

  const products = useLiveQuery(() => db.products.toArray(), [])
  const productById = new Map((products ?? []).map((p) => [p.id!, p]))
  const people = useLiveQuery(() => db.people.toArray(), [])

  const trimmed = query.trim()
  const active = trimmed.length >= 2

  const productResults = useMemo(() => {
    if (!active || !index) return []
    return search(index, trimmed, 20)
  }, [active, index, trimmed])

  const productIds = new Set(productResults.map((r) => r.productId))

  const peopleResults = useMemo(() => {
    if (!active || !people) return []
    const norm = normalizeText(trimmed)
    const digits = trimmed.replace(/[^0-9]/g, '')
    return people.filter(
      (p) =>
        (p.name && normalizeText(p.name).includes(norm)) ||
        (digits.length > 0 && p.cardNumber.includes(digits)),
    )
  }, [active, people, trimmed])

  const items = useLiveQuery(() => db.items.toArray(), [])
  const presentations = useLiveQuery(() => db.presentations.toArray(), [])
  const presentationById = new Map((presentations ?? []).map((p) => [p.id!, p]))

  const matchingItems =
    productIds.size === 0
      ? []
      : (items ?? []).filter((i) => {
          const pres = presentationById.get(i.presentationId)
          return pres && productIds.has(pres.productId)
        })

  const openItems = matchingItems.filter((i) => OPEN_STATUSES.includes(i.status))
  const pastItems = matchingItems.filter((i) => !OPEN_STATUSES.includes(i.status))

  const personById = new Map((people ?? []).map((p) => [p.id!, p]))
  const requests = useLiveQuery(() => db.requests.toArray(), [])
  const requestById = new Map((requests ?? []).map((r) => [r.id!, r]))

  const itemLabel = (item: (typeof matchingItems)[number]) => {
    const request = requestById.get(item.requestId)
    const person = request ? personById.get(request.personId) : undefined
    return person ? person.name || maskCardNumber(person.cardNumber) : '…'
  }

  return (
    <div className="page">
      <h1 className="page__title">Search</h1>
      <input
        className="field__input drugs-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Drug name, card number, person…"
        autoFocus
      />

      {!active && <p className="page__hint">Type at least 2 characters.</p>}

      {active && (
        <>
          {productResults.length > 0 && (
            <>
              <h2 className="product-detail__section-title">Medications</h2>
              <ul className="drug-list">
                {productResults.map((r) => {
                  const p = productById.get(r.productId)
                  if (!p) return null
                  return (
                    <li key={p.id}>
                      <Link to={`/drugs/${p.id}`} className="drug-list__item">
                        <div className="drug-list__names">
                          <span className="drug-list__name-en">{p.nameEn}</span>
                          <span className="drug-list__name-ar" dir="rtl">
                            {p.nameAr}
                          </span>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {peopleResults.length > 0 && (
            <>
              <h2 className="product-detail__section-title">People</h2>
              <ul className="request-list">
                {peopleResults.map((p) => (
                  <li key={p.id}>
                    <Link to={`/people/${p.id}`} className="request-list__item">
                      <span className="request-list__name">
                        {p.name || maskCardNumber(p.cardNumber)}
                      </span>
                      <span className="request-list__meta">{maskCardNumber(p.cardNumber)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {openItems.length > 0 && (
            <>
              <h2 className="product-detail__section-title">Open items</h2>
              <ul className="request-list">
                {openItems.map((item) => (
                  <li key={item.id}>
                    <Link to={`/requests/${item.requestId}`} className="request-list__item">
                      <span className="request-list__name">{itemLabel(item)}</span>
                      <span className={`badge item-row__status item-row__status--${item.status}`}>{STATUS_LABELS[item.status]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {pastItems.length > 0 && (
            <>
              <h2 className="product-detail__section-title">Past items</h2>
              <ul className="request-list">
                {pastItems.map((item) => (
                  <li key={item.id}>
                    <Link to={`/requests/${item.requestId}`} className="request-list__item">
                      <span className="request-list__name">{itemLabel(item)}</span>
                      <span className={`badge item-row__status item-row__status--${item.status}`}>{STATUS_LABELS[item.status]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {productResults.length === 0 && peopleResults.length === 0 && matchingItems.length === 0 && (
            <p className="empty-state">No matches.</p>
          )}
        </>
      )}
    </div>
  )
}
