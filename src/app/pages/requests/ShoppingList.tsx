import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { markLineFound, mostUsedLocations, shoppingList, type ShoppingLine } from '../../../db/repo'
import { db } from '../../../db/schema'
import { useToast } from '../../../ui/Toast'
import { LocationPicker } from './LocationPicker'
import './requests.css'

// VISION §5.3: standing at a counter, ask for everything at once, then mark
// each line Found at that location in one tap.
export function ShoppingList() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const lines = useLiveQuery(() => shoppingList(db), [])
  const locations = useLiveQuery(() => mostUsedLocations(db), [])

  const [activeGroups, setActiveGroups] = useState<Set<string>>(new Set())
  const [pendingLine, setPendingLine] = useState<ShoppingLine | null>(null)

  const groupLabels = [...new Map((lines ?? []).map((l) => [l.groupKey, l.groupLabel])).entries()]

  const toggleGroup = (key: string) => {
    setActiveGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const visibleLines = (lines ?? []).filter(
    (l) => activeGroups.size === 0 || activeGroups.has(l.groupKey),
  )

  const markFound = async (line: ShoppingLine, locationId: number) => {
    await markLineFound(db, line.itemIds, locationId)
    showToast(`Marked ${line.productName} found`)
  }

  const handleTapFound = (line: ShoppingLine) => {
    if (line.locationId) {
      markFound(line, line.locationId)
    } else {
      setPendingLine(line)
    }
  }

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">Shopping list</span>
      </div>

      {groupLabels.length > 1 && (
        <div className="chip-row drugs-categories">
          {groupLabels.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`chip${activeGroups.has(key) ? ' chip--active' : ''}`}
              onClick={() => toggleGroup(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {lines && lines.length === 0 && (
        <p className="empty-state">Nothing to shop for — no open items.</p>
      )}

      {groupLabels
        .filter(([key]) => activeGroups.size === 0 || activeGroups.has(key))
        .map(([key, label]) => (
          <div key={key}>
            <h2 className="product-detail__section-title">{label}</h2>
            <ul className="new-request__draft-list">
              {visibleLines
                .filter((l) => l.groupKey === key)
                .map((line) => (
                  <li key={`${line.groupKey}-${line.presentationId}`}>
                    <span>
                      {line.productName} {line.presentationLabel} × {line.qty}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => handleTapFound(line)}
                    >
                      Found
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}

      {locations && locations.length === 0 && lines && lines.length > 0 && (
        <p className="empty-state">Add locations in Settings to mark items found.</p>
      )}

      {pendingLine && (
        <LocationPicker
          title={`Found ${pendingLine.productName} at…`}
          onClose={() => setPendingLine(null)}
          onPick={(location) => {
            markFound(pendingLine, location.id!)
            setPendingLine(null)
          }}
        />
      )}
    </div>
  )
}
