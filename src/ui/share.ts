// Shares a file through the iOS share sheet when available (Web Share API
// Level 2, file sharing), falling back to a plain browser download.
export async function shareOrDownloadFile(file: File): Promise<void> {
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean
    share?: (data: { files: File[] }) => Promise<void>
  }

  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file] })
      return
    } catch {
      // User cancelled the share sheet, or the OS declined — fall through
      // to a plain download so the export still lands somewhere.
    }
  }

  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
