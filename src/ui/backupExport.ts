import { exportBackup } from '../db/backup'
import { db } from '../db/schema'
import { setLastBackupAt } from './localPrefs'
import { shareOrDownloadFile, type ShareResult } from './share'

// One-tap backup: builds the .json and opens the share sheet, where
// "Save to Files" → iCloud Drive keeps it off the phone.
export async function backUpNow(): Promise<ShareResult> {
  const data = await exportBackup(db)
  const stamp = new Date().toISOString().slice(0, 10)
  const file = new File([JSON.stringify(data)], `raven-rx-backup-${stamp}.json`, {
    type: 'application/json',
  })
  const result = await shareOrDownloadFile(file)
  if (result !== 'cancelled') setLastBackupAt()
  return result
}
