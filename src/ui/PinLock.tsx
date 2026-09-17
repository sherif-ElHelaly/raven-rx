import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getPin } from './localPrefs'
import './PinLock.css'

const IDLE_LOCK_MS = 5 * 60 * 1000
const HIDDEN_AT_KEY = 'sarf-hidden-at'

interface PinLockProps {
  children: ReactNode
}

// VISION §5.8: optional PIN lock when opening the app or returning after N
// minutes. The PIN itself is device-local (localPrefs), never backed up.
export function PinLock({ children }: PinLockProps) {
  const pin = getPin()
  const [unlocked, setUnlocked] = useState(!pin)
  const [entry, setEntry] = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!pin) return

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        sessionStorage.setItem(HIDDEN_AT_KEY, String(Date.now()))
        return
      }
      const hiddenAt = Number(sessionStorage.getItem(HIDDEN_AT_KEY) ?? 0)
      if (hiddenAt && Date.now() - hiddenAt > IDLE_LOCK_MS) {
        setUnlocked(false)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [pin])

  if (unlocked) return <>{children}</>

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (entry === pin) {
      setUnlocked(true)
      setEntry('')
      setError(false)
    } else {
      setError(true)
      setEntry('')
    }
  }

  return (
    <div className="pin-lock">
      <form className="pin-lock__form" onSubmit={handleSubmit}>
        <p className="pin-lock__title">Enter PIN</p>
        <input
          className="field__input field__input--mono pin-lock__input"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus
          value={entry}
          onChange={(e) => {
            setEntry(e.target.value.replace(/[^0-9]/g, ''))
            setError(false)
          }}
        />
        {error && <p className="pin-lock__error">Wrong PIN.</p>}
        <button type="submit" className="btn btn--primary btn--block">
          Unlock
        </button>
      </form>
    </div>
  )
}
