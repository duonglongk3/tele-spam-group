'use client'

import { useState, useEffect } from "react"
import { 
  Send, Image as ImageIcon, MapPin, BarChart2, Forward, Pin, Smile, Users2, Plus, Trash2, HelpCircle 
} from "lucide-react"
import { telegramApi } from "@/lib/telegram"
import { toast } from "sonner"

function Card({ children, className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`} {...rest}>{children}</div>;
}

export default function QuickSendPage() {
  const [accounts, setAccounts] = useState<any[]>([])
  const [selectedAccId, setSelectedAccId] = useState('')
  const [targetChatId, setTargetChatId] = useState('')
  const [activeAction, setActiveAction] = useState<'text' | 'photo' | 'location' | 'poll' | 'forward' | 'pin' | 'reaction' | 'bot_interactive'>('text')
  const [loading, setLoading] = useState(false)

  // Text state
  const [textMessage, setTextMessage] = useState('')
  const [textParseMode, setTextParseMode] = useState('html')

  // Photo state
  const [photoCaption, setPhotoCaption] = useState('')
  const [photoBase64, setPhotoBase64] = useState('')
  const [photoParseMode, setPhotoParseMode] = useState('html')

  // Location state
  const [lat, setLat] = useState('21.028511')
  const [long, setLong] = useState('105.804817')

  // Poll state
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState<string[]>(['Phương án 1', 'Phương án 2'])

  // Forward state
  const [forwardFromChat, setForwardFromChat] = useState('')
  const [forwardMsgId, setForwardMsgId] = useState('')

  // Pin state
  const [pinMsgId, setPinMsgId] = useState('')
  const [pinNotify, setPinNotify] = useState(false)

  // Reaction state
  const [reactMsgId, setReactMsgId] = useState('')
  const [reactEmoticon, setReactEmoticon] = useState('👍')

  // Bot Interactive States
  const [botUsername, setBotUsername] = useState('')
  const [botMessages, setBotMessages] = useState<any[]>([])
  const [loadingBotMessages, setLoadingBotMessages] = useState(false)

  useEffect(() => {
    loadAccounts()
  }, [])

  const loadAccounts = async () => {
    try {
      const accs = await telegramApi.getAccounts()
      setAccounts(accs || [])
      const connected = accs?.find((a: any) => a.connected)
      if (connected) setSelectedAccId(connected.id)
    } catch (e) { console.error(e) }
  }

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return
    const file = e.target.files[0]
    const reader = new FileReader()
    reader.onload = () => {
      setPhotoBase64(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleAddPollOption = () => {
    setPollOptions([...pollOptions, ''])
  }

  const handleRemovePollOption = (index: number) => {
    setPollOptions(pollOptions.filter((_, idx) => idx !== index))
  }

  const handlePollOptionChange = (index: number, val: string) => {
    const updated = [...pollOptions]
    updated[index] = val
    setPollOptions(updated)
  }

  const handleExecuteAction = async () => {
    if (!selectedAccId) {
      toast.error("Vui lòng chọn một tài khoản Telegram!")
      return
    }
    if (!targetChatId.trim()) {
      toast.error("Vui lòng nhập Chat ID hoặc Username người nhận!")
      return
    }

    setLoading(true)
    let payload: any = {}
    
    if (activeAction === 'text') {
      if (!textMessage.trim()) {
        toast.error("Vui lòng nhập nội dung tin nhắn!")
        setLoading(false)
        return
      }
      payload = { message: textMessage, parseMode: textParseMode }
    } else if (activeAction === 'photo') {
      if (!photoBase64) {
        toast.error("Vui lòng chọn hình ảnh cần gửi!")
        setLoading(false)
        return
      }
      payload = { image: photoBase64, caption: photoCaption, parseMode: photoParseMode }
    } else if (activeAction === 'location') {
      if (!lat.trim() || !long.trim()) {
        toast.error("Vui lòng nhập tọa độ vĩ độ và kinh độ hợp lệ!")
        setLoading(false)
        return
      }
      payload = { lat, long }
    } else if (activeAction === 'poll') {
      if (!pollQuestion.trim()) {
        toast.error("Vui lòng nhập câu hỏi khảo sát!")
        setLoading(false)
        return
      }
      const filteredOpts = pollOptions.map(o => o.trim()).filter(Boolean)
      if (filteredOpts.length < 2) {
        toast.error("Cần nhập tối thiểu 2 phương án trả lời!")
        setLoading(false)
        return
      }
      payload = { question: pollQuestion, options: filteredOpts }
    } else if (activeAction === 'forward') {
      if (!forwardFromChat.trim() || !forwardMsgId.trim()) {
        toast.error("Vui lòng điền thông tin Chat nguồn và Message ID nguồn!")
        setLoading(false)
        return
      }
      const msgIds = forwardMsgId.split(',').map(id => Number(id.trim())).filter(id => !isNaN(id))
      if (msgIds.length === 0) {
        toast.error("Message ID không hợp lệ!")
        setLoading(false)
        return
      }
      payload = { fromChatId: forwardFromChat.trim(), messageIds: msgIds }
    } else if (activeAction === 'pin') {
      const msgId = Number(pinMsgId.trim())
      if (isNaN(msgId) || !pinMsgId.trim()) {
        toast.error("Vui lòng nhập ID tin nhắn cần ghim!")
        setLoading(false)
        return
      }
      payload = { messageId: msgId, notify: pinNotify }
    } else if (activeAction === 'reaction') {
      const msgId = Number(reactMsgId.trim())
      if (isNaN(msgId) || !reactMsgId.trim()) {
        toast.error("Vui lòng nhập ID tin nhắn cần thả cảm xúc!")
        setLoading(false)
        return
      }
      payload = { messageId: msgId, emoticon: reactEmoticon }
    }

    try {
      const actionType = `send_${activeAction}` === 'send_text' ? 'send_text' 
                        : `send_${activeAction}` === 'send_photo' ? 'send_photo' 
                        : `send_${activeAction}` === 'send_location' ? 'send_location' 
                        : `send_${activeAction}` === 'send_poll' ? 'send_poll' 
                        : activeAction // 'forward', 'pin', 'reaction'

      const res = await telegramApi.executeQuickAction(selectedAccId, targetChatId.trim(), actionType, payload)
      if (res?.success) {
        toast.success("Thực thi lệnh gửi nhanh thành công!")
        if (activeAction === 'text') setTextMessage('')
      } else {
        toast.error("Thực thi thất bại: " + (res?.error || "Lỗi không xác định"))
      }
    } catch (e: any) {
      toast.error("Lỗi: " + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLoadBotMessages = async () => {
    if (!selectedAccId) {
      toast.error("Vui lòng chọn một tài khoản Telegram!")
      return
    }
    if (!botUsername.trim()) {
      toast.error("Vui lòng nhập Username của Bot!")
      return
    }
    
    setLoadingBotMessages(true)
    setBotMessages([])
    try {
      const res = await telegramApi.getMessages(selectedAccId, botUsername.trim(), 5)
      if (res?.success) {
        setBotMessages(res.messages || [])
        toast.success("Tải tin nhắn từ Bot thành công!")
      } else {
        toast.error("Lỗi tải tin nhắn: " + (res?.error || "Không rõ nguyên nhân"))
      }
    } catch (e: any) {
      toast.error("Lỗi: " + e.message)
    } finally {
      setLoadingBotMessages(false)
    }
  }

  const handleBotButtonClick = async (msgId: number, btn: any) => {
    if (btn.className === 'KeyboardButtonUrl') {
      if (typeof window !== 'undefined') {
        window.open(btn.url, '_blank')
      }
      return
    }

    if (btn.className === 'KeyboardButtonCallback') {
      toast.loading("Đang phản hồi nút bấm...", { id: 'bot-click' })
      try {
        const res = await telegramApi.clickBotButton(selectedAccId, botUsername.trim(), msgId, btn.data)
        if (res?.success) {
          toast.success("Đã kích hoạt nút bấm!", { id: 'bot-click' })
          setTimeout(() => {
            handleLoadBotMessages()
          }, 1500)
        } else {
          toast.error("Lỗi tương tác: " + (res?.error || "Lỗi không xác định"), { id: 'bot-click' })
        }
      } catch (e: any) {
        toast.error("Lỗi: " + e.message, { id: 'bot-click' })
      }
    } else {
      toast.info(`Nút bấm thuộc loại ${btn.className} chưa được hỗ trợ click trực tiếp.`)
    }
  }

  const actionsConfig = [
    { type: 'text', label: 'Văn bản', icon: Send },
    { type: 'photo', label: 'Hình ảnh', icon: ImageIcon },
    { type: 'location', label: 'Định vị GPS', icon: MapPin },
    { type: 'poll', label: 'Khảo sát (Poll)', icon: BarChart2 },
    { type: 'forward', label: 'Forward bài', icon: Forward },
    { type: 'pin', label: 'Ghim bài', icon: Pin },
    { type: 'reaction', label: 'Reaction', icon: Smile },
    { type: 'bot_interactive', label: 'Tương tác Bot', icon: Users2 },
  ]

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Bàn điều khiển gửi nhanh & Tương tác</h1>
        <p className="text-gray-500 text-sm mt-1">Gửi tin nhắn thử nghiệm, ghim bài, chuyển tiếp hoặc tương tác nhanh bằng tài khoản Telegram bất kỳ</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Config */}
        <div className="space-y-6 lg:col-span-1">
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Cấu hình Giao dịch</h3>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Tài khoản thực thi (*)</label>
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

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Chat ID hoặc @Username đích (*)</label>
              <input 
                value={targetChatId} 
                onChange={(e) => setTargetChatId(e.target.value)} 
                placeholder="VD: @ten_nhom hoặc -100123456" 
                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" 
              />
              <p className="text-[10px] text-gray-500 mt-1">Lưu ý: Tài khoản thực thi phải tham gia nhóm/kênh này trước khi gửi.</p>
            </div>
          </Card>
        </div>

        {/* Right Column: Actions Form */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden">
            {/* Tabs Bar */}
            <div className="flex bg-gray-50 border-b overflow-x-auto">
              {actionsConfig.map(act => {
                const Icon = act.icon
                const active = activeAction === act.type
                return (
                  <button 
                    key={act.type}
                    onClick={() => { setActiveAction(act.type as any) }}
                    className={`flex items-center gap-1.5 py-3 px-4 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${active ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {act.label}
                  </button>
                )
              })}
            </div>

            <div className="p-6 min-h-[300px]">
              {/* Bot Interactive Form */}
              {activeAction === 'bot_interactive' && (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <label className="block text-sm font-semibold text-gray-800">Tương tác trực quan với Bot</label>
                    <div className="flex gap-3">
                      <input 
                        value={botUsername} 
                        onChange={e => setBotUsername(e.target.value)} 
                        onKeyDown={e => e.key === 'Enter' && handleLoadBotMessages()}
                        placeholder="VD: @my_telegram_bot" 
                        className="flex-1 p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500" 
                      />
                      <button 
                        onClick={handleLoadBotMessages}
                        disabled={loadingBotMessages || !botUsername.trim()}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-5 rounded-lg text-sm transition-colors disabled:opacity-50 shadow-sm"
                      >
                        {loadingBotMessages ? 'Đang tải...' : 'Tải tin nhắn'}
                      </button>
                    </div>
                  </div>

                  {/* Bot Messages Panel */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Tin nhắn & Phím bấm của Bot (5 tin gần nhất)</h4>
                    {loadingBotMessages ? (
                      <div className="py-12 flex justify-center">
                        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    ) : botMessages.length === 0 ? (
                      <div className="py-12 text-center text-sm text-gray-400 bg-gray-50 rounded-xl border border-dashed">
                        Chưa có tin nhắn nào được tải. Nhập username bot và bấm tải.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {botMessages.map(msg => (
                          <div key={msg.id} className="p-4 border rounded-xl bg-gray-50 hover:bg-white hover:shadow-sm transition-all space-y-3">
                            <div className="flex justify-between items-start">
                              <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${msg.fromId ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>
                                {msg.fromId ? 'Bot' : 'Bạn'}
                              </span>
                              <span className="text-[9px] text-gray-400 font-mono">
                                {new Date(msg.date * 1000).toLocaleTimeString('vi-VN')} (ID: {msg.id})
                              </span>
                            </div>
                            <p className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed font-sans">{msg.text || <span className="italic text-gray-400">Không có text (tin nhắn media hoặc rỗng)</span>}</p>
                            
                            {/* Render Inline Keyboard Buttons */}
                            {msg.replyMarkup && msg.replyMarkup.rows && (
                              <div className="space-y-1.5 pt-2 border-t border-gray-100">
                                {msg.replyMarkup.rows.map((row: any, rIdx: number) => (
                                  <div key={rIdx} className="flex flex-wrap gap-1.5">
                                    {(row.buttons || []).map((btn: any, bIdx: number) => (
                                      <button
                                        key={bIdx}
                                        onClick={() => handleBotButtonClick(msg.id, btn)}
                                        className="bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-gray-700 hover:text-blue-700 text-xs font-semibold py-1.5 px-3 rounded-lg shadow-sm transition-all flex items-center gap-1"
                                      >
                                        <span>{btn.text}</span>
                                        {btn.className === 'KeyboardButtonUrl' && <span className="text-[10px] text-gray-400">🔗</span>}
                                      </button>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Text Form */}
              {activeAction === 'text' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="block text-sm font-semibold text-gray-800">Nội dung tin nhắn văn bản</label>
                    <select 
                      value={textParseMode} 
                      onChange={e => setTextParseMode(e.target.value)}
                      className="p-1 border rounded text-xs bg-white outline-none"
                    >
                      <option value="html">Chế độ HTML</option>
                      <option value="markdown">Chế độ Markdown</option>
                    </select>
                  </div>
                  <textarea 
                    value={textMessage}
                    onChange={e => setTextMessage(e.target.value)}
                    placeholder={textParseMode === 'html' ? "Gõ nội dung, hỗ trợ HTML như <b>bold</b>, <i>italic</i>, <a href='...'>link</a>..." : "Gõ nội dung, hỗ trợ Markdown như **bold**, *italic*, [link](url)..."}
                    className="w-full h-44 p-3 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none resize-none font-sans"
                  />
                </div>
              )}

              {/* Photo Form */}
              {activeAction === 'photo' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="block text-sm font-semibold text-gray-800">Tải ảnh đại diện/nội dung ảnh</label>
                    <select 
                      value={photoParseMode} 
                      onChange={e => setPhotoParseMode(e.target.value)}
                      className="p-1 border rounded text-xs bg-white outline-none"
                    >
                      <option value="html">Chế độ HTML (Caption)</option>
                      <option value="markdown">Chế độ Markdown (Caption)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="cursor-pointer bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 shadow-sm">
                      <ImageIcon className="w-4 h-4 text-gray-500" />
                      {photoBase64 ? 'Chọn lại hình ảnh khác' : 'Chọn hình ảnh để gửi'}
                      <input type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
                    </label>
                    {photoBase64 && (
                      <div className="w-16 h-16 rounded-lg border overflow-hidden shrink-0 shadow-sm relative group">
                        <img src={photoBase64} alt="preview" className="w-full h-full object-cover" />
                        <button onClick={() => setPhotoBase64('')} className="absolute inset-0 bg-black/60 text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">Xóa</button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Mô tả kèm theo (Caption)</label>
                    <textarea 
                      value={photoCaption}
                      onChange={e => setPhotoCaption(e.target.value)}
                      placeholder="Mô tả bức ảnh..."
                      className="w-full h-24 p-3 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Location Form */}
              {activeAction === 'location' && (
                <div className="space-y-4">
                  <label className="block text-sm font-semibold text-gray-800">Nhập Tọa Độ Vị Trí (GPS Location)</label>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Vĩ độ (Latitude)</label>
                      <input 
                        value={lat} 
                        onChange={e => setLat(e.target.value)} 
                        placeholder="VD: 21.028511" 
                        className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Kinh độ (Longitude)</label>
                      <input 
                        value={long} 
                        onChange={e => setLong(e.target.value)} 
                        placeholder="VD: 105.804817" 
                        className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" 
                      />
                    </div>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700 flex items-start gap-2">
                    <HelpCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Vị trí địa lý mẫu</p>
                      <p className="mt-1">Mặc định được điền là tọa độ trung tâm thành phố Hà Nội (21.028511, 105.804817).</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Poll Form */}
              {activeAction === 'poll' && (
                <div className="space-y-4">
                  <label className="block text-sm font-semibold text-gray-800">Tạo khảo sát (Poll)</label>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Câu hỏi khảo sát (*)</label>
                    <input 
                      value={pollQuestion} 
                      onChange={e => setPollQuestion(e.target.value)} 
                      placeholder="VD: Món ăn yêu thích của bạn?" 
                      className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none font-medium" 
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-700 flex items-center justify-between">
                      <span>Các phương án lựa chọn (Tối thiểu 2)</span>
                      <button 
                        onClick={handleAddPollOption}
                        className="text-xs text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> Thêm phương án
                      </button>
                    </label>
                    {pollOptions.map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input 
                          value={opt} 
                          onChange={e => handlePollOptionChange(idx, e.target.value)} 
                          placeholder={`Phương án ${idx + 1}...`} 
                          className="flex-1 p-2 border rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-blue-100" 
                        />
                        {pollOptions.length > 2 && (
                          <button 
                            onClick={() => handleRemovePollOption(idx)}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Forward Form */}
              {activeAction === 'forward' && (
                <div className="space-y-4">
                  <label className="block text-sm font-semibold text-gray-800">Chuyển tiếp tin nhắn (Forward)</label>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Chat ID/Username nguồn (*)</label>
                    <input 
                      value={forwardFromChat} 
                      onChange={e => setForwardFromChat(e.target.value)} 
                      placeholder="VD: @nhom_nguon hoặc -100987654" 
                      className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Message ID cần forward (*)</label>
                    <input 
                      value={forwardMsgId} 
                      onChange={e => setForwardMsgId(e.target.value)} 
                      placeholder="VD: 541 hoặc 123, 124, 125 (cách nhau bằng dấu phẩy để forward nhiều tin)" 
                      className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none font-mono text-xs" 
                    />
                  </div>
                </div>
              )}

              {/* Pin Form */}
              {activeAction === 'pin' && (
                <div className="space-y-4">
                  <label className="block text-sm font-semibold text-gray-800">Ghim tin nhắn trong Chat đích</label>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Message ID cần ghim (*)</label>
                    <input 
                      value={pinMsgId} 
                      onChange={e => setPinMsgId(e.target.value)} 
                      placeholder="VD: 1241" 
                      className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none font-mono" 
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <input 
                      type="checkbox" 
                      id="pinNotify" 
                      checked={pinNotify} 
                      onChange={e => setPinNotify(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500" 
                    />
                    <label htmlFor="pinNotify" className="text-xs text-gray-600 font-semibold cursor-pointer">Gửi thông báo (Notification) đến các thành viên trong nhóm</label>
                  </div>
                </div>
              )}

              {/* Reaction Form */}
              {activeAction === 'reaction' && (
                <div className="space-y-4">
                  <label className="block text-sm font-semibold text-gray-800">Thả cảm xúc vào tin nhắn (Reaction)</label>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Message ID đích (*)</label>
                      <input 
                        value={reactMsgId} 
                        onChange={e => setReactMsgId(e.target.value)} 
                        placeholder="VD: 1234" 
                        className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none font-mono" 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Biểu tượng cảm xúc (Emoticon)</label>
                      <select 
                        value={reactEmoticon} 
                        onChange={e => setReactEmoticon(e.target.value)}
                        className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="👍">👍 Thumbs Up</option>
                        <option value="🔥">🔥 Fire</option>
                        <option value="❤️">❤️ Heart</option>
                        <option value="👏">👏 Clap</option>
                        <option value="🎉">🎉 Party Popper</option>
                        <option value="🤩">🤩 Starstruck</option>
                        <option value="😂">😂 Laughing</option>
                        <option value="🤔">🤔 Thinking</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Execute Button */}
            {activeAction !== 'bot_interactive' && (
              <div className="bg-gray-50 border-t p-4 flex justify-end">
                <button 
                  onClick={handleExecuteAction}
                  disabled={loading || !selectedAccId || !targetChatId.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-md"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Đang gửi...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Thực thi Gửi ngay
                    </>
                  )}
                </button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
