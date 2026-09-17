import { useEffect, useState } from 'react'

interface BlobImageProps {
  blob: Blob | undefined
  alt: string
  className?: string
}

// Renders a Blob (photo stored in IndexedDB) via a revocable object URL.
export function BlobImage({ blob, alt, className }: BlobImageProps) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  if (!url) return null
  return <img src={url} alt={alt} className={className} />
}
