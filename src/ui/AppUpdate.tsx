import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './AppUpdate.css'

type CheckResult = 'update-ready' | 'up-to-date' | 'offline' | 'unsupported'

interface AppUpdateValue {
  updateReady: boolean
  checkForUpdates: () => Promise<CheckResult>
  applyUpdate: () => void
}

const AppUpdateContext = createContext<AppUpdateValue | null>(null)

// iOS rarely fully closes a home-screen app, so a relaunch-based update check
// almost never happens. Check whenever the app comes back to the foreground.
const FOREGROUND_CHECK_INTERVAL_MS = 60 * 1000

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)
  const lastCheckRef = useRef(0)

  const {
    needRefresh: [updateReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration ?? null
    },
  })

  const checkForUpdates = useCallback(async (): Promise<CheckResult> => {
    const registration = registrationRef.current
    if (!registration) return 'unsupported'
    if (!navigator.onLine) return 'offline'
    lastCheckRef.current = Date.now()
    try {
      await registration.update()
    } catch {
      return 'offline'
    }
    // A found update installs in the background; wait for it to finish.
    const installing = registration.installing
    if (installing) {
      await new Promise<void>((resolve) => {
        const done = () => {
          if (installing.state === 'installed' || installing.state === 'redundant') resolve()
        }
        installing.addEventListener('statechange', done)
        done()
      })
    }
    return registration.waiting ? 'update-ready' : 'up-to-date'
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastCheckRef.current > FOREGROUND_CHECK_INTERVAL_MS
      ) {
        void checkForUpdates()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [checkForUpdates])

  const applyUpdate = useCallback(() => {
    // updateServiceWorker(true) reloads on 'controlling', which never fires if the
    // page wasn't controlled yet — so also reload once the new worker activates.
    const waiting = registrationRef.current?.waiting
    waiting?.addEventListener('statechange', () => {
      if (waiting.state === 'activated') window.location.reload()
    })
    void updateServiceWorker(true)
  }, [updateServiceWorker])

  return (
    <AppUpdateContext.Provider value={{ updateReady, checkForUpdates, applyUpdate }}>
      {children}
    </AppUpdateContext.Provider>
  )
}

export function useAppUpdate(): AppUpdateValue {
  const ctx = useContext(AppUpdateContext)
  if (!ctx) throw new Error('useAppUpdate must be used inside AppUpdateProvider')
  return ctx
}

export function UpdateBanner() {
  const { updateReady, applyUpdate } = useAppUpdate()
  const [dismissed, setDismissed] = useState(false)
  if (!updateReady || dismissed) return null

  return (
    <div className="update-banner" role="status">
      <span className="update-banner__text">A new version is ready.</span>
      <button type="button" className="update-banner__dismiss" onClick={() => setDismissed(true)}>
        Later
      </button>
      <button type="button" className="btn btn--primary update-banner__action" onClick={applyUpdate}>
        Update
      </button>
    </div>
  )
}
