import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../../../db/schema'
import { createProduct, getIngredientNamesForProduct, updateProduct } from '../../../db/repo'
import { CATEGORIES, type Category } from '../../../db/types'
import { normalizeText } from '../../../search/normalize'
import { PhotoInput } from '../../../ui/PhotoInput'
import './drugs.css'

export function ProductForm() {
  const { productId } = useParams()
  const isEdit = productId !== undefined
  const id = isEdit ? Number(productId) : undefined
  const navigate = useNavigate()

  const existing = useLiveQuery(
    () => (id !== undefined ? db.products.get(id) : undefined),
    [id],
  )
  const existingIngredients = useLiveQuery(
    () => (id !== undefined ? getIngredientNamesForProduct(db, id) : undefined),
    [id],
  )
  const allProducts = useLiveQuery(() => db.products.toArray(), [])
  const allIngredientNames = useLiveQuery(
    () => db.ingredients.toArray().then((list) => list.map((i) => i.nameEn)),
    [],
  )

  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [notes, setNotes] = useState('')
  const [verified, setVerified] = useState(false)
  const [categories, setCategories] = useState<Set<Category>>(new Set())
  const [ingredientsText, setIngredientsText] = useState('')
  const [photo, setPhoto] = useState<Blob | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (existing) {
      setNameEn(existing.nameEn)
      setNameAr(existing.nameAr)
      setManufacturer(existing.manufacturer ?? '')
      setNotes(existing.notes ?? '')
      setVerified(existing.verified)
      setCategories(new Set(existing.categories))
      setPhoto(existing.photo)
    }
  }, [existing])

  useEffect(() => {
    if (existingIngredients) setIngredientsText(existingIngredients.join('; '))
  }, [existingIngredients])

  // "Typing the English name suggests the Arabic name (and vice versa) only
  // from a lookup of known names ... never overwrites a field the user
  // already typed." VISION §5.1.
  const suggestFromLookup = (field: 'en' | 'ar', value: string) => {
    if (!allProducts || !value.trim()) return
    const norm = normalizeText(value)
    const match = allProducts.find((p) =>
      field === 'en' ? normalizeText(p.nameEn) === norm : normalizeText(p.nameAr) === norm,
    )
    if (!match) return
    if (field === 'en' && !nameAr.trim()) setNameAr(match.nameAr)
    if (field === 'ar' && !nameEn.trim()) setNameEn(match.nameEn)
  }

  const toggleCategory = (c: Category) => {
    setCategories((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  const canSave = nameEn.trim().length > 0 && nameAr.trim().length > 0 && !saving

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    const ingredientNames = ingredientsText
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const data = {
      nameEn: nameEn.trim(),
      nameAr: nameAr.trim(),
      manufacturer: manufacturer.trim() || undefined,
      notes: notes.trim() || undefined,
      verified,
      categories: [...categories],
      photo,
    }
    try {
      if (isEdit && id !== undefined) {
        await updateProduct(db, id, data, ingredientNames)
        navigate(`/drugs/${id}`)
      } else {
        const newId = await createProduct(db, data, ingredientNames)
        navigate(`/drugs/${newId}`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">{isEdit ? 'Edit Medication' : 'New Medication'}</span>
      </div>

      <form onSubmit={handleSubmit} className="product-form">
        <PhotoInput value={photo} onChange={setPhoto} label="Photo (fallback for presentations)" />

        <label className="field">
          <span className="field__label">Name (English)</span>
          <input
            className="field__input"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            onBlur={(e) => suggestFromLookup('en', e.target.value)}
            placeholder="Tareg"
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Name (Arabic)</span>
          <input
            className="field__input"
            dir="rtl"
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            onBlur={(e) => suggestFromLookup('ar', e.target.value)}
            placeholder="تارج"
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Ingredients (comma or ; separated)</span>
          <input
            className="field__input"
            list="ingredient-suggestions"
            value={ingredientsText}
            onChange={(e) => setIngredientsText(e.target.value)}
            placeholder="valsartan; hydrochlorothiazide"
          />
          <datalist id="ingredient-suggestions">
            {allIngredientNames?.map((n) => <option key={n} value={n} />)}
          </datalist>
        </label>

        <div className="field">
          <span className="field__label">Categories</span>
          <div className="chip-row">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={`chip${categories.has(c) ? ' chip--active' : ''}`}
                onClick={() => toggleCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field__label">Manufacturer</span>
          <input
            className="field__input"
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">Notes (plain-language use)</span>
          <textarea
            className="field__textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="high blood pressure"
          />
        </label>

        <label className="field field--row">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />
          <span className="field__label">Verified against a reliable source</span>
        </label>

        <button type="submit" className="btn btn--primary btn--block" disabled={!canSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  )
}
