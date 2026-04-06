'use client'
import { useState, useEffect } from "react"
import { telegramApi } from "@/lib/telegram"
import { User, Users } from "lucide-react"

interface Props {
  accountId: string
  peerId?: string
  title?: string
  isGroup?: boolean
  className?: string
}

export default function TelegramAvatar({ accountId, peerId, title = '', isGroup = false, className = '' }: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let mounted = true
    setImgSrc(null)
    setError(false)

    const fetchPhoto = async () => {
      try {
         const res = await telegramApi.getPhoto(accountId, peerId)
         if (mounted && res?.success && res.photoBase64) {
           setImgSrc(`data:image/jpeg;base64,${res.photoBase64}`)
         } else if (mounted) {
           setError(true)
         }
      } catch (err) {
         if (mounted) setError(true)
      }
    }
    fetchPhoto()
    return () => { mounted = false }
  }, [accountId, peerId])

  if (imgSrc && !error) {
    return <img src={imgSrc} alt={title || 'Avatar'} className={`object-cover ${className}`} />
  }

  return (
    <div className={`bg-gradient-to-tr ${isGroup ? 'from-indigo-500 to-purple-500' : 'from-blue-500 to-cyan-400'} flex items-center justify-center text-white font-bold shadow-sm ${className}`}>
      {title?.[0]?.toUpperCase() || (isGroup ? <Users className="w-1/2 h-1/2" /> : <User className="w-1/2 h-1/2" />)}
    </div>
  )
}
