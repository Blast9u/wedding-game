'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { QRCodeCanvas as QRCode } from 'qrcode.react'
import { supabase, GameState, Guest } from '@/lib/supabase'
import { fetchQuestions, GameQuestion } from '@/lib/questions'

const GUEST_URL = process.env.NEXT_PUBLIC_SITE_URL
  ? `${process.env.NEXT_PUBLIC_SITE_URL}/guest`
  : '/guest'

interface QuestionResult {
  question_index: number
  declared_option: string
  option_points: Record<string, number> | null
}

export default function ProjectorPage() {
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [guests, setGuests] = useState<Guest[]>([])
  const [questionResults, setQuestionResults] = useState<QuestionResult[]>([])
  const [questions, setQuestions] = useState<GameQuestion[]>([])
  const [countdown, setCountdown] = useState<number | null>(null)

  useEffect(() => {
    fetchQuestions().then(setQuestions)
    fetchAll()
    const poll = setInterval(fetchAll, 3000)
    const channel = supabase
      .channel('projector-realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wedding_game_state', filter: 'id=eq.1' }, (p) => {
        const gs = p.new as GameState
        setGameState(gs)
        fetchGuests()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wedding_guests' }, () => fetchGuests())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wedding_question_results' }, () => fetchResults())
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(channel) }
  }, [])

  // Countdown — resets on each new voting round, stops at 0, host still locks manually
  useEffect(() => {
    if (gameState?.status !== 'voting') { setCountdown(null); return }
    setCountdown(10)
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) { clearInterval(timer); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [gameState?.status, gameState?.current_question_index])

  async function fetchAll() {
    const { data: gs } = await supabase.from('wedding_game_state').select('*').eq('id', 1).single()
    if (gs) setGameState(gs)
    await Promise.all([fetchGuests(), fetchResults()])
  }

  async function fetchGuests() {
    const { data } = await supabase.from('wedding_guests').select('*')
    const sorted = (data ?? []).sort((a, b) => {
      const sa = a.score ?? (a as Record<string, number>).penalty_points ?? 0
      const sb = b.score ?? (b as Record<string, number>).penalty_points ?? 0
      return sa - sb
    })
    setGuests(sorted)
  }

  async function fetchResults() {
    const { data } = await supabase.from('wedding_question_results').select('*')
    if (data) setQuestionResults(data)
  }

  const currentQ = gameState ? questions[gameState.current_question_index] : null

  const currentResult = gameState
    ? questionResults.find((r) => r.question_index === gameState.current_question_index)
    : null

  // --- OVERRIDE SCREEN ---
  if (gameState?.status === 'override') {
    return (
      <main className="min-h-screen bg-yellow-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-yellow-500 text-xl font-bold uppercase tracking-widest mb-4">Groom is making a call…</p>
          <div style={{ fontSize: '8rem', lineHeight: 1 }} className="mb-2">💥</div>
          <p className="text-white font-black tracking-tight" style={{ fontSize: '9rem', lineHeight: 1 }}>OVERRIDE</p>
          <p className="text-yellow-300 text-2xl mt-6 animate-pulse">Stand by…</p>
        </div>
      </main>
    )
  }

  // --- IDLE SCREEN ---
  if (!gameState || gameState.status === 'waiting') {
    return (
      <main className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-100 flex items-center justify-center">
        <div className="text-center text-stone-900">
          <div className="text-7xl mb-6">💍</div>
          <h1 className="text-5xl font-bold mb-2">What do u mean where is the crowd? I am the crowd</h1>
          <p className="text-xl text-stone-500 mb-10">Scan to join the game!</p>
          <div className="bg-white rounded-3xl p-6 inline-block shadow-lg">
            <QRCode value={GUEST_URL} size={220} />
          </div>
          <p className="text-stone-400 mt-6 text-sm">{GUEST_URL}</p>
        </div>
      </main>
    )
  }

  // --- RESULTS / LEADERBOARD SCREEN ---
  if (gameState.status === 'results') {
    const gScore = (g: Guest) => g.score ?? (g as unknown as Record<string, number>).penalty_points ?? 0
    const fmtPts = (g: Guest) => { const p = gScore(g); return p > 0 ? `+${p}` : String(p) }
    const scoreColor = (g: Guest) => {
      const p = gScore(g)
      return p < 0 ? 'text-emerald-700' : p === 0 ? 'text-stone-400' : 'text-rose-600'
    }

    const rankedOptions = currentQ && currentResult?.option_points
      ? [...currentQ.options].sort((a, b) =>
          (currentResult.option_points![a.id] ?? 99) - (currentResult.option_points![b.id] ?? 99)
        )
      : []

    const ptsBorder = (pts: number) =>
      pts === -1 ? 'border-emerald-500' : pts === 2 ? 'border-rose-500' : 'border-stone-300'
    const ptsBg = (pts: number) =>
      pts === -1 ? 'bg-emerald-50' : pts === 2 ? 'bg-rose-50' : 'bg-stone-100'
    const ptsTextColor = (pts: number) =>
      pts === -1 ? 'text-emerald-700' : pts === 2 ? 'text-rose-700' : 'text-stone-600'
    const ptsLabel = (pts: number) =>
      pts === -1 ? 'Most Popular' : pts === 0 ? '2nd' : pts === 1 ? '3rd' : 'Least Popular'

    // Table rankings
    const tableMap: Record<number, Guest[]> = {}
    for (const g of guests) {
      if (!tableMap[g.table_number]) tableMap[g.table_number] = []
      tableMap[g.table_number].push(g)
    }
    const tableRankings = Object.entries(tableMap)
      .map(([tNum, members]) => ({
        table: Number(tNum),
        avg: members.reduce((s, m) => s + gScore(m), 0) / members.length,
        members: [...members].sort((a, b) => gScore(a) - gScore(b)),
      }))
      .sort((a, b) => a.avg - b.avg)

    const medals = ['🥇', '🥈', '🥉']

    return (
      <main className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-100 text-stone-900 p-6 flex flex-col">
        {/* This round's ranking */}
        {rankedOptions.length > 0 && currentResult?.option_points && (
          <div className="mb-6">
            <p className="text-center text-stone-400 text-xs uppercase tracking-widest mb-3">This Round&apos;s Ranking</p>
            <div className="grid grid-cols-4 gap-3 max-w-3xl mx-auto">
              {rankedOptions.map((opt) => {
                const pts = currentResult.option_points![opt.id] ?? 0
                const hasImage = opt.image_url && !opt.image_url.startsWith('/images/')
                const noImgBg: Record<string, string> = { a: 'bg-rose-200', b: 'bg-violet-200', c: 'bg-amber-200', d: 'bg-teal-200' }
                return (
                  <div key={opt.id} className={`rounded-2xl overflow-hidden border-4 ${ptsBorder(pts)}`}>
                    <div className={`relative aspect-square ${!hasImage ? (noImgBg[opt.id] ?? 'bg-stone-200') : ''}`}>
                      {hasImage
                        ? <Image src={opt.image_url} alt={opt.label} fill className="object-cover" unoptimized />
                        : <div className="absolute inset-0 flex items-center justify-center p-3">
                            <span className="text-stone-800 font-black text-xl text-center leading-tight">{opt.label}</span>
                          </div>
                      }
                    </div>
                    <div className={`p-2 text-center ${ptsBg(pts)}`}>
                      <p className={`font-bold text-sm ${ptsTextColor(pts)}`}>{opt.label}</p>
                      <p className={`text-xs ${ptsTextColor(pts)}`}>{ptsLabel(pts)} · {pts > 0 ? `+${pts}` : pts} pt</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Two-column leaderboard */}
        <div className="flex gap-5 flex-1 min-h-0">

          {/* Left: Individual */}
          <div className="flex-1 flex flex-col">
            <h2 className="text-xl font-bold mb-2">🏆 I am the Most NPC</h2>
            <p className="text-stone-400 text-xs mb-3">Lower score = less NPC = better!</p>
            {guests.length === 0 ? (
              <p className="text-stone-400 text-sm">Loading…</p>
            ) : (
              <div className="space-y-1.5 overflow-y-auto">
                {guests.map((g, i) => (
                  <div
                    key={g.id}
                    className={`flex items-center justify-between rounded-xl px-4 py-2.5 ${
                      i < 3 ? 'bg-stone-200 border border-stone-300' : 'bg-stone-100'
                    }`}
                  >
                    <span className="text-lg w-8">{medals[i] ?? `#${i + 1}`}</span>
                    <span className="flex-1 font-semibold">{g.name}</span>
                    <span className="text-stone-400 text-xs mr-4">T{g.table_number}</span>
                    <span className={`font-black text-xl ${scoreColor(g)}`}>{fmtPts(g)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Table rankings */}
          <div className="flex-1 flex flex-col">
            <h2 className="text-xl font-bold mb-2">🪑 The most NPC Table.</h2>
            <p className="text-stone-400 text-xs mb-3">&quot;Hello, It&apos;s dangerous to go alone! Take this Potion!&quot;</p>
            {tableRankings.length === 0 ? (
              <p className="text-stone-400 text-sm">Loading…</p>
            ) : (
              <div className="space-y-2 overflow-y-auto">
                {tableRankings.map((t, i) => (
                  <div key={t.table} className={`rounded-xl overflow-hidden border ${i === 0 ? 'border-emerald-400' : 'border-stone-200'}`}>
                    <div className={`flex items-center px-4 py-2.5 ${i === 0 ? 'bg-emerald-50' : 'bg-stone-100'}`}>
                      <span className="text-lg w-8">{medals[i] ?? `#${i + 1}`}</span>
                      <span className="flex-1 font-bold">Table {t.table}</span>
                      <span className={`font-black text-lg ${t.avg < 0 ? 'text-emerald-700' : t.avg === 0 ? 'text-stone-400' : 'text-rose-600'}`}>
                        avg {t.avg > 0 ? `+${t.avg.toFixed(1)}` : t.avg.toFixed(1)}
                      </span>
                    </div>
                    {/* Expand lowest-scoring table to show members */}
                    {i === 0 && (
                      <div className="bg-emerald-50/60 px-4 pb-2 space-y-1">
                        {t.members.map((m, mi) => (
                          <div key={m.id} className="flex items-center justify-between text-sm pl-8">
                            <span className="text-stone-500 mr-2">#{mi + 1}</span>
                            <span className="flex-1 text-stone-700">{m.name}</span>
                            <span className={`font-bold ${gScore(m) < 0 ? 'text-emerald-700' : gScore(m) === 0 ? 'text-stone-400' : 'text-rose-600'}`}>
                              {fmtPts(m)}
                            </span>
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
      </main>
    )
  }

  // --- LIVE VOTING SCREEN ---
  if ((gameState.status === 'voting' || gameState.status === 'locked') && currentQ) {
    const isLocked = gameState.status === 'locked'
    return (
      <main className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-100 text-stone-900 p-8 flex flex-col">
        <div className="text-center mb-6">
          <p className="text-rose-500 text-sm font-medium uppercase tracking-widest">
            Question {gameState.current_question_index + 1}
          </p>
          <h2 className="text-4xl font-bold mt-1">{currentQ.text}</h2>
          {isLocked
            ? <p className="text-orange-500 text-lg mt-2 animate-pulse">🔒 Voting Locked — Calculating…</p>
            : <div className="flex items-center justify-center gap-4 mt-3">
                <p className="text-stone-500 text-lg">Voting open…</p>
                {countdown !== null && (
                  <span className={`text-5xl font-black tabular-nums transition-colors ${
                    countdown > 5 ? 'text-emerald-600' : countdown > 2 ? 'text-amber-500' : 'text-rose-600 animate-pulse'
                  }`}>
                    {countdown}
                  </span>
                )}
              </div>
          }
        </div>

        <div className="grid grid-cols-4 gap-4 flex-1">
          {currentQ.options.map((opt) => {
            const hasImage = opt.image_url && !opt.image_url.startsWith('/images/')
            const noImgBg: Record<string, string> = { a: 'bg-rose-200', b: 'bg-violet-200', c: 'bg-amber-200', d: 'bg-teal-200' }
            return (
              <div key={opt.id} className="relative rounded-2xl overflow-hidden flex flex-col border-4 border-stone-300">
                <div className={`relative flex-1 min-h-48 ${!hasImage ? (noImgBg[opt.id] ?? 'bg-stone-200') : ''}`}>
                  {hasImage
                    ? <Image src={opt.image_url} alt={opt.label} fill className="object-cover" unoptimized />
                    : <div className="absolute inset-0 flex items-center justify-center p-4">
                        <span className="text-stone-800 font-black text-3xl text-center leading-tight">{opt.label}</span>
                      </div>
                  }
                </div>
                {hasImage && (
                  <div className="p-2 text-center text-sm font-bold bg-stone-100 text-stone-800">{opt.label}</div>
                )}
              </div>
            )
          })}
        </div>
      </main>
    )
  }

  return null
}
