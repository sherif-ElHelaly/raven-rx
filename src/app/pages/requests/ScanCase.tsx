import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../../db/schema'
import { createCaseFromScan, type ScanLine } from '../../../db/scanCase'
import type { Form, Plan, Presentation, Product } from '../../../db/types'
import { matchPresentation, matchProduct, strengthLabel } from '../../../scan/matchMed'
import { readCasePages } from '../../../scan/ocr'
import { mergePages, quantityFor, type ScannedMed, type ScanResult } from '../../../scan/parseCase'
import { search } from '../../../search/searchIndex'
import { useSearchIndex } from '../../../search/useSearchIndex'
import { personTitle } from '../../../ui/format'
import './requests.css'
import './scan.css'

interface Row {
  key: string
  // As read off the sheet (Arabic); for a new drug this becomes its name.
  name: string
  productId: number | null
  // A presentation id, 'new' (new strength), or null (still to choose).
  choice: number | 'new' | null
  newStrength: string
  form: Form
  qty: number
  // 'sheet' = read from the الكمية column; 'estimate' = doses/day × days.
  qtySource: 'sheet' | 'estimate'
  // Set once the user picks or types a quantity, which settles any disagreement.
  qtyConfirmed: boolean
  line: string
  page: number
  perDay?: number
  searching: boolean
}

interface PagePhoto {
  file: Blob
  url: string
}

const MAX_PAGES = 4

let rowCounter = 0
const rowKey = () => `row-${rowCounter++}`

function buildRow(
  med: ScannedMed,
  plan: Plan,
  products: Product[],
  presentations: Presentation[],
  lastTime: Map<number, number>,
): Row {
  const product = matchProduct(med.name, products)
  const own = product ? presentations.filter((p) => p.productId === product.id) : []
  // The sheet's digits beat history; history beats asking.
  const hit =
    (product && matchPresentation(med.strength, med.modifier, own)) ||
    own.find((p) => p.id === lastTime.get(product?.id ?? -1))
  // A misread strength ("175" for 0.25) must not silently become a new
  // presentation: with no match, the user picks from the chips.
  let choice: Row['choice'] = hit?.id ?? null
  if (!hit && own.length === 1 && !med.strength && !med.modifier) choice = own[0]!.id!
  if (own.length === 0) choice = 'new'
  return {
    key: rowKey(),
    name: med.name,
    productId: product?.id ?? null,
    choice,
    newStrength: strengthLabel(med.strength, med.modifier),
    form: hit?.form ?? own[0]?.form ?? med.form,
    qty: med.sheetQty ?? quantityFor(med, plan),
    qtySource: med.sheetQty !== undefined ? 'sheet' : 'estimate',
    qtyConfirmed: false,
    line: med.line,
    page: med.page,
    perDay: med.perDay,
    searching: false,
  }
}

// productId → the presentation this person got most recently.
async function lastPresentations(personId: number): Promise<Map<number, number>> {
  const requests = await db.requests.where('personId').equals(personId).sortBy('createdAt')
  const items = await db.items.where('requestId').anyOf(requests.map((r) => r.id!)).toArray()
  const order = new Map(requests.map((r, i) => [r.id!, i]))
  items.sort((a, b) => order.get(a.requestId)! - order.get(b.requestId)!)
  const presentations = await db.presentations.bulkGet(items.map((i) => i.presentationId))
  const map = new Map<number, number>()
  for (const p of presentations) if (p) map.set(p.productId, p.id!)
  return map
}

