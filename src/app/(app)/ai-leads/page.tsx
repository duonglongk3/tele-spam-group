'use client'

import { useEffect, useState } from 'react'
import {
  Inbox,
  Loader2,
  RefreshCw,
  Check,
  X,
  Edit2,
  MessageSquare,
  User,
  Cpu,
  AlertTriangle,
  Send,
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { telegramApi } from '@/lib/telegram'

type QueueItem = {
  _id: string
  status: 'pending' | 'sent' | 'skipped'
  accountId: string
  chatId: string
  messageId: string
  senderId: string
  senderName: string
  chatTitle: string
  sourceType: 'group' | 'private'
  category: string
  score: number
  riskScore: number
  reason: string
  originalText: string
  suggestedReply: string
  autoSendAt?: string
  autoSendScheduledAt?: string
  autoSendError?: string
  adminNotifiedAt?: string
  sentAt?: string
  skippedAt?: string
  createdAt: string
}

type BlacklistItem = {
  accountId: string
  senderId: string
  senderName: string
  score: number
  reason: string
  addedAt: string
}

function formatAutoSendError(error: string) {
  if (error.includes('ALLOW_PAYMENT_REQUIRED')) {
    return 'Group này yêu cầu trả phí để gửi tin nhắn. Hệ thống không tự động thanh toán nên đề xuất đã được bỏ qua.'
  }
  return error
}

export default function AiLeadsPage() {
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState<QueueItem[]>([])
  const [blacklist, setBlacklist] = useState<any[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [uniqueGroups, setUniqueGroups] = useState<{ accountId: string; chatId: string; chatTitle: string }[]>([])
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [queuePage, setQueuePage] = useState(1)
  const [queueLimit, setQueueLimit] = useState(20)
  const [queueTotal, setQueueTotal] = useState(0)
  const [queueTotalPages, setQueueTotalPages] = useState(1)

  // Blacklist Pagination & Filter states
  const [blacklistPage, setBlacklistPage] = useState(1)
  const [blacklistTotal, setBlacklistTotal] = useState(0)
  const [blacklistTotalPages, setBlacklistTotalPages] = useState(1)
  const [blacklistSearch, setBlacklistSearch] = useState('')
  const [blacklistAccountId, setBlacklistAccountId] = useState('')
  const [blacklistSourceType, setBlacklistSourceType] = useState('')
  const [blacklistSortBy, setBlacklistSortBy] = useState('updatedAt')
  const [blacklistSortOrder, setBlacklistSortOrder] = useState('DESC')

  useEffect(() => {
    if (statusFilter !== 'blacklist') {
      loadQueue(queuePage)
    }
  }, [statusFilter, queuePage, queueLimit, categoryFilter, groupFilter])

  useEffect(() => {
    if (statusFilter === 'blacklist') {
      loadBlacklist(1)
    }
  }, [statusFilter, blacklistSearch, blacklistAccountId, blacklistSourceType, blacklistSortBy, blacklistSortOrder])

  useEffect(() => {
    if (statusFilter === 'blacklist') {
      loadBlacklist(blacklistPage)
    }
  }, [blacklistPage])

  async function loadQueue(pageToLoad = queuePage) {
    try {
      setLoading(true)
      const filter: any = statusFilter === 'all' ? {} : { status: statusFilter }
      if (categoryFilter !== 'all') {
        filter.category = categoryFilter
      }
      if (groupFilter !== 'all') {
        filter.chatId = groupFilter
      }
      const res = await telegramApi.getAiLeadQueue(filter, queueLimit, pageToLoad)
      if (res?.success) {
        setList(res.list || [])
        setQueueTotal(res.total || 0)
        setQueueTotalPages(res.totalPages || 1)
        setQueuePage(res.page || pageToLoad)
        if (res.uniqueGroups) {
          setUniqueGroups(res.uniqueGroups)
        }
      } else {
        toast.error('Lỗi tải hàng chờ: ' + (res?.error || 'Không rõ'))
      }
    } catch (e: any) {
      toast.error('Lỗi kết nối: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadBlacklist(pageToLoad = blacklistPage) {
    try {
      setLoading(true)
      const res = await telegramApi.getAiLeadBlacklistPaged({
        page: pageToLoad,
        limit: 10,
        search: blacklistSearch,
        accountId: blacklistAccountId,
        sourceType: blacklistSourceType,
        sortBy: blacklistSortBy,
        sortOrder: blacklistSortOrder,
      })
      if (res?.success) {
        setBlacklist(res.items || [])
        setBlacklistTotal(res.total || 0)
        setBlacklistTotalPages(res.totalPages || 1)
        setBlacklistPage(res.page || 1)
      } else {
        toast.error('Lỗi tải danh sách đen: ' + (res?.error || 'Không rõ'))
      }
    } catch (e: any) {
      toast.error('Lỗi kết nối: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRemoveFromBlacklist(accountId: string, senderId: string) {
    try {
      setProcessingId(`${accountId}:${senderId}`)
      const res = await telegramApi.removeFromAiLeadBlacklist(accountId, senderId)
      if (res?.success) {
        toast.success('Đã gỡ chặn user thành công!')
        loadBlacklist(blacklistPage)
      } else {
        toast.error('Lỗi gỡ chặn: ' + (res?.error || 'Không rõ'))
      }
    } catch (e: any) {
      toast.error('Lỗi kết nối: ' + e.message)
    } finally {
      setProcessingId(null)
    }
  }

  async function handleSend(id: string) {
    try {
      setProcessingId(id)
      const res = await telegramApi.sendAiLeadPending(id)
      if (res?.success) {
        toast.success('Đã gửi phản hồi thành công!')
        setList(prev => prev.filter(item => item._id !== id))
      } else {
        toast.error('Lỗi gửi phản hồi: ' + (res?.error || 'Không rõ'))
      }
    } catch (e: any) {
      toast.error('Lỗi kết nối: ' + e.message)
    } finally {
      setProcessingId(null)
    }
  }

  async function handleSkip(id: string) {
    try {
      setProcessingId(id)
      const res = await telegramApi.skipAiLeadPending(id)
      if (res?.success) {
        toast.success('Đã bỏ qua đề xuất!')
        setList(prev => prev.filter(item => item._id !== id))
      } else {
        toast.error('Lỗi cập nhật: ' + (res?.error || 'Không rõ'))
      }
    } catch (e: any) {
      toast.error('Lỗi kết nối: ' + e.message)
    } finally {
      setProcessingId(null)
    }
  }

  async function handleEditSave(id: string) {
    if (!editText.trim()) {
      toast.error('Nội dung phản hồi không được để trống')
      return
    }
    try {
      setProcessingId(id)
      const res = await telegramApi.editAiLeadPending(id, editText)
      if (res?.success) {
        toast.success('Đã lưu phản hồi thành công!')
        setList(prev => prev.map(item => item._id === id ? { ...item, suggestedReply: editText } : item))
        setEditingId(null)
      } else {
        toast.error('Lỗi lưu phản hồi: ' + (res?.error || 'Không rõ'))
      }
    } catch (e: any) {
      toast.error('Lỗi kết nối: ' + e.message)
    } finally {
      setProcessingId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Bạn có chắc chắn muốn xóa phản hồi này khỏi hàng chờ?')) return
    try {
      setProcessingId(id)
      const res = await telegramApi.deleteAiLeadQueueItem(id)
      if (res?.success) {
        toast.success('Đã xóa phản hồi thành công!')
        setList(prev => prev.filter(item => item._id !== id))
        setQueueTotal(prev => Math.max(0, prev - 1))
      } else {
        toast.error('Lỗi xóa phản hồi: ' + (res?.error || 'Không rõ'))
      }
    } catch (e: any) {
      toast.error('Lỗi kết nối: ' + e.message)
    } finally {
      setProcessingId(null)
    }
  }

  async function handleClearQueue() {
    const statusText = statusFilter === 'pending' ? 'đang chờ' : statusFilter === 'sent' ? 'đã gửi' : statusFilter === 'skipped' ? 'đã bỏ qua' : 'toàn bộ hàng chờ'
    if (!confirm(`Bạn có chắc chắn muốn xóa tất cả tin nhắn ${statusText}? Hành động này không thể hoàn tác.`)) return
    try {
      setLoading(true)
      const statusToClear = statusFilter === 'all' ? undefined : statusFilter
      const res = await telegramApi.clearAiLeadQueue(statusToClear)
      if (res?.success) {
        toast.success('Đã dọn dẹp hàng chờ thành công!')
        loadQueue(1)
      } else {
        toast.error('Lỗi dọn dẹp: ' + (res?.error || 'Không rõ'))
      }
    } catch (e: any) {
      toast.error('Lỗi kết nối: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  function startEditing(item: QueueItem) {
    setEditingId(item._id)
    setEditText(item.suggestedReply)
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Inbox className="w-8 h-8 text-[#24A1DE]" /> Hàng chờ AI Lead
          </h1>
          <p className="text-gray-500 mt-2">
            Danh sách phản hồi AI. Auto queue sẽ tự gửi theo lịch random, còn item duyệt tay vẫn có nút gửi/bỏ qua.
          </p>
        </div>
        <div className="flex gap-2">
          {statusFilter !== 'blacklist' && list.length > 0 && (
            <button
              onClick={handleClearQueue}
              disabled={loading}
              className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-100 px-4 py-2 rounded-lg font-medium flex items-center gap-2 justify-center shadow-sm disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" /> 
              Xóa tất cả {statusFilter === 'pending' ? 'đang chờ' : statusFilter === 'sent' ? 'đã gửi' : statusFilter === 'skipped' ? 'đã bỏ qua' : 'hàng chờ'}
            </button>
          )}
          <button
            onClick={() => statusFilter === 'blacklist' ? loadBlacklist(blacklistPage) : loadQueue(queuePage)}
            disabled={loading}
            className="bg-white border hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg font-medium flex items-center gap-2 justify-center shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Làm mới
          </button>
        </div>
      </div>

      {/* Bộ lọc trạng thái và loại tin nhắn */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gray-50/50 border rounded-xl p-4">
        <div className="flex gap-2 p-1 bg-gray-100 rounded-lg w-fit">
          {[
            { key: 'pending', label: 'Đang chờ' },
            { key: 'sent', label: 'Đã gửi' },
            { key: 'skipped', label: 'Đã bỏ qua' },
            { key: 'all', label: 'Tất cả' },
            { key: 'blacklist', label: 'Danh sách đen' }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                setStatusFilter(tab.key)
                setQueuePage(1)
              }}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                statusFilter === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {statusFilter !== 'blacklist' && (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 font-medium whitespace-nowrap">Loại tin nhắn:</span>
              <select
                value={categoryFilter}
                onChange={e => {
                  setCategoryFilter(e.target.value)
                  setQueuePage(1)
                }}
                className="border rounded-lg px-3 py-2 bg-white font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#24A1DE] cursor-pointer"
              >
                <option value="all">Tất cả loại</option>
                <option value="engagement">Thảo luận & Quảng bá dạo</option>
                <option value="buying">Hỏi mua sỉ & lẻ</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-gray-500 font-medium whitespace-nowrap">Nhóm (Group):</span>
              <select
                value={groupFilter}
                onChange={e => {
                  setGroupFilter(e.target.value)
                  setQueuePage(1)
                }}
                className="border rounded-lg px-3 py-2 bg-white font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#24A1DE] cursor-pointer max-w-[250px]"
              >
                <option value="all">Tất cả nhóm ({uniqueGroups.length})</option>
                {uniqueGroups.map(g => (
                  <option key={`${g.accountId}:${g.chatId}`} value={g.chatId}>
                    {g.chatTitle}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#24A1DE]" />
          <p className="text-sm text-gray-500">Đang tải dữ liệu...</p>
        </div>
      ) : statusFilter === 'blacklist' ? (
        <div className="space-y-4">
          {/* Panel bộ lọc của Blacklist */}
          <div className="bg-gray-50 border rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-4 text-sm">
            <div className="flex-1 relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Tìm theo tên, ID người dùng, hoặc lý do chặn..."
                value={blacklistSearch}
                onChange={e => {
                  setBlacklistSearch(e.target.value)
                  setBlacklistPage(1)
                }}
                className="w-full pl-9 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#24A1DE] bg-white"
              />
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 font-medium whitespace-nowrap">Nguồn:</span>
                <select
                  value={blacklistSourceType}
                  onChange={e => {
                    setBlacklistSourceType(e.target.value)
                    setBlacklistPage(1)
                  }}
                  className="border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#24A1DE]"
                >
                  <option value="">Tất cả</option>
                  <option value="group">Nhóm (Group)</option>
                  <option value="private">Cá nhân (Private)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-gray-500 font-medium whitespace-nowrap">Sắp xếp:</span>
                <select
                  value={blacklistSortBy}
                  onChange={e => {
                    setBlacklistSortBy(e.target.value)
                    setBlacklistPage(1)
                  }}
                  className="border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#24A1DE]"
                >
                  <option value="updatedAt">Thời gian chặn</option>
                  <option value="score">Điểm rác</option>
                  <option value="riskScore">Mức độ rủi ro</option>
                  <option value="senderName">Tên người dùng</option>
                </select>
              </div>

              <select
                value={blacklistSortOrder}
                onChange={e => {
                  setBlacklistSortOrder(e.target.value)
                  setBlacklistPage(1)
                }}
                className="border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#24A1DE]"
              >
                <option value="DESC">Giảm dần</option>
                <option value="ASC">Tăng dần</option>
              </select>
            </div>
          </div>

          {blacklist.length === 0 ? (
            <div className="border border-dashed rounded-xl p-16 text-center space-y-3 bg-white">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto text-gray-400">
                <User className="w-6 h-6" />
              </div>
              <h3 className="font-semibold text-gray-900">Danh sách đen trống</h3>
              <p className="text-sm text-gray-500 max-w-sm mx-auto">
                Không tìm thấy tài khoản nào khớp với bộ lọc của bạn. Khi phát hiện các tin nhắn rác hoặc spam, AI sẽ tự động đưa ID người gửi vào đây.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Người dùng</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Nguồn</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Tài khoản Telegram</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Điểm rác</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Rủi ro</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Lý do chặn gần nhất</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Thời gian</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200 text-sm">
                    {blacklist.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                              {(item.senderName || 'U').slice(0, 1).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">{item.senderName}</div>
                              <div className="text-xs text-gray-500">ID: {item.senderId}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-full ${
                            item.sourceType === 'private'
                              ? 'bg-purple-50 text-purple-700 border border-purple-100'
                              : 'bg-blue-50 text-blue-700 border border-blue-100'
                          }`}>
                            {item.sourceType === 'private' ? 'Cá nhân' : 'Nhóm'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-500 text-xs">
                          ID: {item.accountId}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-full">
                            {item.score}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            (item.riskScore || 0) > 60 
                              ? 'text-red-700 bg-red-50 border border-red-100'
                              : 'text-amber-700 bg-amber-50 border border-amber-100'
                          }`}>
                            {item.riskScore || 0}%
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600 max-w-xs truncate" title={item.reason}>
                          {item.reason}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-400">
                          {new Date(item.addedAt).toLocaleString('vi-VN')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-xs font-medium">
                          <button
                            onClick={() => handleRemoveFromBlacklist(item.accountId, item.senderId)}
                            disabled={processingId === `${item.accountId}:${item.senderId}`}
                            className="text-emerald-600 hover:text-emerald-900 border border-emerald-100 hover:bg-emerald-50 px-3 py-1.5 rounded-lg transition-colors font-semibold disabled:opacity-50 inline-flex items-center gap-1"
                          >
                            {processingId === `${item.accountId}:${item.senderId}` ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            Bỏ chặn
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Phần phân trang */}
              <div className="px-6 py-4 bg-gray-50 border-t flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="text-xs text-gray-500 font-medium">
                  Hiển thị {blacklist.length} trên tổng số {blacklistTotal} người dùng bị chặn
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setBlacklistPage(prev => Math.max(1, prev - 1))}
                    disabled={blacklistPage <= 1}
                    className="border bg-white hover:bg-gray-50 text-gray-700 p-2 rounded-lg font-medium shadow-sm disabled:opacity-50 disabled:hover:bg-white transition-colors"
                    title="Trang trước"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-semibold text-gray-700 bg-white border px-3 py-2 rounded-lg shadow-sm">
                    Trang {blacklistPage} / {blacklistTotalPages}
                  </span>
                  <button
                    onClick={() => setBlacklistPage(prev => Math.min(blacklistTotalPages, prev + 1))}
                    disabled={blacklistPage >= blacklistTotalPages}
                    className="border bg-white hover:bg-gray-50 text-gray-700 p-2 rounded-lg font-medium shadow-sm disabled:opacity-50 disabled:hover:bg-white transition-colors"
                    title="Trang sau"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : list.length === 0 ? (
        <div className="border border-dashed rounded-xl p-16 text-center space-y-3 bg-white">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto text-gray-400">
            <Inbox className="w-6 h-6" />
          </div>
          <h3 className="font-semibold text-gray-900">Hàng chờ trống</h3>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            Không tìm thấy đề xuất phản hồi nào khớp với bộ lọc của bạn. Hệ thống sẽ tự động thêm vào đây khi có tin nhắn mới phù hợp.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-xs text-gray-500 font-medium">
              Hiển thị {list.length} trên tổng số {queueTotal} item, trang {queuePage} / {queueTotalPages}
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end">
              <select
                value={queueLimit}
                onChange={e => {
                  setQueueLimit(Number(e.target.value))
                  setQueuePage(1)
                }}
                className="border rounded-lg px-3 py-2 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[#24A1DE]"
              >
                <option value={10}>10 / trang</option>
                <option value={20}>20 / trang</option>
                <option value={50}>50 / trang</option>
                <option value={100}>100 / trang</option>
              </select>
              <button
                onClick={() => setQueuePage(prev => Math.max(1, prev - 1))}
                disabled={queuePage <= 1 || loading}
                className="border bg-white hover:bg-gray-50 text-gray-700 p-2 rounded-lg font-medium shadow-sm disabled:opacity-50 disabled:hover:bg-white transition-colors"
                title="Trang trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setQueuePage(prev => Math.min(queueTotalPages, prev + 1))}
                disabled={queuePage >= queueTotalPages || loading}
                className="border bg-white hover:bg-gray-50 text-gray-700 p-2 rounded-lg font-medium shadow-sm disabled:opacity-50 disabled:hover:bg-white transition-colors"
                title="Trang sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6">
            {list.map(item => (
            <div
              key={item._id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col md:grid md:grid-cols-12 hover:shadow-md transition-shadow"
            >
              {/* Cột trái: Thông tin Meta */}
              <div className="p-5 border-b md:border-b-0 md:border-r border-gray-100 md:col-span-3 bg-gray-50/50 space-y-4">
                <div>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      item.status === 'pending'
                        ? 'bg-amber-50 text-amber-700 border border-amber-100'
                        : item.status === 'sent'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                        : 'bg-gray-100 text-gray-700 border'
                    }`}
                  >
                    {item.status === 'pending' && ((item.autoSendScheduledAt || item.autoSendAt) ? 'Auto queue' : 'Chờ duyệt')}
                    {item.status === 'sent' && 'Đã gửi'}
                    {item.status === 'skipped' && 'Đã bỏ qua'}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span className="font-medium truncate" title={item.chatTitle}>
                      {item.chatTitle}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <User className="w-3.5 h-3.5" />
                    <span className="truncate" title={item.senderName}>
                      {item.senderName} (ID: {item.senderId})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Cpu className="w-3.5 h-3.5" />
                    <span>Mức độ phù hợp: </span>
                    <span className={`font-bold ${item.score >= 80 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {item.score}%
                    </span>
                  </div>
                  {item.riskScore > 0 && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                      <span>Rủi ro: </span>
                      <span className="font-bold text-rose-600">{item.riskScore}%</span>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-gray-100 text-[10px] text-gray-400 space-y-1">
                  <div>Tạo lúc: {new Date(item.createdAt).toLocaleString('vi-VN')}</div>
                  {(item.autoSendScheduledAt || item.autoSendAt) && <div>Loại: Auto queue</div>}
                  {item.autoSendAt && <div>Dự kiến gửi: {new Date(item.autoSendAt).toLocaleString('vi-VN')}</div>}
                  {item.sentAt && <div>Gửi lúc: {new Date(item.sentAt).toLocaleString('vi-VN')}</div>}
                  {item.skippedAt && <div>Bỏ qua lúc: {new Date(item.skippedAt).toLocaleString('vi-VN')}</div>}
                </div>
              </div>

              {/* Cột giữa: Nội dung tin nhắn & AI Reply */}
              <div className="p-5 md:col-span-7 space-y-4">
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">Tin nhắn của khách</span>
                  <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-800 border leading-relaxed whitespace-pre-wrap">
                    {item.originalText}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-[#24A1DE] uppercase tracking-wider block">AI đề xuất phản hồi</span>
                  {editingId === item._id ? (
                    <div className="space-y-2">
                      <textarea
                        className="w-full p-3 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#24A1DE] leading-relaxed min-h-[100px]"
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 border hover:bg-gray-50 text-gray-700 text-xs rounded-md font-medium"
                        >
                          Hủy
                        </button>
                        <button
                          onClick={() => handleEditSave(item._id)}
                          disabled={processingId === item._id}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-md font-medium flex items-center gap-1"
                        >
                          {processingId === item._id && <Loader2 className="w-3 h-3 animate-spin" />} Lưu
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-blue-50/30 text-blue-900 border border-blue-100 rounded-lg text-sm leading-relaxed whitespace-pre-wrap">
                      {item.suggestedReply}
                    </div>
                  )}
                </div>

                {item.reason && (
                  <div className="text-xs text-gray-500 bg-gray-50 px-2.5 py-1.5 rounded border border-dashed">
                    <span className="font-semibold">AI phân tích:</span> {item.reason}
                  </div>
                )}
                {item.status === 'skipped' && item.autoSendError && (
                  <div className="text-xs text-red-700 bg-red-50 px-2.5 py-1.5 rounded border border-red-200">
                    <span className="font-semibold">Lý do gửi thất bại:</span> {formatAutoSendError(item.autoSendError)}
                  </div>
                )}
              </div>

              {/* Cột phải: Nút hành động */}
              <div className="p-5 border-t md:border-t-0 md:border-l border-gray-100 md:col-span-2 flex md:flex-col justify-end md:justify-center gap-3 bg-gray-50/20">
                {item.status === 'pending' && (
                  <>
                    {(item.autoSendScheduledAt || item.autoSendAt) ? (
                      <div className="space-y-3 w-full">
                        <div className="w-full text-center text-xs text-blue-600 font-medium py-2 px-2 rounded-lg bg-blue-50 border border-blue-100">
                          Đã vào auto queue{item.autoSendAt ? `, gửi lúc ${new Date(item.autoSendAt).toLocaleString('vi-VN')}` : ', đang chờ tới lượt'}
                        </div>
                        <button
                          onClick={() => handleDelete(item._id)}
                          disabled={processingId !== null}
                          className="w-full bg-red-50 hover:bg-red-100 text-red-700 border border-red-100 px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Xóa hàng chờ
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleSend(item._id)}
                          disabled={processingId !== null}
                          className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                        >
                          {processingId === item._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Duyệt gửi
                        </button>
                        <button
                          onClick={() => startEditing(item)}
                          disabled={processingId !== null || editingId === item._id}
                          className="flex-1 md:flex-none border bg-white hover:bg-gray-50 text-gray-700 px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                        >
                          <Edit2 className="w-3.5 h-3.5" /> Sửa nhanh
                        </button>
                        <button
                          onClick={() => handleSkip(item._id)}
                          disabled={processingId !== null}
                          className="flex-1 md:flex-none bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-100 px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" /> Bỏ qua
                        </button>
                        <button
                          onClick={() => handleDelete(item._id)}
                          disabled={processingId !== null}
                          className="flex-1 md:flex-none bg-red-50 hover:bg-red-100 text-red-700 border border-red-100 px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Xóa
                        </button>
                      </>
                    )}
                  </>
                )}
                {item.status === 'sent' && (
                  <>
                    <div className="w-full text-center text-xs text-emerald-600 font-medium py-2 flex items-center justify-center gap-1">
                      <Check className="w-4 h-4" /> Đã gửi thành công
                    </div>
                    <button
                      onClick={() => handleDelete(item._id)}
                      disabled={processingId !== null}
                      className="w-full bg-red-50 hover:bg-red-100 text-red-700 border border-red-100 px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Xóa
                    </button>
                  </>
                )}
                {item.status === 'skipped' && (
                  <>
                    <div className="w-full text-center text-xs text-gray-400 font-medium py-2 flex items-center justify-center gap-1">
                      <X className="w-4 h-4" /> Đã bỏ qua đề xuất
                    </div>
                    <button
                      onClick={() => handleDelete(item._id)}
                      disabled={processingId !== null}
                      className="w-full bg-red-50 hover:bg-red-100 text-red-700 border border-red-100 px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Xóa
                    </button>
                  </>
                )}
              </div>
            </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
