'use client'

import { useState, useEffect } from "react"
import { ClipboardList, CheckCircle, XCircle, Filter, ChevronLeft, ChevronRight, Trash2 } from "lucide-react"
import { telegramApi } from "@/lib/telegram"
import { toast } from "sonner"

function Card({ children, className = '' }: { children: React.ReactNode, className?: string }) {
  return <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}>{children}</div>;
}

const PAGE_SIZE = 30

export default function LogsPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [filterCampaign, setFilterCampaign] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [campaigns, setCampaigns] = useState<any[]>([])

  useEffect(() => {
    loadCampaigns()
  }, [])

  useEffect(() => {
    loadLogs()
  }, [page, filterCampaign])

  const loadCampaigns = async () => {
    const res = await telegramApi.getCampaigns()
    if (res?.success) setCampaigns(res.campaigns)
  }

  const loadLogs = async () => {
    const params: any = { limit: PAGE_SIZE, skip: page * PAGE_SIZE }
    if (filterCampaign) params.campaignId = filterCampaign
    const res = await telegramApi.getLogs(params)
    if (res?.success) {
      setLogs(res.logs)
      setTotal(res.total)
    }
  }

  const filteredLogs = filterStatus ? logs.filter(l => l.status === filterStatus) : logs
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const fmtTime = (d: string) => {
    try { return new Date(d).toLocaleString('vi-VN') } catch { return d }
  }

  const handleClearAll = async () => {
    if (!confirm("Xác nhận xóa toàn bộ Lịch sử hành động? Thao tác này không thể hoàn tác.")) return;
    const res = await telegramApi.deleteAllLogs()
    if (res?.success) {
      toast.success("Đã xóa toàn bộ lịch sử!")
      setLogs([])
      setTotal(0)
      setPage(0)
    } else {
      toast.error("Lỗi xóa lịch sử: " + res?.error)
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6 fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <ClipboardList className="w-8 h-8 text-blue-500" />
          Lịch sử hành động
        </h1>
        <p className="text-gray-500 mt-2">Tất cả log post / share / forward được ghi nhận chi tiết</p>
      </div>

      {/* Filters */}
      <Card className="p-4 flex flex-wrap gap-4 items-center">
        <Filter className="w-5 h-5 text-gray-400" />
        <select 
          value={filterCampaign} 
          onChange={e => { setFilterCampaign(e.target.value); setPage(0) }}
          className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Tất cả chiến dịch</option>
          {campaigns.map((c: any) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
        <select 
          value={filterStatus} 
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="success">Thành công</option>
          <option value="fail">Thất bại</option>
        </select>
        <span className="ml-auto text-sm text-gray-400">Tổng: {total} bản ghi</span>
        <button 
          onClick={handleClearAll}
          disabled={logs.length === 0}
          className="ml-2 px-3 py-1.5 flex items-center gap-1 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Trash2 className="w-4 h-4"/> Xóa Tất Cả
        </button>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-gray-500 text-left">
                <th className="px-4 py-3 font-medium w-8">#</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-4 py-3 font-medium">Hành động</th>
                <th className="px-4 py-3 font-medium">Chiến dịch</th>
                <th className="px-4 py-3 font-medium">Tài khoản</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Link Bài</th>
                <th className="px-4 py-3 font-medium">Nội dung</th>
                <th className="px-4 py-3 font-medium">Lỗi</th>
                <th className="px-4 py-3 font-medium">Thời gian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                    Không có dữ liệu
                  </td>
                </tr>
              )}
              {filteredLogs.map((log: any, i: number) => (
                <tr key={typeof log._id === 'object' ? (log._id.$oid || `log-${i}`) : (log._id || `log-${i}`)} className="hover:bg-blue-50/50 transition-colors">
                  <td className="px-4 py-3 text-gray-400">{page * PAGE_SIZE + i + 1}</td>
                  <td className="px-4 py-3">
                    {log.status === 'success' 
                      ? <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 px-2 py-1 rounded-full text-xs font-semibold"><CheckCircle className="w-3.5 h-3.5"/>OK</span>
                      : <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 px-2 py-1 rounded-full text-xs font-semibold"><XCircle className="w-3.5 h-3.5"/>Fail</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs font-medium">{log.action}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-[120px] truncate" title={log.campaignName}>{log.campaignName || '-'}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-[130px] truncate" title={log.accountName}>{log.accountName || '-'}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-[150px] truncate" title={log.targetName || log.targetLink}>{log.targetName || log.targetLink || '-'}</td>
                  <td className="px-4 py-3">
                    {log.postLinks && log.postLinks.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {log.postLinks.map((link: string, idx: number) => (
                          <a key={idx} href={link} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700 text-xs truncate max-w-[100px] inline-block font-medium">Link {idx + 1}</a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-[180px] truncate" title={log.contentPreview}>{log.contentPreview || '-'}</td>
                  <td className="px-4 py-3 text-red-500 max-w-[150px] truncate" title={log.errorMessage}>{log.errorMessage || '-'}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">{fmtTime(log.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <button 
              onClick={() => setPage(Math.max(0, page - 1))} 
              disabled={page === 0}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4"/>Trước
            </button>
            <span className="text-sm text-gray-500">Trang {page + 1} / {totalPages}</span>
            <button 
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))} 
              disabled={page >= totalPages - 1}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Sau<ChevronRight className="w-4 h-4"/>
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
