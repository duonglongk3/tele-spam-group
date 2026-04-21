'use client'

import Link from 'next/link'
import { useState, useEffect } from "react"
import { Users, Activity, Send, CheckCircle, XCircle, Clock } from "lucide-react"
import { telegramApi } from "@/lib/telegram"

function Card({ children, className = '' }: { children: React.ReactNode, className?: string }) {
  return <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}>{children}</div>;
}

export default function DashboardPage() {
  const [stats, setStats] = useState({ todaySuccess: 0, todayFail: 0, totalSuccess: 0, totalFail: 0 })
  const [recentLogs, setRecentLogs] = useState<any[]>([])
  const [accountCount, setAccountCount] = useState(0)
  const [campaignCount, setCampaignCount] = useState(0)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [s, l, a, c] = await Promise.all([
        telegramApi.getLogStats(),
        telegramApi.getLogs({ limit: 15 }),
        telegramApi.getAccounts(),
        telegramApi.getCampaigns(),
      ])
      if (s?.success) setStats(s)
      if (l?.success) setRecentLogs(l.logs)
      setAccountCount(Array.isArray(a) ? a.length : 0)
      if (c?.success) setCampaignCount(c.campaigns?.length || 0)
    } catch (e) {
      console.error(e)
    }
  }

  const fmtTime = (d: string) => {
    try { return new Date(d).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) } catch { return d }
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8 fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tổng quan</h1>
        <p className="text-gray-500 mt-2">Theo dõi và quản lý các tác vụ Telegram Automation.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {/* Accounts */}
        <Card className="hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><Users className="w-16 h-16 text-blue-500" /></div>
          <div className="p-6 pb-2 flex items-center justify-between relative z-10">
            <h3 className="text-sm font-medium">Tài khoản</h3>
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center"><Users className="w-4 h-4 text-blue-600" /></div>
          </div>
          <div className="px-6 pb-6 relative z-10">
            <div className="text-3xl font-bold">{accountCount}</div>
            <p className="text-xs text-gray-500 mt-1">Active sessions</p>
          </div>
        </Card>

        {/* Campaign */}
        <Card className="hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><Send className="w-16 h-16 text-indigo-500" /></div>
          <div className="p-6 pb-2 flex items-center justify-between relative z-10">
            <h3 className="text-sm font-medium">Chiến dịch</h3>
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center"><Send className="w-4 h-4 text-indigo-600" /></div>
          </div>
          <div className="px-6 pb-6 relative z-10">
            <div className="text-3xl font-bold">{campaignCount}</div>
            <p className="text-xs text-gray-500 mt-1">Campaign records</p>
          </div>
        </Card>

        {/* Today Success */}
        <Card className="hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><CheckCircle className="w-16 h-16 text-green-500" /></div>
          <div className="p-6 pb-2 flex items-center justify-between relative z-10">
            <h3 className="text-sm font-medium">Thành công hôm nay</h3>
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center"><CheckCircle className="w-4 h-4 text-green-600" /></div>
          </div>
          <div className="px-6 pb-6 relative z-10">
            <div className="text-3xl font-bold text-green-600">{stats.todaySuccess}</div>
            <p className="text-xs text-gray-500 mt-1">Tổng: {stats.totalSuccess}</p>
          </div>
        </Card>

        {/* Today Fail */}
        <Card className="hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><XCircle className="w-16 h-16 text-red-400" /></div>
          <div className="p-6 pb-2 flex items-center justify-between relative z-10">
            <h3 className="text-sm font-medium">Thất bại hôm nay</h3>
            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center"><XCircle className="w-4 h-4 text-red-600" /></div>
          </div>
          <div className="px-6 pb-6 relative z-10">
            <div className="text-3xl font-bold text-red-500">{stats.todayFail}</div>
            <p className="text-xs text-gray-500 mt-1">Tổng: {stats.totalFail}</p>
          </div>
        </Card>
      </div>
      
      {/* Recent Logs */}
      <Card>
        <div className="p-6 pb-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold text-lg">Hoạt động gần đây</h3>
          </div>
          <Link href="/logs" className="text-sm text-blue-600 hover:underline font-medium">Xem tất cả</Link>
        </div>
        <div className="divide-y divide-gray-100">
          {recentLogs.length === 0 && (
            <div className="p-12 flex flex-col items-center justify-center text-center text-gray-400">
              <Clock className="w-10 h-10 mb-2 text-gray-300"/>
              <p>Chưa có hành động nào được ghi nhận.</p>
            </div>
          )}
          {recentLogs.map((log: any, i: number) => (
            <div key={typeof log._id === 'object' ? (log._id.$oid || `log-${i}`) : (log._id || `log-${i}`)} className="px-6 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors">
              {log.status === 'success' 
                ? <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" /> 
                : <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 truncate">{log.targetName || log.targetLink}</span>
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-medium">{log.action}</span>
                </div>
                <p className="text-xs text-gray-400 truncate mt-0.5">
                  {log.accountName} {log.campaignName ? `· ${log.campaignName}` : ''}
                  {log.status === 'fail' && log.errorMessage ? ` · Lỗi: ${log.errorMessage}` : ''}
                </p>
              </div>
              <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">{fmtTime(log.createdAt)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