export function ScanCase() {
  const navigate = useNavigate()
  const index = useSearchIndex()
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  // Which page slot the next picked photo goes into.
  const targetPage = useRef(0)

  const [pages, setPages] = useState<PagePhoto[]>([])
  const [progress, setProgress] = useState<{ fraction: number; stage: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  // Photos changed since the last read.
  const [stale, setStale] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)

  const [cardNumber, setCardNumber] = useState('')
  const [name, setName] = useState('')
  const [rank, setRank] = useState('')
  const [plan, setPlan] = useState<Plan>('bimonthly')
  const [rows, setRows] = useState<Row[]>([])
  const [rowQuery, setRowQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const pageUrls = useRef<string[]>([])
  useEffect(() => {
    pageUrls.current = pages.map((p) => p.url)
  }, [pages])
  useEffect(() => () => pageUrls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const products = useLiveQuery(() => db.products.toArray(), [])
  const presentations = useLiveQuery(() => db.presentations.toArray(), [])
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id!, p])), [products])
  const presentationsByProduct = useMemo(() => {
    const map = new Map<number, Presentation[]>()
    for (const p of presentations ?? []) map.set(p.productId, [...(map.get(p.productId) ?? []), p])
    return map
  }, [presentations])

  const existingPerson = useLiveQuery(
    () => (cardNumber ? db.people.where('cardNumber').equals(cardNumber).first() : undefined),
    [cardNumber],
  )

  const pickPhoto = (slot: number, source: 'camera' | 'library') => {
    targetPage.current = slot
    ;(source === 'camera' ? cameraRef : libraryRef).current?.click()
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const slot = targetPage.current
    setPages((prev) => {
      const next = [...prev]
      if (next[slot]) URL.revokeObjectURL(next[slot]!.url)
      next[slot] = { file, url: URL.createObjectURL(file) }
      return next
    })
    setStale(true)
    setError(null)
  }

  const removePage = (slot: number) => {
    setPages((prev) => {
      URL.revokeObjectURL(prev[slot]!.url)
      return prev.filter((_, i) => i !== slot)
    })
    setStale(true)
  }

  const handleRead = async () => {
    if (!products || !presentations || pages.length === 0) return
    setError(null)
    setReviewing(false)
    setProgress({ fraction: 0, stage: 'Preparing photos…' })
    try {
      const reads = await readCasePages(
        pages.map((p) => p.file),
        (fraction, stage) => setProgress({ fraction, stage }),
      )
      const result = mergePages(reads)
      if (result.meds.length === 0) {
        setError(
          "Couldn't find any meds in those photos. Retake them flat, in good light, with the whole med table in frame.",
        )
        return
      }
      const scannedPlan = result.plan ?? 'bimonthly'
      setScan(result)
      setPlan(scannedPlan)
      // A returning person found by name keeps their stored details.
      const people = await db.people.toArray()
      const byName = result.name
        ? people.find((p) => p.name && p.name.replace(/\s+/g, '') === result.name!.replace(/\s+/g, ''))
        : undefined
      const card = result.cardNumber ?? byName?.cardNumber ?? ''
      const returning = people.find((p) => p.cardNumber === card) ?? byName
      const lastTime = returning ? await lastPresentations(returning.id!) : new Map<number, number>()
      setCardNumber(card)
      setName(returning?.name ?? result.name ?? '')
      setRank(returning?.rank ?? result.rank ?? '')
      setRows(result.meds.map((m) => buildRow(m, scannedPlan, products, presentations, lastTime)))
      setReviewing(true)
      setStale(false)
    } catch (err) {
      console.error('Case scan failed', err)
      setError(
        navigator.onLine
          ? 'Reading failed. Try again.'
          : 'The first scan needs internet to download the reader (~5 MB). After that it works offline.',
      )
    } finally {
      setProgress(null)
    }
  }

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const changePlan = (next: Plan) => {
    setPlan(next)
    // Estimated quantities follow the plan length; numbers read off the sheet stay as printed.
    const factor = next === 'bimonthly' ? 2 : 0.5
    if (next !== plan) {
      setRows((prev) =>
        prev.map((r) => (r.qtySource === 'estimate' ? { ...r, qty: Math.max(1, Math.round(r.qty * factor)) } : r)),
      )
    }
  }

  const pickProduct = (key: string, productId: number) => {
    const own = presentationsByProduct.get(productId) ?? []
    updateRow(key, {
      productId,
      choice: own.length === 1 ? own[0]!.id! : own.length === 0 ? 'new' : null,
      searching: false,
    })
    setRowQuery('')
  }

  const addRow = () => {
    const key = rowKey()
    setRows((prev) => [
      ...prev,
      {
        key,
        name: '',
        productId: null,
        choice: null,
        newStrength: '',
        form: 'tablet',
        qty: plan === 'bimonthly' ? 60 : 30,
        qtySource: 'estimate',
        qtyConfirmed: true,
        line: '',
        page: 0,
        searching: true,
      },
    ])
    setRowQuery('')
  }

  const searchResults = useMemo(() => {
    if (!index || rowQuery.trim().length < 2) return []
    return search(index, rowQuery, 8)
  }, [index, rowQuery])

  // Doses/day × 30 × months — only meaningful when the dosing was read.
  const estimateFor = (r: Row) => (r.perDay ? r.perDay * 30 * (plan === 'bimonthly' ? 2 : 1) : undefined)
  // A sheet number that disagrees with the dosing may be a misread digit: ask.
  const qtyConflict = (r: Row) => {
    const estimate = estimateFor(r)
    return r.qtySource === 'sheet' && !r.qtyConfirmed && estimate !== undefined && estimate !== r.qty
  }
  const rowReady = (r: Row) =>
    r.qty > 0 && !qtyConflict(r) && (r.productId !== null ? r.choice !== null : r.name.trim().length > 0)
  const unresolved = rows.filter((r) => !rowReady(r)).length
  const newCount = rows.filter((r) => r.productId === null || r.choice === 'new').length
  const canCreate = cardNumber.trim().length > 0 && rows.length > 0 && unresolved === 0 && !creating

  const handleCreate = async () => {
    if (!canCreate) return
    setCreating(true)
    try {
      const lines: ScanLine[] = rows.map((r) => {
        if (r.productId === null) {
          return { kind: 'new-drug', nameAr: r.name, strength: r.newStrength, form: r.form, qty: r.qty, sourceLine: r.line || undefined }
        }
        if (r.choice === 'new') {
          return { kind: 'new-strength', productId: r.productId, strength: r.newStrength, form: r.form, qty: r.qty }
        }
        return { kind: 'presentation', presentationId: r.choice as number, qty: r.qty }
      })
      const requestId = await createCaseFromScan(db, { cardNumber, name, rank, plan, lines })
      navigate(`/requests/${requestId}`, { replace: true })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">Scan case sheet</span>
      </div>

      <p className="scan-hint">
        Photograph each page flat and well lit. If the meds run onto a second page, add it as page 2.
      </p>

      <ul className="scan-pages">
        {Array.from({ length: Math.min(MAX_PAGES, Math.max(2, pages.length + 1)) }, (_, slot) => {
          const photo = pages[slot]
          // Slots fill in order: page 3 opens once page 2 is in.
          const enabled = slot <= pages.length
          return (
            <li key={slot} className={`scan-page${enabled ? '' : ' scan-page--off'}`}>
              {photo ? (
                <button type="button" className="scan-pick__thumb" onClick={() => setViewing(photo.url)}>
                  <img src={photo.url} alt={`Page ${slot + 1}`} />
                </button>
              ) : (
                <div className="scan-page__empty">{slot + 1}</div>
              )}
              <div className="scan-page__body">
                <span className="scan-page__label">
                  Page {slot + 1}
                  {slot > 0 && !photo && <span className="scan-page__optional"> · only if the meds continue</span>}
                </span>
                <div className="scan-pick__actions">
                  <button type="button" className="btn" disabled={!enabled || !!progress} onClick={() => pickPhoto(slot, 'camera')}>
                    {photo ? 'Retake' : 'Camera'}
                  </button>
                  <button type="button" className="btn" disabled={!enabled || !!progress} onClick={() => pickPhoto(slot, 'library')}>
                    Library
                  </button>
                  {photo && (
                    <button type="button" className="btn btn--ghost" disabled={!!progress} onClick={() => removePage(slot)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={handleFile} />
      <input ref={libraryRef} type="file" accept="image/*" hidden onChange={handleFile} />

      {pages.length > 0 && (!reviewing || stale) && (
        <button
          type="button"
          className="btn btn--primary btn--block scan-read"
          disabled={!!progress || !products || !presentations}
          onClick={handleRead}
        >
          {reviewing ? 'Read again (replaces the form below)' : `Read ${pages.length === 1 ? 'sheet' : `${pages.length} pages`}`}
        </button>
      )}

      {progress && (
        <div className="scan-progress" role="status">
          <span>{progress.stage}</span>
          <div className="scan-progress__bar">
            <div style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
          </div>
        </div>
      )}

      {error && <p className="warning-banner">{error}</p>}

      {reviewing && (
        <>
          <label className="field">
            <span className="field__label">Card number · رقم الحاسب</span>
            <input
              className="field__input field__input--mono"
              inputMode="numeric"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
          {scan && <CardCheck scan={scan} value={cardNumber} onPick={setCardNumber} />}
          {existingPerson && <p className="new-request__existing">Returning: {personTitle(existingPerson)}</p>}
          {scan && scan.mismatchedPages.length > 0 && (
            <p className="warning-banner">
              Page {scan.mismatchedPages.join(', ')} shows a different card number. Is it from another case?
            </p>
          )}

          <div className="new-request__person">
            <label className="field">
              <span className="field__label">Name</span>
              <input className="field__input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Rank · رتبة</span>
              <input className="field__input" dir="auto" value={rank} onChange={(e) => setRank(e.target.value)} />
            </label>
          </div>

          <div className="field">
            <span className="field__label">
              Plan{' '}
              {scan?.planSource === 'oval'
                ? '· read from the oval stamp'
                : scan?.planSource === 'durations'
                  ? '· stamp unreadable, guessed from the med lines — check'
                  : '· not found on the sheet — check'}
            </span>
            <div className="plan-toggle">
              <button type="button" className={`chip${plan === 'monthly' ? ' chip--active' : ''}`} onClick={() => changePlan('monthly')}>
                Monthly · 5 EGP
              </button>
              <button type="button" className={`chip${plan === 'bimonthly' ? ' chip--active' : ''}`} onClick={() => changePlan('bimonthly')}>
                Bimonthly · 10 EGP
              </button>
            </div>
          </div>

          <h2 className="product-detail__section-title">
            Meds ({rows.length}){newCount > 0 && <span className="badge badge--warn scan-badge">{newCount} new</span>}
          </h2>

          <ul className="scan-rows">
            {rows.map((r) => {
              const product = r.productId !== null ? productById.get(r.productId) : undefined
              const own = r.productId !== null ? (presentationsByProduct.get(r.productId) ?? []) : []
              return (
                <li key={r.key} className={`scan-row${rowReady(r) ? '' : ' scan-row--todo'}`}>
                  <div className="scan-row__head">
                    {product ? (
                      <span className="scan-row__name">
                        {product.nameEn} <span dir="rtl">{product.nameAr !== product.nameEn ? product.nameAr : ''}</span>
                        {product.unregistered && <span className="badge badge--warn">unregistered</span>}
                      </span>
                    ) : r.searching ? (
                      <span className="scan-row__name">Pick a medication</span>
                    ) : (
                      <span className="scan-row__name">
                        <span className="badge badge--warn">new drug</span> goes to Unregistered meds
                      </span>
                    )}
                    <button type="button" className="scan-row__remove" aria-label="Remove" onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}>
                      ✕
                    </button>
                  </div>

                  {r.line && (
                    <p className="scan-row__line" dir="rtl">
                      {pages.length > 1 && <span className="scan-row__page">صفحة {r.page}</span>} {r.line}
                    </p>
                  )}

                  {r.searching ? (
                    <div className="scan-row__search">
                      <input
                        className="field__input"
                        autoFocus
                        value={rowQuery}
                        onChange={(e) => setRowQuery(e.target.value)}
                        placeholder="Search by English or Arabic name…"
                      />
                      {searchResults.length > 0 && (
                        <ul className="new-request__results">
                          {searchResults.map((res) => {
                            const p = productById.get(res.productId)
                            if (!p) return null
                            return (
                              <li key={res.productId}>
                                <button type="button" onClick={() => pickProduct(r.key, res.productId)}>
                                  {p.nameEn} <span dir="rtl">{p.nameAr}</span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      <div className="chip-row">
                        <button
                          type="button"
                          className="chip"
                          onClick={() => {
                            updateRow(r.key, { productId: null, choice: 'new', searching: false, name: r.name || rowQuery })
                            setRowQuery('')
                          }}
                        >
                          Not in the app, add as new
                        </button>
                        {(r.name || r.productId !== null) && (
                          <button type="button" className="chip" onClick={() => updateRow(r.key, { searching: false })}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {r.productId === null && (
                        <label className="field">
                          <span className="field__label">Name as written (Arabic)</span>
                          <input className="field__input" dir="rtl" value={r.name} onChange={(e) => updateRow(r.key, { name: e.target.value })} />
                        </label>
                      )}

                      {r.productId !== null && own.length > 0 && (
                        <div className="chip-row">
                          {own.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className={`chip${r.choice === p.id ? ' chip--active' : ''}`}
                              onClick={() => updateRow(r.key, { choice: p.id!, form: p.form })}
                            >
                              {p.strength} {p.form}
                            </button>
                          ))}
                          <button
                            type="button"
                            className={`chip${r.choice === 'new' ? ' chip--active' : ''}`}
                            onClick={() => updateRow(r.key, { choice: 'new' })}
                          >
                            Other strength
                          </button>
                        </div>
                      )}
                      {r.productId !== null && r.choice === null && <p className="scan-hint">Choose the strength on the sheet.</p>}

                      {(r.productId === null || r.choice === 'new') && (
                        <label className="field">
                          <span className="field__label">
                            Strength {r.productId !== null && '· new strength, goes to Unregistered meds'}
                          </span>
                          <input
                            className="field__input"
                            value={r.newStrength}
                            onChange={(e) => updateRow(r.key, { newStrength: e.target.value })}
                            placeholder="e.g. 10 mg"
                          />
                        </label>
                      )}

                      <div className="scan-row__foot">
                        <label className="field scan-row__qty">
                          <span className="field__label">
                            {r.qtySource === 'sheet'
                              ? 'Qty · from sheet'
                              : r.perDay
                                ? `Qty · estimated (${r.perDay}/day)`
                                : 'Qty · not read — check'}
                          </span>
                          <input
                            className="field__input"
                            type="number"
                            min={1}
                            value={r.qty}
                            onChange={(e) => updateRow(r.key, { qty: Math.max(1, Number(e.target.value) || 1), qtyConfirmed: true })}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => {
                            updateRow(r.key, { searching: true })
                            setRowQuery(r.name)
                          }}
                        >
                          {product ? 'Wrong drug?' : 'Find in app'}
                        </button>
                      </div>
                      {qtyConflict(r) && (
                        <div className="scan-check scan-check--warn">
                          <span>
                            The sheet reads {r.qty}, but {r.perDay}/day for {plan === 'bimonthly' ? '2 months' : '1 month'} is{' '}
                            {estimateFor(r)}. Which is on the sheet?
                          </span>
                          <div className="chip-row">
                            <button type="button" className="chip" onClick={() => updateRow(r.key, { qtyConfirmed: true })}>
                              {r.qty}
                            </button>
                            <button
                              type="button"
                              className="chip"
                              onClick={() => updateRow(r.key, { qty: estimateFor(r)!, qtyConfirmed: true })}
                            >
                              {estimateFor(r)}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>

          <button type="button" className="btn btn--block" onClick={addRow}>
            + Add a med the scan missed
          </button>

          {unresolved > 0 && (
            <p className="scan-hint">
              {unresolved} med{unresolved === 1 ? '' : 's'} still need{unresolved === 1 ? 's' : ''} a choice.
            </p>
          )}

          <button type="button" className="btn btn--primary btn--block new-request__create" disabled={!canCreate} onClick={handleCreate}>
            {creating ? 'Creating…' : `Create case (${rows.length} med${rows.length === 1 ? '' : 's'})`}
          </button>
        </>
      )}

      {viewing && (
        <div className="scan-viewer" role="dialog" aria-label="Case sheet photo" onClick={() => setViewing(null)}>
          <img src={viewing} alt="Case sheet" />
        </div>
      )}
    </div>
  )
}

// The card number is printed twice: "رقم الحاسب" in Arabic digits and "*119244*"
// in Latin digits at the top left. Shows whether the two readings agree.
function CardCheck({ scan, value, onPick }: { scan: ScanResult; value: string; onPick: (card: string) => void }) {
  const { cardFromStars: stars, cardFromLabel: label } = scan
  if (stars && label && stars === label) {
    return <p className="scan-check scan-check--ok">✓ Matches both copies on the sheet (رقم الحاسب and *{stars}*)</p>
  }
  if (stars && label) {
    return (
      <div className="scan-check scan-check--warn">
        <span>The two copies read differently. Tap the one that matches the sheet:</span>
        <div className="chip-row">
          {[stars, label].map((c) => (
            <button key={c} type="button" className={`chip${value === c ? ' chip--active' : ''}`} onClick={() => onPick(c)}>
              {c === stars ? `*${c}*` : `${c} (رقم الحاسب)`}
            </button>
          ))}
        </div>
      </div>
    )
  }
  if (stars) return <p className="scan-check">Read from *{stars}* at the top of the sheet. Check it against the sheet.</p>
  if (label) return <p className="scan-check scan-check--warn">Read from رقم الحاسب only (Arabic digits are error-prone). Check it.</p>
  return <p className="scan-check scan-check--warn">Card number not found. Type it from the sheet.</p>
}
