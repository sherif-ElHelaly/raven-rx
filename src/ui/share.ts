export type ShareResult = 'shared' | 'downloaded' | 'cancelled'

// Shares files through the iOS share sheet when available (Web Share API
// Level 2, file sharing), falling back to a plain browser download.
// All files go in ONE share sheet: iOS only allows a share per tap, so a second
// share() call in a loop would be rejected.
export async function shareOrDownloadFiles(files: File[]): Promise<ShareResult> {
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean
    share?: (data: { files: File[] }) => Promise<void>
  }

  if (nav.canShare?.({ files }) && nav.share) {
    try {
      await nav.share({ files })
      return 'shared'
    } catch (err) {
      // Closing the share sheet is a choice, not a failure. Don't fall back to a
      // download: in the home-screen app that opens the raw file with no way back.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    }
  }

  for (const file of files) {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }
  return 'downloaded'
}

export function shareOrDownloadFile(file: File): Promise<ShareResult> {
  return shareOrDownloadFiles([file])
}
