import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type ReactNode } from 'react'
import { db } from '../../../db/schema'
import type { Presentation, Product } from '../../../db/types'
import { search } from '../../../search/searchIndex'
import { useSearchIndex } from '../../../search/useSearchIndex'
import '../requests/requests.css'

export interface SuggestedMed {
  key: string
  presentationId: number
  label: string
  hint?: string
}

interface MedPickerBase {
  title: string
  onClose: () => void
  excludeProductIds?: number[]
  // Rendered above the search (e.g. "Back to prescribed med").
  header?: ReactNode
}

type MedPickerProps = MedPickerBase &
  (
    | { mode: 'product'; onPick: (product: Product) => void }
    | {
        mode: 'presentation'
        onPick: (presentation: Presentation, product: Product) => void
        suggested?: SuggestedMed[]
        excludePresentationIds?: number[]
      }
  )

function presLabel(p: Presentation): string {
  return [p.strength, p.form].filter(Boolean).join(' ') || p.form
}

// Bottom sheet to choose a med: search by English/Arabic name or ingredient,
// then (in 'presentation' mode) its strength.
export function MedPicker(props: MedPickerProps) {
  const { title, onClose, header, excludeProductIds = [] } = props
  const index = useSearchIndex()
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState<Product | null>(null)

  const products = useLiveQuery(() => db.products.toArray(), [])
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id!, p])), [products])
  const results = useMemo(() => {
    if (!index || query.trim().length < 2) return []
    return search(index, query, 12).filter((r) => !excludeProductIds.includes(r.productId))
  }, [index, query, excludeProductIds])

  const excludePres = props.mode === 'presentation' ? (props.excludePresentationIds ?? []) : []
  const strengths = useLiveQuery(
    () =>
      product
        ? db.presentations.where('productId').equals(product.id!).toArray()
        : Promise.resolve<Presentation[]>([]),
    [product],
  )
  const strengthOptions = (strengths ?? []).filter((p) => !excludePres.includes(p.id!))

  const pickProduct = (p: Product) => {
    if (props.mode === 'product') props.onPick(p)
    else setProduct(p)
  }

  const pickSuggested = async (s: SuggestedMed) => {
    if (props.mode !== 'presentation') return
    const pres = await db.presentations.get(s.presentationId)
    const prod = pres ? await db.products.get(pres.productId) : undefined
    if (pres && prod) props.onPick(pres, prod)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet--tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__handle" />
        <p className="sheet__title">{product ? `${title} — ${product.nameEn}` : title}</p>

        {product && props.mode === 'presentation' ? (
          <>
            {strengths && strengthOptions.length === 0 && (
              <p className="empty-state">
                No other strengths saved for {product.nameEn}. Add one from its page in Drugs first.
              </p>
            )}
            {strengthOptions.map((pres) => (
              <button
                key={pres.id}
                type="button"
                className="sheet__option"
                onClick={() => props.onPick(pres, product)}
              >
                {presLabel(pres)}
                {pres.unregistered && <span className="badge badge--warn"> unregistered</span>}
              </button>
            ))}
            <button type="button" className="sheet__cancel" onClick={() => setProduct(null)}>
              ← Other med
            </button>
          </>
        ) : (
          <>
            {header}
            {props.mode === 'presentation' && props.suggested && props.suggested.length > 0 && (
              <>
                <p className="sheet__subtitle">Suggested</p>
                {props.suggested.map((s) => (
                  <button key={s.key} type="button" className="sheet__option" onClick={() => pickSuggested(s)}>
                    {s.label}
                    {s.hint && <span className="sheet__option-hint">{s.hint}</span>}
                  </button>
                ))}
              </>
            )}
            <input
              className="field__input med-picker__search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any med — English, عربي, ingredient…"
            />
            {results.map((r) => {
              const p = productById.get(r.productId)
              if (!p) return null
              return (
                <button key={p.id} type="button" className="sheet__option" onClick={() => pickProduct(p)}>
                  {p.nameEn}
                  {p.nameAr !== p.nameEn && (
                    <span className="sheet__option-hint" dir="rtl">
                      {p.nameAr}
                    </span>
                  )}
                </button>
              )
            })}
            {query.trim().length >= 2 && index && results.length === 0 && (
              <p className="empty-state">No matching meds.</p>
            )}
          </>
        )}

        <button type="button" className="sheet__cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
