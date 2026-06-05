'use client'

import { useState, useEffect } from "react"
import { 
  Users2, Plus, Trash2, Phone, ShieldCheck, KeyRound, 
  Import, ArrowLeft, CheckCircle, Edit, X, BookOpen, Image, Trash
} from "lucide-react"
import { telegramApi } from "@/lib/telegram"
import { toast } from "sonner"
import TelegramAvatar from "@/components/ui/TelegramAvatar"

function Card({ children, className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`} {...rest}>{children}</div>;
}

type ViewMode = 'list' | 'add-otp' | 'add-session'

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<any[]>([])
  const [view, setView] = useState<ViewMode>('list')
  
  // OTP Login
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [otpStep, setOtpStep] = useState(1)
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')

  // Import Session
  const [sessionStr, setSessionStr] = useState('')

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Edit Profile
  const [editingAcc, setEditingAcc] = useState<any>(null)
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editAbout, setEditAbout] = useState('')
  const [editUsername, setEditUsername] = useState('')
  const [privacyStatus, setPrivacyStatus] = useState('all')
  const [privacyPhone, setPrivacyPhone] = useState('contacts')

  // Contacts Manager
  const [contactModalAcc, setContactModalAcc] = useState<any>(null)
  const [contactsList, setContactsList] = useState<any[]>([])
  const [newContactPhone, setNewContactPhone] = useState('')
  const [newContactFirstName, setNewContactFirstName] = useState('')
  const [newContactLastName, setNewContactLastName] = useState('')
  const [contactLoading, setContactLoading] = useState(false)

  useEffect(() => { 
    loadAccounts() 
    const t = setInterval(loadAccounts, 3000)
    return () => clearInterval(t)
  }, [])

  const loadAccounts = async () => {
    try {
      const accs = await telegramApi.getAccounts()
      setAccounts(accs || [])
    } catch (e) { console.error(e) }
  }

  // ─── OTP LOGIN ──────────────────────────────────────
  const handleRequestCode = async () => {
    if (!apiId.trim() || !apiHash.trim()) {
      setError('Vui lòng nhập API ID và API Hash theo hướng dẫn ở trên');
      return;
    }
    setError(''); setLoading(true)
    try {
      const res = await telegramApi.requestLoginCode(apiId, apiHash, phone)
      if (res?.success) { setOtpStep(2) }
      else { setError(res?.error || 'Lỗi gửi mã') }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleSubmitCode = async () => {
    setError(''); setLoading(true)
    try {
      const res = await telegramApi.submitLoginCode(code, password)
      if (res?.success) {
        resetForm(); loadAccounts()
      } else if (res?.error?.includes('SESSION_PASSWORD_NEEDED')) {
        setOtpStep(3)
      } else { setError(res?.error || 'Lỗi xác nhận') }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  // ─── IMPORT SESSION ─────────────────────────────────
  const handleImportSession = async () => {
    if (!sessionStr.trim()) return
    setError(''); setLoading(true)
    try {
      const fbId = apiId.trim() || '2040';
      const fbHash = apiHash.trim() || 'b18441a1ff607e10a989891a5462e627';
      const res = await telegramApi.importSession(fbId, fbHash, sessionStr.trim())
      if (res?.success) {
        resetForm(); loadAccounts()
      } else { setError(res?.error || 'Session không hợp lệ') }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const resetForm = () => {
    setView('list'); setOtpStep(1); setPhone(''); setCode(''); setPassword(''); setSessionStr(''); setError('')
  }

  const handleRemove = async (id: string) => {
    toast('Xác nhận xóa tài khoản khỏi hệ thống?', {
      action: {
        label: 'Đồng ý',
        onClick: async () => {
          await telegramApi.removeAccount(id);
          loadAccounts();
          toast.success("Xoá tài khoản thành công");
        }
      },
      cancel: { label: 'Hủy', onClick: () => {} }
    })
  }

  const openEditModal = (acc: any) => {
    setEditingAcc(acc)
    setEditFirstName(acc.firstName || '')
    setEditLastName(acc.lastName || '')
    setEditAbout(acc.about || '')
    setEditUsername(acc.username || '')
    setPrivacyStatus('all')
    setPrivacyPhone('contacts')
  }

  const handleUpdateProfile = async () => {
    if (!editingAcc) return
    setLoading(true)
    try {
      let res = await telegramApi.updateProfile(editingAcc.id, {
        firstName: editFirstName,
        lastName: editLastName,
        about: editAbout
      });
      if (!res?.success) throw new Error(res?.error || "Lỗi cập nhật tên/bio");

      if (editUsername !== (editingAcc.username || '')) {
        const uRes = await telegramApi.updateUsername(editingAcc.id, editUsername);
        if (!uRes?.success) throw new Error(uRes?.error || "Lỗi cập nhật username");
      }

      const pRes = await telegramApi.setPrivacySettings(editingAcc.id, {
        statusRule: privacyStatus,
        phoneRule: privacyPhone
      });
      if (!pRes?.success) throw new Error(pRes?.error || "Lỗi cài đặt quyền riêng tư");

      setEditingAcc(null)
      loadAccounts()
      toast.success("Cập nhật hồ sơ và cài đặt thành công")
    } catch (e: any) {
      toast.error("Lỗi cập nhật: " + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingAcc || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = async () => {
      setLoading(true);
      try {
        const base64 = reader.result as string;
        const res = await telegramApi.uploadProfilePhoto(editingAcc.id, base64);
        if (res?.success) {
          toast.success("Đổi ảnh đại diện thành công");
          loadAccounts();
        } else {
          toast.error("Lỗi đổi ảnh: " + (res?.error || "Lỗi không xác định"));
        }
      } catch (err: any) {
        toast.error("Lỗi đổi ảnh: " + err.message);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoDelete = async () => {
    if (!editingAcc) return;
    setLoading(true);
    try {
      const res = await telegramApi.deleteProfilePhoto(editingAcc.id);
      if (res?.success) {
        toast.success("Xóa ảnh đại diện thành công");
        loadAccounts();
      } else {
        toast.error("Lỗi xóa ảnh: " + (res?.error || "Lỗi không xác định"));
      }
    } catch (err: any) {
      toast.error("Lỗi xóa ảnh: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const openContactsModal = async (acc: any) => {
    setContactModalAcc(acc)
    setNewContactPhone('')
    setNewContactFirstName('')
    setNewContactLastName('')
    setContactLoading(true)
    try {
      const res = await telegramApi.manageContacts(acc.id, 'get', null)
      if (res?.success) {
        setContactsList(res.contacts || [])
      } else {
        toast.error("Lỗi tải danh bạ: " + (res?.error || "Lỗi không xác định"))
      }
    } catch (e: any) {
      toast.error("Lỗi tải danh bạ: " + e.message)
    } finally {
      setContactLoading(false)
    }
  }

  const handleAddContact = async () => {
    if (!contactModalAcc || !newContactPhone.trim() || !newContactFirstName.trim()) return
    setContactLoading(true)
    try {
      const res = await telegramApi.manageContacts(contactModalAcc.id, 'add', {
        phone: newContactPhone,
        firstName: newContactFirstName,
        lastName: newContactLastName
      })
      if (res?.success) {
        toast.success("Đã thêm liên hệ vào danh bạ!")
        const loadRes = await telegramApi.manageContacts(contactModalAcc.id, 'get', null)
        if (loadRes?.success) setContactsList(loadRes.contacts || [])
        setNewContactPhone('')
        setNewContactFirstName('')
        setNewContactLastName('')
      } else {
        toast.error("Lỗi thêm liên hệ: " + (res?.error || "Lỗi không xác định"))
      }
    } catch (e: any) {
      toast.error("Lỗi thêm liên hệ: " + e.message)
    } finally {
      setContactLoading(false)
    }
  }

  const handleDeleteContact = async (userId: string) => {
    if (!contactModalAcc) return
    setContactLoading(true)
    try {
      const res = await telegramApi.manageContacts(contactModalAcc.id, 'delete', { userId })
      if (res?.success) {
        toast.success("Đã xóa liên hệ!")
        const loadRes = await telegramApi.manageContacts(contactModalAcc.id, 'get', null)
        if (loadRes?.success) setContactsList(loadRes.contacts || [])
      } else {
        toast.error("Lỗi xóa liên hệ: " + (res?.error || "Lỗi không xác định"))
      }
    } catch (e: any) {
      toast.error("Lỗi xóa liên hệ: " + e.message)
    } finally {
      setContactLoading(false)
    }
  }

  // ─── RENDER: Thêm tài khoản ─────────────────────────
  if (view === 'add-otp' || view === 'add-session') {
    return (
      <div className="p-6 md:p-8 max-w-lg mx-auto space-y-6 fade-in">
        <button onClick={resetForm} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Quay lại
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Thêm tài khoản</h1>
          <p className="text-gray-500 text-sm mt-1">Kết nối Telegram để tự động hóa</p>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button onClick={() => { setView('add-otp'); setError('') }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all ${view === 'add-otp' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>
            <Phone className="w-4 h-4" /> Đăng nhập OTP
          </button>
          <button onClick={() => { setView('add-session'); setError('') }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all ${view === 'add-session' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>
            <Import className="w-4 h-4" /> Import Session
          </button>
        </div>

        {/* API Config (Dùng chung cho cả OTP và Import) */}
        <Card className="p-5 space-y-3 bg-blue-50/50">
          <div>
            <h3 className="text-sm font-semibold text-blue-800 flex items-center gap-2">
              <KeyRound className="w-4 h-4" /> Cấu hình API Telegram
            </h3>
            <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">
              Bạn cần cung cấp cấu hình <b>API ID</b> và <b>API Hash</b> (tuỳ chọn hoặc dùng app ID mặc định).
              Có thể lấy tại <a href="https://my.telegram.org" target="_blank" className="text-blue-600 hover:underline font-medium">my.telegram.org</a>.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">API ID (*)</label>
              <input value={apiId} onChange={e => setApiId(e.target.value)} 
                placeholder="VD: 2040"
                className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-100 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">API Hash (*)</label>
              <input value={apiHash} onChange={e => setApiHash(e.target.value)} 
                placeholder="VD: b18441a1ff..."
                className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-100 outline-none" />
            </div>
          </div>
        </Card>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0"></span> {error}
          </div>
        )}

        {view === 'add-otp' && (
          <Card className="p-5 space-y-4 shadow-md border-blue-100">
            {otpStep === 1 && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Số điện thoại</label>
                  <div className="relative">
                    <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input autoFocus value={phone} onChange={e => setPhone(e.target.value)} placeholder="+84987654321" 
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Bao gồm mã quốc gia (VD: +84...)</p>
                </div>
                <button 
                  onClick={handleRequestCode} disabled={loading || !phone}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading ? 'Đang gửi...' : 'Gửi mã xác nhận'}
                </button>
              </>
            )}
            
            {otpStep === 2 && (
              <>
                <div className="bg-green-50 text-green-700 p-3 rounded-lg text-sm flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" /> Đã gửi mã OTP đến Telegram của bạn
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mã xác nhận (OTP)</label>
                  <div className="relative">
                    <ShieldCheck className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input autoFocus value={code} onChange={e => setCode(e.target.value)} placeholder="Nhập 5 số..." 
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
                <button disabled={loading || !code} onClick={handleSubmitCode}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50">
                  {loading ? 'Đang kiểm tra...' : 'Xác nhận mã'}
                </button>
              </>
            )}

            {otpStep === 3 && (
              <>
                <div className="bg-yellow-50 text-yellow-800 p-3 rounded-lg text-sm">
                  Tài khoản có xác minh 2 bước. Nhập mật khẩu 2FA.
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu 2FA</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input autoFocus type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Nhập mật khẩu..." 
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
                <button disabled={loading || !password} onClick={handleSubmitCode}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50">
                  {loading ? 'Đang xác minh...' : 'Đăng nhập'}
                </button>
              </>
            )}
          </Card>
        )}

        {view === 'add-session' && (
          <Card className="p-5 space-y-4 shadow-md border-blue-100">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Chuỗi String Session</label>
              <textarea 
                value={sessionStr} 
                onChange={e => setSessionStr(e.target.value)} 
                placeholder="1BADy...paste.session.here..." 
                className="w-full p-3 border border-gray-300 rounded-lg h-32 text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none resize-none" 
              />
              <p className="text-xs text-gray-500 mt-2">Dán chuỗi String Session (telethon / gramjs) vào đây.</p>
            </div>
            <button 
              onClick={handleImportSession} disabled={loading || !sessionStr}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              <Import className="w-4 h-4" />
              {loading ? 'Đang kết nối...' : 'Import Tài Khoản'}
            </button>
          </Card>
        )}
      </div>
    )
  }

  // ─── RENDER: View List ──────────────────────────────
  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6 fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tài khoản Telegram</h1>
          <p className="text-gray-500 text-sm mt-1">Xem đầy đủ thông tin {accounts.length} tài khoản đang trực tuyến</p>
        </div>
        <button 
          onClick={() => setView('add-otp')}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm"
        >
          <Plus className="w-4 h-4" /> Thêm tài khoản
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {accounts.length === 0 ? (
          <div className="col-span-full py-16 text-center border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50">
            <Users2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-gray-900">Chưa có tài khoản nào</h3>
            <p className="text-gray-500 mt-1">Thêm tài khoản qua mã OTP hoặc Import Session String để xem chi tiết.</p>
          </div>
        ) : (
          accounts.map(acc => (
            <Card key={acc.id} className="overflow-hidden hover:shadow-md transition-shadow">
              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <TelegramAvatar 
                      accountId={acc.id} 
                      title={acc.firstName || acc.username} 
                      className="w-12 h-12 rounded-full text-lg overflow-hidden shrink-0" 
                    />
                    <div>
                      <h3 className="font-bold text-gray-900 leading-tight">
                        {acc.firstName} {acc.lastName}
                      </h3>
                      <span className={`inline-flex mt-1 items-center gap-1 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                        acc.connected === true ? 'bg-green-100 text-green-700' : 
                        acc.connected === false ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {acc.connected === true ? 'Online' : 
                         acc.connected === false ? 'Offline' : 'Đang tải...'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 mt-4 bg-gray-50 p-3 rounded-lg text-sm border border-gray-100">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Username:</span>
                    <span className="font-medium text-gray-900">{acc.username ? `@${acc.username}` : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Phone:</span>
                    <span className="font-medium text-gray-900">{acc.phone ? `+${acc.phone}` : 'N/A'}</span>
                  </div>
                  {acc.about && (
                    <div className="flex flex-col border-t border-gray-200 mt-2 pt-2">
                       <span className="text-gray-500 mb-1">Bio/About:</span>
                       <span className="font-medium text-gray-900 text-xs italic">{acc.about}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-gray-200 mt-2 pt-2">
                    <span className="text-gray-500">Account ID:</span>
                    <span className="font-medium text-gray-900 truncate max-w-[120px]" title={acc.id}>{acc.id}</span>
                  </div>
                  
                  {acc.error && acc.connected === false && (
                    <div className="mt-2 pt-2 border-t border-red-100">
                      <p className="text-[10px] text-red-600 font-medium leading-tight">
                        Lỗi kết nối: <span className="font-mono">{acc.error}</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="bg-gray-50 p-3 border-t flex justify-end gap-2">
                <button 
                  onClick={() => openContactsModal(acc)}
                  className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-md transition-colors flex items-center gap-1 text-xs"
                  title="Quản lý danh bạ"
                >
                  <BookOpen className="w-4 h-4" />
                  <span className="text-[10px] font-semibold">Danh bạ</span>
                </button>
                <button 
                  onClick={() => openEditModal(acc)}
                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                  title="Chỉnh sửa hồ sơ"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => handleRemove(acc.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                  title="Xoá tài khoản"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </Card>
          ))
        )}
      </div>

      {editingAcc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 fade-in">
          <Card className="w-full max-w-lg p-6 bg-white shadow-xl relative max-h-[90vh] overflow-y-auto">
            <button 
              onClick={() => setEditingAcc(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Chỉnh sửa Hồ sơ & Cấu hình</h2>
            <p className="text-sm text-gray-500 mb-5">Cập nhật thông tin công khai và thiết lập bảo mật Telegram.</p>

            <div className="space-y-5">
              {/* Profile Photo Upload/Delete */}
              <div className="border bg-gray-50 p-4 rounded-xl space-y-3">
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider">Ảnh đại diện (Profile Photo)</label>
                <div className="flex items-center gap-4">
                  <TelegramAvatar 
                    accountId={editingAcc.id} 
                    title={editFirstName || editingAcc.username} 
                    className="w-16 h-16 rounded-full text-2xl overflow-hidden shrink-0 border" 
                  />
                  <div className="flex flex-col gap-2">
                    <label className="cursor-pointer bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 shadow-sm">
                      <Image className="w-3.5 h-3.5" />
                      Tải ảnh mới lên
                      <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                    </label>
                    <button 
                      onClick={handlePhotoDelete}
                      className="border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 shadow-sm bg-white"
                    >
                      <Trash className="w-3.5 h-3.5" />
                      Xóa ảnh đại diện
                    </button>
                  </div>
                </div>
              </div>

              {/* Basic Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tên (First Name)</label>
                  <input 
                    value={editFirstName} onChange={e => setEditFirstName(e.target.value)}
                    className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-100 outline-none"
                    placeholder="First name..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Họ (Last Name)</label>
                  <input 
                    value={editLastName} onChange={e => setEditLastName(e.target.value)}
                    className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-100 outline-none"
                    placeholder="Last name..."
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username (@username)</label>
                <input 
                  value={editUsername} onChange={e => setEditUsername(e.target.value)}
                  className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-100 outline-none font-mono"
                  placeholder="Username..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tiểu sử (Bio / About)</label>
                <textarea 
                  value={editAbout} onChange={e => setEditAbout(e.target.value)}
                  className="w-full p-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-100 outline-none resize-none h-20"
                  placeholder="Viết một chút về tài khoản này..."
                  maxLength={70}
                />
                <p className="text-xs text-gray-500 mt-1 text-right">{editAbout.length}/70</p>
              </div>

              {/* Privacy Settings */}
              <div className="border bg-blue-50/30 p-4 rounded-xl space-y-3">
                <label className="block text-xs font-semibold text-blue-800 uppercase tracking-wider">Cấu hình Quyền riêng tư (Privacy)</label>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Trạng thái Online</label>
                    <select 
                      value={privacyStatus} 
                      onChange={e => setPrivacyStatus(e.target.value)}
                      className="w-full p-2 border rounded-lg text-xs bg-white outline-none"
                    >
                      <option value="all">Cho phép tất cả (Everybody)</option>
                      <option value="contacts">Chỉ danh bạ (My Contacts)</option>
                      <option value="none">Không cho ai (Nobody)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Số điện thoại</label>
                    <select 
                      value={privacyPhone} 
                      onChange={e => setPrivacyPhone(e.target.value)}
                      className="w-full p-2 border rounded-lg text-xs bg-white outline-none"
                    >
                      <option value="all">Cho phép tất cả (Everybody)</option>
                      <option value="contacts">Chỉ danh bạ (My Contacts)</option>
                      <option value="none">Không cho ai (Nobody)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button 
                  onClick={() => setEditingAcc(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Hủy
                </button>
                <button 
                  onClick={handleUpdateProfile} disabled={loading}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? 'Đang lưu...' : 'Lưu lại'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Contacts Manager Modal */}
      {contactModalAcc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 fade-in">
          <Card className="w-full max-w-2xl p-6 bg-white shadow-xl relative flex flex-col max-h-[85vh]">
            <button 
              onClick={() => setContactModalAcc(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Danh bạ tài khoản</h2>
            <p className="text-sm text-gray-500 mb-5">Danh sách bạn bè & liên hệ của tài khoản: <span className="font-semibold text-blue-600">{contactModalAcc.firstName}</span></p>

            {/* Add Contact Form */}
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-4 space-y-3">
              <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Thêm liên hệ mới</h4>
              <div className="grid grid-cols-3 gap-3">
                <input 
                  value={newContactPhone} onChange={e => setNewContactPhone(e.target.value)}
                  placeholder="SĐT (+84...)"
                  className="p-2 border rounded-lg text-xs bg-white outline-none"
                />
                <input 
                  value={newContactFirstName} onChange={e => setNewContactFirstName(e.target.value)}
                  placeholder="Tên (First Name)"
                  className="p-2 border rounded-lg text-xs bg-white outline-none"
                />
                <input 
                  value={newContactLastName} onChange={e => setNewContactLastName(e.target.value)}
                  placeholder="Họ (Last Name - tuỳ chọn)"
                  className="p-2 border rounded-lg text-xs bg-white outline-none"
                />
              </div>
              <div className="flex justify-end">
                <button 
                  onClick={handleAddContact}
                  disabled={contactLoading || !newContactPhone || !newContactFirstName}
                  className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  Thêm liên hệ
                </button>
              </div>
            </div>

            {/* Contacts list */}
            <div className="flex-1 overflow-y-auto border rounded-xl divide-y min-h-[250px]">
              {contactLoading && contactsList.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500">Đang tải danh bạ...</div>
              ) : contactsList.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500">Danh bạ trống</div>
              ) : (
                contactsList.map((c: any) => (
                  <div key={c.id} className="p-3 flex items-center justify-between hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
                        {c.firstName ? c.firstName[0] : '?'}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{c.firstName} {c.lastName}</p>
                        <p className="text-xs text-gray-500">
                          {c.username ? `@${c.username}` : ''} {c.phone ? `| +${c.phone}` : ''}
                          {c.mutual && <span className="ml-2 text-[10px] text-green-600 font-semibold bg-green-50 px-1.5 py-0.5 rounded border border-green-200">Liên hệ 2 chiều</span>}
                        </p>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDeleteContact(c.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                      title="Xóa liên hệ"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
