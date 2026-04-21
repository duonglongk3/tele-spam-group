'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, Loader2, Send, MessageSquareText } from 'lucide-react'
import { toast } from 'sonner'
import { telegramApi } from '@/lib/telegram'

function Card({ children, className = '' }: { children: React.ReactNode, className?: string }) {
  return <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}>{children}</div>
}

type GroupItem = {
  id: string
  title: string
  isGroup?: boolean
  isChannel?: boolean
}

export default function BotMessageTemplatePage() {
  const [accounts, setAccounts] = useState<any[]>([])
  const [dialogs, setDialogs] = useState<GroupItem[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [selectedChatId, setSelectedChatId] = useState('-1003788125204')
  const [message, setMessage] = useState('Chọn một tùy chọn bên dưới:')

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const accs = await telegramApi.getAccounts()
        setAccounts(accs || [])

        let merged: GroupItem[] = []
        for (const acc of accs || []) {
          const res = await telegramApi.getDialogs(acc.id)
          if (res?.success) {
            merged = [...merged, ...(res.dialogs || [])]
          }
        }

        const unique = Array.from(new Map(merged.map((item) => [item.id, item])).values())
        setDialogs(unique.filter((item) => item.isGroup || item.isChannel))
      } catch (e: any) {
        toast.error('Lỗi tải danh sách nhóm: ' + e.message)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const targetOptions = useMemo(() => {
    const base = dialogs.map((dialog) => ({
      value: dialog.id,
      label: `${dialog.title} (${dialog.id})`,
    }))

    if (!base.some((item) => item.value === '-1003788125204')) {
      base.unshift({ value: '-1003788125204', label: 'test (-1003788125204)' })
    }

    return base
  }, [dialogs])

  const handleSendNow = async () => {
    if (!message.trim()) {
      toast.warning('Vui lòng nhập nội dung tin nhắn')
      return
    }

    try {
      setSending(true)
      const res = await telegramApi.sendNow({
        name: 'Bot message template',
        type: 'text',
        contentTemplate: message.trim(),
        imagePaths: [],
        actionButtons: [
          { text: 'View Web', url: 'https://buffortune.com/' },
          { text: 'Contact Admin', url: 'https://t.me/buffortuner' },
        ],
        sendViaBot: true,
        target: {
          chatId: selectedChatId,
          name: targetOptions.find((item) => item.value === selectedChatId)?.label || selectedChatId,
        },
      })

      if (res?.success) {
        toast.success('Đã gửi ngay thành công')
      } else {
        let msg = res?.error || 'UNKNOWN_ERROR'
        if (msg.includes('chat not found') || msg.includes('was kicked') || msg.includes('peer id invalid') || msg.includes('not a member')) {
          msg = 'Bạn chưa thêm Bot vào Nhóm này, hoặc nhóm đã đuổi Bot. Vui lòng thêm/mời Bot vào nhóm trước khi gửi!'
        }
        toast.error('Gửi thất bại: ' + msg)
      }
    } catch (e: any) {
      let msg = e.message
      if (msg.includes('chat not found') || msg.includes('was kicked') || msg.includes('peer id invalid') || msg.includes('not a member')) {
        msg = 'Bạn chưa thêm Bot vào Nhóm này, hoặc nhóm đã đuổi Bot. Vui lòng thêm/mời Bot vào nhóm trước khi gửi!'
      }
      toast.error('Gửi thất bại: ' + msg)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Bot className="w-8 h-8 text-gray-700" />
          Mẫu tin nhắn Bot
        </h1>
        <p className="text-gray-500 mt-2">Tạo nhanh mẫu tin nhắn với 2 button cố định và gửi ngay bằng Telegram Bot</p>
      </div>

      <Card className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-semibold mb-2">Chọn group / channel</label>
            <select
              value={selectedChatId}
              onChange={(e) => setSelectedChatId(e.target.value)}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            >
              {targetOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-2">
              {loading ? 'Đang tải danh sách nhóm...' : `Đã tải ${targetOptions.length} đích từ ${accounts.length} tài khoản`}
            </p>
            
            <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200 space-y-2">
              <p className="text-xs text-amber-700 font-medium">
                ⚠️ CẦN BIẾT: Danh sách trên lấy từ các Nhóm mà Account của bạn đang tham gia. Tuy nhiên, để Bot có thể gửi tin nhắn vào đó, bạn <strong className="font-bold underline">BẮT BUỘC PHẢI THÊM CON BOT ĐÓ VÀO NHÓM</strong> trước tiên!
              </p>
              <div className="text-xs text-amber-800 bg-amber-100/50 p-2 rounded">
                <p className="font-bold mb-1">Hướng dẫn thêm Bot:</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Mở Telegram, vào Cài đặt nhóm (Group Info).</li>
                  <li>Chọn <strong>Add Members</strong> (Thêm thành viên).</li>
                  <li>Gõ chính xác <strong>@username_bot_cua_ban</strong> vào ô tìm kiếm.</li>
                  <li>Chọn Bot và bấm Add (Để Bot hoạt động tốt nhất, hãy set Bot làm Admin).</li>
                </ol>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-700">Buttons cố định</div>
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium">View Web → https://buffortune.com/</span>
              <span className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium">Contact Admin → https://t.me/buffortuner</span>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Nội dung text</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={8}
            placeholder="Nhập nội dung tin nhắn..."
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>

        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-gray-700">
            <MessageSquareText className="w-4 h-4" />
            Xem trước nhanh
          </div>
          <div className="rounded-xl bg-white border border-gray-200 p-4 space-y-4">
            <div className="text-sm text-gray-800 whitespace-pre-wrap">{message || '...'}</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="px-3 py-2 rounded-lg bg-[#24A1DE] text-white text-sm font-medium">
                View Web
              </button>
              <button type="button" className="px-3 py-2 rounded-lg bg-[#24A1DE] text-white text-sm font-medium">
                Contact Admin
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSendNow}
            disabled={sending || loading}
            className="px-6 py-3 rounded-lg font-medium bg-emerald-600 text-white flex items-center gap-2 disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Gửi ngay
          </button>
        </div>
      </Card>
    </div>
  )
}
