import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../../db/schema'
import { addItem, createRequest, findOrCreatePerson, hasOpenDuplicate, updatePerson } from '../../../db/repo'
import type { Plan, Presentation } from '../../../db/types'
import { search } from '../../../search/searchIndex'
import { useSearchIndex } from '../../../search/useSearchIndex'
import { personTitle } from '../../../ui/format'
import './requests.css'

// Egyptian military ranks, offered as suggestions (free text is still allowed).
const RANKS = [
  'جندي',
  'عريف',
  'رقيب',
  'رقيب أول',
  'مساعد',
  'مساعد أول',
  'ملازم',
  'ملازم أول',
  'نقيب',
  'رائد',
  'مقدم',
  'عقيد',
  'عميد',
  'لواء',
  'فريق',
  'فريق أول',
]

interface DraftItem {
  key: string
  productId: number
  presentationId: number
  label: string
  qty: number
}

export function NewRequest() {
  const navigate = useNavigate()
  const index = useSearchIndex()

  const [cardNumber, setCardNumber] = useState('')
  // null = untouched, so a known card shows the saved name/rank.
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [rankDraft, setRankDraft] = useState<string | null>(null)
  const [plan, setPlan] = useState<Plan>('monthly')
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])

  const [itemQuery, setItemQuery] = useState('')
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [selectedPresentationId, setSelectedPresentationId] = useState<number | null>(null)
  const [qty, setQty] = useState(1)
  const [duplicateWarning, setDuplicateWarning] = useState(false)
  const [creating, setCreating] = useState(false)

  const existingPerson = useLiveQuery(
    () => (cardNumber ? db.people.where('cardNumber').equals(cardNumber).first() : undefined),
    [cardNumber],
  )

  const name = nameDraft ?? existingPerson?.name ?? ''
  const rank = rankDraft ?? existingPerson?.rank ?? ''

  const changeCard = (value: string) => {
    setCardNumber(value)
    setNameDraft(null)
    setRankDraft(null)
  }

  const usedRanks = useLiveQuery(async () => {
    const people = await db.people.toArray()
    return [...new Set([...people.map((p) => p.rank?.trim()).filter(Boolean), ...RANKS])] as string[]
  }, [])

  const recentRequests = useLiveQuery(
    () => db.requests.orderBy('createdAt').reverse().limit(5).toArray(),
    [],
  )
  const recentPeople = useLiveQuery(async () => {
    if (!recentRequests) return []
    const ids = [...new Set(recentRequests.map((r) => r.personId))]
    const people = await db.people.bulkGet(ids)
    return people.filter((p): p is NonNullable<typeof p> => !!p)
  }, [recentRequests])

  const products = useLiveQuery(() => db.products.toArray(), [])
  const productById = useMemo(
    () => new Map((products ?? []).map((p) => [p.id!, p])),
    [products],
  )

  const searchResults = useMemo(() => {
    if (!index || itemQuery.trim().length < 2) return []
    return search(index, itemQuery, 10)
  }, [index, itemQuery])

  const presentationsForSelected = useLiveQuery(
    () =>
      selectedProductId !== null
        ? db.presentations.where('productId').equals(selectedProductId).toArray()
        : Promise.resolve<Presentation[]>([]),
    [selectedProductId],
  )

  const pickProduct = async (productId: number) => {
    setSelectedProductId(productId)
    setSelectedPresentationId(null)
    setItemQuery('')

    if (existingPerson) {
      setDuplicateWarning(await hasOpenDuplicate(db, existingPerson.id!, productId))
    } else {
      setDuplicateWarning(false)
    }
  }

  // Auto-select the only presentation when a product has just one.
  const singlePresentationId =
    presentationsForSelected && presentationsForSelected.length === 1
      ? presentationsForSelected[0]!.id!
      : null
  const effectivePresentationId = selectedPresentationId ?? singlePresentationId

  const addDraftItem = () => {
    if (selectedProductId === null || effectivePresentationId === null) return
    const product = productById.get(selectedProductId)
    const presentation = presentationsForSelected?.find((p) => p.id === effectivePresentationId)
    const label = [product?.nameEn, presentation?.strength, presentation?.form]
      .filter(Boolean)
      .join(' ')

    setDraftItems((prev) => [
      ...prev,
      {
        key: `${effectivePresentationId}-${Date.now()}`,
        productId: selectedProductId,
        presentationId: effectivePresentationId,
        label,
        qty,
      },
    ])
    setSelectedProductId(null)
    setSelectedPresentationId(null)
    setQty(1)
    setDuplicateWarning(false)
  }

  const removeDraftItem = (key: string) => {
    setDraftItems((prev) => prev.filter((i) => i.key !== key))
  }

  const canCreate = cardNumber.trim().length > 0 && draftItems.length > 0 && !creating

  const handleCreate = async () => {
    if (!canCreate) return
    setCreating(true)
    try {
      const details = { name: name.trim() || undefined, rank: rank.trim() || undefined }
      const person = await findOrCreatePerson(db, cardNumber.trim(), details)
      if (person.name !== details.name || person.rank !== details.rank) {
        await updatePerson(db, person.id!, details)
      }
      const requestId = await createRequest(db, person.id!, plan)
      for (const item of draftItems) {
        await addItem(db, requestId, item.presentationId, item.qty)
      }
      navigate(`/requests/${requestId}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="page">
      <h1 className="page__title">New Request</h1>

      <label className="field">
        <span className="field__label">Card number</span>
        <input
          className="field__input field__input--mono"
          inputMode="numeric"
          pattern="[0-9]*"
          value={cardNumber}
          onChange={(e) => changeCard(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="e.g. 12345"
        />
      </label>

      {existingPerson && (
        <p className="new-request__existing">
          Returning: {personTitle(existingPerson)} — details filled in from last time
        </p>
      )}

      <div className="new-request__person">
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="field__input"
            value={name}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="e.g. أحمد علي"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span className="field__label">Rank · رتبة</span>
          <input
            className="field__input"
            value={rank}
            onChange={(e) => setRankDraft(e.target.value)}
            list="rank-options"
            placeholder="e.g. عقيد"
            dir="auto"
            autoComplete="off"
          />
          <datalist id="rank-options">
            {usedRanks?.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
      </div>

      {!cardNumber && recentPeople && recentPeople.length > 0 && (
        <div className="chip-row new-request__recent">
          {recentPeople.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              onClick={() => changeCard(p.cardNumber)}
            >
              {personTitle(p)}
            </button>
          ))}
        </div>
      )}

      <div className="field">
        <span className="field__label">Plan</span>
        <div className="plan-toggle">
          <button
            type="button"
            className={`chip${plan === 'monthly' ? ' chip--active' : ''}`}
            onClick={() => setPlan('monthly')}
          >
            Monthly · 5 EGP
          </button>
          <button
            type="button"
            className={`chip${plan === 'bimonthly' ? ' chip--active' : ''}`}
            onClick={() => setPlan('bimonthly')}
          >
            Bimonthly · 10 EGP
          </button>
        </div>
      </div>

      <hr className="new-request__divider" />

      <h2 className="product-detail__section-title">Add items</h2>

      {selectedProductId === null ? (
        <label className="field">
          <span className="field__label">Search medication</span>
          <input
            className="field__input"
            value={itemQuery}
            onChange={(e) => setItemQuery(e.target.value)}
            placeholder="Type 2-3 letters…"
          />
        </label>
      ) : null}

      {selectedProductId === null && searchResults.length > 0 && (
        <ul className="new-request__results">
          {searchResults.map((r) => {
            const p = productById.get(r.productId)
            if (!p) return null
            return (
              <li key={r.productId}>
                <button type="button" onClick={() => pickProduct(r.productId)}>
                  {p.nameEn} <span dir="rtl">{p.nameAr}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {selectedProductId !== null && (
        <div className="new-request__picked">
          <p className="new-request__picked-name">{productById.get(selectedProductId)?.nameEn}</p>

          {duplicateWarning && (
            <p className="warning-banner">
              This card already has an open request for this medication. Add anyway.
            </p>
          )}

          {presentationsForSelected && presentationsForSelected.length > 1 && (
            <div className="chip-row">
              {presentationsForSelected.map((pres) => (
                <button
                  key={pres.id}
                  type="button"
                  className={`chip${selectedPresentationId === pres.id ? ' chip--active' : ''}`}
                  onClick={() => setSelectedPresentationId(pres.id!)}
                >
                  {pres.strength} {pres.form}
                </button>
              ))}
            </div>
          )}

          <label className="field new-request__qty">
            <span className="field__label">Qty</span>
            <input
              className="field__input"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>

          <div className="new-request__picked-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSelectedProductId(null)
                setSelectedPresentationId(null)
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={effectivePresentationId === null}
              onClick={addDraftItem}
            >
              Add another
            </button>
          </div>
        </div>
      )}

      {draftItems.length > 0 && (
        <ul className="new-request__draft-list">
          {draftItems.map((item) => (
            <li key={item.key}>
              <span>
                {item.label} ×{item.qty}
              </span>
              <button type="button" onClick={() => removeDraftItem(item.key)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="btn btn--primary btn--block new-request__create"
        disabled={!canCreate}
        onClick={handleCreate}
      >
        {creating ? 'Creating…' : `Create Request (${draftItems.length} item${draftItems.length === 1 ? '' : 's'})`}
      </button>
    </div>
  )
}
