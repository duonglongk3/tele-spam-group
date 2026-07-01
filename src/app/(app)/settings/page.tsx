'use client'

import { useState, useEffect } from "react"
import { Settings as SettingsIcon, Save, RefreshCw, Loader2, Link as LinkIcon, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

function Card({ children, className = '' }: { children: React.ReactNode, className?: string }) {
  return <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}>{children}</div>;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [testingToken, setTestingToken] = useState(false)
  
  const [form, setForm] = useState({
    telegramBotToken: '',
    telegramAdminChatId: '',
    telegramWebhookUrl: '',
    telegramPairToken: '',
    telegramBotUsername: '',
    openaiApiKey: '',
    aiApiUrl: 'https://api.openai.com/v1',
    aiModel: 'claude_sonet_4.5',
    telegramApiId: '2040',
    telegramApiHash: 'b18441a1ff607e10a989891a5462e627',
    telegramDeviceModel: 'Desktop',
    telegramSystemVersion: 'Windows 10',
    telegramAppVersion: 'Telegram Desktop 6.9.3 x64',
    telegramLangCode: 'en',
    telegramSystemLangCode: 'en-US',
  })

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const res = await (window as any).ipcRenderer.invoke('settings:get')
      if (res.success && res.settings) {
        setForm({
          telegramBotToken: res.settings.telegramBotToken || '',
          telegramAdminChatId: res.settings.telegramAdminChatId || '',
          telegramWebhookUrl: res.settings.telegramWebhookUrl || 'https://d5x1qljf-3000.asse.devtunnels.ms',
          telegramPairToken: res.settings.telegramPairToken || '',
          telegramBotUsername: res.settings.telegramBotUsername || '',
          openaiApiKey: res.settings.openaiApiKey || '',
          aiApiUrl: res.settings.aiApiUrl || 'https://api.openai.com/v1',
          aiModel: res.settings.aiModel || 'claude_sonet_4.5',
          telegramApiId: res.settings.telegramApiId || '2040',
          telegramApiHash: res.settings.telegramApiHash || 'b18441a1ff607e10a989891a5462e627',
          telegramDeviceModel: res.settings.telegramDeviceModel || 'Desktop',
          telegramSystemVersion: res.settings.telegramSystemVersion || 'Windows 10',
          telegramAppVersion: res.settings.telegramAppVersion || 'Telegram Desktop 6.9.3 x64',
          telegramLangCode: res.settings.telegramLangCode || 'en',
          telegramSystemLangCode: res.settings.telegramSystemLangCode || 'en-US',
        })
      }
    } catch (e: any) {
      toast.error('Lỗi tải cài đặt: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleTestToken = async () => {
    if (!form.telegramBotToken) return;
    try {
      setTestingToken(true);
      const res = await fetch(`https://api.telegram.org/bot${form.telegramBotToken}/getMe`);
      const data = await res.json();
      
      if (data.ok && data.result) {
        setForm(prev => ({ ...prev, telegramBotUsername: data.result.username }));
        toast.success(`Hợp lệ! Bot: @${data.result.username}`);
      } else {
        toast.error('Token không hợp lệ hoặc Bot đã bị xóa!');
      }
    } catch (e: any) {
      toast.error('Lỗi khi kiểm tra Token: ' + e.message);
    } finally {
      setTestingToken(false);
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const res = await (window as any).ipcRenderer.invoke('settings:save', form)
      if (res.success) {
        toast.success('Đã lưu cấu hình thành công!')
      } else {
        toast.error('Lỗi khi lưu: ' + res.error)
      }
    } catch (e: any) {
      toast.error('Lỗi hệ thống: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleRestartBot = async () => {
    try {
      setRestarting(true)
      const res = await (window as any).ipcRenderer.invoke('bot:restart')
      if (res.success) {
        toast.success('Đã chạy lại & Khởi tạo Bot thành công!')
        loadSettings() // Tải lại để lấy Username (Bot) nếu có
      } else {
        toast.error('Lỗi khởi tạo Bot (vui lòng check Token): ' + res.error)
      }
    } catch (e: any) {
      toast.error('Lỗi hệ thống: ' + e.message)
    } finally {
      setRestarting(false)
    }
  }

  const handleResetAdmin = async () => {
    try {
      const updatedForm = { ...form, telegramAdminChatId: '' }
      const res = await (window as any).ipcRenderer.invoke('settings:save', updatedForm);
      if (res.success) {
        setForm(updatedForm);
        toast.success('Đã xóa dữ liệu liên kết cũ. Vui lòng kết nối lại!');
        handleRestartBot();
      }
    } catch (e: any) {
      toast.error('Lỗi: ' + e.message)
    }
  }

  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
  }

  const isPaired = !!form.telegramAdminChatId;
  const pairingUrl = form.telegramBotUsername && form.telegramPairToken 
    ? `https://t.me/${form.telegramBotUsername}?start=${form.telegramPairToken}` 
    : '';

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-8 fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <SettingsIcon className="w-8 h-8 text-gray-700" />
          Cài đặt Hệ thống
        </h1>
        <p className="text-gray-500 mt-2">Cấu hình Bot Telegram và nhận cảnh báo Lỗi Auto Post</p>
      </div>

      <Card className="p-6 space-y-6 border-t-4 border-t-blue-500">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
            <ShieldAlert className="w-5 h-5 text-blue-500" /> 
            Cấu hình Bot Cảnh Báo (Độc Quyền Admin)
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            Bot được bảo mật tuyệt đối. Người lạ sẽ bị block 100%. Bạn phải liên kết tài khoản Telegram cá nhân thành Admin thông qua link bảo mật 1 chạm dưới đây để nhận thông báo.
          </p>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold mb-1.5">1. Telegram Bot Token</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="VD: 123456789:ABCdefGHIjklMNO..."
                className="flex-1 p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.telegramBotToken}
                onChange={e => setForm({...form, telegramBotToken: e.target.value})}
              />
              <button
                onClick={handleTestToken}
                disabled={testingToken || !form.telegramBotToken}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium border border-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
              >
                {testingToken ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Kiểm tra Token
              </button>
            </div>
            {form.telegramBotUsername && (
              <p className="text-sm text-blue-600 mt-2 font-medium flex items-center gap-1">
                ✅ Đã nhận diện Bot: <span className="font-bold">@{form.telegramBotUsername}</span>
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">Lấy Token từ <a href="https://t.me/botfather" target="_blank" className="text-blue-500 hover:underline">@BotFather</a>. Nhấn "Kiểm tra Token" để lấy Tên Bot.</p>
          </div>

          <div className="pt-2">
            <label className="block text-sm font-semibold mb-1.5">2. Trạng thái Kết Nối (Admin)</label>
            
            {isPaired ? (
              <div className="p-4 bg-green-50 border-2 border-green-200 rounded-lg flex items-center justify-between">
                <div>
                  <p className="font-semibold text-green-700">✅ Đã liên kết & Bảo mật thành công</p>
                  <p className="text-sm text-green-600 mt-0.5">Admin Chat ID đăng ký: <span className="font-mono">{form.telegramAdminChatId}</span></p>
                </div>
                <button
                  onClick={handleResetAdmin}
                  className="px-4 py-2 bg-white text-red-600 hover:bg-red-50 border border-red-200 rounded-md text-sm font-medium transition-colors"
                >
                  Gỡ Liên Kết
                </button>
              </div>
            ) : (
              <div className="p-4 border-2 border-dashed border-gray-300 bg-gray-50/50 rounded-lg">
                <p className="text-sm text-gray-600 mb-3 font-medium">🔴 Chưa liên kết Admin. Bấm vào Link tạo sẵn dưới đây để kích hoạt:</p>
                
                {pairingUrl ? (
                  <div className="flex flex-col gap-2">
                    <a 
                      href={pairingUrl} 
                      target="_blank" 
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-2 bg-[#24A1DE] text-white px-5 py-2.5 rounded-md font-medium shadow-sm hover:bg-[#1E88BE] transition-colors w-max"
                    >
                      <LinkIcon className="w-4 h-4" />
                      Nhấn vào đây để Liên Kết (Deep Link)
                    </a>
                    <p className="text-xs text-gray-400 mt-1">Hoặc gửi link này tới thiết bị có Telegram: <br/><code className="text-blue-500 bg-blue-50 px-1 py-0.5 rounded break-all">{pairingUrl}</code></p>
                  </div>
                ) : (
                  <div className="text-sm text-orange-600 bg-orange-50 px-4 py-3 rounded-md border border-orange-200">
                    Bạn cần điền <b>Bot Token</b>, Ấn <b>Lưu cài đặt</b> và <b>Khởi động & Áp dụng</b> ở dưới trước để Bot sinh ra Link liên kết bảo mật nhé!
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-2">
            <label className="block text-sm font-semibold mb-1.5">3. Webhook URL</label>
            <div className="flex relative items-center">
              <span className="inline-flex h-[42px] items-center px-3 rounded-l-lg border border-r-0 border-gray-200 bg-gray-100 text-gray-500">
                <LinkIcon className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="https://d5x1qljf-3000.asse.devtunnels.ms"
                className="flex-1 p-2.5 border border-gray-200 rounded-r-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 h-[42px]"
                value={form.telegramWebhookUrl}
                onChange={e => setForm({...form, telegramWebhookUrl: e.target.value})}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1.5 max-w-2xl leading-relaxed">
              Webhook đi qua Next.js backend sẵn có ở port <code>3000</code>, endpoint <code>/webhook</code>. Không cần mở thêm port <code>3001</code>.
            </p>
          </div>

          <div className="pt-2">
            <label className="block text-sm font-semibold mb-1.5">4. Telegram MTProto Client</label>
            <p className="text-xs text-gray-500 mb-3">
              Cấu hình này dùng cho đăng nhập OTP, import session và chuyển TData. Đã có sẵn giá trị mặc định, user không cần đổi nếu chưa hiểu rõ.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">API ID</label>
                <input
                  type="text"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.telegramApiId}
                  onChange={e => setForm({...form, telegramApiId: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">API Hash</label>
                <input
                  type="password"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.telegramApiHash}
                  onChange={e => setForm({...form, telegramApiHash: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Device Model</label>
                <input
                  type="text"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.telegramDeviceModel}
                  onChange={e => setForm({...form, telegramDeviceModel: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">System Version</label>
                <input
                  type="text"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.telegramSystemVersion}
                  onChange={e => setForm({...form, telegramSystemVersion: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">App Version</label>
                <input
                  type="text"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.telegramAppVersion}
                  onChange={e => setForm({...form, telegramAppVersion: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Lang Code</label>
                  <input
                    type="text"
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.telegramLangCode}
                    onChange={e => setForm({...form, telegramLangCode: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">System Lang</label>
                  <input
                    type="text"
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.telegramSystemLangCode}
                    onChange={e => setForm({...form, telegramSystemLangCode: e.target.value})}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2 space-y-3">
            <label className="block text-sm font-semibold">5. AI API Core</label>
            <p className="text-xs text-gray-500">Dùng OpenAI-compatible endpoint. Ví dụ custom core: https://.../v1, model claude_sonet_4.5.</p>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">AI API URL</label>
              <input
                type="text"
                placeholder="https://api.openai.com/v1"
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.aiApiUrl}
                onChange={e => setForm({...form, aiApiUrl: e.target.value})}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">AI API Key</label>
                <input
                  type="password"
                  placeholder="hello-im-stondy / sk-..."
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.openaiApiKey}
                  onChange={e => setForm({...form, openaiApiKey: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">AI Model</label>
                <input
                  type="text"
                  placeholder="claude_sonet_4.5"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.aiModel}
                  onChange={e => setForm({...form, aiModel: e.target.value})}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t flex flex-wrap gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#24A1DE] text-white px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 min-w-[120px] justify-center hover:bg-[#1E88BE] transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Lưu cài đặt
          </button>

          <button
            onClick={handleRestartBot}
            disabled={restarting}
            className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 min-w-[180px] justify-center hover:bg-emerald-100 transition-colors disabled:opacity-50"
          >
            {restarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Khởi động & Áp dụng
          </button>
        </div>
      </Card>
    </div>
  )
}



