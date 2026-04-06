import { useState, useEffect, useRef } from 'react'
import { telegramApi } from '@/lib/telegram'
import { ImageIcon, FileText, Play, Loader2 } from 'lucide-react'

export default function TelegramMedia({ 
  accountId, 
  chatId, 
  messageId, 
  mediaType 
}: { 
  accountId: string, 
  chatId: string, 
  messageId: number, 
  mediaType: string 
}) {
  const [mediaData, setMediaData] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasRequested, setHasRequested] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasRequested) {
          setHasRequested(true)
        }
      },
      { rootMargin: '100px' }
    )

    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => {
      observer.disconnect()
    }
  }, [hasRequested])

  useEffect(() => {
    if (!hasRequested || mediaData !== null || loading) return;
    
    let active = true
    const loadMedia = async () => {
      setLoading(true)
      try {
        const res = await telegramApi.getMessageMedia(accountId, chatId, messageId)
        if (active && res && res.success) {
          setMediaData(res.base64)
        }
      } catch (err) {
        console.error('Failed to load message media', err)
      } finally {
        if (active) setLoading(false)
      }
    }
    loadMedia()
    return () => { active = false }
  }, [accountId, chatId, messageId, hasRequested, mediaData, loading])

  if (!hasRequested || loading) {
    return (
      <div ref={containerRef} className="w-full h-32 flex items-center justify-center bg-gray-100 rounded-lg animate-pulse mb-2">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    )
  }

  if (!mediaData) {
    return (
      <div className="w-full py-3 flex items-center justify-center bg-gray-50 border border-dashed rounded-lg mb-2 text-xs font-medium text-gray-500 gap-1.5">
        <ImageIcon className="w-4 h-4" /> Không thể tải ảnh/media
      </div>
    )
  }

  // Nếu là ảnh JPEG, PNG, WEBP, GIF
  if (
    mediaType === 'MessageMediaPhoto' || 
    mediaData.startsWith('data:image/') ||
    mediaData.startsWith('data:video/')
  ) {
    const isVideo = mediaData.startsWith('data:video/')
    return (
      <div className="relative mb-2 w-full max-h-[300px] overflow-hidden rounded-xl border border-gray-100 bg-black flex items-center justify-center">
        {isVideo ? (
          <video src={mediaData} controls className="w-full object-contain max-h-[300px]" />
        ) : (
          <img src={mediaData} alt="Telegram Media" className="w-full object-contain max-h-[300px]" />
        )}
      </div>
    )
  }

  return (
    <div className="mb-2 p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-3">
      <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white shrink-0">
        <FileText className="w-5 h-5" />
      </div>
      <div className="overflow-hidden">
        <p className="text-sm font-semibold truncate text-gray-800">Tệp tin đính kèm</p>
        <p className="text-xs text-blue-600 font-mono mt-0.5">{mediaType}</p>
      </div>
    </div>
  )
}
