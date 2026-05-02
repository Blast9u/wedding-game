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
      <main className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="text-7xl mb-6">💍</div>
          <h1 className="text-5xl font-bold mb-2">Majority Loses</h1>
          <p className="text-xl text-gray-400 mb-10">Scan to join the game!</p>
          <div className="bg-white rounded-3xl p-6 inline-block">
            <QRCode value={GUEST_URL} size={220} />
          </div>
          <p className="text-gray-500 mt-6 text-sm">{GUEST_URL}</p>
        </div>
      </main>
    )
  }

  // --- RESULTS / LEADERBOARD SCREEN ---
  if (gameState.status === 'results') {
    const fmtPts = (g: Guest) => {
      const pts = g.score ?? (g as unknown as Record<string, number>).penalty_points ?? 0
      return pts > 0 ? `+${pts}` : String(pts)
    }
    const scoreColor = (g: Guest) => {
      const pts = g.score ?? (g as unknown as Record<string, number>).penalty_points ?? 0
      return pts < 0 ? 'text-emerald-400' : pts === 0 ? 'text-gray-300' : 'text-rose-400'
    }

    const rankedOptions = currentQ && currentResult?.option_points
      ? [...currentQ.options].sort((a, b) =>
          (currentResult.option_points![a.id] ?? 99) - (currentResult.option_points![b.id] ?? 99)
        )
      : []

    const ptsBorder = (pts: number) =>
      pts === -1 ? 'border-emerald-400' : pts === 2 ? 'border-rose-500' : 'border-gray-600'
    const ptsBg = (pts: number) =>
      pts === -1 ? 'bg-emerald-800' : pts === 2 ? 'bg-rose-900' : 'bg-gray-800'
    const ptsLabel = (pts: number) =>
      pts === -1 ? 'Most Popular' : pts === 0 ? '2nd' : pts === 1 ? '3rd' : 'Least Popular'

    return (
      <main className="min-h-screen bg-gray-950 text-white p-8 flex flex-col">
        {/* This round's ranking */}
        {rankedOptions.length > 0 && currentResult?.option_points && (
          <div className="mb-8">
            <p className="text-center text-gray-400 text-sm uppercase tracking-widest mb-4">This Round&apos;s Ranking</p>
            <div className="grid grid-cols-4 gap-4 max-w-3xl mx-auto">
              {rankedOptions.map((opt) => {
                const pts = currentResult.option_points![opt.id] ?? 0
                return (
                  <div key={opt.id} className={`rounded-2xl overflow-hidden border-4 ${ptsBorder(pts)}`}>
                    <div className="relative aspect-square">
                      <Image src={opt.image_url} alt={opt.label} fill className="object-cover" unoptimized />
                    </div>
                    <div className={`p-2 text-center ${ptsBg(pts)}`}>
                      <p className="font-bold text-sm">{opt.label}</p>
                      <p className="text-xs text-gray-300">{ptsLabel(pts)} · {pts > 0 ? `+${pts}` : pts} pt</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <h1 className="text-3xl font-bold text-center mb-2">🏆 Most Common People</h1>
        <p className="text-center text-gray-500 text-sm mb-5">Lower score = less common = better!</p>

        {guests.length === 0 ? (
          <p className="text-center text-gray-500 mt-6">Loading scores…</p>
        ) : (
          <div className="max-w-2xl mx-auto w-full space-y-2">
            {guests.map((g, i) => {
              const medals = ['🥇', '🥈', '🥉']
              return (
                <div
                  key={g.id}
                  className={`flex items-center justify-between rounded-2xl px-5 py-3 ${
                    i < 3 ? 'bg-gray-700 border border-gray-600' : 'bg-gray-800'
                  }`}
                >
                  <span className="text-xl w-10">{medals[i] ?? `#${i + 1}`}</span>
                  <span className="flex-1 font-semibold text-lg">{g.name}</span>
                  <span className="text-gray-400 text-sm mr-6">Table {g.table_number}</span>
                  <span className={`font-black text-2xl ${scoreColor(g)}`}>{fmtPts(g)}</span>
                </div>
              )
            })}
          </div>
        )}
      </main>
    )
  }

  // --- LIVE VOTING SCREEN ---
  if ((gameState.status === 'voting' || gameState.status === 'locked') && currentQ) {
    const isLocked = gameState.status === 'locked'
    return (
      <main className="min-h-screen bg-gray-950 text-white p-8 flex flex-col">
        <div className="text-center mb-6">
          <p className="text-rose-400 text-sm font-medium uppercase tracking-widest">
            Question {gameState.current_question_index + 1}
          </p>
          <h2 className="text-4xl font-bold mt-1">{currentQ.text}</h2>
          {isLocked
            ? <p className="text-orange-400 text-lg mt-2 animate-pulse">🔒 Voting Locked — Calculating…</p>
            : <p className="text-gray-400 text-lg mt-2">Voting open…</p>
          }
        </div>

        {/* Option images — no vote counts shown at any stage here */}
        <div className="grid grid-cols-4 gap-4 flex-1">
          {currentQ.options.map((opt) => (
            <div
              key={opt.id}
              className="relative rounded-2xl overflow-hidden flex flex-col border-4 border-gray-700"
            >
              <div className="relative flex-1 min-h-48">
                <Image src={opt.image_url} alt={opt.label} fill className="object-cover" unoptimized />
              </div>
              <div className="p-2 text-center text-sm font-bold bg-gray-800">
                {opt.label}
              </div>
            </div>
          ))}
        </div>
      </main>
    )
  }

  return null
}
