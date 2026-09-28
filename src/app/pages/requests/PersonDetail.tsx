import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { summarizeCase } from '../../../db/cases'
import { createRenewalRequest, setRegularMeds, updatePerson } from '../../../db/repo'
import { db } from '../../../db/schema'
import type { Plan, RegularMed } from '../../../db/types'
import { personTitle } from '../../../ui/format'
import { MedPicker } from '../drugs/MedPicker'
import { CaseRow } from './CaseRow'
import './requests.css'

export function PersonDetail() {
  const { personId } = useParams()
  const id = Number(personId)
  const navigate = useNavigate()

  const person = useLiveQuery(() => db.people.get(id), [id])
  const requests = useLiveQuery(
    () => db.requests.where('personId').equals(id).reverse().sortBy('createdAt'),
    [id],
  )
  const caseItems = useLiveQuery(async () => {
    const ids = (requests ?? []).map((r) => r.id!)
    return ids.length ? db.items.where('requestId').anyOf(ids).toArray() : []
  }, [requests])

  const products = useLiveQuery(() => db.products.toArray(), [])
  const productById = new Map((products ?? []).map((p) => [p.id!, p]))
  const presentations = useLiveQuery(() => db.presentations.toArray(), [])
  const presentationById = new Map((presentations ?? []).map((p) => [p.id!, p]))

  const [name, setName] = useState('')
  const [rank, setRank] = useState('')
  const [unit, setUnit] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [editingInfo, setEditingInfo] = useState(false)

  useEffect(() => {
    if (person) {
      setName(person.name ?? '')
      setRank(person.rank ?? '')
      setUnit(person.unit ?? '')
      setPhone(person.phone ?? '')
      setNotes(person.notes ?? '')
    }
  }, [person])

  const [addingMed, setAddingMed] = useState(false)

  const [renewPlan, setRenewPlan] = useState<Plan>('monthly')
  const [renewing, setRenewing] = useState(false)

  if (person === undefined) return <div className="page">Loading…</div>
  if (!person) {
    return (
      <div className="page">
        <p className="empty-state">Person not found.</p>
      </div>
    )
  }

  const regularMeds = person.regularMeds ?? []

  const saveInfo = async () => {
    await updatePerson(db, id, {
      name: name.trim() || undefined,
      rank: rank.trim() || undefined,
      unit: unit.trim() || undefined,
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
    })
    setEditingInfo(false)
  }

  const addRegularMed = (presentationId: number) => {
    const next: RegularMed[] = [...regularMeds]
    const existing = next.find((m) => m.presentationId === presentationId)
    if (existing) existing.qty += 1
    else next.push({ presentationId, qty: 1 })
    setRegularMeds(db, id, next)
  }

  const updateMedQty = (presentationId: number, qty: number) => {
    const next = regularMeds.map((m) => (m.presentationId === presentationId ? { ...m, qty } : m))
    setRegularMeds(db, id, next)
  }

  const removeRegularMed = (presentationId: number) => {
    setRegularMeds(
      db,
      id,
      regularMeds.filter((m) => m.presentationId !== presentationId),
    )
  }

  const handleRenew = async () => {
    setRenewing(true)
    try {
      const requestId = await createRenewalRequest(db, id, renewPlan)
      navigate(`/requests/${requestId}`)
    } finally {
      setRenewing(false)
    }
  }

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">{personTitle(person)}</span>
      </div>

      {!editingInfo ? (
        <div className="request-summary">
          <p className="request-summary__card">Card {person.cardNumber}</p>
          {person.rank && <p className="product-detail__meta">{person.rank}</p>}
          {person.unit && <p className="product-detail__meta">{person.unit}</p>}
          {person.phone && (
            <p className="product-detail__meta">
              <a href={`tel:${person.phone}`}>{person.phone}</a>
            </p>
          )}
          {person.notes && <p className="product-detail__meta">{person.notes}</p>}
          <button type="button" className="btn btn--ghost" onClick={() => setEditingInfo(true)}>
            Edit info
          </button>
        </div>
      ) : (
        <div className="request-summary">
          <label className="field">
            <span className="field__label">Name</span>
            <input className="field__input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Rank · رتبة</span>
            <input className="field__input" value={rank} onChange={(e) => setRank(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Unit</span>
            <input className="field__input" value={unit} onChange={(e) => setUnit(e.target.value)} />
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
          <div className="new-request__picked-actions">
            <button type="button" className="btn" onClick={() => setEditingInfo(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={saveInfo}>
              Save
            </button>
          </div>
        </div>
      )}

      <h2 className="product-detail__section-title">Regular medications</h2>
      <ul className="new-request__draft-list">
        {regularMeds.map((med) => {
          const pres = presentationById.get(med.presentationId)
          const prod = pres ? productById.get(pres.productId) : undefined
          return (
            <li key={med.presentationId}>
              {prod ? (
                <Link to={`/drugs/${prod.id}?pres=${med.presentationId}`} className="item-row__name">
                  {prod.nameEn} {pres?.strength} {pres?.form} × {med.qty}
                </Link>
              ) : (
                <span>Unknown × {med.qty}</span>
              )}
              <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <input
                  type="number"
                  min={1}
                  className="field__input"
                  style={{ width: 56, padding: 'var(--space-1)' }}
                  value={med.qty}
                  onChange={(e) => updateMedQty(med.presentationId, Math.max(1, Number(e.target.value) || 1))}
                />
                <button type="button" onClick={() => removeRegularMed(med.presentationId)}>
                  Remove
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      {regularMeds.length === 0 && <p className="empty-state">No regular medications set yet.</p>}

      <button type="button" className="btn btn--ghost" onClick={() => setAddingMed(true)}>
        + Add regular medication
      </button>
      {addingMed && (
        <MedPicker
          mode="presentation"
          title="Add regular medication"
          onClose={() => setAddingMed(false)}
          onPick={(pres) => {
            setAddingMed(false)
            addRegularMed(pres.id!)
          }}
        />
      )}

      <h2 className="product-detail__section-title">Renew</h2>
      <div className="plan-toggle" style={{ marginBottom: 'var(--space-3)' }}>
        <button
          type="button"
          className={`chip${renewPlan === 'monthly' ? ' chip--active' : ''}`}
          onClick={() => setRenewPlan('monthly')}
        >
          Monthly · 5 EGP
        </button>
        <button
          type="button"
          className={`chip${renewPlan === 'bimonthly' ? ' chip--active' : ''}`}
          onClick={() => setRenewPlan('bimonthly')}
        >
          Bimonthly · 10 EGP
        </button>
      </div>
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={regularMeds.length === 0 || renewing}
        onClick={handleRenew}
      >
        {renewing ? 'Creating…' : `Renew (${regularMeds.length} item${regularMeds.length === 1 ? '' : 's'})`}
      </button>

      <h2 className="product-detail__section-title">Cases</h2>
      <ul className="request-list">
        {requests?.map((r) => (
          <CaseRow
            key={r.id}
            summary={summarizeCase(r, person, (caseItems ?? []).filter((i) => i.requestId === r.id))}
          />
        ))}
      </ul>
      {requests && requests.length === 0 && <p className="empty-state">No cases yet.</p>}
    </div>
  )
}
