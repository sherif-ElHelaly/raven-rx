import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../../../db/schema'
import { LOCATION_TYPES, type LocationType } from '../../../db/types'
import './locations.css'

const TYPE_LABELS: Record<LocationType, string> = {
  hospital_pharmacy: 'Hospital pharmacy',
  storage: 'Storage',
  external_hospital: 'External hospital',
  civilian_pharmacy: 'Civilian pharmacy',
}

export function LocationForm() {
  const { locationId } = useParams()
  const isEdit = locationId !== undefined
  const id = isEdit ? Number(locationId) : undefined
  const navigate = useNavigate()

  const existing = useLiveQuery(
    () => (id !== undefined ? db.locations.get(id) : undefined),
    [id],
  )

  const [name, setName] = useState('')
  const [type, setType] = useState<LocationType>('hospital_pharmacy')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [needsTransferSlip, setNeedsTransferSlip] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (existing) {
      setName(existing.name)
      setType(existing.type)
      setPhone(existing.phone ?? '')
      setNotes(existing.notes ?? '')
      setNeedsTransferSlip(existing.needsTransferSlip)
    }
  }, [existing])

  const canSave = name.trim().length > 0 && !saving

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    const data = {
      name: name.trim(),
      type,
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
      needsTransferSlip,
    }
    try {
      if (isEdit && id !== undefined) {
        await db.locations.update(id, data)
      } else {
        await db.locations.add(data)
      }
      navigate('/locations')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (id === undefined) return
    await db.locations.delete(id)
    navigate('/locations')
  }

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">{isEdit ? 'Edit Location' : 'New Location'}</span>
      </div>

      <form onSubmit={handleSubmit} className="product-form">
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Hospital Pharmacy 1"
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Type</span>
          <select
            className="field__select"
            value={type}
            onChange={(e) => setType(e.target.value as LocationType)}
          >
            {LOCATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Phone</span>
          <input
            className="field__input"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">Notes</span>
          <textarea
            className="field__textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <label className="field field--row">
          <input
            type="checkbox"
            checked={needsTransferSlip}
            onChange={(e) => setNeedsTransferSlip(e.target.checked)}
          />
          <span className="field__label">Needs a transfer slip (civilian pharmacy)</span>
        </label>

        <button type="submit" className="btn btn--primary btn--block" disabled={!canSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>

        {isEdit && (
          <button
            type="button"
            className="btn btn--danger btn--block"
            style={{ marginTop: 'var(--space-3)' }}
            onClick={() => setConfirmDelete(true)}
          >
            Delete location
          </button>
        )}
      </form>

      {confirmDelete && (
        <div className="sheet-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <p className="sheet__title">Delete “{name}”?</p>
            <p className="settings-section__hint">
              Items already recorded against this location keep their history, but it disappears
              from the picker.
            </p>
            <button type="button" className="btn btn--danger btn--block" onClick={handleDelete}>
              Delete
            </button>
            <button type="button" className="sheet__cancel" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
