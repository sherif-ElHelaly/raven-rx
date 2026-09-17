import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './Toast.css'

interface ToastState {
  id: number
  message: string
  onUndo?: () => void
}

interface ToastContextValue {
  showToast: (message: string, onUndo?: () => void) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const AUTO_DISMISS_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef = useRef(0)

  const showToast = useCallback((message: string, onUndo?: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const id = ++idRef.current
    setToast({ id, message, onUndo })
    timerRef.current = setTimeout(() => {
      setToast((t) => (t?.id === id ? null : t))
    }, AUTO_DISMISS_MS)
  }, [])

  const dismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast(null)
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div className="toast" role="status">
          <span className="toast__message">{toast.message}</span>
          {toast.onUndo && (
            <button
              type="button"
              className="toast__undo"
              onClick={() => {
                toast.onUndo?.()
                dismiss()
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
