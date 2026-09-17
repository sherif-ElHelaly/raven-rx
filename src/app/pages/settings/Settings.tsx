import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { importBackup } from '../../../db/backup'
import { exportEntityCsvs } from '../../../db/entityCsv'
import { applySeedImport, diffSeedImport, type ImportDiff } from '../../../db/repo'
import { db } from '../../../db/schema'
import { parseSeedCsv } from '../../../db/seedImport'
import { useAppUpdate } from '../../../ui/AppUpdate'
import { backUpNow } from '../../../ui/backupExport'
import { getLastBackupAt, getPin, setLastBackupAt, setPin } from '../../../ui/localPrefs'
import { shareOrDownloadFiles } from '../../../ui/share'
import './settings.css'

function formatBackupDate(at: number | null) {
  if (at === null) return 'Never backed up on this device.'
  return `Last backup: ${new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
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
  const [lastBackupAt, setLastBackupAtState] = useState(getLastBackupAt)

  const { updateReady, checkForUpdates, applyUpdate } = useAppUpdate()
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)

  const handleCheckForUpdates = async () => {
    setBusy('update-check')
    setUpdateStatus(null)
    try {
      const result = await checkForUpdates()
      setUpdateStatus(
        {
          'update-ready': 'A new version is ready.',
          'up-to-date': 'You have the latest version.',
          offline: 'Couldn’t check — you seem to be offline.',
          unsupported: 'Updates can only be checked in the installed app.',
        }[result],
      )
    } finally {
      setBusy(null)
    }
  }

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
      const result = await backUpNow()
      if (result !== 'cancelled') {
        setLastBackupAtState(getLastBackupAt())
        setMessage('Backup exported.')
      }
    } finally {
      setBusy(null)
    }
  }

  const handleCsvExport = async () => {
    setBusy('csv')
    setMessage(null)
    try {
      const csvs = await exportEntityCsvs(db)
      const files = Object.entries(csvs).map(
        ([name, content]) => new File([content], `raven-rx-${name}`, { type: 'text/csv' }),
      )
      const result = await shareOrDownloadFiles(files)
      if (result !== 'cancelled') setMessage(`CSV export complete (${files.length} files).`)
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
      setLastBackupAt()
      setLastBackupAtState(getLastBackupAt())
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
        <h2 className="settings-section__title">App version</h2>
        <p className="settings-section__hint">
          {__APP_VERSION__}
          {updateStatus && (
            <>
              <br />
              {updateStatus}
            </>
          )}
        </p>
        {updateReady ? (
          <button type="button" className="btn btn--primary btn--block" onClick={applyUpdate}>
            Update now
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--block"
            disabled={busy === 'update-check'}
            onClick={handleCheckForUpdates}
          >
            {busy === 'update-check' ? 'Checking…' : 'Check for updates'}
          </button>
        )}
      </section>

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
          A single .json file with everything, including photos. In the share sheet, tap{' '}
          <strong>Save to Files</strong> → iCloud Drive so it survives losing the phone. Restoring
          replaces all data on this device.
        </p>
        <p className="settings-section__hint">{formatBackupDate(lastBackupAt)}</p>
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
          accept="application/json,.json"
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
