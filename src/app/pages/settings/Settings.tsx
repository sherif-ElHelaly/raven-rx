import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { exportBackup, importBackup } from '../../../db/backup'
import { exportEntityCsvs } from '../../../db/entityCsv'
import { applySeedImport, diffSeedImport, type ImportDiff } from '../../../db/repo'
import { db } from '../../../db/schema'
import { parseSeedCsv } from '../../../db/seedImport'
import { getPin, setLastBackupAt, setPin } from '../../../ui/localPrefs'
import { shareOrDownloadFile } from '../../../ui/share'
import './settings.css'

function timestamp() {
  return new Date().toISOString().slice(0, 10)
}

export function Settings() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmRestoreFile, setConfirmRestoreFile] = useState<File | null>(null)

  const csvInputRef = useRef<HTMLInputElement>(null)
  const [importRows, setImportRows] = useState<ReturnType<typeof parseSeedCsv> | null>(null)
  const [importDiff, setImportDiff] = useState<ImportDiff | null>(null)

  const [pinSet, setPinSet] = useState(() => getPin() !== null)
  const [pinDraft, setPinDraft] = useState('')

  useEffect(() => {
    if ('storage' in navigator) {
      navigator.storage.persisted().then(setPersisted)
    }
  }, [])

  const requestPersist = async () => {
    if (!('storage' in navigator)) return
    const result = await navigator.storage.persist()
    setPersisted(result)
  }

  const handleBackupExport = async () => {
    setBusy('backup')
    setMessage(null)
    try {
      const data = await exportBackup(db)
      const file = new File([JSON.stringify(data)], `sarf-backup-${timestamp()}.json`, {
        type: 'application/json',
      })
      await shareOrDownloadFile(file)
      setLastBackupAt()
      setMessage('Backup exported.')
    } finally {
      setBusy(null)
    }
  }

  const handleCsvExport = async () => {
    setBusy('csv')
    setMessage(null)
    try {
      const csvs = await exportEntityCsvs(db)
      for (const [name, content] of Object.entries(csvs)) {
        const file = new File([content], `sarf-${name}`, { type: 'text/csv' })
        await shareOrDownloadFile(file)
      }
      setMessage('CSV export complete (6 files).')
    } finally {
      setBusy(null)
    }
  }

  const handleCsvImportSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy('csv-import')
    setMessage(null)
    try {
      const text = await file.text()
      const rows = parseSeedCsv(text)
      const diff = await diffSeedImport(db, rows)
      setImportRows(rows)
      setImportDiff(diff)
    } finally {
      setBusy(null)
    }
  }

  const applyCsvImport = async () => {
    if (!importRows) return
    setBusy('csv-import-apply')
    try {
      const result = await applySeedImport(db, importRows)
      setMessage(`Imported ${result.productsAdded} new medications, ${result.presentationsAdded} new presentations.`)
    } finally {
      setImportRows(null)
      setImportDiff(null)
      setBusy(null)
    }
  }

  const handleSetPin = (e: React.FormEvent) => {
    e.preventDefault()
    if (pinDraft.length < 4) {
      setMessage('PIN must be at least 4 digits.')
      return
    }
    setPin(pinDraft)
    setPinSet(true)
    setPinDraft('')
    setMessage('PIN lock enabled.')
  }

  const handleRemovePin = () => {
    setPin(null)
    setPinSet(false)
    setMessage('PIN lock removed.')
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setConfirmRestoreFile(file)
    e.target.value = ''
  }

  const performRestore = async () => {
    if (!confirmRestoreFile) return
    setBusy('restore')
    setMessage(null)
    try {
      const text = await confirmRestoreFile.text()
      const data = JSON.parse(text)
      await importBackup(db, data)
      setMessage('Backup restored. Everything else was replaced.')
    } catch (err) {
      setMessage(`Restore failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setConfirmRestoreFile(null)
      setBusy(null)
    }
  }

  return (
    <div className="page">
      <div className="top-bar top-bar--inline">
        <button className="top-bar__back" onClick={() => navigate(-1)} aria-label="Back">
          ←
        </button>
        <span className="top-bar__title">Settings</span>
      </div>

      <section className="settings-section">
        <h2 className="settings-section__title">Locations</h2>
        <p className="settings-section__hint">
          Pharmacies, storage and transfer points used by the Found / Transferred pickers.
        </p>
        <Link to="/locations" className="btn btn--block">
          Manage locations
        </Link>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Storage</h2>
        <p className="settings-section__hint">
          {persisted === null && 'Persistent storage not supported on this browser.'}
          {persisted === true && 'Storage is persistent — the OS will not silently clear it.'}
          {persisted === false && 'Storage is not yet persistent.'}
        </p>
        {persisted === false && (
          <button type="button" className="btn" onClick={requestPersist}>
            Request persistent storage
          </button>
        )}
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Full backup</h2>
        <p className="settings-section__hint">
          A single .json file with everything, including photos. Restoring replaces all data on
          this device.
        </p>
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={busy === 'backup'}
          onClick={handleBackupExport}
        >
          {busy === 'backup' ? 'Exporting…' : 'Export backup'}
        </button>
        <button
          type="button"
          className="btn btn--block"
          disabled={busy !== null}
          onClick={() => fileInputRef.current?.click()}
        >
          Restore from backup…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={handleFileSelected}
        />
        <p className="settings-section__hint">
          ⚠️ Backups contain card numbers. Don't share the file in group chats.
        </p>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">CSV export</h2>
        <p className="settings-section__hint">
          One file each for products, presentations, ingredients, persons, requests and items. No
          photos.
        </p>
        <button
          type="button"
          className="btn btn--block"
          disabled={busy === 'csv'}
          onClick={handleCsvExport}
        >
          {busy === 'csv' ? 'Exporting…' : 'Export CSVs'}
        </button>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">CSV import (medications)</h2>
        <p className="settings-section__hint">
          Bulk-add to the drug database from a file in the seed/import format. Only new brands and
          presentations are added — existing entries are never overwritten.
        </p>
        <button
          type="button"
          className="btn btn--block"
          disabled={busy === 'csv-import'}
          onClick={() => csvInputRef.current?.click()}
        >
          {busy === 'csv-import' ? 'Reading…' : 'Choose CSV…'}
        </button>
        <input
          ref={csvInputRef}
          type="file"
          accept="text/csv,.csv"
          hidden
          onChange={handleCsvImportSelected}
        />
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">PIN lock</h2>
        <p className="settings-section__hint">
          {pinSet
            ? 'The app locks on open and after 5 minutes away.'
            : 'No PIN set — the app opens straight away.'}
        </p>
        {pinSet ? (
          <button type="button" className="btn btn--danger btn--block" onClick={handleRemovePin}>
            Remove PIN
          </button>
        ) : (
          <form className="field field--row" onSubmit={handleSetPin}>
            <input
              className="field__input field__input--mono"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="4+ digits"
              value={pinDraft}
              onChange={(e) => setPinDraft(e.target.value.replace(/[^0-9]/g, ''))}
            />
            <button type="submit" className="btn btn--primary">
              Set PIN
            </button>
          </form>
        )}
      </section>

      {message && <p className="settings-message">{message}</p>}

      {importDiff && (
        <div className="sheet-backdrop" onClick={() => (busy ? undefined : setImportDiff(null))}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <p className="sheet__title">Import preview</p>
            <p className="settings-section__hint">
              {importDiff.newProducts} new medication{importDiff.newProducts === 1 ? '' : 's'} ·{' '}
              {importDiff.newPresentations} new presentation{importDiff.newPresentations === 1 ? '' : 's'}{' '}
              · {importDiff.existing} already in the database (skipped)
            </p>
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={busy === 'csv-import-apply' || (importDiff.newProducts === 0 && importDiff.newPresentations === 0)}
              onClick={applyCsvImport}
            >
              {busy === 'csv-import-apply' ? 'Importing…' : 'Import new rows'}
            </button>
            <button
              type="button"
              className="sheet__cancel"
              onClick={() => {
                setImportRows(null)
                setImportDiff(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirmRestoreFile && (
        <div className="sheet-backdrop" onClick={() => setConfirmRestoreFile(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <p className="sheet__title">Restore backup?</p>
            <p className="settings-section__hint">
              This replaces every person, request, item and medication currently on this device
              with the contents of “{confirmRestoreFile.name}”. This cannot be undone.
            </p>
            <button type="button" className="btn btn--danger btn--block" onClick={performRestore}>
              Replace everything
            </button>
            <button
              type="button"
              className="sheet__cancel"
              onClick={() => setConfirmRestoreFile(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
