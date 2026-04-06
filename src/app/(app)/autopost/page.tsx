'use client'

import { useState, useEffect } from "react"
import { 
  Send, Plus, Trash2, Edit, Save, Play, Square, X, Users, MessageSquareText, 
  Image as ImageIcon, ArrowLeft, ChevronDown, ChevronRight, Loader2, Clock, Calendar, Share2,
  ShieldCheck, CheckCircle2, AlertCircle, AlertTriangle, Search
} from "lucide-react"
import { telegramApi } from "@/lib/telegram"
import { toast } from "sonner"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

function Card({ children, className = '' }: { children: React.ReactNode, className?: string }) {
  return <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}>{children}</div>;
}

interface TargetItem {
  chatId: string
  name: string
  isChannel: boolean
  isForum: boolean
  topicId?: number
  topicName?: string
  accountId: string
  scheduleType?: 'global' | 'random' | 'fixed'
  customSchedule?: string
}

function AutoPostContent() {
  const searchParams = useSearchParams()
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [accounts, setAccounts] = useState<any[]>([])
  
  const [isEditing, setIsEditing] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<any>(null)

  // Group selection state
  const [dialogs, setDialogs] = useState<any[]>([])
  const [searchTargetQuery, setSearchTargetQuery] = useState('')
  const [isLoadingGroups, setIsLoadingGroups] = useState(false)
  
  // Topics state per group
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [topicsMap, setTopicsMap] = useState<Record<string, any[]>>({})
  const [loadingTopics, setLoadingTopics] = useState<string | null>(null)

  // Validation state
  const [validating, setValidating] = useState(false)
  const [validationReport, setValidationReport] = useState<any>(null)
  // Progress Tracking state
  const [campaignProgress, setCampaignProgress] = useState<any[]>([])
  const [viewingProgressCampaign, setViewingProgressCampaign] = useState<any>(null)

  useEffect(() => { loadData() }, [])

  // Setup interval to fetch campaign progress
  useEffect(() => {
    let interval: NodeJS.Timeout;
    // Only poll if there's at least one running campaign
    // But to be safe and simple, we can just poll every 3 seconds if the component is mounted
    const fetchProgress = async () => {
      try {
        const res = await telegramApi.getCampaignProgress();
        if (res?.success) {
          setCampaignProgress(res.progress);
        }
      } catch (err) {}
    };

    fetchProgress(); // run immediately
    interval = setInterval(fetchProgress, 3000); // 3 seconds live update

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const isForward = searchParams.get('forward') === 'true'
    const msgId = searchParams.get('msgId')
    const fromChatId = searchParams.get('fromChatId')
    const fromChatUsername = searchParams.get('fromChatUsername')
    const accId = searchParams.get('acc')
    
    if (isForward && msgId && fromChatId && accId && accounts.length > 0) {
      setEditingCampaign({
        name: `Share Bài Đăng #${msgId}`,
        type: 'forward',
        forwardSource: {
          accountId: accId,
          fromChatId: fromChatId,
          fromChatUsername: fromChatUsername || '',
          messageIds: [parseInt(msgId)]
        },
        accounts: [accId],
        targets: [],
        contentTemplate: '',
        schedule: '60-240',
        firstRunMode: 'immediate'
      })
      setIsEditing(true)
      fetchDialogsForAccounts([accId])
    }
  }, [searchParams, accounts.length])

  const loadData = async () => {
    try {
      const [camps, accs] = await Promise.all([
        telegramApi.getCampaigns(),
        telegramApi.getAccounts(),
      ])
      if (camps?.success) setCampaigns(camps.campaigns)
      setAccounts(accs || [])
    } catch (e) { console.error(e) }
  }

  const handleCreateNew = () => {
    setEditingCampaign({
      name: 'Chiến dịch mới',
      type: 'text',
      accounts: [],
      targets: [],
      contentTemplate: '',
      schedule: '60-240',
      firstRunMode: 'immediate'
    })
    setIsEditing(true)
    setDialogs([])
    setTopicsMap({})
  }

  const handleEdit = (c: any) => {
    setEditingCampaign({ ...c })
    setIsEditing(true)
    setTopicsMap({})
    if (c.accounts?.length > 0) fetchDialogsForAccounts(c.accounts)
  }

  const fetchDialogsForAccounts = async (accountIds: string[]) => {
    setIsLoadingGroups(true)
    try {
      let allDialogs: any[] = []
      for (const id of accountIds) {
        const res = await telegramApi.getDialogs(id)
        if (res?.success) {
          allDialogs = [...allDialogs, ...res.dialogs.map((d: any) => ({ ...d, accountId: id }))]
        }
      }
      const unique = Array.from(new Map(allDialogs.map(item => [item.id, item])).values())
      setDialogs(unique)
    } catch (e) { console.error(e) }
    finally { setIsLoadingGroups(false) }
  }

  const handleAccountToggle = (accId: string) => {
    const isSelected = editingCampaign.accounts.includes(accId)
    const newAccs = isSelected
      ? editingCampaign.accounts.filter((id: string) => id !== accId)
      : [...editingCampaign.accounts, accId]
    setEditingCampaign({ ...editingCampaign, accounts: newAccs })
    fetchDialogsForAccounts(newAccs)
  }

  // ─── GROUP + TOPIC SELECTION ────────────────────────
  const handleGroupClick = async (d: any) => {
    if (d.isForum) {
      // Toggle expand and fetch topics if needed
      if (expandedGroup === d.id) {
        setExpandedGroup(null)
        return
      }
      setExpandedGroup(d.id)

      if (!topicsMap[d.id]) {
        setLoadingTopics(d.id)
        try {
          const res = await telegramApi.getForumTopics(d.accountId, d.id)
          if (res?.success) {
            setTopicsMap(prev => ({ ...prev, [d.id]: res.topics }))
          }
        } catch (e) { console.error(e) }
        finally { setLoadingTopics(null) }
      }
    } else {
      // Non-forum: toggle as target directly
      toggleTarget({
        chatId: d.id, name: d.title, isChannel: d.isChannel,
        isForum: false, accountId: d.accountId,
      })
    }
  }

  const toggleTarget = (target: TargetItem) => {
    const key = target.topicId ? `${target.chatId}:${target.topicId}` : target.chatId
    const existing = editingCampaign.targets.find((t: TargetItem) => {
      const tKey = t.topicId ? `${t.chatId}:${t.topicId}` : t.chatId
      return tKey === key
    })
    if (existing) {
      setEditingCampaign({
        ...editingCampaign,
        targets: editingCampaign.targets.filter((t: TargetItem) => {
          const tKey = t.topicId ? `${t.chatId}:${t.topicId}` : t.chatId
          return tKey !== key
        })
      })
    } else {
      setEditingCampaign({
        ...editingCampaign,
        targets: [...editingCampaign.targets, { ...target, scheduleType: 'global', customSchedule: '' }]
      })
    }
  }

  const handleTargetScheduleChange = (key: string, field: string, value: string) => {
    setEditingCampaign((prev: any) => ({
      ...prev,
      targets: prev.targets.map((t: TargetItem) => {
        const tKey = t.topicId ? `${t.chatId}:${t.topicId}` : t.chatId;
        if (tKey === key) return { ...t, [field]: value };
        return t;
      })
    }))
  }

  const isTargetSelected = (chatId: string, topicId?: number) => {
    const key = topicId ? `${chatId}:${topicId}` : chatId
    return editingCampaign.targets.some((t: TargetItem) => {
      const tKey = t.topicId ? `${t.chatId}:${t.topicId}` : t.chatId
      return tKey === key
    })
  }

  const handleSave = async () => {
    const res = await telegramApi.saveCampaign(editingCampaign)
    if (res?.success) {
      setIsEditing(false)
      toast.success("Đã rủng rỉnh lưu chiến dịch!");
      loadData()
    } else {
      toast.error("Lỗi: " + res?.error)
    }
  }

  const handleDelete = async (id: string) => {
    toast('Xác nhận xóa chiến dịch này?', {
      action: {
        label: 'Đồng ý',
        onClick: async () => {
          await telegramApi.deleteCampaign(id);
          loadData();
          toast.success("Đã xóa chiến dịch");
        }
      },
      cancel: { label: 'Hủy', onClick: () => {} }
    });
  }

  const handleToggleRun = async (c: any) => {
    const newStatus = !c.isRunning;
    const res = await telegramApi.saveCampaign({ ...c, isRunning: newStatus });
    if (res?.success) {
      toast.success(newStatus ? `Đã BẮT ĐẦU chiến dịch ${c.name}` : `Đã DỪNG chiến dịch ${c.name}`);
      loadData();
    } else {
      toast.error("Lỗi cập nhật trạng thái: " + res?.error);
    }
  }

  const handleSelectAll = () => {
    const nonForums = dialogs.filter(d => !d.isForum);
    
    // Create new targets from non-forums
    const newTargets = nonForums.map(d => ({
        chatId: d.id,
        name: d.title,
        isChannel: d.isChannel,
        isForum: false,
        accountId: d.accountId,
        scheduleType: 'global',
        customSchedule: ''
    }));

    // Retain existing forums so they are not wiped
    const existingForums = editingCampaign.targets.filter((t: any) => t.isForum);

    setEditingCampaign({
        ...editingCampaign,
        targets: [...existingForums, ...newTargets]
    });
  }

  const handleDeselectAll = () => {
    const existingForums = editingCampaign.targets.filter((t: any) => t.isForum);
    setEditingCampaign({
        ...editingCampaign,
        // Optional: keep forums or wipe everything? User asked to "Cho chọn tất" which implies they want easy bulk management. 
        // We will wipe non-forums for quick reset, keeping manually selected forums.
        targets: [...existingForums]
    });
  }

  const handleValidate = async () => {
    if (editingCampaign.targets.length === 0) {
       toast.warning("Vui lòng chọn ít nhất 1 Group Target.");
       return;
    }
    setValidating(true);
    setValidationReport(null);

    const targetsCache = editingCampaign.targets.map((t: any) => {
        const dialog = dialogs.find(d => d.id === t.chatId);
        return {
           chatId: t.chatId,
           name: t.name,
           defaultBannedRights: dialog?.defaultBannedRights || null
        };
    });

    const accId = editingCampaign.accounts[0];
    if (!accId) {
        toast.warning("Vui lòng chọn tài khoản chạy post.");
        setValidating(false);
        return;
    }

    try {
        const res = await telegramApi.validateCampaign(accId, editingCampaign, targetsCache);
        if (res?.success) {
            setValidationReport(res.result);
            toast.success("Đã kiểm tra xong.");
        } else {
            toast.error("Lỗi: " + res?.error);
        }
    } catch(err: any) {
        toast.error("Lỗi: " + err.message);
    } finally {
        setValidating(false);
    }
  }

  const handleRemoveErrorTargets = () => {
      if (!validationReport?.targets) return;
      
      const errorChatIds = validationReport.targets
         .filter((r: any) => r.status === 'ERROR')
         .map((r: any) => r.chatId);
         
      if (errorChatIds.length > 0) {
         setEditingCampaign((prev: any) => ({
            ...prev,
            targets: prev.targets.filter((t: any) => !errorChatIds.includes(t.chatId))
         }));
         toast.success(`Đã loại bỏ ${errorChatIds.length} nhóm báo lỗi khỏi danh sách gửi!`);
         setValidationReport(null);
      }
  }

  // ─── EDITOR VIEW ────────────────────────────────────
  if (isEditing) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6 fade-in pb-24">
        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold">{editingCampaign._id ? 'Sửa chiến dịch' : 'Tạo chiến dịch mới'}</h1>
          <button onClick={() => setIsEditing(false)} className="text-gray-500 hover:text-gray-900"><X className="w-6 h-6" /></button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Config */}
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold mb-1.5">Tên chiến dịch</label>
              <input type="text" value={editingCampaign.name}
                onChange={e => setEditingCampaign({...editingCampaign, name: e.target.value})}
                className="w-full p-2.5 border rounded-lg" />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1.5">Kiểu bài đăng</label>
              <select value={editingCampaign.type}
                onChange={e => setEditingCampaign({...editingCampaign, type: e.target.value})}
                className="w-full p-2.5 border rounded-lg bg-white">
                <option value="text">Chữ (Spin Text)</option>
                <option value="photo">Chữ + Ảnh</option>
                <option value="quote">Trích dẫn (Quote Block)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1.5">Lịch gửi toàn cục mặc định (phút, VD: 60-240)</label>
              <input type="text" value={editingCampaign.schedule}
                onChange={e => setEditingCampaign({...editingCampaign, schedule: e.target.value})}
                className="w-full p-2.5 border rounded-lg" />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1.5">Chế độ Khởi chạy lần đầu (Ngăn xả đạn)</label>
              <select value={editingCampaign.firstRunMode || 'immediate'}
                onChange={e => setEditingCampaign({...editingCampaign, firstRunMode: e.target.value})}
                className="w-full p-2.5 border rounded-lg bg-white">
                <option value="immediate">Khởi chạy ngay (Rải hạt cách nhau 2 phút)</option>
                <option value="random">Chờ đúng định mức Random (an toàn nhất)</option>
              </select>
              <p className="text-[10px] text-gray-500 mt-1">Điều khiển cách hệ thống dàn mỏng hàng loạt tin nhắn khi vừa bấm nút Play.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1.5">Tài khoản chạy post</label>
              <div className="border rounded-lg p-3 max-h-40 overflow-y-auto bg-gray-50 space-y-2">
                {accounts.length === 0 && <p className="text-sm text-gray-400">Chưa có tài khoản nào</p>}
                {accounts.map(acc => (
                  <label key={acc.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="checkbox" checked={editingCampaign.accounts.includes(acc.id)}
                      onChange={() => handleAccountToggle(acc.id)} />
                    <span>{acc.firstName} (@{acc.username || acc.phone})</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Targets (Groups + Topics) */}
          <div className="space-y-3">
            <div className="flex justify-between items-end">
              <div>
                <label className="block text-sm font-semibold">Targets — Groups & Topics</label>
                <p className="text-xs text-gray-500">Chọn tài khoản phía trên, danh sách group sẽ hiện bên dưới. Group forum sẽ hiển thị topics con.</p>
              </div>
              {dialogs.length > 0 && (
                <div className="flex gap-2 shrink-0">
                  <button onClick={handleSelectAll} className="text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded truncate">
                    Chọn Tất Cả Nhóm Thường
                  </button>
                  <button onClick={handleDeselectAll} className="text-xs font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded truncate">
                    Bỏ Chọn Tất Cả
                  </button>
                </div>
              )}
            </div>
            
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="text-gray-400 w-4 h-4" />
              </div>
              <input
                type="text"
                placeholder="Tìm kiếm group/channel..."
                value={searchTargetQuery}
                onChange={(e) => setSearchTargetQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
              />
            </div>
            
            <div className="border rounded-lg bg-white overflow-hidden" style={{ maxHeight: '420px', overflowY: 'auto' }}>
              {isLoadingGroups && (
                <div className="p-4 text-sm text-blue-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải groups...</div>
              )}
              {dialogs.length === 0 && !isLoadingGroups && (
                <div className="p-8 text-center text-gray-400 text-sm">Chưa chọn tài khoản hoặc tài khoản không có group.</div>
              )}
              {(searchTargetQuery ? dialogs.filter(d => d.title?.toLowerCase().includes(searchTargetQuery.toLowerCase())) : dialogs).map(d => (
                <div key={d.id}>
                  {/* Group Row */}
                  <div className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-100 hover:bg-blue-50 transition-colors text-sm ${
                    isTargetSelected(d.id) && !d.isForum ? 'bg-blue-50' : ''
                  }`}
                    onClick={() => handleGroupClick(d)}>
                    
                    {d.isForum ? (
                      <span className="w-5 flex justify-center">
                        {expandedGroup === d.id ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      </span>
                    ) : (
                      <input type="checkbox" checked={isTargetSelected(d.id)} readOnly />
                    )}
                    
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${d.isChannel ? 'bg-purple-400' : 'bg-blue-400'}`}></span>
                    <span className="truncate flex-1">{d.title}</span>
                    {d.isForum && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold">FORUM</span>}
                    {d.isChannel && <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-semibold">CH</span>}
                  </div>

                  {/* Target Schedule Customization */}
                  {isTargetSelected(d.id) && !d.isForum && (
                    <div className="pl-8 pr-3 py-2 bg-slate-50 border-b border-gray-100/50 flex flex-wrap gap-2 items-center">
                      <select 
                        title="Tùy chỉnh lịch gửi"
                        value={editingCampaign.targets.find((t: any) => t.chatId === d.id)?.scheduleType || 'global'}
                        onChange={(e) => handleTargetScheduleChange(d.id, 'scheduleType', e.target.value)}
                        className="text-xs p-1.5 border rounded bg-white shadow-sm font-medium text-gray-700"
                      >
                        <option value="global">Lịch dùng chung</option>
                        <option value="random">Lịch ngẫu nhiên (phút)</option>
                        <option value="fixed">Giờ cố định (hàng ngày)</option>
                      </select>
                      
                      {editingCampaign.targets.find((t: any) => t.chatId === d.id)?.scheduleType === 'random' && (
                        <input type="text" placeholder="VD: Min-Max (60-120)"
                          className="text-xs p-1.5 border rounded flex-1 min-w-[100px]"
                          value={editingCampaign.targets.find((t: any) => t.chatId === d.id)?.customSchedule || ''}
                          onChange={(e) => handleTargetScheduleChange(d.id, 'customSchedule', e.target.value)}
                        />
                      )}
                      
                      {editingCampaign.targets.find((t: any) => t.chatId === d.id)?.scheduleType === 'fixed' && (
                        <input type="text" placeholder="VD: 10:00, 15:30"
                          className="text-xs p-1.5 border rounded flex-1 min-w-[100px]"
                          value={editingCampaign.targets.find((t: any) => t.chatId === d.id)?.customSchedule || ''}
                          onChange={(e) => handleTargetScheduleChange(d.id, 'customSchedule', e.target.value)}
                        />
                      )}
                    </div>
                  )}

                  {/* Forum Topics (expanded) */}
                  {d.isForum && expandedGroup === d.id && (
                    <div className="bg-gray-50 border-b">
                      {loadingTopics === d.id && (
                        <div className="px-6 py-2 text-xs text-blue-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Đang tải topics...</div>
                      )}
                      {(topicsMap[d.id] || []).map((topic: any) => (
                        <div key={topic.id}>
                          <label className={`flex items-center gap-2 px-8 py-2 text-sm cursor-pointer hover:bg-blue-100 transition-colors ${
                            isTargetSelected(d.id, topic.id) ? 'bg-blue-50' : ''
                          }`}>
                            <input type="checkbox" 
                              checked={isTargetSelected(d.id, topic.id)}
                              onChange={() => toggleTarget({
                                chatId: d.id, name: d.title, isChannel: d.isChannel,
                                isForum: true, topicId: topic.id, topicName: topic.title,
                                accountId: d.accountId,
                              })}
                            />
                            <span className="text-gray-700">{topic.title}</span>
                            <span className="text-[10px] text-gray-400 ml-auto">#{topic.id}</span>
                          </label>
                          {/* Topic Schedule Customization */}
                          {isTargetSelected(d.id, topic.id) && (
                            <div className="pl-14 pr-8 py-2 bg-slate-100/50 flex flex-wrap gap-2 items-center">
                              <select 
                                title="Tùy chỉnh lịch gửi"
                                value={editingCampaign.targets.find((t: any) => t.chatId === d.id && t.topicId === topic.id)?.scheduleType || 'global'}
                                onChange={(e) => handleTargetScheduleChange(`${d.id}:${topic.id}`, 'scheduleType', e.target.value)}
                                className="text-xs p-1.5 border rounded bg-white font-medium text-gray-700"
                              >
                                <option value="global">Lịch dùng chung</option>
                                <option value="random">Lịch ngẫu nhiên</option>
                                <option value="fixed">Giờ cố định</option>
                              </select>
                              {editingCampaign.targets.find((t: any) => t.chatId === d.id && t.topicId === topic.id)?.scheduleType === 'random' && (
                                <input type="text" placeholder="Min-Max phút" className="text-xs p-1.5 border rounded w-24"
                                  value={editingCampaign.targets.find((t: any) => t.chatId === d.id && t.topicId === topic.id)?.customSchedule || ''}
                                  onChange={(e) => handleTargetScheduleChange(`${d.id}:${topic.id}`, 'customSchedule', e.target.value)} />
                              )}
                              {editingCampaign.targets.find((t: any) => t.chatId === d.id && t.topicId === topic.id)?.scheduleType === 'fixed' && (
                                <input type="text" placeholder="VD: 10:00" className="text-xs p-1.5 border rounded w-24"
                                  value={editingCampaign.targets.find((t: any) => t.chatId === d.id && t.topicId === topic.id)?.customSchedule || ''}
                                  onChange={(e) => handleTargetScheduleChange(`${d.id}:${topic.id}`, 'customSchedule', e.target.value)} />
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      {!loadingTopics && (topicsMap[d.id] || []).length === 0 && (
                        <p className="px-8 py-2 text-xs text-gray-400">Không có topic nào</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="text-sm text-gray-500 font-medium">
              Đã chọn: {editingCampaign.targets.length} targets
            </div>
          </div>
        </div>

        {/* Content Template */}
        {editingCampaign.type === 'forward' ? (
          <div className="bg-blue-50 border border-blue-200 p-5 rounded-xl border-l-4 border-l-blue-500">
            <h3 className="font-semibold text-blue-800 flex items-center gap-2">
              <Share2 className="w-5 h-5" /> Đang ở chế độ Chia sẻ (Forward)
            </h3>
            <p className="text-sm text-blue-700 mt-2">
              Hệ thống sẽ lấy các bài đăng được chọn từ Kênh nguồn và Forward một cách tự động vào các Group Targets. Lịch gửi sẽ bám theo cấu hình (Global/Cố định/Random) của từng group.
            </p>
            {editingCampaign.forwardSource && editingCampaign.forwardSource.messageIds?.length > 0 && (
              <div className="mt-4 pt-4 border-t border-blue-200/60">
                <p className="text-sm font-semibold text-blue-800 mb-2">Thông tin bài đăng đang Forward:</p>
                <div className="bg-white/60 p-3 rounded-lg border border-blue-100 flex flex-col gap-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">ID Kênh nguồn:</span>
                    <span className="font-mono text-blue-700 font-medium">{editingCampaign.forwardSource.fromChatId}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">ID Bài viết:</span>
                    <span className="font-mono text-blue-700 font-medium">{editingCampaign.forwardSource.messageIds.join(', ')}</span>
                  </div>
                  {editingCampaign.forwardSource.fromChatUsername ? (
                    <div className="mt-1 pt-2 flex items-center justify-between border-t border-blue-100/50">
                       <span className="text-gray-600">Link công khai do Kênh có Username:</span>
                       <a href={`https://t.me/${editingCampaign.forwardSource.fromChatUsername}/${editingCampaign.forwardSource.messageIds[0]}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">https://t.me/{editingCampaign.forwardSource.fromChatUsername}/{editingCampaign.forwardSource.messageIds[0]}</a>
                    </div>
                  ) : String(editingCampaign.forwardSource.fromChatId).startsWith('-100') ? (
                    <div className="mt-1 pt-2 flex items-center justify-between border-t border-blue-100/50">
                       <span className="text-gray-600">Tham chiếu (Link Kênh Private/Ẩn):</span>
                       <a href={`https://t.me/c/${String(editingCampaign.forwardSource.fromChatId).replace('-100', '')}/${editingCampaign.forwardSource.messageIds[0]}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">Mở bài viết trên Web Telegram</a>
                    </div>
                  ) : (
                    <div className="mt-1 pt-2 flex items-center justify-between border-t border-blue-100/50">
                       <span className="text-gray-600">Tham chiếu (Kênh công khai vô danh):</span>
                       <a href={`https://t.me/${editingCampaign.forwardSource.fromChatId}/${editingCampaign.forwardSource.messageIds[0]}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">Mở bài viết</a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : editingCampaign.type === 'quote' ? (
          <div className="space-y-4">
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg">
              <label className="block text-sm font-semibold text-blue-800 mb-2">Nội dung Khung Trích Dẫn (Quote Block)</label>
              <p className="text-xs text-blue-600 mb-2">Đoạn văn này sẽ được đóng khung xanh nổi bật. Hỗ trợ Spin <code className="bg-blue-100 px-1 rounded">{'{A|B|C}'}</code>.</p>
              <textarea className="w-full h-24 p-3 border border-blue-200 rounded-lg bg-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                value={editingCampaign.quoteText || ''}
                placeholder="Ví dụ: Anh em nào muốn tạo shop để trải nghiệm..."
                onChange={e => setEditingCampaign({...editingCampaign, quoteText: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2">Lời bình của Sếp (Message)</label>
              <p className="text-xs text-gray-500 mb-2">Đoạn văn này sẽ nằm ngay dưới khung Xanh.</p>
              <textarea className="w-full h-24 p-4 border rounded-xl bg-gray-50 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
                value={editingCampaign.contentTemplate}
                placeholder="Ví dụ: Đăng ký tải ở Link bên dưới nhé!"
                onChange={e => setEditingCampaign({...editingCampaign, contentTemplate: e.target.value})} />
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-semibold mb-2">Nội dung mẫu (Hỗ trợ Spin Text)</label>
            <p className="text-xs text-gray-400 mb-2">Dùng cú pháp <code className="bg-gray-100 px-1 rounded">{'{A|B|C}'}</code> để random nội dung.</p>
            <textarea className="w-full h-36 p-4 border rounded-xl bg-gray-50 text-sm resize-none"
              value={editingCampaign.contentTemplate}
              onChange={e => setEditingCampaign({...editingCampaign, contentTemplate: e.target.value})} />
          </div>
        )}

        {/* Bottom Bar */}
        <div className="fixed bottom-0 left-0 lg:left-64 right-0 p-4 border-t bg-white flex justify-end gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-40">
          <div className="flex flex-col sm:flex-row items-center gap-2 mr-auto ml-2 sm:ml-4">
            <button onClick={handleValidate} className="px-6 py-2 rounded-lg font-bold text-xs sm:text-sm bg-purple-100 text-purple-700 hover:bg-purple-200 flex items-center gap-2 transition-colors" disabled={validating}>
              {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} <span className="hidden sm:inline">KIỂM TRA TƯƠNG THÍCH</span><span className="sm:hidden">VALIDATE</span>
            </button>
            {editingCampaign.type === 'forward' && (
              <span className="text-[10px] text-gray-500 max-w-[150px] leading-tight hidden md:inline">
                * Có thể mất thời gian để lặn sâu quét tín hiệu Anti-Spam Bot của từng nhóm
              </span>
            )}
          </div>

          <button onClick={() => setIsEditing(false)} className="px-6 py-2 rounded-lg font-medium bg-gray-100">Hủy</button>
          <button onClick={handleSave} className="px-6 py-2 rounded-lg font-medium bg-[#24A1DE] text-white flex items-center gap-2">
            <Save className="w-4 h-4" /> Lưu Chiến Dịch
          </button>
        </div>

        {/* Validation Modal */}
        {validationReport && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 fade-in">
            <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl relative overflow-hidden">
              <div className="p-5 border-b flex justify-between items-center bg-white z-10 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Kết quả Validation Campaign</h3>
                    <p className="text-xs text-gray-500">Đối chiếu Nội dung với Luật của Nhóm</p>
                  </div>
                </div>
                <button onClick={() => setValidationReport(null)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 bg-gray-50 space-y-5">
                {/* Content Summary */}
                <div className="bg-white p-4 rounded-xl border border-gray-200">
                  <h4 className="text-xs font-bold text-gray-500 mb-3 uppercase">Phân Tích Nội Dung Tải Lên</h4>
                  <div className="flex gap-4">
                    <span className={`px-3 py-1.5 rounded-md text-xs font-semibold ${validationReport.content.hasLinks ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      Links (http) {validationReport.content.hasLinks ? '✅' : '❌'}
                    </span>
                    <span className={`px-3 py-1.5 rounded-md text-xs font-semibold ${validationReport.content.hasTags ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      Tags (@) {validationReport.content.hasTags ? '✅' : '❌'}
                    </span>
                    <span className={`px-3 py-1.5 rounded-md text-xs font-semibold ${validationReport.content.hasMedia ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      Media (Ảnh/Clip) {validationReport.content.hasMedia ? '✅' : '❌'}
                    </span>
                  </div>
                </div>

                {/* Targets Report */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-gray-500 uppercase flex justify-between items-end">
                    <span>Trạng thái Targets ({validationReport.targets.length})</span>
                    {validationReport.targets.some((r: any) => r.status === 'ERROR') && (
                      <button onClick={handleRemoveErrorTargets} className="text-red-600 hover:text-red-700 flex items-center gap-1 normal-case text-xs">
                        <Trash2 className="w-3.5 h-3.5" /> Xóa toàn bộ LỖI ĐỎ khỏi danh sách
                      </button>
                    )}
                  </h4>
                  
                  {validationReport.targets.map((r: any, idx: number) => (
                    <div key={idx} className={`p-4 rounded-xl border bg-white flex gap-3 ${r.status === 'ERROR' ? 'border-red-200' : r.status === 'WARNING' ? 'border-amber-200' : 'border-emerald-200'}`}>
                      {r.status === 'ERROR' ? <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" /> : 
                       r.status === 'WARNING' ? <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" /> :
                       <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />}
                      <div>
                        <h5 className="font-semibold text-sm text-gray-900">{r.name}</h5>
                        <ul className="mt-1.5 space-y-1">
                          {r.reasons.map((reason: string, i: number) => (
                            <li key={i} className={`text-xs ${r.status === 'ERROR' ? 'text-red-600 font-medium' : r.status === 'WARNING' ? 'text-amber-700' : 'text-emerald-600'}`}>
                              • {reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                  
                  {validationReport.targets.length === 0 && (
                     <div className="text-center text-sm text-gray-500 py-4">Chưa chọn Target nào!</div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    )
  }

  // ─── CAMPAIGN LIST VIEW ─────────────────────────────
  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8 fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Chiến dịch Auto Post</h1>
          <p className="text-gray-500 mt-2">Tạo nhiều chiến dịch khác nhau, mỗi chiến dịch gắn tài khoản và targets riêng</p>
        </div>
        <button onClick={handleCreateNew}
          className="bg-[#24A1DE] text-white px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-[#1E88BE] shadow-sm">
          <Plus className="w-5 h-5" /> Tạo chiến dịch
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {campaigns.map(c => (
          <Card key={c._id} className="p-5 flex flex-col gap-4 border-l-4 border-l-blue-500">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-lg leading-tight">{c.name}</h3>
                <span className={`inline-flex mt-1.5 items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full uppercase ${
                  c.type === 'forward' ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-600'
                }`}>
                  {c.type === 'text' ? <MessageSquareText className="w-3 h-3"/> : c.type === 'forward' ? <Share2 className="w-3 h-3" /> : <ImageIcon className="w-3 h-3"/>} {c.type}
                </span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => handleEdit(c)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-md" title="Sửa">
                  <Edit className="w-4 h-4"/>
                </button>
                <button onClick={() => handleDelete(c._id)} className="p-2 text-red-500 hover:bg-red-50 rounded-md" title="Xóa">
                  <Trash2 className="w-4 h-4"/>
                </button>
              </div>
            </div>

            <div className="flex gap-4 text-sm text-gray-500">
              <div><Users className="w-4 h-4 inline mr-1" />{c.accounts?.length || 0} Accounts</div>
              <div><Send className="w-4 h-4 inline mr-1" />{c.targets?.length || 0} Targets</div>
            </div>

            {/* Show selected targets summary if not running */}
            {!c.isRunning && c.targets?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {c.targets.slice(0, 5).map((t: any, i: number) => (
                  <span key={i} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full truncate max-w-[150px]">
                    {t.name}{t.topicName ? ` → ${t.topicName}` : ''}
                  </span>
                ))}
                {c.targets.length > 5 && <span className="text-xs text-gray-400">+{c.targets.length - 5} nữa</span>}
              </div>
            )}

            {/* Live Progress Button */}
            {c.isRunning && (
              <button 
                onClick={() => setViewingProgressCampaign(c)}
                className="mt-2 w-full py-2.5 bg-blue-50 text-blue-700 font-semibold text-xs rounded-xl border border-blue-100 flex justify-center items-center gap-2 hover:bg-blue-100 transition-colors"
               >
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div> 
                XEM TRẠNG THÁI TIẾN ĐỘ LIVE (PROGRESS)
              </button>
            )}
            
            <div className="flex gap-2 mt-2">
              <button onClick={() => handleToggleRun(c)} className={`flex-1 flex justify-center items-center gap-2 py-2 rounded-lg font-medium transition-all ${
                c.isRunning ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100' : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
              }`}>
                {c.isRunning ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {c.isRunning ? 'Stop' : 'Bắt đầu gửi'}
              </button>
            </div>
          </Card>
        ))}

        {campaigns.length === 0 && (
          <div className="col-span-full py-16 text-center text-gray-500 border border-dashed rounded-xl bg-gray-50">
            <Send className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>Chưa có chiến dịch nào.</p>
          </div>
        )}
      </div>

      {/* Progress Modal */}
      {viewingProgressCampaign && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 fade-in">
          <Card className="w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl relative overflow-hidden">
            <div className="p-5 border-b flex justify-between items-center bg-white z-10 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></div>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Trạng thái Tiến độ Live</h3>
                  <p className="text-xs text-gray-500 font-medium">{viewingProgressCampaign.name}</p>
                </div>
              </div>
              <button onClick={() => setViewingProgressCampaign(null)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-gray-50 space-y-2">
              {viewingProgressCampaign.targets.map((t: any, i: number) => {
                const prog = campaignProgress.find((p: any) => p.campaignId === viewingProgressCampaign._id && p.chatId === t.chatId && p.topicId === String(t.topicId || '0'));
                
                let statusText = <span className="text-gray-400 italic flex items-center gap-1.5 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin"/> Đợi lấy lịch...</span>;
                if (prog) {
                  const diffSec = Math.floor((prog.nextRunAt - Date.now()) / 1000);
                  if (diffSec <= 0) {
                      statusText = <span className="text-emerald-600 font-semibold flex items-center gap-1.5 text-xs"><Send className="w-3.5 h-3.5 animate-bounce" /> Đang chuẩn bị xả đạn...</span>;
                  } else {
                      const mins = Math.floor(diffSec / 60);
                      const secs = diffSec % 60;
                      statusText = <span className="text-blue-600 font-medium text-xs whitespace-nowrap">⏳ Chờ ~ {mins}p {secs}s</span>;
                  }
                }

                return (
                  <div key={i} className="flex justify-between items-center text-sm bg-white p-3 rounded-xl shadow-sm border border-gray-100">
                    <span className="truncate max-w-[280px] text-gray-800 font-medium" title={t.name}>{t.name}{t.topicName ? ` > ${t.topicName}` : ''}</span>
                    <div className="shrink-0">{statusText}</div>
                  </div>
                );
              })}
              
              {viewingProgressCampaign.targets.length === 0 && (
                 <div className="text-center text-sm text-gray-500 py-10">Chiến dịch này chưa có Target nào.</div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

export default function AutoPostPage() {
  return (
    <Suspense fallback={<div className="p-10 flex justify-center w-full"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>}>
      <AutoPostContent />
    </Suspense>
  )
}
