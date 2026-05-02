'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { QRCodeCanvas as QRCode } from 'qrcode.react'
import { supabase, GameState, Guest, Vote } from '@/lib/supabase'
import { fetchQuestions, GameQuestion } from '@/lib/questions'

const GUEST_URL = process.env.NEXT_PUBLIC_SITE_URL
  ? `${process.env.NEXT_PUBLIC_SITE_URL}/guest`
  : '/guest'

interface QuestionResult {
  question_index: number
  declared_option: string
}

export default function ProjectorPage() {
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [votes, setVotes] = useState<Vote[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  const [questionResults, setQuestionResults] = useState<QuestionResult[]>([])
  const [questions, setQuestions] = useState<GameQuestion[]>([])

  useEffect(() => {
    fetchQuestions().then(setQuestions)
    fetchAll()
    const channel = supabase
      .channel('projector-realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wedding_game_state', filter: 'id=eq.1' }, (p) => {
        const gs = p.new as GameState
        setGameState(gs)
        fetchVotes(gs.current_question_index)
        fetchGuests()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wedding_votes' }, (p) => {
        setVotes((prev) => prev.find((v) => v.id === p.new.id) ? prev : [...prev, p.new as Vote])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wedding_guests' }, () => fetchGuests())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wedding_question_results' }, () => fetchResults())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchAll() {
    const { data: gs } = await supabase.from('wedding_game_state').select('*').eq('id', 1).single()
    if (gs) { setGameState(gs); await fetchVotes(gs.current_question_index) }
    await Promise.all([fetchGuests(), fetchResults()])
  }

  async function fetchVotes(qIndex: number) {
    const { data } = await supabase.from('wedding_votes').select('*').eq('question_index', qIndex)
    setVotes(data ?? [])
  }

  async function fetchGuests() {
    const { data } = await supabase.from('wedding_guests').select('*').order('score', { ascending: true })
    setGuests(data ?? [])
  }

  async function fetchResults() {
    const { data } = await supabase.from('wedding_question_results').select('*')
    if (data) setQuestionResults(data)
  }

  const currentQ = gameState ? questions[gameState.current_question_index] : null
  const chartData = currentQ
    ? currentQ.options.map((opt) => ({
        name: opt.label,
        id: opt.id,
        votes: votes.filter((v) => v.selected_option === opt.id).length,
      }))
    : []
  const currentMajority = chartData.reduce((a, b) => (a.votes >= b.votes ? a : b), chartData[0])

  // Declared loser for the current question (may differ from majority if overridden)
  const currentResult = gameState
    ? questionResults.find((r) => r.question_index === gameState.current_question_index)
    : null

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
    // Sorted ascending: lowest score = best (index 0 = winner)
    const top3 = guests.slice(0, 3)
    const rest = guests.slice(3)
    const rank1Option = currentQ?.options.find((o) => o.id === currentResult?.declared_option)

    const scoreColor = (pts: number) =>
      pts < 0 ? 'text-emerald-400' : pts === 0 ? 'text-gray-300' : 'text-rose-400'
    const fmtPts = (pts: number) => (pts > 0 ? `+${pts}` : String(pts))

    return (
      <main className="min-h-screen bg-gray-950 text-white p-10">
        <h1 className="text-4xl font-bold text-center mb-2">🏆 Leaderboard</h1>

        {/* Scoring legend for this round */}
        {currentQ && currentResult?.declared_option && (
          <div className="flex justify-center gap-3 mb-6 flex-wrap">
            {currentQ.options.map((opt, i) => {
              const rankPts = [-1, 0, 1, 2]
              // Find actual rank of this option based on declared_option being rank1
              const rank = opt.id === currentResult.declared_option ? 0
                : i  // rough — just show the scale
              return null // skip per-option display, show scale instead
            })}
            <span className="bg-gray-800 rounded-xl px-3 py-1.5 text-sm">Most popular: <span className="text-emerald-400 font-bold">-1 pt</span></span>
            <span className="bg-gray-800 rounded-xl px-3 py-1.5 text-sm">2nd: <span className="text-gray-300 font-bold">0 pt</span></span>
            <span className="bg-gray-800 rounded-xl px-3 py-1.5 text-sm">3rd: <span className="text-orange-400 font-bold">+1 pt</span></span>
            <span className="bg-gray-800 rounded-xl px-3 py-1.5 text-sm">Least popular: <span className="text-rose-400 font-bold">+2 pt</span></span>
          </div>
        )}

        {/* Top 3 podium */}
        <div className="flex items-end justify-center gap-6 mb-8">
          {top3.map((g, i) => {
            const medals = ['🥇', '🥈', '🥉']
            const heights = ['h-40', 'h-32', 'h-24']
            const colors = ['bg-emerald-600', 'bg-gray-500', 'bg-gray-600']
            return (
              <div key={g.id} className="flex flex-col items-center">
                <p className="text-xl mb-1">{medals[i]}</p>
                <p className="font-bold text-lg">{g.name}</p>
                <p className="text-sm text-gray-400 mb-2">Table {g.table_number}</p>
                <div className={`${heights[i]} ${colors[i]} w-24 rounded-t-xl flex items-end justify-center pb-2`}>
                  <span className={`font-black text-2xl ${scoreColor(g.score)}`}>
                    {fmtPts(g.score)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {rest.length > 0 && (
          <div className="max-w-md mx-auto space-y-2">
            {rest.map((g, i) => (
              <div key={g.id} className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-2">
                <span className="text-gray-400 mr-3">#{i + 4}</span>
                <span className="flex-1">{g.name} <span className="text-gray-500 text-sm">· Table {g.table_number}</span></span>
                <span className={`font-bold ${scoreColor(g.score)}`}>{fmtPts(g.score)} pts</span>
              </div>
            ))}
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
            ? <p className="text-orange-400 text-lg mt-2 animate-pulse">🔒 Voting Locked — Reveal incoming…</p>
            : <p className="text-gray-400 text-lg mt-2">{votes.length} vote{votes.length !== 1 ? 's' : ''} cast so far</p>
          }
        </div>

        {/* Images — counts hidden during voting, revealed on lock */}
        <div className="grid grid-cols-4 gap-4 mb-6 flex-1">
          {currentQ.options.map((opt) => {
            const count = votes.filter((v) => v.selected_option === opt.id).length
            const isMostVoted = isLocked && opt.id === currentMajority?.id
            return (
              <div
                key={opt.id}
                className={`relative rounded-2xl overflow-hidden flex flex-col border-4 transition-all ${
                  isMostVoted ? 'border-emerald-400 scale-105' : 'border-gray-700'
                }`}
              >
                <div className="relative flex-1 min-h-48">
                  <Image src={opt.image_url} alt={opt.label} fill className="object-cover" unoptimized />
                  {isMostVoted && (
                    <div className="absolute inset-0 bg-emerald-600/20 flex items-center justify-center">
                      <span className="text-4xl">👑</span>
                    </div>
                  )}
                </div>
                <div className={`p-2 text-center text-sm font-bold ${isMostVoted ? 'bg-emerald-700' : 'bg-gray-800'}`}>
                  {opt.label}{isLocked ? ` — ${count} vote${count !== 1 ? 's' : ''}` : ''}
                </div>
              </div>
            )
          })}
        </div>

        {/* Bar chart — only shown after lock */}
        {isLocked && (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barSize={60}>
                <XAxis dataKey="name" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#1f2937', border: 'none', borderRadius: 8 }} />
                <Bar dataKey="votes" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.id}
                      fill={entry.id === currentMajority?.id ? '#34d399' : '#6366f1'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <p className="text-center text-gray-500 text-sm mt-2">
          {votes.length} vote{votes.length !== 1 ? 's' : ''} cast so far
        </p>
      </main>
    )
  }

  return null
}
