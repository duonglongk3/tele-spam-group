import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: true, message: 'Telegram webhook endpoint ready' })
}

export async function POST(req: NextRequest) {
  try {
    const update = await req.json()
    const { connectDB } = require('../../../electron/db')
    await connectDB()
    const botService = require('../../../electron/botService')
    await botService.handleWebhookUpdate(update)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[Telegram Webhook] handle error:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Webhook error' }, { status: 500 })
  }
}
