import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../../../db/schema'
import type { Category } from '../../../db/types'
import { search } from '../../../search/searchIndex'
import { useSearchIndex } from '../../../search/useSearchIndex'
import { BlobImage } from '../../../ui/BlobImage'
import './drugs.css'

export function ProductList() {
  const [query, setQuery] = useState('')
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(new Set())

  const index = useSearchIndex()
  const products = useLiveQuery(() => db.products.toArray(), [])
  const presentations = useLiveQuery(() => db.presentations.toArray(), [])

  const categoryList = useMemo(() => {
    if (!products) return []
    const counts = new Map<Category, number>()
    for (const p of products) {
      for (const c of p.categories) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [products])

  const flagsByProductId = useMemo(() => {
    const map = new Map<number, { fridge: boolean; controlled: boolean }>()
    for (const p of presentations ?? []) {
      const flags = map.get(p.productId) ?? { fridge: false, controlled: false }
      if (p.fridge) flags.fridge = true
      if (p.controlled) flags.controlled = true
      map.set(p.productId, flags)
    }
    return map
  }, [presentations])

  const results = useMemo(() => {
    if (!products) return []

    let list = products
    if (activeCategories.size > 0) {
      list = list.filter((p) => p.categories.some((c) => activeCategories.has(c)))
    }

    if (query.trim() && index) {
      const scored = search(index, query, 200)
      const order = new Map(scored.map((r, i) => [r.productId, i]))
      list = list.filter((p) => order.has(p.id!))
      list = [...list].sort((a, b) => order.get(a.id!)! - order.get(b.id!)!)
    } else {
      list = [...list].sort((a, b) => a.nameEn.localeCompare(b.nameEn))
    }

    return list
  }, [products, query, index, activeCategories])

  const toggleCategory = (c: Category) => {
    setActiveCategories((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  return (
    <div className="page">
      <div className="drugs-header">
        <h1 className="page__title">Drugs</h1>
        <Link to="/drugs/new" className="btn btn--primary drugs-header__add">
          + New
        </Link>
      </div>

      <input
        className="field__input drugs-search"
        type="search"
        inputMode="search"
        placeholder="Search name, ingredient…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {categoryList.length > 0 && (
        <div className="chip-row drugs-categories">
          {categoryList.map(([category, count]) => (
            <button
              key={category}
              type="button"
              className={`chip${activeCategories.has(category) ? ' chip--active' : ''}`}
              onClick={() => toggleCategory(category)}
            >
              {category} ({count})
            </button>
          ))}
        </div>
      )}

      {products === undefined && <p className="empty-state">Loading…</p>}
      {products && results.length === 0 && (
        <p className="empty-state">No medications match.</p>
      )}

      <ul className="drug-list">
        {results.map((p) => {
          const flags = flagsByProductId.get(p.id!)
          return (
            <li key={p.id}>
              <Link to={`/drugs/${p.id}`} className="drug-list__item">
                {p.photo && <BlobImage blob={p.photo} alt="" className="photo-thumb" />}
                <div className="drug-list__names">
                  <span className="drug-list__name-en">{p.nameEn}</span>
                  <span className="drug-list__name-ar" dir="rtl">
                    {p.nameAr}
                  </span>
                </div>
                <div className="drug-list__flags">
                  {!p.verified && <span className="badge badge--muted">unverified</span>}
                  {flags?.fridge && <span aria-label="requires fridge">❄️</span>}
                  {flags?.controlled && <span aria-label="controlled drug">⚠️</span>}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
