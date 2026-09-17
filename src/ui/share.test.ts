import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareOrDownloadFiles } from './share'

const file = new File(['{}'], 'backup.json', { type: 'application/json' })

function stubNavigator(share: (data: { files: File[] }) => Promise<void>) {
  vi.stubGlobal('navigator', { canShare: () => true, share })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shareOrDownloadFiles', () => {
  it('shares all files in a single share sheet', async () => {
    const share = vi.fn(async () => {})
    stubNavigator(share)
    const second = new File(['a'], 'b.csv')
    await expect(shareOrDownloadFiles([file, second])).resolves.toBe('shared')
    expect(share).toHaveBeenCalledTimes(1)
    expect(share).toHaveBeenCalledWith({ files: [file, second] })
  })

  it('treats closing the share sheet as cancelled, without downloading', async () => {
    stubNavigator(async () => {
      throw new DOMException('dismissed', 'AbortError')
    })
    const createElement = vi.fn()
    vi.stubGlobal('document', { createElement })
    await expect(shareOrDownloadFiles([file])).resolves.toBe('cancelled')
    expect(createElement).not.toHaveBeenCalled()
  })

  it('falls back to a download when sharing fails for another reason', async () => {
    stubNavigator(async () => {
      throw new DOMException('no gesture', 'NotAllowedError')
    })
    const anchor = { click: vi.fn(), remove: vi.fn(), href: '', download: '' }
    vi.stubGlobal('document', {
      createElement: () => anchor,
      body: { appendChild: vi.fn() },
    })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    await expect(shareOrDownloadFiles([file])).resolves.toBe('downloaded')
    expect(anchor.download).toBe('backup.json')
    expect(anchor.click).toHaveBeenCalled()
  })
})
