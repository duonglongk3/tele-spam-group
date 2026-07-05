'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, Loader2, RefreshCw, Save, Search, Send, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { telegramApi } from '@/lib/telegram'

function Card({ children, className = '' }: { children: React.ReactNode, className?: string }) {
  return <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}>{children}</div>
}

type EngagementTopic = { id: number | string, title: string, purpose: string }
type EngagementGroup = {
  accountId: string
  chatId: string
  title: string
  username?: string
  purpose?: string
  topics?: EngagementTopic[]
}

const PURPOSE_OPTIONS = [
  { value: 'discussion', label: 'Thảo luận tự nhiên' },
  { value: 'promotion', label: 'Thảo luận dạng quảng bá mềm' },
  { value: 'bulk_buying', label: 'Hỏi mua sỉ / Tìm nhà cung cấp sỉ' },
]

export default function AiSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [accounts, setAccounts] = useState<any[]>([])
  const [selectedAccId, setSelectedAccId] = useState('')
  const [dialogs, setDialogs] = useState<any[]>([])
  const [loadingDialogs, setLoadingDialogs] = useState(false)
  const [query, setQuery] = useState('')
  const [scanningId, setScanningId] = useState<string | null>(null)
  const [scanningPrivate, setScanningPrivate] = useState(false)
  const [privateScanStatus, setPrivateScanStatus] = useState('')
  const [topicsByGroup, setTopicsByGroup] = useState<Record<string, any[]>>({})
  const [loadingTopicsId, setLoadingTopicsId] = useState<string | null>(null)
  const [testingBot, setTestingBot] = useState(false)
  const [form, setForm] = useState<any>({
    aiLeadEnabled: true,
    aiLeadMode: 'auto',
    aiLeadUserReplyEnabled: true,
    aiLeadMinScore: 85,
    aiLeadMaxRepliesPerDay: 500,
    aiLeadMaxRepliesPerGroupPerDay: 200,
    aiLeadMaxRepliesPerGroupPerHour: 0,
    aiLeadCooldownMinutes: 0,
    aiLeadAutoSendDelayMinutes: 15,
    aiLeadAutoSendMinDelayMinutes: 15,
    aiLeadAutoSendMaxDelayMinutes: 30,
    aiLeadEngagementSampleLimit: 40,
    aiLeadIgnoreBotLikeUsers: false,
    aiLeadEngagementGroups: [],
    aiLeadPrompt: '',
    telegramBotToken: '',
    telegramAdminChatId: '',
    telegramBotUsername: '',
  })

  useEffect(() => { loadInitial() }, [])
  useEffect(() => { if (selectedAccId) loadDialogs(selectedAccId) }, [selectedAccId])

  const selectedGroups: EngagementGroup[] = Array.isArray(form.aiLeadEngagementGroups) ? form.aiLeadEngagementGroups : []
  const selectedKeys = useMemo(() => new Set(selectedGroups.map(g => `${g.accountId}:${g.chatId}`)), [selectedGroups])
  const filteredDialogs = dialogs.filter(d => d.isGroup && `${d.title || ''} ${d.username || ''}`.toLowerCase().includes(query.toLowerCase()))

  async function loadInitial() {
    try {
      setLoading(true)
      const [settingsRes, accs] = await Promise.all([telegramApi.getSettings(), telegramApi.getAccounts()])
      const connected = (accs || []).filter((acc: any) => acc.connected)
      setAccounts(connected)
      if (connected[0]) setSelectedAccId(connected[0].id)

      if (settingsRes?.success && settingsRes.settings) {
        const nextSettings = { ...settingsRes.settings }
        if (Array.isArray(nextSettings.aiLeadEngagementGroups)) {
          const connectedIds = new Set(connected.map((acc: any) => String(acc.id)))
          nextSettings.aiLeadEngagementGroups = nextSettings.aiLeadEngagementGroups.filter(
            (g: any) => connectedIds.has(String(g.accountId))
          )
        }
        setForm((prev: any) => ({ ...prev, ...nextSettings }))
      }
    } catch (e: any) { toast.error('Lỗi tải AI settings: ' + e.message) }
    finally { setLoading(false) }
  }

  async function loadDialogs(accountId: string) {
    try {
      setLoadingDialogs(true)
      const res = await telegramApi.getDialogs(accountId)
      if (res?.success) setDialogs(res.dialogs || [])
      else toast.error('Lỗi tải group: ' + (res?.error || 'Không rõ'))
    } catch (e: any) { toast.error('Lỗi tải group: ' + e.message) }
    finally { setLoadingDialogs(false) }
  }

  function updateGroups(next: EngagementGroup[]) {
    setForm({ ...form, aiLeadEngagementGroups: next })
  }

  function updateGroup(key: string, patch: Partial<EngagementGroup>) {
    updateGroups(selectedGroups.map(g => `${g.accountId}:${g.chatId}` === key ? { ...g, ...patch } : g))
  }

  function toggleGroup(dialog: any) {
    const key = `${selectedAccId}:${dialog.id}`
    const exists = selectedKeys.has(key)
    updateGroups(exists
      ? selectedGroups.filter(g => `${g.accountId}:${g.chatId}` !== key)
      : [...selectedGroups, { accountId: selectedAccId, chatId: String(dialog.id), title: dialog.title || dialog.id, username: dialog.username || '', purpose: 'discussion', topics: [] }])
  }

  async function loadTopics(group: EngagementGroup) {
    const key = `${group.accountId}:${group.chatId}`
    try {
      setLoadingTopicsId(key)
      const res = await telegramApi.getForumTopics(group.accountId, group.chatId)
      if (res?.success) {
        setTopicsByGroup(prev => ({ ...prev, [key]: res.topics || [] }))
        if (!res.topics?.length) toast.info('Group này không có topics hoặc không phải forum group')
      } else toast.error('Lỗi tải topics: ' + (res?.error || 'Không rõ'))
    } catch (e: any) { toast.error('Lỗi tải topics: ' + e.message) }
    finally { setLoadingTopicsId(null) }
  }

  function toggleTopic(group: EngagementGroup, topic: any) {
    const key = `${group.accountId}:${group.chatId}`
    const topics = group.topics || []
    const exists = topics.some(t => String(t.id) === String(topic.id))
    const nextTopics = exists
      ? topics.filter(t => String(t.id) !== String(topic.id))
      : [...topics, { id: topic.id, title: topic.title, purpose: group.purpose || 'discussion' }]
    updateGroup(key, { topics: nextTopics })
  }

  function updateTopicPurpose(group: EngagementGroup, topicId: number | string, purpose: string) {
    const key = `${group.accountId}:${group.chatId}`
    updateGroup(key, { topics: (group.topics || []).map(t => String(t.id) === String(topicId) ? { ...t, purpose } : t) })
  }

  async function saveSettings() {
    try {
      setSaving(true)
      const res = await telegramApi.saveSettings(form)
      if (res?.success) {
        toast.success('Đã lưu AI Settings')
        if (form.aiLeadUserReplyEnabled !== false) {
          await scanUnreadPrivate()
        } else {
          setPrivateScanStatus('Trả lời tin nhắn user đang tắt, nên inbox watcher chưa chạy.')
          toast.info('Đã lưu, nhưng inbox watcher chưa chạy vì Trả lời tin nhắn user đang tắt.')
        }
      }
      else toast.error('Lỗi lưu: ' + (res?.error || 'Không rõ'))
    } catch (e: any) { toast.error('Lỗi lưu: ' + e.message) }
    finally { setSaving(false) }
  }

  async function scanUnreadPrivate() {
    try {
      setScanningPrivate(true)
      setPrivateScanStatus('Đang kiểm tra inbox riêng chưa đọc...')
      const res = await telegramApi.scanAiUnreadPrivate({ dialogLimit: 100, messageLimit: 5, source: 'ui_save' })
      if (!res?.success) throw new Error(res?.error || 'Không rõ')
      const text = `Inbox watcher OK: ${res.accounts || 0} account, ${res.dialogs || 0} inbox có unread, ${res.scanned || 0} tin đã quét, ${res.queued || 0} đề xuất, ${res.sent || 0} tự gửi.`
      setPrivateScanStatus(text)
      toast.success(text)
    } catch (e: any) {
      setPrivateScanStatus('Lỗi quét tin nhắn riêng: ' + e.message)
      toast.error('Lỗi quét tin nhắn riêng: ' + e.message)
    }
    finally { setScanningPrivate(false) }
  }

  async function scanGroup(group: EngagementGroup) {
    const key = `${group.accountId}:${group.chatId}`
    const topics = group.topics || []
    try {
      setScanningId(key)
      let scanned = 0
      let queued = 0
      if (topics.length) {
        for (const topic of topics) {
          const res = await telegramApi.scanAiEngagementGroup(group.accountId, group.chatId, Number(form.aiLeadEngagementSampleLimit || 40), topic.id, topic.title, topic.purpose)
          if (!res?.success) throw new Error(res?.error || `Lỗi quét topic ${topic.title}`)
          scanned += Number(res.scanned || 0)
          queued += Number(res.queued || 0)
        }
      } else {
        const res = await telegramApi.scanAiEngagementGroup(group.accountId, group.chatId, Number(form.aiLeadEngagementSampleLimit || 40), undefined, undefined, group.purpose || 'discussion')
        if (!res?.success) throw new Error(res?.error || 'Không rõ')
        scanned = Number(res.scanned || 0)
        queued = Number(res.queued || 0)
      }
      toast.success(`Đã quét ${scanned} tin, tạo ${queued} đề xuất gửi về Telegram admin`)
    } catch (e: any) { toast.error('Lỗi quét: ' + e.message) }
    finally { setScanningId(null) }
  }

  async function testBotConfig() {
    if (!form.telegramBotToken || !form.telegramAdminChatId) {
      toast.error('Vui lòng nhập đầy đủ Token và Admin Chat ID để test.')
      return
    }
    try {
      setTestingBot(true)
      const res = await fetch(`https://api.telegram.org/bot${form.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: form.telegramAdminChatId,
          text: '🔔 Test kết nối Bot Telegram thành công từ trang cấu hình AI Settings!'
        })
      })
      const data = await res.json()
      if (data.ok) {
        toast.success('Gửi tin nhắn test thành công! Hãy kiểm tra Telegram của bạn.')
      } else {
        toast.error('Lỗi từ Telegram: ' + (data.description || 'Không rõ'))
      }
    } catch (e: any) {
      toast.error('Lỗi kết nối API Telegram: ' + e.message)
    } finally {
      setTestingBot(false)
    }
  }

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6 fade-in">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Bot className="w-8 h-8 text-blue-600" /> AI Settings</h1>
          <p className="text-gray-500 mt-2">Chọn group/topic thảo luận, AI sẽ quét câu hỏi hay, tạo reply và gửi về Telegram admin để duyệt.</p>
        </div>
        <button onClick={saveSettings} disabled={saving || scanningPrivate} className="bg-[#24A1DE] text-white px-5 py-2.5 rounded-lg font-medium flex items-center gap-2 justify-center hover:bg-[#1E88BE] disabled:opacity-50">
          {saving || scanningPrivate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {scanningPrivate ? 'Đang quét inbox...' : 'Lưu AI Settings'}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 space-y-6">
          <Card className="p-5 space-y-4">
            <h2 className="font-bold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-600" /> Cấu hình AI</h2>
            <label className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg border"><span className="text-sm font-medium">Bật AI watcher</span><input type="checkbox" checked={!!form.aiLeadEnabled} onChange={e => setForm({ ...form, aiLeadEnabled: e.target.checked })} /></label>
            <label className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg border"><span><span className="block text-sm font-medium">Trả lời tin nhắn user</span><span className="block text-xs text-gray-500">Bật riêng mục này là đủ cho private inbox. Không cần bật AI watcher hoặc chọn group.</span></span><input type="checkbox" checked={form.aiLeadUserReplyEnabled !== false} onChange={e => setForm({ ...form, aiLeadUserReplyEnabled: e.target.checked })} /></label>
            <label className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg border"><span><span className="block text-sm font-medium">Bỏ qua user giống Telegram bot</span><span className="block text-xs text-gray-500">Nếu content hoặc profile có username dạng stondystoreBot, *_bot, hoặc kết thúc bằng bot thì bỏ qua.</span></span><input type="checkbox" checked={!!form.aiLeadIgnoreBotLikeUsers} onChange={e => setForm({ ...form, aiLeadIgnoreBotLikeUsers: e.target.checked })} /></label>
            <button onClick={scanUnreadPrivate} disabled={scanningPrivate || form.aiLeadUserReplyEnabled === false} className="w-full border bg-white hover:bg-gray-50 text-gray-700 text-sm rounded-lg px-3 py-2 flex items-center justify-center gap-2 disabled:opacity-50">
              {scanningPrivate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Quét tin nhắn riêng chưa đọc
            </button>
            {privateScanStatus && <div className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg p-3 leading-relaxed">{privateScanStatus}</div>}
            <div><label className="block text-sm font-semibold mb-1.5">Mode</label><select className="w-full p-2.5 border rounded-lg text-sm" value={form.aiLeadMode} onChange={e => setForm({ ...form, aiLeadMode: e.target.value })}><option value="suggest">Suggest, gửi admin duyệt</option><option value="auto">Auto reply nếu đủ điểm</option></select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Min score</label><input type="number" className="w-full p-2.5 border rounded-lg text-sm" value={form.aiLeadMinScore} onChange={e => setForm({ ...form, aiLeadMinScore: Number(e.target.value) })} /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Sample messages</label><input type="number" className="w-full p-2.5 border rounded-lg text-sm" value={form.aiLeadEngagementSampleLimit} onChange={e => setForm({ ...form, aiLeadEngagementSampleLimit: Number(e.target.value) })} /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Random queue min phút</label><input type="number" min="0" className="w-full p-2.5 border rounded-lg text-sm" value={form.aiLeadAutoSendMinDelayMinutes ?? 15} onChange={e => setForm({ ...form, aiLeadAutoSendMinDelayMinutes: Number(e.target.value), aiLeadAutoSendDelayMinutes: Number(e.target.value) })} /></div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Random queue max phút</label><input type="number" min="0" className="w-full p-2.5 border rounded-lg text-sm" value={form.aiLeadAutoSendMaxDelayMinutes ?? 30} onChange={e => setForm({ ...form, aiLeadAutoSendMaxDelayMinutes: Number(e.target.value) })} /></div>
              <div className="col-span-2 text-xs text-gray-500">Auto mode luôn add vào queue chung cho mọi account. Ví dụ 15-30 phút nghĩa là gửi 1 tin, rồi chờ random 15-30 phút mới gửi tin tiếp theo.</div>
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <h2 className="font-bold flex items-center gap-2"><Send className="w-5 h-5 text-[#24A1DE]" /> Bot Telegram nhận thông báo</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Telegram Bot Token</label>
                <input 
                  type="text" 
                  placeholder="5000000000:AA... (Token từ @BotFather)" 
                  className="w-full p-2.5 border rounded-lg text-sm" 
                  value={form.telegramBotToken || ''} 
                  onChange={e => setForm({ ...form, telegramBotToken: e.target.value })} 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Admin Chat ID</label>
                <input 
                  type="text" 
                  placeholder="Ví dụ: 123456789 (ID nhận đề xuất duyệt)" 
                  className="w-full p-2.5 border rounded-lg text-sm" 
                  value={form.telegramAdminChatId || ''} 
                  onChange={e => setForm({ ...form, telegramAdminChatId: e.target.value })} 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Username của Bot (Không chứa @)</label>
                <input 
                  type="text" 
                  placeholder="Ví dụ: my_tele_shop_bot" 
                  className="w-full p-2.5 border rounded-lg text-sm" 
                  value={form.telegramBotUsername || ''} 
                  onChange={e => setForm({ ...form, telegramBotUsername: e.target.value })} 
                />
              </div>
              <button 
                type="button" 
                onClick={testBotConfig} 
                disabled={testingBot || !form.telegramBotToken || !form.telegramAdminChatId} 
                className="w-full border bg-white hover:bg-gray-50 text-gray-700 text-sm rounded-lg px-3 py-2 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {testingBot ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Test gửi tin nhắn
              </button>
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="font-bold">Group/topic mục đích</h2>
            {!selectedGroups.length ? <p className="text-sm text-gray-500">Chưa chọn group nào.</p> : <div className="space-y-3 max-h-[560px] overflow-y-auto">
              {selectedGroups.map(group => {
                const key = `${group.accountId}:${group.chatId}`
                const allTopics = topicsByGroup[key] || []
                return <div key={key} className="p-3 border rounded-lg bg-gray-50 space-y-3">
                  <div><div className="font-semibold text-sm">{group.username ? `@${group.username}` : group.title}</div><div className="text-xs text-gray-500">Account: {group.accountId}</div></div>
                  <div><label className="block text-xs font-medium text-gray-500 mb-1">Mục đích group mặc định</label><select className="w-full p-2 border rounded-lg text-xs" value={group.purpose || 'discussion'} onChange={e => updateGroup(key, { purpose: e.target.value })}>{PURPOSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                  <button onClick={() => loadTopics(group)} disabled={loadingTopicsId === key} className="w-full border bg-white hover:bg-gray-50 text-gray-700 text-sm rounded-lg px-3 py-2 flex items-center justify-center gap-2 disabled:opacity-50">{loadingTopicsId === key ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Load topics</button>
                  {!!allTopics.length && <div className="space-y-2 max-h-56 overflow-y-auto border rounded-lg bg-white p-2">{allTopics.map(topic => {
                    const selected = (group.topics || []).some(t => String(t.id) === String(topic.id))
                    const selectedTopic = (group.topics || []).find(t => String(t.id) === String(topic.id))
                    return <div key={topic.id} className="space-y-1 border-b last:border-0 pb-2 last:pb-0"><label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={selected} onChange={() => toggleTopic(group, topic)} /> {topic.title}</label>{selected && <select className="w-full p-1.5 border rounded text-xs" value={selectedTopic?.purpose || group.purpose || 'discussion'} onChange={e => updateTopicPurpose(group, topic.id, e.target.value)}>{PURPOSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}</div>
                  })}</div>}
                  <button onClick={() => scanGroup(group)} disabled={scanningId === key} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg px-3 py-2 flex items-center justify-center gap-2 disabled:opacity-50">{scanningId === key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Quét group/topics và gửi admin duyệt</button>
                </div>
              })}
            </div>}
          </Card>
        </div>

        <Card className="xl:col-span-2 p-5 space-y-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-end"><div className="flex-1"><label className="block text-sm font-semibold mb-1.5">Account dùng để lấy group</label><select className="w-full p-2.5 border rounded-lg text-sm" value={selectedAccId} onChange={e => setSelectedAccId(e.target.value)}>{accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.firstName} {acc.lastName || ''} ({acc.id})</option>)}</select></div><button onClick={() => selectedAccId && loadDialogs(selectedAccId)} className="px-4 py-2.5 border rounded-lg text-sm flex items-center gap-2 hover:bg-gray-50"><RefreshCw className="w-4 h-4" /> Refresh group</button></div>
          <div className="relative"><Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" /><input className="w-full pl-9 pr-3 py-2.5 border rounded-lg text-sm" placeholder="Tìm group theo title hoặc @username..." value={query} onChange={e => setQuery(e.target.value)} /></div>
          {loadingDialogs ? <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div> : <div className="border rounded-xl divide-y max-h-[720px] overflow-y-auto">{filteredDialogs.map(dialog => { const key = `${selectedAccId}:${dialog.id}`; const checked = selectedKeys.has(key); return <label key={key} className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer"><input type="checkbox" checked={checked} onChange={() => toggleGroup(dialog)} /><div className="flex-1 min-w-0"><div className="font-semibold text-sm truncate">{dialog.title}</div><div className="text-xs text-gray-500">{dialog.username ? `@${dialog.username}` : 'private/no username'} · {dialog.isForum ? 'forum/topics' : 'normal group'} · {dialog.participantsCount || '?'} members · ID {dialog.id}</div></div></label> })}{!filteredDialogs.length && <div className="p-8 text-center text-sm text-gray-500">Không có group phù hợp.</div>}</div>}
        </Card>
      </div>
    </div>
  )
}
