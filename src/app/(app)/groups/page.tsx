'use client'

import { useState, useEffect } from "react"
import { 
  Users2, MessageSquare, Megaphone, Edit, Share2, ArrowLeft, ArrowRight, ShieldCheck, Crown, 
  Lock, ImageOff, MessageCircleOff, Link2Off, FileX, BotOff, ShieldAlert, CheckCircle2, AlertTriangle, AlertCircle,
  Eye, X, Image as ImageIcon, Send, Search
} from "lucide-react"
import { telegramApi } from "@/lib/telegram"
import { toast } from "sonner"
import Link from "next/link"
import { useRouter } from "next/navigation"
import TelegramAvatar from "@/components/ui/TelegramAvatar"
import TelegramMedia from "@/components/ui/TelegramMedia"

function Card({ children, className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`} {...rest}>{children}</div>;
}

export default function GroupsPage() {
  const [accounts, setAccounts] = useState<any[]>([])
  const [selectedAccId, setSelectedAccId] = useState<string>('')
  const [dialogs, setDialogs] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  
  const [activeTab, setActiveTab] = useState<'groups' | 'channels'>('groups')

  // Message Viewer State
  const [viewingDialog, setViewingDialog] = useState<any>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [loadingMsg, setLoadingMsg] = useState(false)

  // Scan Security State
  const [scanningDialog, setScanningDialog] = useState<any>(null)
  const [scanResult, setScanResult] = useState<any>(null)
  const [loadingScan, setLoadingScan] = useState(false)

  useEffect(() => { 
    loadAccounts() 
  }, [])

  useEffect(() => {
    if (selectedAccId) {
      loadDialogs(selectedAccId)
    } else {
      setDialogs([])
    }
  }, [selectedAccId])

  const loadAccounts = async () => {
    try {
      const accs = await telegramApi.getAccounts()
      setAccounts(accs || [])
      // Auto select first connected account
      const connected = accs?.find((a: any) => a.connected)
      if (connected) setSelectedAccId(connected.id)
    } catch (e) { console.error(e) }
  }

  const loadDialogs = async (accId: string) => {
    setLoading(true)
    try {
      const res = await telegramApi.getDialogs(accId)
      if (res?.success) {
        setDialogs(res.dialogs)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleViewMessages = async (dialog: any) => {
    setViewingDialog(dialog)
    setLoadingMsg(true)
    setMessages([])
    try {
      const res = await telegramApi.getMessages(selectedAccId, dialog.id, 50)
      if (res?.success) setMessages(res.messages)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingMsg(false)
    }
  }

  const handleEditClick = (dialog: any) => {
    toast.info(`Chức năng chỉnh sửa thông tin cho ${dialog.title} sẽ được cập nhật...`)
  }
  
  const handleScanSecurity = async (dialog: any) => {
    setScanningDialog(dialog);
    setScanResult(null);
    setLoadingScan(true);
    try {
      const res = await telegramApi.scanGroupSecurity(selectedAccId, dialog.id);
      if (res?.success) {
         setScanResult(res);
      } else {
         setScanResult({ error: res?.error || 'Lỗi không xác định' });
      }
    } catch (e: any) {
      setScanResult({ error: e.message });
    } finally {
      setLoadingScan(false);
    }
  }

  const [searchQuery, setSearchQuery] = useState('')

  const filteredDialogs = dialogs.filter(d => 
    !searchQuery || d.name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const groups = filteredDialogs.filter(d => d.isGroup)
  const channels = filteredDialogs.filter(d => d.isChannel && !d.isGroup)

  const itemsToRender = activeTab === 'groups' ? groups : channels;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6 fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quản lý Hội Nhóm & Kênh</h1>
          <p className="text-gray-500 text-sm mt-1">Duyệt thông tin và cấu hình các nhóm từ tài khoản Telegram</p>
        </div>
        
        <div className="min-w-[250px]">
          <select 
            value={selectedAccId} 
            onChange={(e) => setSelectedAccId(e.target.value)}
            className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="" disabled>--- Chọn Tài khoản ---</option>
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>
                {acc.firstName} {acc.lastName} {acc.phone ? `(+${acc.phone})` : ''} 
                {!acc.connected ? ' (Offline)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedAccId && (
        <div className="py-16 text-center border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50">
          <Users2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900">Chưa chọn tài khoản</h3>
          <p className="text-gray-500 mt-1">Vui lòng chọn 1 tài khoản ở góc trên để tải danh sách nhóm.</p>
        </div>
      )}

      {selectedAccId && (
        <>
          {/* Navigation Tabs and Search */}
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-200 gap-4 mb-4">
            <div className="flex">
              <button
                onClick={() => setActiveTab('groups')}
                className={`flex items-center gap-2 py-3 px-6 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'groups' 
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50' 
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Users2 className="w-4 h-4" /> Hội nhóm ({groups.length})
              </button>
              <button
                onClick={() => setActiveTab('channels')}
                className={`flex items-center gap-2 py-3 px-6 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'channels' 
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50' 
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Megaphone className="w-4 h-4" /> Kênh Channel ({channels.length})
              </button>
            </div>
            <div className="pb-2 md:pb-0 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none md:pb-0" style={{ paddingBottom: '8px' }}>
                <Search className="text-gray-400 w-4 h-4" />
              </div>
              <input
                type="text"
                placeholder="Tìm kiếm nhóm/kênh..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full md:w-64 pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* List Content */}
          {loading ? (
            <div className="py-20 flex justify-center items-center">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {itemsToRender.length === 0 ? (
                <div className="col-span-full py-16 text-center text-gray-500 bg-gray-50 rounded-xl border border-dashed">
                  Không tìm thấy {activeTab === 'groups' ? 'Nhóm' : 'Kênh'} nào.
                </div>
              ) : (
                itemsToRender.map(dialog => (
                  <Card key={dialog.id} className="overflow-hidden hover:shadow-md transition-shadow flex flex-col h-full">
                    <div className="p-5 flex-1">
                      <div className="flex gap-4">
                        <TelegramAvatar
                          accountId={selectedAccId}
                          peerId={dialog.id}
                          title={dialog.title}
                          isGroup={dialog.isGroup}
                          className="shrink-0 w-12 h-12 rounded-full overflow-hidden text-xl"
                        />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-gray-900 truncate" title={dialog.title}>
                            {dialog.title}
                          </h3>
                          <div className="flex flex-wrap gap-2 mt-1.5">
                            {dialog.isCreator && (
                              <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 text-[10px] px-2 py-0.5 rounded font-medium">
                                <Crown className="w-3 h-3" /> CHỦ SỞ HỮU
                              </span>
                            )}
                            {dialog.isAdmin && !dialog.isCreator && (
                              <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-[10px] px-2 py-0.5 rounded font-medium">
                                <ShieldCheck className="w-3 h-3" /> QUẢN TRỊ
                              </span>
                            )}
                            {dialog.isForum && (
                              <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-800 text-[10px] px-2 py-0.5 rounded font-medium">
                                <MessageSquare className="w-3 h-3" /> Forum Topics
                              </span>
                            )}
                            {dialog.defaultBannedRights?.sendMessages && (
                              <span className="inline-flex items-center gap-1 bg-red-100 text-red-800 text-[10px] px-2 py-0.5 rounded font-medium">
                                <MessageCircleOff className="w-3 h-3" /> Cấm Chat
                              </span>
                            )}
                            {dialog.defaultBannedRights?.sendMedia && !dialog.defaultBannedRights?.sendMessages && (
                              <span className="inline-flex items-center gap-1 bg-orange-100 text-orange-800 text-[10px] px-2 py-0.5 rounded font-medium">
                                <ImageOff className="w-3 h-3" /> Cấm Media
                              </span>
                            )}
                            {dialog.defaultBannedRights?.embedLinks && !dialog.defaultBannedRights?.sendMessages && (
                              <span className="inline-flex items-center gap-1 bg-pink-100 text-pink-800 text-[10px] px-2 py-0.5 rounded font-medium">
                                <Link2Off className="w-3 h-3" /> Cấm Links
                              </span>
                            )}
                            {dialog.defaultBannedRights?.sendInline && !dialog.defaultBannedRights?.sendMessages && (
                              <span className="inline-flex items-center gap-1 bg-purple-100 text-purple-800 text-[10px] px-2 py-0.5 rounded font-medium">
                                <BotOff className="w-3 h-3" /> Cấm Bot Inline
                              </span>
                            )}
                          </div>
                        </div>
                      </div>


                      <div className="mt-4 space-y-1.5 text-xs text-gray-600 bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                        <div className="flex justify-between">
                          <span>Loại:</span>
                          <span className="font-medium text-gray-900">{dialog.isGroup ? 'Group' : 'Channel'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Thành viên:</span>
                          <span className="font-medium text-gray-900">{dialog.participantsCount || '~'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Chat ID:</span>
                          <span className="font-mono text-[10px] text-gray-500 truncate ml-2">{dialog.id}</span>
                        </div>
                      </div>
                    </div>

                    <div className="border-t bg-gray-50/80 p-3 grid grid-cols-3 gap-2 mt-auto">
                      <button 
                        onClick={() => handleViewMessages(dialog)}
                        className="flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg text-[10px] sm:text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                        title="Xem bài đăng"
                      >
                        <Eye className="w-3.5 h-3.5" /> <span className="hidden lg:inline">Bài đăng</span>
                      </button>
                      
                      <Link 
                        href={`/autopost?target=${dialog.id}&acc=${selectedAccId}`}
                        className="flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg text-[10px] sm:text-xs font-medium text-gray-700 bg-gray-200/80 hover:bg-gray-300 transition-colors text-center"
                        title="Đăng bài mới"
                      >
                        <Edit className="w-3.5 h-3.5" /> <span className="hidden lg:inline">Đăng bài</span>
                      </Link>

                      <button 
                        onClick={() => handleScanSecurity(dialog)}
                        className="flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg text-[10px] sm:text-xs font-medium text-amber-700 bg-amber-100/80 hover:bg-amber-200 transition-colors"
                        title="Quét rủi ro"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" /> <span className="hidden lg:inline">Quét</span>
                      </button>
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Message Viewer Modal */}
      {viewingDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 fade-in">
          <div className="w-full max-w-lg h-full bg-slate-50 shadow-2xl flex flex-col transform transition-transform border-l">
            <div className="px-5 py-4 border-b bg-white flex items-center justify-between shadow-sm z-10 shrink-0">
              <div className="flex items-center gap-3">
                <TelegramAvatar accountId={selectedAccId} peerId={viewingDialog.id} title={viewingDialog.title} className="w-10 h-10 rounded-full" />
                <div>
                  <h3 className="font-bold text-gray-900 leading-tight">{viewingDialog.title}</h3>
                  <p className="text-xs text-gray-500">Bài đăng gần đây</p>
                </div>
              </div>
              <button onClick={() => setViewingDialog(null)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loadingMsg ? (
                <div className="py-20 flex justify-center">
                  <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : messages.length === 0 ? (
                <div className="py-16 text-center text-gray-500 bg-white rounded-xl border border-dashed">
                  Không có tin nhắn nào.
                </div>
              ) : (
                messages.map(msg => (
                  <Card key={msg.id} className="overflow-hidden">
                    <div className="p-4 text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto custom-scrollbar">
                      {msg.hasMedia && (
                        <TelegramMedia accountId={selectedAccId} chatId={viewingDialog.id} messageId={msg.id} mediaType={msg.mediaType} />
                      )}
                      {msg.text || (msg.hasMedia ? null : <span className="italic text-gray-400">Không có text</span>)}
                    </div>
                    <div className="bg-gray-50 border-t px-4 py-2 flex items-center justify-between">
                      <span className="text-[10px] text-gray-500 font-mono">
                        {new Date(msg.date * 1000).toLocaleString('vi-VN')}
                      </span>
                      <button 
                        onClick={() => router.push(`/autopost?forward=true&msgId=${msg.id}&fromChatId=${viewingDialog.id}&fromChatUsername=${viewingDialog.username || ''}&acc=${selectedAccId}`)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md shadow-sm transition-colors"
                      >
                        <Share2 className="w-3.5 h-3.5" /> Chia sẻ & Auto Post
                      </button>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scan Security Modal */}
      {scanningDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 fade-in">
          <Card className="w-full max-w-lg shadow-2xl relative overflow-hidden">
            <div className={`absolute top-0 inset-x-0 h-1.5 ${scanResult ? (scanResult.adminBots?.length > 0 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-blue-500'}`}></div>
            
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl ${scanResult ? (scanResult.adminBots?.length > 0 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600') : 'bg-blue-50 text-blue-600'}`}>
                    <ShieldAlert className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Kết quả Quét Rủi Ro</h3>
                    <p className="text-sm text-gray-500 font-medium truncate max-w-[250px]">{scanningDialog.title}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setScanningDialog(null)}
                  className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {loadingScan ? (
                <div className="py-12 flex flex-col items-center justify-center space-y-4">
                  <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-sm font-medium text-gray-500 animate-pulse">Đang quét quản trị viên và 100 tin nhắn gần nhất...</p>
                </div>
              ) : scanResult ? (
                <div className="space-y-6">
                  {scanResult.error ? (
                    <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold mb-1">Lỗi quét dữ liệu</p>
                        <p>{scanResult.error}</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {scanResult.warning && (
                        <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-blue-800 text-xs mt-2 mb-4 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <p>{scanResult.warning}</p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                          <div className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Bot / Spam Filter</div>
                          <div className="flex items-center gap-2">
                            <BotOff className={`w-5 h-5 ${scanResult.adminBots?.length > 0 ? 'text-amber-500' : 'text-emerald-500'}`} />
                            <span className={`text-xl font-bold ${scanResult.adminBots?.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                              {scanResult.adminBots?.length || 0}
                            </span>
                          </div>
                          {scanResult.adminBots?.length > 0 && (
                            <p className="text-[10px] text-gray-500 mt-2 font-mono">
                              {scanResult.adminBots.join(', ')}
                            </p>
                          )}
                        </div>

                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                          <div className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Lịch sử (Users)</div>
                          <div className="space-y-1 mt-2 text-sm font-medium text-gray-700">
                            <div className="flex justify-between">
                              <span>Link (http):</span>
                              <span className={scanResult.normalUserLinks > 0 ? 'text-emerald-600' : 'text-gray-400'}>{scanResult.normalUserLinks}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Tags (@):</span>
                              <span className={scanResult.normalUserTags > 0 ? 'text-emerald-600' : 'text-gray-400'}>{scanResult.normalUserTags}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Forwards:</span>
                              <span className={scanResult.normalUserForwards > 0 ? 'text-emerald-600' : 'text-gray-400'}>{scanResult.normalUserForwards}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className={`p-4 rounded-xl border ${scanResult.adminBots?.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                        <div className="flex gap-3">
                          {scanResult.adminBots?.length > 0 ? (
                            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                          ) : (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                          )}
                          <div>
                            <h4 className={`text-sm font-bold ${scanResult.adminBots?.length > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                              {scanResult.adminBots?.length > 0 ? 'NGUY HIỂM (STRICT)' : 'AN TOÀN (SAFE)'}
                            </h4>
                            <p className={`text-xs mt-1 leading-relaxed ${scanResult.adminBots?.length > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                              {scanResult.adminBots?.length > 0 
                                ? 'Nhóm này có sử dụng Bot cảnh sát. Cân nhắc kỹ trước khi bắn Link hoặc Tag vào nhóm này vì rất dễ bị auto-xoá và ban acc.'
                                : 'Không tìm thấy Anti-Spam Bot. ' + (scanResult.normalUserLinks > 0 ? 'Nhóm không chặn link tự động.' : '')
                              }
                            </p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              <div className="mt-6 flex justify-end">
                <button 
                  onClick={() => setScanningDialog(null)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
                >
                  Đóng
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
