import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../../../db/schema'
import { addPresentation, updatePresentation } from '../../../db/repo'
import { FORMS, type Form } from '../../../db/types'
import { PhotoInput } from '../../../ui/PhotoInput'
import './drugs.css'

export function PresentationForm() {
  const { productId, presentationId } = useParams()
  const pId = Number(productId)
  const isEdit = presentationId !== undefined
  const navigate = useNavigate()

  const product = useLiveQuery(() => db.products.get(pId), [pId])
  const existing = useLiveQuery(
    () => (isEdit ? db.presentations.get(Number(presentationId)) : undefined),
    [isEdit, presentationId],
  )

  const [strength, setStrength] = useState('')
  const [form, setForm] = useState<Form>('tablet')
  const [packSize, setPackSize] = useState('')
  const [fridge, setFridge] = useState(false)
  const [controlled, setControlled] = useState(false)
  const [photo, setPhoto] = useState<Blob | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (existing) {
      setStrength(existing.strength ?? '')
      setForm(existing.form)
      setPackSize(existing.packSize ?? '')
      setFridge(existing.fridge)
      setControlled(existing.controlled)
      setPhoto(existing.photo)
    }
  }, [existing])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const data = {
      productId: pId,
      strength: strength.trim() || undefined,
      form,
      packSize: packSize.trim() || undefined,
      fridge,
      controlled,
      photo,
    }
    try {
      if (isEdit) {
        await updatePresentation(db, Number(presentationId), data)
      } else {
        await addPresentation(db, data)
      }
      navigate(`/drugs/${pId}`)
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
        <span className="top-bar__title">
          {isEdit ? 'Edit Presentation' : 'New Presentation'}
          {product && ` — ${product.nameEn}`}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="product-form">
        <PhotoInput value={photo} onChange={setPhoto} />

        <label className="field">
          <span className="field__label">Strength</span>
          <input
            className="field__input field__input--mono"
            value={strength}
            onChange={(e) => setStrength(e.target.value)}
            placeholder="80 mg"
          />
        </label>

        <label className="field">
          <span className="field__label">Form</span>
          <select
            className="field__select"
            value={form}
            onChange={(e) => setForm(e.target.value as Form)}
          >
            {FORMS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Pack size</span>
          <input
            className="field__input"
            value={packSize}
            onChange={(e) => setPackSize(e.target.value)}
            placeholder="28 tablets"
          />
        </label>

        <label className="field field--row">
          <input type="checkbox" checked={fridge} onChange={(e) => setFridge(e.target.checked)} />
          <span className="field__label">❄️ Requires fridge (2–8°C)</span>
        </label>

        <label className="field field--row">
          <input
            type="checkbox"
            checked={controlled}
            onChange={(e) => setControlled(e.target.checked)}
          />
          <span className="field__label">⚠️ Controlled drug</span>
        </label>

        <button type="submit" className="btn btn--primary btn--block" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  )
}
