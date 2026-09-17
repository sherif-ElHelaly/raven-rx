import { useEffect, useRef, useState } from 'react'
import { compressImage } from './image'
import './PhotoInput.css'

interface PhotoInputProps {
  value: Blob | undefined
  onChange: (blob: Blob | undefined) => void
  label?: string
}

export function PhotoInput({ value, onChange, label = 'Photo' }: PhotoInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!value) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(value)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [value])

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      onChange(await compressImage(file))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="photo-input">
        {previewUrl ? (
          <img className="photo-input__preview" src={previewUrl} alt="" />
        ) : (
          <div className="photo-input__placeholder">No photo</div>
        )}
        <div className="photo-input__actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Processing…' : value ? 'Retake' : 'Take photo'}
          </button>
          {value && (
            <button type="button" className="btn btn--ghost" onClick={() => onChange(undefined)}>
              Remove
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={handleFile}
        />
      </div>
    </div>
  )
}
