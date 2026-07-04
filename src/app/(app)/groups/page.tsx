'use client'

import { useState, useEffect } from "react"
import { 
  Users2, MessageSquare, Megaphone, Edit, Share2, ArrowLeft, ArrowRight, ShieldCheck, Crown, 
  Lock, ImageOff, MessageCircleOff, Link2Off, FileX, BotOff, ShieldAlert, CheckCircle2, AlertTriangle, AlertCircle,
  Eye, X, Image as ImageIcon, Send, Search, LogOut, Plus, PlusCircle, UserX, MessageSquarePlus,
  Copy, Link2, ExternalLink, Loader2, ChevronDown, Clock
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
  const [fetchingLinkId, setFetchingLinkId] = useState<string | null>(null)
  const router = useRouter()

  // Bulk Selection and Actions State
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  
  // Bulk Leave
  const [showBulkLeaveModal, setShowBulkLeaveModal] = useState(false)
  const [leavingBulk, setLeavingBulk] = useState(false)
  const [bulkLeaveMinDelay, setBulkLeaveMinDelay] = useState(60)
  const [bulkLeaveMaxDelay, setBulkLeaveMaxDelay] = useState(120)
  const [bulkLeaveProgress, setBulkLeaveProgress] = useState<{ current: number; total: number; results: any[]; countdown: number | null }>({ current: 0, total: 0, results: [], countdown: null })

  // Bulk Scan
  const [showBulkScanModal, setShowBulkScanModal] = useState(false)
  const [scanningBulk, setScanningBulk] = useState(false)
  const [bulkScanMinDelay, setBulkScanMinDelay] = useState(2)
  const [bulkScanMaxDelay, setBulkScanMaxDelay] = useState(5)
  const [bulkScanProgress, setBulkScanProgress] = useState<{ current: number; total: number; results: any[]; countdown: number | null }>({ current: 0, total: 0, results: [], countdown: null })

  // Bulk Send
  const [showBulkSendModal, setShowBulkSendModal] = useState(false)
  const [bulkSendMessage, setBulkSendMessage] = useState('')
  const [sendingBulkMsg, setSendingBulkMsg] = useState(false)
  const [bulkSendMinDelay, setBulkSendMinDelay] = useState(60)
  const [bulkSendMaxDelay, setBulkSendMaxDelay] = useState(120)
  const [bulkSendProgress, setBulkSendProgress] = useState<{ current: number; total: number; results: any[]; countdown: number | null }>({ current: 0, total: 0, results: [], countdown: null })
  
  // List Join State
  const [directJoinMinDelay, setDirectJoinMinDelay] = useState(60)
  const [directJoinMaxDelay, setDirectJoinMaxDelay] = useState(120)
  const [joinProgress, setJoinProgress] = useState<{ current: number; total: number; results: any[]; countdown: number | null }>({ current: 0, total: 0, results: [], countdown: null })

  const [activeTab, setActiveTab] = useState<'groups' | 'channels' | 'search_join'>('groups')
  const [selectedFilters, setSelectedFilters] = useState<string[]>([])
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)

  // Message Viewer State
  const [viewingDialog, setViewingDialog] = useState<any>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [loadingMsg, setLoadingMsg] = useState(false)

  // Scan Security State
  const [scanningDialog, setScanningDialog] = useState<any>(null)
  const [scanResult, setScanResult] = useState<any>(null)
  const [loadingScan, setLoadingScan] = useState(false)

  // Create Chat State
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newChatTitle, setNewChatTitle] = useState('')
  const [newChatAbout, setNewChatAbout] = useState('')
  const [newChatType, setNewChatType] = useState<'group' | 'mega'>('group')
  const [newChatUsers, setNewChatUsers] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  // Moderation State
  const [modDialog, setModDialog] = useState<any>(null)
  const [modTargetUser, setModTargetUser] = useState('')
  const [modAction, setModAction] = useState<'ban' | 'kick' | 'mute' | 'unban'>('ban')
  const [modLoading, setModLoading] = useState(false)

  // Forum Topic State
  const [topicDialog, setTopicDialog] = useState<any>(null)
  const [newTopicTitle, setNewTopicTitle] = useState('')
  const [topicLoading, setTopicLoading] = useState(false)

  // Global Search & Join
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [globalSearchResults, setGlobalSearchResults] = useState<any[]>([])
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [minGlobalMembers, setMinGlobalMembers] = useState<number>(0)
  const [directJoinLink, setDirectJoinLink] = useState('')
  const [directJoinLoading, setDirectJoinLoading] = useState(false)

  // Edit Group Profile States
  const [editGroupDialog, setEditGroupDialog] = useState<any>(null)
  const [editGroupTitle, setEditGroupTitle] = useState('')
  const [editGroupAbout, setEditGroupAbout] = useState('')
  const [editGroupPhotoBase64, setEditGroupPhotoBase64] = useState('')
  const [editGroupLoading, setEditGroupLoading] = useState(false)

  // Member List States
  const [memberListDialog, setMemberListDialog] = useState<any>(null)
  const [members, setMembers] = useState<any[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)

  // Promote Admin States
  const [promoteAdminDialog, setPromoteAdminDialog] = useState<any>(null)
  const [promoteUserId, setPromoteUserId] = useState('')
  const [promoteRank, setPromoteRank] = useState('')
  const [promoteLoading, setPromoteLoading] = useState(false)
  const [promoteRights, setPromoteRights] = useState<any>({
    changeInfo: true,
    postMessages: true,
    editMessages: true,
    deleteMessages: true,
    banUsers: true,
    inviteUsers: true,
    pinMessages: true,
    addAdmins: false
  })

  useEffect(() => { 
    loadAccounts() 
  }, [])

  useEffect(() => {
    setSelectedGroupIds([])
    setJoinProgress({ current: 0, total: 0, results: [], countdown: null })
    setBulkLeaveProgress({ current: 0, total: 0, results: [], countdown: null })
    setBulkScanProgress({ current: 0, total: 0, results: [], countdown: null })
    setBulkSendProgress({ current: 0, total: 0, results: [], countdown: null })
    setSelectedFilters([])
    setShowFilterDropdown(false)
    if (selectedAccId) {
      loadDialogs(selectedAccId)
    } else {
      setDialogs([])
    }
  }, [selectedAccId])

  useEffect(() => {
    setSelectedGroupIds([])
    setJoinProgress({ current: 0, total: 0, results: [], countdown: null })
    setBulkLeaveProgress({ current: 0, total: 0, results: [], countdown: null })
    setBulkScanProgress({ current: 0, total: 0, results: [], countdown: null })
    setBulkSendProgress({ current: 0, total: 0, results: [], countdown: null })
    setSelectedFilters([])
    setShowFilterDropdown(false)
  }, [activeTab])

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

  const handleLeaveGroup = async (dialog: any) => {
    if (!confirm(`Bạn có chắc chắn muốn thoát khỏi ${dialog.isGroup ? 'nhóm' : 'kênh'} "${dialog.title}" không?`)) return;
    
    toast.loading(`Đang thoát ${dialog.title}...`, { id: 'leave' });
    try {
      const res = await telegramApi.leaveGroup(selectedAccId, dialog.id);
      if (res?.success) {
        toast.success(`Đã thoát ${dialog.title}`, { id: 'leave' });
        loadDialogs(selectedAccId);
      } else {
        toast.error(`Lỗi: ${res?.error || 'Không thể thoát'}`, { id: 'leave' });
      }
    } catch (e: any) {
      toast.error(`Lỗi: ${e.message}`, { id: 'leave' });
    }
  }

  const handleCreateChat = async () => {
    if (!selectedAccId || !newChatTitle.trim()) return
    setChatLoading(true)
    try {
      const usersArray = newChatUsers.split(',').map(u => u.trim()).filter(Boolean)
      const isMega = newChatType === 'mega'
      const res = await telegramApi.createChat(selectedAccId, newChatTitle, usersArray, isMega, newChatAbout)
      if (res?.success) {
        toast.success("Tạo nhóm/kênh thành công!")
        setShowCreateModal(false)
        setNewChatTitle('')
        setNewChatAbout('')
        setNewChatUsers('')
        loadDialogs(selectedAccId)
      } else {
        toast.error("Lỗi tạo: " + (res?.error || "Lỗi không xác định"))
      }
    } catch (e: any) {
      toast.error("Lỗi tạo: " + e.message)
    } finally {
      setChatLoading(false)
    }
  }

  const handleEditBanned = async () => {
    if (!selectedAccId || !modDialog || !modTargetUser.trim()) return
    setModLoading(true)
    try {
      const res = await telegramApi.editBanned(selectedAccId, modDialog.id, modTargetUser.trim(), modAction)
      if (res?.success) {
        toast.success(`Đã thực hiện tác vụ ${modAction} thành công!`)
        setModDialog(null)
        setModTargetUser('')
      } else {
        toast.error("Lỗi điều hành: " + (res?.error || "Lỗi không xác định"))
      }
    } catch (e: any) {
      toast.error("Lỗi điều hành: " + e.message)
    } finally {
      setModLoading(false)
    }
  }

  const handleCreateForumTopic = async () => {
    if (!selectedAccId || !topicDialog || !newTopicTitle.trim()) return
    setTopicLoading(true)
    try {
      const res = await telegramApi.createForumTopic(selectedAccId, topicDialog.id, newTopicTitle.trim())
      if (res?.success) {
        toast.success("Tạo Topic mới thành công!")
        setTopicDialog(null)
        setNewTopicTitle('')
      } else {
        toast.error("Lỗi tạo Topic: " + (res?.error || "Lỗi không xác định"))
      }
    } catch (e: any) {
      toast.error("Lỗi tạo Topic: " + e.message)
    } finally {
      setTopicLoading(false)
    }
  }

  const handleGlobalSearch = async (queryOverride?: string) => {
    const q = (queryOverride || globalSearchQuery).trim()
    if (!selectedAccId || !q) return
    setGlobalSearchLoading(true)
    setGlobalSearchResults([])
    try {
      const res = await telegramApi.searchGlobalChats(selectedAccId, q)
      if (res?.success) {
        setGlobalSearchResults(res.chats || [])
      } else {
        toast.error("Lỗi tìm kiếm: " + (res?.error || "Không rõ nguyên nhân"))
      }
    } catch (e: any) {
      toast.error("Lỗi tìm kiếm: " + e.message)
    } finally {
      setGlobalSearchLoading(false)
    }
  }

  const handleJoinChat = async (linkOrUsername: string, isFromSearch = false) => {
    if (!selectedAccId || !linkOrUsername.trim()) return
    if (isFromSearch) toast.loading("Đang tham gia nhóm...", { id: 'join-chat' })
    else setDirectJoinLoading(true)
    
    try {
      const res = await telegramApi.joinChat(selectedAccId, linkOrUsername.trim())
      if (res?.success) {
        toast.success("Tham gia nhóm/kênh thành công!", { id: 'join-chat' })
        if (!isFromSearch) setDirectJoinLink('')
        loadDialogs(selectedAccId)
      } else {
        toast.error("Lỗi tham gia: " + (res?.error || "Không thể tham gia"), { id: 'join-chat' })
      }
    } catch (e: any) {
      toast.error("Lỗi tham gia: " + e.message, { id: 'join-chat' })
    } finally {
      if (!isFromSearch) setDirectJoinLoading(false)
    }
  }

  const sleepWithCountdown = async (seconds: number, onTick: (remaining: number) => void) => {
    let remaining = seconds
    while (remaining > 0) {
      onTick(remaining)
      await new Promise(r => setTimeout(r, 1000))
      remaining--
    }
    onTick(0)
  }

  const handleJoinChatList = async () => {
    if (!selectedAccId || !directJoinLink.trim()) return
    
    const items = directJoinLink.split('\n').map(line => line.trim()).filter(Boolean)
    if (items.length === 0) return
    
    setDirectJoinLoading(true)
    setJoinProgress({ current: 0, total: items.length, results: [], countdown: null })
    
    const tempResults: any[] = []
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      setJoinProgress(prev => ({ ...prev, current: i + 1 }))
      
      try {
        const res = await telegramApi.joinChat(selectedAccId, item)
        tempResults.push({
          target: item,
          success: res?.success,
          error: res?.success ? null : (res?.error || 'Lỗi không rõ')
        })
      } catch (e: any) {
        tempResults.push({
          target: item,
          success: false,
          error: e.message
        })
      }
      
      setJoinProgress(prev => ({ ...prev, results: [...tempResults] }))
      
      if (i < items.length - 1) {
        const min = Number(directJoinMinDelay) || 60
        const max = Number(directJoinMaxDelay) || 120
        const randomSeconds = Math.floor(Math.random() * (max - min + 1)) + min
        
        await sleepWithCountdown(randomSeconds, (remaining) => {
          setJoinProgress(prev => ({ ...prev, countdown: remaining }))
        })
      }
    }
    
    setDirectJoinLoading(false)
    setJoinProgress(prev => ({ ...prev, countdown: null }))
    toast.success("Đã hoàn thành tiến trình tham gia danh sách nhóm!")
    loadDialogs(selectedAccId)
  }

  const handleCopyLink = async (dialog: any) => {
    if (dialog.username) {
      const link = `https://t.me/${dialog.username}`
      navigator.clipboard.writeText(link)
      toast.success(`Đã sao chép link nhóm công khai: ${link}`)
      return
    }

    if (!dialog.isAdmin && !dialog.isCreator) {
      toast.error("Chỉ Admin / Chủ sở hữu mới có quyền lấy link mời của nhóm riêng tư.")
      return
    }

    setFetchingLinkId(dialog.id)
    try {
      const res = await telegramApi.getInviteLink(selectedAccId, dialog.id)
      if (res?.success && res.link) {
        navigator.clipboard.writeText(res.link)
        toast.success("Đã lấy và sao chép link mời nhóm riêng tư vào Clipboard!")
      } else {
        toast.error(res?.error || "Không thể lấy link mời.")
      }
    } catch (e: any) {
      toast.error("Lỗi: " + e.message)
    } finally {
      setFetchingLinkId(null)
    }
  }

  const handleBulkCopyLinks = async () => {
    if (!selectedGroupIds.length) return
    
    toast.loading("Đang thu thập link các nhóm...", { id: 'bulk-copy-links' })
    const links: string[] = []
    let successCount = 0
    let failCount = 0
    
    for (const groupId of selectedGroupIds) {
      const dialog = dialogs.find(d => d.id === groupId)
      if (!dialog) continue
      
      if (dialog.username) {
        links.push(`https://t.me/${dialog.username}`)
        successCount++
      } else {
        if (dialog.isAdmin || dialog.isCreator) {
          try {
            const res = await telegramApi.getInviteLink(selectedAccId, dialog.id)
            if (res?.success && res.link) {
              links.push(res.link)
              successCount++
            } else {
              links.push(`[Không lấy được link private ID: ${dialog.id}]`)
              failCount++
            }
          } catch (e) {
            links.push(`[Lỗi lấy link private ID: ${dialog.id}]`)
            failCount++
          }
          await new Promise(r => setTimeout(r, 200))
        } else {
          links.push(`[Nhóm riêng tư, không có quyền admin để lấy link ID: ${dialog.id}]`)
          failCount++
        }
      }
    }
    
    if (links.length > 0) {
      const textToCopy = links.join('\n')
      navigator.clipboard.writeText(textToCopy)
      toast.success(
        `Đã sao chép ${successCount} link vào Clipboard.${failCount > 0 ? ` Thất bại ${failCount} nhóm riêng tư.` : ''}`, 
        { id: 'bulk-copy-links' }
      )
    } else {
      toast.error("Không có link nào được sao chép.", { id: 'bulk-copy-links' })
    }
  }

  const toggleSelectGroup = (groupId: string) => {
    setSelectedGroupIds(prev => 
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    )
  }

  const handleToggleSelectAll = () => {
    if (selectedGroupIds.length === itemsToRender.length) {
      setSelectedGroupIds([])
    } else {
      setSelectedGroupIds(itemsToRender.map(d => d.id))
    }
  }

  const handleBulkLeave = async () => {
    if (!selectedGroupIds.length) return
    setLeavingBulk(true)
    const total = selectedGroupIds.length
    setBulkLeaveProgress({ current: 0, total, results: [], countdown: null })
    
    const tempResults: any[] = []
    for (let i = 0; i < total; i++) {
      const groupId = selectedGroupIds[i]
      const dialog = dialogs.find(d => d.id === groupId)
      setBulkLeaveProgress(prev => ({ ...prev, current: i + 1 }))
      
      try {
        const res = await telegramApi.leaveGroup(selectedAccId, groupId)
        tempResults.push({
          id: groupId,
          title: dialog?.title || 'Unknown',
          success: res?.success,
          error: res?.success ? null : (res?.error || 'Không thoát được')
        })
      } catch (e: any) {
        tempResults.push({
          id: groupId,
          title: dialog?.title || 'Unknown',
          success: false,
          error: e.message
        })
      }
      
      setBulkLeaveProgress(prev => ({ ...prev, results: [...tempResults] }))
      
      if (i < total - 1) {
        const min = Number(bulkLeaveMinDelay) || 60
        const max = Number(bulkLeaveMaxDelay) || 120
        const randomSeconds = Math.floor(Math.random() * (max - min + 1)) + min
        
        await sleepWithCountdown(randomSeconds, (remaining) => {
          setBulkLeaveProgress(prev => ({ ...prev, countdown: remaining }))
        })
      }
    }
    
    setLeavingBulk(false)
    setBulkLeaveProgress(prev => ({ ...prev, countdown: null }))
    toast.success("Đã hoàn thành tiến trình thoát nhóm hàng loạt!")
    setSelectedGroupIds([])
    loadDialogs(selectedAccId)
  }

  const handleBulkScan = async () => {
    if (!selectedGroupIds.length) return
    setScanningBulk(true)
    const total = selectedGroupIds.length
    setBulkScanProgress({ current: 0, total, results: [], countdown: null })
    
    const tempResults: any[] = []
    for (let i = 0; i < total; i++) {
      const groupId = selectedGroupIds[i]
      const dialog = dialogs.find(d => d.id === groupId)
      setBulkScanProgress(prev => ({ ...prev, current: i + 1 }))
      
      try {
        const res = await telegramApi.scanGroupSecurity(selectedAccId, groupId)
        const reasons: string[] = []
        let status = 'SAFE'
        
        if (res?.success) {
          if (res.adminBots && res.adminBots.length > 0) {
            status = 'WARNING'
            reasons.push(`Phát hiện ${res.adminBots.length} Bot quản trị: ${res.adminBots.join(', ')} (Có thể là Anti-Spam Bot)`)
          }
          if (dialog?.defaultBannedRights) {
            const r = dialog.defaultBannedRights
            if (r.sendMessages) {
              status = 'ERROR'
              reasons.push('Nhóm cấm gửi tin nhắn (Tắt tiếng toàn bộ)')
            } else {
              if (r.sendMedia) {
                if (status === 'SAFE') status = 'WARNING'
                reasons.push('Nhóm cấm gửi Media')
              }
              if (r.embedLinks) {
                if (status === 'SAFE') status = 'WARNING'
                reasons.push('Nhóm cấm hiển thị Link Preview')
              }
              if (r.sendInline) {
                if (status === 'SAFE') status = 'WARNING'
                reasons.push('Nhóm cấm Bot Inline')
              }
            }
          }
        } else {
          status = 'ERROR'
          reasons.push(res?.error || 'Lỗi quét bảo mật')
        }

        tempResults.push({
          id: groupId,
          title: dialog?.title || 'Unknown',
          success: res?.success,
          status,
          reasons
        })
      } catch (e: any) {
        tempResults.push({
          id: groupId,
          title: dialog?.title || 'Unknown',
          success: false,
          status: 'ERROR',
          reasons: [e.message]
        })
      }
      
      setBulkScanProgress(prev => ({ ...prev, results: [...tempResults] }))
      
      if (i < total - 1) {
        const min = Number(bulkScanMinDelay) || 2
        const max = Number(bulkScanMaxDelay) || 5
        const randomSeconds = Math.floor(Math.random() * (max - min + 1)) + min
        
        await sleepWithCountdown(randomSeconds, (remaining) => {
          setBulkScanProgress(prev => ({ ...prev, countdown: remaining }))
        })
      }
    }
    
    setScanningBulk(false)
    setBulkScanProgress(prev => ({ ...prev, countdown: null }))
  }

  const handleBulkCreateCampaign = () => {
    if (!selectedGroupIds.length) return
    const selectedTargets = selectedGroupIds.map(id => {
      const d = dialogs.find(dialog => dialog.id === id)
      return {
        chatId: id,
        name: d?.title || 'Unknown',
        isChannel: !!d?.isChannel,
        isForum: !!d?.isForum
      }
    })
    const targetQuery = encodeURIComponent(JSON.stringify(selectedTargets))
    router.push(`/autopost?acc=${selectedAccId}&prefilledTargets=${targetQuery}`)
  }

  const handleBulkSend = async () => {
    if (!bulkSendMessage.trim() || !selectedGroupIds.length) return
    setSendingBulkMsg(true)
    const total = selectedGroupIds.length
    setBulkSendProgress({ current: 0, total, results: [], countdown: null })
    
    const tempResults: any[] = []
    for (let i = 0; i < total; i++) {
      const groupId = selectedGroupIds[i]
      const dialog = dialogs.find(d => d.id === groupId)
      setBulkSendProgress(prev => ({ ...prev, current: i + 1 }))
      
      try {
        const res = await telegramApi.executeQuickAction(selectedAccId, groupId, 'send_text', {
          message: bulkSendMessage,
          parseMode: 'html'
        })
        tempResults.push({
          id: groupId,
          title: dialog?.title || 'Unknown',
          success: res?.success,
          error: res?.success ? null : (res?.error || 'Không gửi được')
        })
      } catch (e: any) {
        tempResults.push({
          id: groupId,
          title: dialog?.title || 'Unknown',
          success: false,
          error: e.message
        })
      }
      setBulkSendProgress(prev => ({ ...prev, results: [...tempResults] }))
      
      if (i < total - 1) {
        const min = Number(bulkSendMinDelay) || 60
        const max = Number(bulkSendMaxDelay) || 120
        const randomSeconds = Math.floor(Math.random() * (max - min + 1)) + min
        
        await sleepWithCountdown(randomSeconds, (remaining) => {
          setBulkSendProgress(prev => ({ ...prev, countdown: remaining }))
        })
      }
    }
    setSendingBulkMsg(false)
    setBulkSendProgress(prev => ({ ...prev, countdown: null }))
    toast.success("Đã hoàn thành gửi tin nhắn hàng loạt!")
    setSelectedGroupIds([])
  }

  const handleOpenEditGroup = (dialog: any) => {
    setEditGroupDialog(dialog)
    setEditGroupTitle(dialog.title || '')
    setEditGroupAbout('')
    setEditGroupPhotoBase64('')
  }

  const handleEditGroupPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return
    const file = e.target.files[0]
    const reader = new FileReader()
    reader.onload = () => {
      setEditGroupPhotoBase64(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleUpdateGroupProfile = async () => {
    if (!selectedAccId || !editGroupDialog) return
    setEditGroupLoading(true)
    try {
      const res = await telegramApi.updateGroupProfile(selectedAccId, editGroupDialog.id, {
        title: editGroupTitle,
        about: editGroupAbout || undefined,
        base64Photo: editGroupPhotoBase64 || undefined
      })
      if (res?.success) {
        toast.success("Cập nhật thông tin nhóm thành công!")
        setEditGroupDialog(null)
        loadDialogs(selectedAccId)
      } else {
        toast.error("Lỗi cập nhật: " + (res?.error || "Không rõ nguyên nhân"))
      }
    } catch (e: any) {
      toast.error("Lỗi: " + e.message)
    } finally {
      setEditGroupLoading(false)
    }
  }

  const handleOpenMemberList = async (dialog: any) => {
    setMemberListDialog(dialog)
    setLoadingMembers(true)
    setMembers([])
    try {
      const res = await telegramApi.getParticipants(selectedAccId, dialog.id)
      if (res?.success) {
        setMembers(res.participants || [])
      } else {
        toast.error("Không thể tải danh sách thành viên: " + (res?.error || ""))
      }
    } catch (e: any) {
      toast.error("Lỗi tải thành viên: " + e.message)
    } finally {
      setLoadingMembers(false)
    }
  }

  const handleOpenPromote = (dialog: any, userId = '') => {
    setPromoteAdminDialog(dialog)
    setPromoteUserId(userId)
    setPromoteRank('')
    setPromoteRights({
      changeInfo: true,
      postMessages: !dialog.isGroup,
      editMessages: !dialog.isGroup,
      deleteMessages: true,
      banUsers: true,
      inviteUsers: true,
      pinMessages: true,
      addAdmins: false
    })
  }

  const handlePromoteAdmin = async () => {
    if (!selectedAccId || !promoteAdminDialog || !promoteUserId.trim()) return
    setPromoteLoading(true)
    try {
      const res = await telegramApi.editAdmin(
        selectedAccId,
        promoteAdminDialog.id,
        promoteUserId.trim(),
        promoteRights,
        promoteRank
      )
      if (res?.success) {
        toast.success(`Đã bổ nhiệm quản trị viên thành công!`)
        setPromoteAdminDialog(null)
        setPromoteUserId('')
        if (memberListDialog && memberListDialog.id === promoteAdminDialog.id) {
          handleOpenMemberList(memberListDialog)
        }
      } else {
        toast.error("Lỗi bổ nhiệm: " + (res?.error || "Không rõ nguyên nhân"))
      }
    } catch (e: any) {
      toast.error("Lỗi: " + e.message)
    } finally {
      setPromoteLoading(false)
    }
  }

  const [searchQuery, setSearchQuery] = useState('')

  const filteredDialogs = dialogs.filter(d => {
    const matchesSearch = !searchQuery || 
      d.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (d.username && d.username.toLowerCase().includes(searchQuery.toLowerCase()))
      
    if (!matchesSearch) return false

    for (const filter of selectedFilters) {
      if (filter === 'can_send' && d.defaultBannedRights?.sendMessages) return false
      if (filter === 'no_send' && !d.defaultBannedRights?.sendMessages) return false
      if (filter === 'no_media' && !d.defaultBannedRights?.sendMedia && !d.defaultBannedRights?.sendMessages) return false
      if (filter === 'no_links' && !d.defaultBannedRights?.embedLinks && !d.defaultBannedRights?.sendMessages) return false
      if (filter === 'no_inline' && !d.defaultBannedRights?.sendInline && !d.defaultBannedRights?.sendMessages) return false
      if (filter === 'public' && !d.username) return false
      if (filter === 'private' && d.username) return false
      if (filter === 'admin' && !d.isAdmin && !d.isCreator) return false
    }

    return true
  })

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
        
        <div className="flex items-center gap-3">
          <div className="min-w-[220px]">
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
          {selectedAccId && (
            <button 
              onClick={() => setShowCreateModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 shadow-sm shrink-0"
            >
              <Plus className="w-4 h-4" /> Tạo Nhóm/Kênh
            </button>
          )}
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
              <button
                onClick={() => setActiveTab('search_join')}
                className={`flex items-center gap-2 py-3 px-6 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'search_join' 
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50' 
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Search className="w-4 h-4" /> Tìm & Tham gia nhóm
              </button>
            </div>
            <div className="pb-2 md:pb-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              {activeTab !== 'search_join' && (
                <div className="relative">
                  <button
                    onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                    className="p-2 py-2.5 bg-white border border-gray-300 rounded-lg text-sm shadow-sm hover:bg-gray-50 flex items-center gap-1.5 font-medium cursor-pointer transition-colors"
                  >
                    <span>🔍 Lọc bảo mật ({selectedFilters.length})</span>
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  </button>

                  {showFilterDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowFilterDropdown(false)} />
                      
                      <div className="absolute right-0 sm:left-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-20 py-2.5">
                        <div className="px-3 pb-2 mb-2 border-b flex justify-between items-center">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Chọn bộ lọc</span>
                          {selectedFilters.length > 0 && (
                            <button
                              onClick={() => setSelectedFilters([])}
                              className="text-[10px] font-bold text-red-600 hover:text-red-700"
                            >
                              Xóa hết
                            </button>
                          )}
                        </div>
                        <div className="space-y-1 px-1">
                          {[
                            { value: 'can_send', label: 'Cho phép gửi tin' },
                            { value: 'no_send', label: 'Cấm Chat (Tắt tiếng)' },
                            { value: 'no_media', label: 'Cấm gửi Media' },
                            { value: 'no_links', label: 'Cấm gửi Links' },
                            { value: 'no_inline', label: 'Cấm Bot Inline' },
                            { value: 'public', label: 'Nhóm công khai (Public)' },
                            { value: 'private', label: 'Nhóm riêng tư (Private)' },
                            { value: 'admin', label: 'Tôi là Admin/Owner' }
                          ].map((option) => {
                            const isChecked = selectedFilters.includes(option.value)
                            return (
                              <label
                                key={option.value}
                                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                                  isChecked ? 'bg-blue-50/70 text-blue-700 font-semibold' : 'hover:bg-gray-50 text-gray-700'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    setSelectedFilters(prev =>
                                      prev.includes(option.value)
                                        ? prev.filter(v => v !== option.value)
                                        : [...prev, option.value]
                                    )
                                  }}
                                  className="w-3.5 h-3.5 rounded text-blue-600 border-gray-300 focus:ring-blue-500 cursor-pointer"
                                />
                                <span>{option.label}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="text-gray-400 w-4 h-4" />
                </div>
                <input
                  type="text"
                  placeholder="Tìm kiếm nhóm/kênh..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full md:w-56 pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Chọn Tất Cả Bar */}
          {activeTab !== 'search_join' && itemsToRender.length > 0 && (
            <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 mb-4 shadow-sm fade-in">
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={itemsToRender.length > 0 && selectedGroupIds.length === itemsToRender.length}
                  onChange={handleToggleSelectAll}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                />
                <span>Chọn tất cả ({itemsToRender.length} {activeTab === 'groups' ? 'nhóm' : 'kênh'})</span>
              </label>
              {selectedGroupIds.length > 0 && (
                <span className="text-xs text-blue-600 font-bold bg-blue-50 border border-blue-100 px-2.5 py-0.5 rounded-full animate-pulse">
                  Đang chọn {selectedGroupIds.length} mục
                </span>
              )}
            </div>
          )}

          {/* List Content */}
          {activeTab === 'search_join' ? (
            <div className="space-y-6">
              {/* Direct Join Link Card */}
              <Card className="p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Tham gia nhóm bằng Link / Username</h3>
                  <p className="text-xs text-gray-500 mt-1">Dán danh sách các link mời hoặc username (mỗi dòng 1 mục) để tham gia hàng loạt.</p>
                </div>
                <div className="space-y-3">
                  <textarea 
                    value={directJoinLink} 
                    onChange={e => setDirectJoinLink(e.target.value)}
                    placeholder="VD:&#10;@username_nhom1&#10;t.me/joinchat/...&#10;@username_nhom2"
                    rows={4}
                    disabled={directJoinLoading}
                    className="w-full p-3 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-none shadow-sm"
                  />

                  {/* Delay Settings */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Delay tối thiểu (giây)</label>
                      <input
                        type="number"
                        min={1}
                        value={directJoinMinDelay}
                        disabled={directJoinLoading}
                        onChange={e => setDirectJoinMinDelay(Math.max(1, parseInt(e.target.value) || 0))}
                        className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Delay tối đa (giây)</label>
                      <input
                        type="number"
                        min={1}
                        value={directJoinMaxDelay}
                        disabled={directJoinLoading}
                        onChange={e => setDirectJoinMaxDelay(Math.max(1, parseInt(e.target.value) || 0))}
                        className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button 
                      onClick={handleJoinChatList}
                      disabled={directJoinLoading || !directJoinLink.trim()}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2 shadow-sm transition-all"
                    >
                      {directJoinLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Đang tham gia...</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          <span>Tham gia danh sách</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Join Progress & logs */}
                  {joinProgress.total > 0 && (
                    <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
                      <div className="flex justify-between items-center text-xs font-semibold text-gray-700">
                        <span>Tiến trình: {joinProgress.current} / {joinProgress.total}</span>
                        {joinProgress.countdown !== null && (
                          <span className="text-amber-600 animate-pulse flex items-center gap-1.5 font-bold">
                            <Clock className="w-3.5 h-3.5" /> Nghỉ ngơi: {joinProgress.countdown}s
                          </span>
                        )}
                      </div>
                      
                      {/* Progress Bar */}
                      <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${(joinProgress.current / joinProgress.total) * 100}%` }}
                        />
                      </div>

                      {/* Results Log */}
                      <div className="max-h-36 overflow-y-auto space-y-1.5 border border-gray-100 rounded-lg p-3 bg-gray-50/50">
                        {joinProgress.results.map((r, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs gap-3">
                            <span className="font-mono text-gray-600 truncate max-w-[65%]">{r.target}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                              r.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'
                            }`}>
                              {r.success ? 'Thành công' : r.error?.includes('USER_ALREADY_PARTICIPANT') ? 'Đã tham gia' : 'Lỗi'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* Global Search Card */}
              <Card className="p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Tìm kiếm nhóm công khai toàn cầu</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Tìm kiếm các nhóm và kênh công khai trên hệ thống Telegram bằng từ khóa.
                  </p>
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                    ⚠️ <strong>Lưu ý:</strong> Telegram API chỉ trả về tối đa 5-10 kết quả phù hợp nhất cho mỗi từ khóa. Nếu bạn đặt số thành viên tối thiểu quá lớn, các kết quả này có thể bị ẩn hết.
                  </p>
                </div>
                <div className="flex gap-3 flex-wrap md:flex-nowrap">
                  <input 
                    value={globalSearchQuery} 
                    onChange={e => setGlobalSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleGlobalSearch()}
                    placeholder="VD: MMO, Crypto, Kiếm tiền online..."
                    className="flex-1 min-w-[200px] p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input 
                    type="number"
                    value={minGlobalMembers || ''} 
                    onChange={e => setMinGlobalMembers(Math.max(0, parseInt(e.target.value) || 0))}
                    placeholder="Số TV tối thiểu (VD: 1000)..."
                    className="w-full md:w-56 p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button 
                    onClick={() => handleGlobalSearch()}
                    disabled={globalSearchLoading || !globalSearchQuery.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 shrink-0"
                  >
                    {globalSearchLoading ? 'Đang tìm...' : 'Tìm kiếm'}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-1 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Từ khóa quốc tế gợi ý:</span>
                  {[
                    'gmail bulk', 'bulk accounts', 'netflix wholesale', 
                    'premium accounts', 'dropship supplier', 'replica wholesale', 
                    'telegram member', 'socks5 wholesale'
                  ].map(kw => (
                    <button
                      key={kw}
                      type="button"
                      onClick={() => {
                        setGlobalSearchQuery(kw);
                        handleGlobalSearch(kw);
                      }}
                      className="text-xs bg-white hover:bg-blue-50 hover:text-blue-600 border border-gray-200 hover:border-blue-300 px-2.5 py-1 rounded-full transition-all cursor-pointer font-medium"
                    >
                      {kw}
                    </button>
                  ))}
                </div>

                {/* Results Table */}
                <div className="border rounded-xl divide-y overflow-hidden bg-white">
                  {globalSearchLoading ? (
                    <div className="py-12 text-center text-sm text-gray-500">Đang tìm kiếm nhóm toàn cầu...</div>
                  ) : globalSearchResults.filter((chat: any) => !minGlobalMembers || (chat.participantsCount && chat.participantsCount >= minGlobalMembers)).length === 0 ? (
                    <div className="py-12 text-center text-sm text-gray-500">
                      {globalSearchQuery 
                        ? `Không tìm thấy nhóm nào có trên ${minGlobalMembers.toLocaleString()} thành viên khớp với từ khóa` 
                        : 'Nhập từ khóa và bấm tìm kiếm'}
                    </div>
                  ) : (
                    globalSearchResults
                      .filter((chat: any) => !minGlobalMembers || (chat.participantsCount && chat.participantsCount >= minGlobalMembers))
                      .map((chat: any) => {
                        const isAlreadyJoined = dialogs.some(d => {
                          const cleanDialogId = d.id.replace(/^-100/, '');
                          const cleanChatId = chat.id.replace(/^-100/, '');
                          const idMatch = cleanDialogId === cleanChatId;
                          const usernameMatch = chat.username && d.username && 
                            chat.username.toLowerCase() === d.username.toLowerCase();
                          return idMatch || usernameMatch;
                        });

                        return (
                          <div key={chat.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${chat.type === 'Channel' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                                {chat.title ? chat.title[0] : '?'}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-gray-900">{chat.title}</p>
                                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${chat.type === 'Channel' ? 'bg-purple-50 text-purple-700 border border-purple-100' : 'bg-blue-50 text-blue-700 border border-blue-100'}`}>
                                    {chat.type}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {chat.username ? `@${chat.username}` : 'Private'} {chat.participantsCount ? `| ${chat.participantsCount.toLocaleString()} thành viên` : ''}
                                </p>
                              </div>
                            </div>
                            {isAlreadyJoined ? (
                              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm">
                                <CheckCircle2 className="w-3.5 h-3.5 animate-pulse" /> Đã tham gia
                              </span>
                            ) : (
                              <button 
                                onClick={() => handleJoinChat(chat.username || chat.id, true)}
                                className="bg-gray-100 hover:bg-blue-600 hover:text-white border text-gray-700 px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm"
                              >
                                Tham gia
                              </button>
                            )}
                          </div>
                        );
                      })
                  )}
                </div>
              </Card>
            </div>
          ) : loading ? (
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
                  <Card key={dialog.id} className={`overflow-hidden hover:shadow-md transition-all flex flex-col h-full border ${
                    selectedGroupIds.includes(dialog.id) ? 'border-blue-500 bg-blue-50/5' : 'border-gray-200'
                  }`}>
                    <div className="p-5 flex-1">
                      <div className="flex gap-4">
                        {/* Checkbox chọn hàng loạt */}
                        <div className="flex items-center shrink-0">
                          <input
                            type="checkbox"
                            checked={selectedGroupIds.includes(dialog.id)}
                            onChange={() => toggleSelectGroup(dialog.id)}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <TelegramAvatar
                          accountId={selectedAccId}
                          peerId={dialog.id}
                          title={dialog.title}
                          isGroup={dialog.isGroup}
                          className="shrink-0 w-12 h-12 rounded-full overflow-hidden text-xl"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <h3 className="font-bold text-gray-900 truncate" title={dialog.title}>
                              {dialog.title}
                            </h3>
                            {(dialog.isAdmin || dialog.isCreator) && (
                              <button 
                                onClick={() => handleOpenEditGroup(dialog)}
                                className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-blue-600 transition-colors shrink-0"
                                title="Chỉnh sửa thông tin nhóm"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
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
                        
                        {/* Group/Channel Link Info */}
                        <div className="flex justify-between items-center border-t border-gray-200/60 pt-1.5 mt-1.5">
                          <span>Đường dẫn:</span>
                          {dialog.username ? (
                            <div className="flex items-center gap-1 min-w-0">
                              <a 
                                href={`https://t.me/${dialog.username}`} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="font-medium text-blue-600 hover:underline truncate max-w-[120px] flex items-center gap-0.5"
                                title={`Mở link https://t.me/${dialog.username}`}
                              >
                                t.me/{dialog.username}
                                <ExternalLink className="w-2.5 h-2.5 inline-block shrink-0" />
                              </a>
                              <button
                                onClick={() => handleCopyLink(dialog)}
                                className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-blue-600 transition-colors shrink-0"
                                title="Sao chép link công khai"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              {dialog.isAdmin || dialog.isCreator ? (
                                <button
                                  onClick={() => handleCopyLink(dialog)}
                                  disabled={fetchingLinkId === dialog.id}
                                  className="text-[10px] px-1.5 py-0.5 rounded font-medium border bg-white text-gray-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-all flex items-center gap-1 active:scale-95 disabled:opacity-50"
                                  title="Lấy link mời riêng tư"
                                >
                                  {fetchingLinkId === dialog.id ? (
                                    <>
                                      <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                                      <span>Đang lấy...</span>
                                    </>
                                  ) : (
                                    <>
                                      <Link2 className="w-3 h-3 text-blue-600" />
                                      <span>Lấy Link Mời</span>
                                    </>
                                  )}
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 bg-gray-100 text-gray-500 text-[10px] px-1.5 py-0.5 rounded font-medium cursor-not-allowed" title="Nhóm riêng tư, chỉ quản trị viên mới lấy được link mời">
                                  <Lock className="w-2.5 h-2.5" /> Riêng tư
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="border-t bg-gray-50/80 p-3 flex flex-col gap-2 mt-auto">
                      <div className="grid grid-cols-4 gap-1.5">
                        <button 
                          onClick={() => handleViewMessages(dialog)}
                          className="flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                          title="Xem bài đăng"
                        >
                          <Eye className="w-3.5 h-3.5" /> <span>Xem</span>
                        </button>
                        
                        <Link 
                          href={`/autopost?target=${dialog.id}&acc=${selectedAccId}`}
                          className="flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium text-gray-700 bg-gray-200/80 hover:bg-gray-300 transition-colors text-center"
                          title="Đăng bài mới"
                        >
                          <Edit className="w-3.5 h-3.5" /> <span>Đăng</span>
                        </Link>

                        <button 
                          onClick={() => handleScanSecurity(dialog)}
                          className="flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium text-amber-700 bg-amber-100/80 hover:bg-amber-200 transition-colors"
                          title="Quét rủi ro"
                        >
                          <ShieldAlert className="w-3.5 h-3.5" /> <span>Quét</span>
                        </button>

                        <button 
                          onClick={() => handleLeaveGroup(dialog)}
                          className="flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium text-red-700 bg-red-100/80 hover:bg-red-200 transition-colors"
                          title="Thoát nhóm"
                        >
                          <LogOut className="w-3.5 h-3.5" /> <span>Thoát</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        {(dialog.isAdmin || dialog.isCreator) && (
                          <>
                            <button 
                              onClick={() => setModDialog(dialog)}
                              className="flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium text-purple-700 bg-purple-100/80 hover:bg-purple-200 transition-colors"
                              title="Quản lý thành viên (Ban/Kick/Mute)"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" /> <span>Điều hành</span>
                            </button>
                            <button 
                              onClick={() => handleOpenMemberList(dialog)}
                              className="flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium text-indigo-700 bg-indigo-100/80 hover:bg-indigo-200 transition-colors"
                              title="Xem thành viên & Phong Admin"
                            >
                              <Users2 className="w-3.5 h-3.5" /> <span>Thành viên</span>
                            </button>
                          </>
                        )}
                        {dialog.isForum && (
                          <button 
                            onClick={() => setTopicDialog(dialog)}
                            className="flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium text-teal-700 bg-teal-100/80 hover:bg-teal-200 transition-colors"
                            title="Tạo Topic Forum"
                          >
                            <PlusCircle className="w-3.5 h-3.5" /> <span>Tạo Topic</span>
                          </button>
                        )}
                      </div>
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
      {/* Create Chat Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 fade-in">
          <Card className="w-full max-w-md p-6 bg-white shadow-xl relative">
            <button 
              onClick={() => setShowCreateModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Tạo nhóm/kênh mới</h2>
            <p className="text-sm text-gray-500 mb-5">Khởi tạo Supergroup diễn đàn hoặc Kênh phát sóng.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Loại hội nhóm</label>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => setNewChatType('group')}
                    className={`py-2 px-4 rounded-lg text-xs font-semibold border transition-all ${newChatType === 'group' ? 'bg-blue-50 border-blue-500 text-blue-600' : 'bg-white border-gray-200 text-gray-600'}`}
                  >
                    Nhóm thường (Basic Chat)
                  </button>
                  <button 
                    onClick={() => setNewChatType('mega')}
                    className={`py-2 px-4 rounded-lg text-xs font-semibold border transition-all ${newChatType === 'mega' ? 'bg-blue-50 border-blue-500 text-blue-600' : 'bg-white border-gray-200 text-gray-600'}`}
                  >
                    Siêu nhóm / Kênh (Megagroup)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tên Nhóm / Kênh</label>
                <input 
                  value={newChatTitle} onChange={e => setNewChatTitle(e.target.value)}
                  placeholder="Tên hội nhóm..."
                  className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả (About)</label>
                <input 
                  value={newChatAbout} onChange={e => setNewChatAbout(e.target.value)}
                  placeholder="Mô tả ngắn..."
                  className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mời thành viên (Usernames)</label>
                <input 
                  value={newChatUsers} onChange={e => setNewChatUsers(e.target.value)}
                  placeholder="VD: user1, user2, user3 (cách nhau bằng dấu phẩy)"
                  className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none font-mono text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button 
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Hủy
                </button>
                <button 
                  onClick={handleCreateChat} disabled={chatLoading || !newChatTitle}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {chatLoading ? 'Đang tạo...' : 'Tạo mới'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Moderation Modal */}
      {modDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 fade-in">
          <Card className="w-full max-w-md p-6 bg-white shadow-xl relative">
            <button 
              onClick={() => setModDialog(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Quản lý thành viên</h2>
            <p className="text-sm text-gray-500 mb-5">Điều hành hành vi trong nhóm: <span className="font-semibold text-blue-600">{modDialog.title}</span></p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hành động điều hành</label>
                <select 
                  value={modAction} 
                  onChange={e => setModAction(e.target.value as any)}
                  className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none"
                >
                  <option value="ban">Ban (Cấm hoàn toàn khỏi nhóm)</option>
                  <option value="kick">Kick (Trục xuất khỏi nhóm)</option>
                  <option value="mute">Mute (Tắt tiếng / Cấm chat)</option>
                  <option value="unban">Mở khóa (Unban / Unmute)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tài khoản đích (Username hoặc ID)</label>
                <input 
                  value={modTargetUser} onChange={e => setModTargetUser(e.target.value)}
                  placeholder="VD: @username hoặc 12345678"
                  className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button 
                  onClick={() => setModDialog(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Hủy
                </button>
                <button 
                  onClick={handleEditBanned} disabled={modLoading || !modTargetUser}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {modLoading ? 'Đang xử lý...' : 'Thực thi'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Forum Topic Modal */}
      {topicDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 fade-in">
          <Card className="w-full max-w-md p-6 bg-white shadow-xl relative">
            <button 
              onClick={() => setTopicDialog(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Tạo Chủ đề mới (Forum Topic)</h2>
            <p className="text-sm text-gray-500 mb-5">Thêm một chuyên mục thảo luận mới trong diễn đàn: <span className="font-semibold text-blue-600">{topicDialog.title}</span></p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tiêu đề Topic</label>
                <input 
                  value={newTopicTitle} onChange={e => setNewTopicTitle(e.target.value)}
                  placeholder="VD: 💬 Phòng hỏi đáp..."
                  className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button 
                  onClick={() => setTopicDialog(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Hủy
                </button>
                <button 
                  onClick={handleCreateForumTopic} disabled={topicLoading || !newTopicTitle}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {topicLoading ? 'Đang tạo...' : 'Tạo Topic'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Chỉnh sửa thông tin nhóm Modal */}
      {editGroupDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 fade-in">
          <Card className="w-full max-w-md p-6 bg-white shadow-xl relative">
            <button 
              onClick={() => setEditGroupDialog(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Chỉnh sửa thông tin nhóm</h2>
            <p className="text-sm text-gray-500 mb-5">Thay đổi tiêu đề, mô tả và ảnh đại diện nhóm.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tiêu đề nhóm/kênh</label>
                <input 
                  value={editGroupTitle} onChange={e => setEditGroupTitle(e.target.value)}
                  placeholder="Tiêu đề mới..."
                  className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả nhóm/kênh (About)</label>
                <textarea 
                  value={editGroupAbout} onChange={e => setEditGroupAbout(e.target.value)}
                  placeholder="Gõ mô tả/tiểu sử mới..."
                  className="w-full h-24 p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ảnh đại diện nhóm mới</label>
                <div className="flex items-center gap-4">
                  <label className="cursor-pointer bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm">
                    <ImageIcon className="w-3.5 h-3.5 text-gray-500" />
                    {editGroupPhotoBase64 ? 'Chọn lại ảnh khác' : 'Chọn hình ảnh đại diện'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleEditGroupPhotoSelect} />
                  </label>
                  {editGroupPhotoBase64 && (
                    <div className="w-12 h-12 rounded-full border overflow-hidden shrink-0 shadow-sm relative group">
                      <img src={editGroupPhotoBase64} alt="avatar preview" className="w-full h-full object-cover" />
                      <button onClick={() => setEditGroupPhotoBase64('')} className="absolute inset-0 bg-black/60 text-white text-[9px] font-bold opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">Xóa</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button 
                  onClick={() => setEditGroupDialog(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Hủy
                </button>
                <button 
                  onClick={handleUpdateGroupProfile} disabled={editGroupLoading || !editGroupTitle.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {editGroupLoading ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Danh sách thành viên Modal */}
      {memberListDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 fade-in">
          <Card className="w-full max-w-lg bg-white shadow-xl rounded-xl overflow-hidden flex flex-col max-h-[85vh] relative">
            <div className="p-6 border-b flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-xl font-bold text-gray-900 leading-tight">Danh sách thành viên</h2>
                <p className="text-xs text-gray-500 mt-1">Danh sách thành viên trong nhóm: <span className="font-semibold text-blue-600">{memberListDialog.title}</span></p>
              </div>
              <button 
                onClick={() => setMemberListDialog(null)}
                className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3 min-h-[250px]">
              {loadingMembers ? (
                <div className="py-20 flex justify-center items-center">
                  <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : members.length === 0 ? (
                <div className="py-16 text-center text-gray-500 bg-gray-50 rounded-xl border border-dashed">
                  Không tìm thấy thành viên nào hoặc không có quyền truy cập danh sách.
                </div>
              ) : (
                members.map((member: any) => (
                  <div key={member.id} className="flex items-center justify-between p-3 border rounded-xl bg-gray-50 hover:bg-white hover:shadow-sm transition-all">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">
                        {member.firstName ? member.firstName[0] : '?'}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-gray-900">{member.firstName} {member.lastName}</p>
                          {member.bot && (
                            <span className="bg-purple-100 text-purple-700 text-[9px] font-bold px-1.5 py-0.5 rounded">BOT</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 font-mono">
                          {member.username ? `@${member.username}` : `ID: ${member.id}`}
                        </p>
                      </div>
                    </div>

                    {(memberListDialog.isCreator || memberListDialog.isAdmin) && !member.bot && (
                      <button
                        onClick={() => handleOpenPromote(memberListDialog, member.username || member.id)}
                        className="bg-blue-50 hover:bg-blue-600 hover:text-white border border-blue-100 text-blue-700 font-semibold px-3 py-1.5 rounded-lg text-[10px] transition-all"
                      >
                        Bổ nhiệm Admin
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t bg-gray-50 shrink-0 flex justify-end">
              <button 
                onClick={() => setMemberListDialog(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
              >
                Đóng
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Bổ nhiệm Admin Modal */}
      {promoteAdminDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 fade-in">
          <Card className="w-full max-w-md p-6 bg-white shadow-2xl relative">
            <button 
              onClick={() => setPromoteAdminDialog(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-900 mb-1 flex items-center gap-2">
              <Crown className="w-5 h-5 text-yellow-500" /> Bổ nhiệm Quản trị viên
            </h2>
            <p className="text-sm text-gray-500 mb-5">Thiết lập quyền quản trị trong nhóm: <span className="font-semibold text-blue-600">{promoteAdminDialog.title}</span></p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tài khoản được bổ nhiệm (Username hoặc ID)</label>
                <input 
                  value={promoteUserId} onChange={e => setPromoteUserId(e.target.value)}
                  placeholder="VD: @username hoặc 12345678"
                  className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Biệt danh Admin (Rank - Tùy chọn)</label>
                <input 
                  value={promoteRank} onChange={e => setPromoteRank(e.target.value)}
                  placeholder="VD: Trưởng ban, Moderator..."
                  className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Phân quyền chi tiết</label>
                <div className="grid grid-cols-2 gap-3 bg-gray-50 p-3 rounded-lg border">
                  {[
                    { key: 'changeInfo', label: 'Đổi thông tin nhóm' },
                    { key: 'postMessages', label: 'Đăng tin (Channel)' },
                    { key: 'editMessages', label: 'Sửa tin (Channel)' },
                    { key: 'deleteMessages', label: 'Xóa tin nhắn' },
                    { key: 'banUsers', label: 'Cấm thành viên' },
                    { key: 'inviteUsers', label: 'Thêm thành viên' },
                    { key: 'pinMessages', label: 'Ghim tin nhắn' },
                    { key: 'addAdmins', label: 'Bổ nhiệm Admin khác' }
                  ].map((perm) => (
                    <label key={perm.key} className="flex items-center gap-2 text-xs font-medium text-gray-600 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={promoteRights[perm.key]}
                        onChange={(e) => setPromoteRights({ ...promoteRights, [perm.key]: e.target.checked })}
                        className="w-3.5 h-3.5 rounded text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <span>{perm.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button 
                  onClick={() => setPromoteAdminDialog(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Hủy
                </button>
                <button 
                  onClick={handlePromoteAdmin} disabled={promoteLoading || !promoteUserId.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {promoteLoading ? 'Đang xử lý...' : 'Xác nhận Bổ nhiệm'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      {selectedGroupIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[90%] max-w-4xl bg-slate-900/95 backdrop-blur-md border border-slate-700/50 shadow-2xl rounded-2xl px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4 text-white animate-slide-up">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-sm">
              {selectedGroupIds.length}
            </div>
            <div>
              <p className="text-sm font-semibold">Đã chọn {selectedGroupIds.length} nhóm/kênh</p>
              <p className="text-xs text-slate-400 font-medium">Chọn tác vụ bạn muốn thực thi hàng loạt</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setSelectedGroupIds([])}
              className="px-3.5 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700/50"
            >
              Bỏ chọn
            </button>
            <button
              onClick={() => {
                setBulkScanProgress({ current: 0, total: selectedGroupIds.length, results: [], countdown: null })
                setShowBulkScanModal(true)
              }}
              className="px-3.5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg transition-colors flex items-center gap-1.5 shadow-md shadow-amber-500/10"
            >
              <ShieldAlert className="w-3.5 h-3.5" /> Quét bảo mật
            </button>
            <button
              onClick={handleBulkCopyLinks}
              className="px-3.5 py-2 text-xs font-semibold bg-white hover:bg-gray-50 text-slate-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm border border-slate-200"
            >
              <Copy className="w-3.5 h-3.5" /> Copy link
            </button>
            <button
              onClick={() => {
                setBulkSendProgress({ current: 0, total: selectedGroupIds.length, results: [], countdown: null })
                setShowBulkSendModal(true)
              }}
              className="px-3.5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors flex items-center gap-1.5 shadow-md shadow-indigo-600/10"
            >
              <Send className="w-3.5 h-3.5" /> Gửi tin nhanh
            </button>
            <button
              onClick={handleBulkCreateCampaign}
              className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors flex items-center gap-1.5 shadow-md shadow-emerald-600/10"
            >
              <PlusCircle className="w-3.5 h-3.5" /> Tạo chiến dịch
            </button>
            <button
              onClick={() => {
                setBulkLeaveProgress({ current: 0, total: selectedGroupIds.length, results: [], countdown: null })
                setShowBulkLeaveModal(true)
              }}
              className="px-3.5 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-1.5 shadow-md shadow-red-600/10"
            >
              <LogOut className="w-3.5 h-3.5" /> Thoát nhóm
            </button>
          </div>
        </div>
      )}

      {/* Bulk Scan Modal */}
      {showBulkScanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 fade-in">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl relative overflow-hidden bg-white rounded-2xl border border-gray-200">
            <div className="p-5 border-b flex justify-between items-center bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 leading-tight">Quét Bảo mật Hàng loạt</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Đối chiếu luật gửi tin nhắn của các nhóm được chọn</p>
                </div>
              </div>
              {!scanningBulk && (
                <button onClick={() => setShowBulkScanModal(false)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-gray-50/50 space-y-4">
              {!scanningBulk && bulkScanProgress.current === 0 ? (
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Cấu hình thời gian nghỉ ngẫu nhiên</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Nghỉ tối thiểu (giây)</label>
                      <input 
                        type="number"
                        value={bulkScanMinDelay}
                        onChange={e => setBulkScanMinDelay(Math.max(1, Number(e.target.value)))}
                        className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Nghỉ tối đa (giây)</label>
                      <input 
                        type="number"
                        value={bulkScanMaxDelay}
                        onChange={e => setBulkScanMaxDelay(Math.max(1, Number(e.target.value)))}
                        className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    * Nên đặt nghỉ từ 2-5 giây để đảm bảo hệ thống không gửi quá nhiều request API cùng lúc.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-semibold text-gray-700">
                        {scanningBulk 
                          ? `Đang tiến hành quét: ${bulkScanProgress.current} / ${bulkScanProgress.total} nhóm` 
                          : `Đã hoàn thành quét bảo mật!`
                        }
                      </span>
                      <span className="text-xs font-bold text-blue-600">
                        {Math.round((bulkScanProgress.current / (bulkScanProgress.total || 1)) * 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                        style={{ width: `${(bulkScanProgress.current / (bulkScanProgress.total || 1)) * 100}%` }}
                      />
                    </div>
                    
                    {/* Countdown */}
                    {scanningBulk && bulkScanProgress.countdown !== null && bulkScanProgress.countdown > 0 && (
                      <div className="mt-3 flex items-center justify-center gap-2 p-2 bg-amber-50 rounded-lg text-amber-800 text-xs font-medium animate-pulse">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Chờ ngẫu nhiên: Nghỉ giãn cách còn {bulkScanProgress.countdown} giây...</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Chi tiết kết quả</h4>
                    <div className="space-y-2.5 max-h-[40vh] overflow-y-auto pr-1">
                      {bulkScanProgress.results.map((r, idx) => (
                        <div 
                          key={idx} 
                          className={`p-3.5 rounded-xl border bg-white flex gap-3 transition-all ${
                            r.status === 'ERROR' 
                              ? 'border-red-200 bg-red-50/10' 
                              : r.status === 'WARNING' 
                                ? 'border-amber-200 bg-amber-50/10' 
                                : 'border-emerald-200 bg-emerald-50/10'
                          }`}
                        >
                          <div className="shrink-0 mt-0.5">
                            {r.status === 'ERROR' ? (
                              <AlertCircle className="w-4 h-4 text-red-500" />
                            ) : r.status === 'WARNING' ? (
                              <AlertTriangle className="w-4 h-4 text-amber-500" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center gap-2">
                              <h5 className="font-semibold text-xs text-gray-900 truncate">{r.title}</h5>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                                r.status === 'ERROR' 
                                  ? 'bg-red-100 text-red-700' 
                                  : r.status === 'WARNING' 
                                    ? 'bg-amber-100 text-amber-800' 
                                    : 'bg-emerald-100 text-emerald-700'
                              }`}>
                                {r.status}
                              </span>
                            </div>
                            <ul className="mt-1.5 space-y-0.5">
                              {r.reasons.map((reason: string, i: number) => (
                                <li 
                                  key={i} 
                                  className={`text-[11px] ${
                                    r.status === 'ERROR' 
                                      ? 'text-red-600' 
                                      : r.status === 'WARNING' 
                                        ? 'text-amber-700' 
                                        : 'text-emerald-600'
                                  }`}
                                >
                                  • {reason}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ))}
                      {bulkScanProgress.results.length === 0 && (
                        <div className="text-center text-sm text-gray-500 py-6">Đang chuẩn bị quét...</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t bg-white flex justify-end gap-2 shrink-0">
              {!(scanningBulk || bulkScanProgress.current > 0) ? (
                <>
                  <button
                    onClick={() => setShowBulkScanModal(false)}
                    className="px-5 py-2 text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleBulkScan}
                    className="px-5 py-2 text-sm font-semibold bg-amber-500 text-slate-950 hover:bg-amber-600 rounded-lg transition-colors shadow-md shadow-amber-500/10"
                  >
                    Bắt đầu quét
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setShowBulkScanModal(false);
                    setBulkScanProgress({ current: 0, total: 0, results: [], countdown: null });
                  }}
                  disabled={scanningBulk}
                  className="px-5 py-2 text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  Đóng
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Leave Modal */}
      {showBulkLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 fade-in">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl relative overflow-hidden bg-white rounded-2xl border border-gray-200">
            <div className="p-5 border-b flex justify-between items-center bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-red-50 text-red-600 rounded-xl">
                  <LogOut className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 leading-tight">Thoát Nhóm Hàng Loạt</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Tiến hành rời khỏi {selectedGroupIds.length} mục đã chọn</p>
                </div>
              </div>
              {!leavingBulk && (
                <button onClick={() => setShowBulkLeaveModal(false)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-gray-50/50 space-y-4">
              {!leavingBulk && bulkLeaveProgress.current === 0 ? (
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Cấu hình thời gian nghỉ ngẫu nhiên</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Nghỉ tối thiểu (giây)</label>
                      <input 
                        type="number"
                        value={bulkLeaveMinDelay}
                        onChange={e => setBulkLeaveMinDelay(Math.max(1, Number(e.target.value)))}
                        className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Nghỉ tối đa (giây)</label>
                      <input 
                        type="number"
                        value={bulkLeaveMaxDelay}
                        onChange={e => setBulkLeaveMaxDelay(Math.max(1, Number(e.target.value)))}
                        className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    * Khuyên dùng 60 - 120 giây để giảm thiểu rủi ro Telegram hạn chế tài khoản khi thoát quá nhiều nhóm liên tục.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-semibold text-gray-700">
                        {leavingBulk 
                          ? `Đang thực hiện: ${bulkLeaveProgress.current} / ${bulkLeaveProgress.total} nhóm` 
                          : `Đã hoàn thành rời nhóm!`
                        }
                      </span>
                      <span className="text-xs font-bold text-red-600">
                        {Math.round((bulkLeaveProgress.current / (bulkLeaveProgress.total || 1)) * 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div 
                        className="bg-red-600 h-2 rounded-full transition-all duration-300" 
                        style={{ width: `${(bulkLeaveProgress.current / (bulkLeaveProgress.total || 1)) * 100}%` }}
                      />
                    </div>
                    
                    {/* Countdown */}
                    {leavingBulk && bulkLeaveProgress.countdown !== null && bulkLeaveProgress.countdown > 0 && (
                      <div className="mt-3 flex items-center justify-center gap-2 p-2 bg-amber-50 rounded-lg text-amber-800 text-xs font-medium animate-pulse">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Chờ ngẫu nhiên: Nghỉ giãn cách còn {bulkLeaveProgress.countdown} giây...</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Lịch sử thực thi</h4>
                    <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-1">
                      {bulkLeaveProgress.results.map((r, idx) => (
                        <div 
                          key={idx} 
                          className={`p-3 rounded-xl border bg-white flex justify-between items-center transition-all ${
                            r.success ? 'border-emerald-100 bg-emerald-50/10' : 'border-red-100 bg-red-50/10'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {r.success ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                            )}
                            <span className="font-semibold text-xs text-gray-800 truncate">{r.title}</span>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase shrink-0 ${
                            r.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'
                          }`}>
                            {r.success ? 'Đã rời' : 'Lỗi'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t bg-white flex justify-end gap-2 shrink-0">
              {!(leavingBulk || bulkLeaveProgress.current > 0) ? (
                <>
                  <button
                    onClick={() => setShowBulkLeaveModal(false)}
                    className="px-5 py-2 text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleBulkLeave}
                    className="px-5 py-2 text-sm font-semibold bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors shadow-md shadow-red-600/10"
                  >
                    Bắt đầu rời
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setShowBulkLeaveModal(false);
                    setBulkLeaveProgress({ current: 0, total: 0, results: [], countdown: null });
                  }}
                  disabled={leavingBulk}
                  className="px-5 py-2 text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  Đóng
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Send Quick Message Modal */}
      {showBulkSendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 fade-in">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl relative overflow-hidden bg-white rounded-2xl border border-gray-200">
            <div className="p-5 border-b flex justify-between items-center bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 leading-tight">Gửi Tin Nhanh Hàng Loạt</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Gửi tin nhắn văn bản (HTML) trực tiếp vào {selectedGroupIds.length} mục đã chọn</p>
                </div>
              </div>
              {!sendingBulkMsg && (
                <button onClick={() => {
                  setShowBulkSendModal(false);
                  setBulkSendMessage('');
                  setBulkSendProgress({ current: 0, total: 0, results: [], countdown: null });
                }} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-gray-50/50 space-y-4">
              {!sendingBulkMsg && bulkSendProgress.current === 0 ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Nội dung tin nhắn (Hỗ trợ HTML)</label>
                    <textarea
                      value={bulkSendMessage}
                      onChange={e => setBulkSendMessage(e.target.value)}
                      placeholder="Nhập tin nhắn của bạn ở đây... VD: Chào anh em, tham gia nhóm của mình nhé! <b>In đậm</b>, <i>In nghiêng</i>."
                      rows={5}
                      className="w-full p-4 border rounded-xl bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm resize-none"
                    />
                    <p className="text-[10px] text-gray-400">
                      * Bạn có thể sử dụng các thẻ HTML cơ bản như <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;a href="..."&gt;</code>,...
                    </p>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Cấu hình thời gian nghỉ ngẫu nhiên</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Nghỉ tối thiểu (giây)</label>
                        <input 
                          type="number"
                          value={bulkSendMinDelay}
                          onChange={e => setBulkSendMinDelay(Math.max(1, Number(e.target.value)))}
                          className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Nghỉ tối đa (giây)</label>
                        <input 
                          type="number"
                          value={bulkSendMaxDelay}
                          onChange={e => setBulkSendMaxDelay(Math.max(1, Number(e.target.value)))}
                          className="w-full p-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400">
                      * Khuyên dùng 60 - 120 giây để chống tài khoản bị Telegram giới hạn spam khi nhắn tin hàng loạt.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-semibold text-gray-700">
                        {sendingBulkMsg 
                          ? `Đang gửi: ${bulkSendProgress.current} / ${bulkSendProgress.total} nhóm` 
                          : `Đã hoàn thành gửi tin nhắn!`
                        }
                      </span>
                      <span className="text-xs font-bold text-indigo-600">
                        {Math.round((bulkSendProgress.current / (bulkSendProgress.total || 1)) * 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div 
                        className="bg-indigo-600 h-2 rounded-full transition-all duration-300" 
                        style={{ width: `${(bulkSendProgress.current / (bulkSendProgress.total || 1)) * 100}%` }}
                      />
                    </div>
                    
                    {/* Countdown */}
                    {sendingBulkMsg && bulkSendProgress.countdown !== null && bulkSendProgress.countdown > 0 && (
                      <div className="mt-3 flex items-center justify-center gap-2 p-2 bg-amber-50 rounded-lg text-amber-800 text-xs font-medium animate-pulse">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Chờ ngẫu nhiên: Đang nghỉ giãn cách còn {bulkSendProgress.countdown} giây...</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Trạng thái chi tiết</h4>
                    <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-1">
                      {bulkSendProgress.results.map((r, idx) => (
                        <div 
                          key={idx} 
                          className={`p-3 rounded-xl border bg-white flex justify-between items-center transition-all ${
                            r.success ? 'border-emerald-100 bg-emerald-50/10' : 'border-red-100 bg-red-50/10'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {r.success ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                            )}
                            <span className="font-semibold text-xs text-gray-800 truncate">{r.title}</span>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase shrink-0 ${
                            r.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'
                          }`}>
                            {r.success ? 'Thành công' : 'Lỗi'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t bg-white flex justify-end gap-2 shrink-0">
              {!(sendingBulkMsg || bulkSendProgress.current > 0) ? (
                <>
                  <button
                    onClick={() => {
                      setShowBulkSendModal(false);
                      setBulkSendMessage('');
                    }}
                    className="px-5 py-2 text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleBulkSend}
                    disabled={!bulkSendMessage.trim()}
                    className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 shadow-md shadow-indigo-600/10"
                  >
                    Bắt đầu gửi
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setShowBulkSendModal(false);
                    setBulkSendMessage('');
                    setBulkSendProgress({ current: 0, total: 0, results: [], countdown: null });
                  }}
                  disabled={sendingBulkMsg}
                  className="px-5 py-2 text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  Đóng
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
