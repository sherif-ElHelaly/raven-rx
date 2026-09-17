// Device-local settings that are never backed up (PIN, last-backup nag) —
// deliberately outside Dexie so a restore never overwrites the lock.

const LAST_BACKUP_KEY = 'sarf-last-backup-at'
const PIN_KEY = 'sarf-pin'

export function getLastBackupAt(): number | null {
  const raw = localStorage.getItem(LAST_BACKUP_KEY)
  return raw ? Number(raw) : null
}

export function setLastBackupAt(at: number = Date.now()): void {
  localStorage.setItem(LAST_BACKUP_KEY, String(at))
}

export function daysSinceLastBackup(): number | null {
  const at = getLastBackupAt()
  if (at === null) return null
  return Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000))
}

export function getPin(): string | null {
  return localStorage.getItem(PIN_KEY)
}

export function setPin(pin: string | null): void {
  if (pin) localStorage.setItem(PIN_KEY, pin)
  else localStorage.removeItem(PIN_KEY)
}
