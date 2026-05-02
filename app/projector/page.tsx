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
    const { data } = await supabase.from('wedding_guests').select('*').order('penalty_points', { ascending: false })
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
    const top3 = guests.slice(0, 3)
    const rest = guests.slice(3)
    const topPenalty = guests[0]?.penalty_points ?? 0
    const declaredLoser = currentQ?.options.find((o) => o.id === currentResult?.declared_option)

    return (
      <main className="min-h-screen bg-gray-950 text-white p-10">
        <h1 className="text-4xl font-bold text-center mb-2">🏆 Leaderboard</h1>
        <p className="text-center text-gray-400 mb-8">
          Question {gameState.current_question_index + 1} —{' '}
          {declaredLoser
            ? <>Losing option: <span className="text-rose-400 font-bold">{declaredLoser.label}</span></>
            : 'Calculating…'
          }
        </p>

        {/* Top 3 podium */}
        <div className="flex items-end justify-center gap-6 mb-8">
          {top3.map((g, i) => {
            const medals = ['🥇', '🥈', '🥉']
            const heights = ['h-40', 'h-32', 'h-24']
            const colors = ['bg-yellow-500', 'bg-gray-400', 'bg-amber-700']
            return (
              <div key={g.id} className="flex flex-col items-center">
                <p className="text-xl mb-1">{medals[i]}</p>
                <p className="font-bold text-lg">{g.name}</p>
                <p className="text-sm text-gray-400 mb-2">Table {g.table_number}</p>
                <div className={`${heights[i]} ${colors[i]} w-24 rounded-t-xl flex items-end justify-center pb-2`}>
                  <span className={`font-black text-2xl ${g.penalty_points === topPenalty ? 'text-rose-200' : ''}`}>
                    {g.penalty_points}
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
                <span className="font-bold text-rose-400">{g.penalty_points} pts</span>
              </div>
            ))}
          </div>
        )}
      </main>
    )
  }

  // --- LIVE VOTING SCREEN ---
  if ((gameState.status === 'voting' || gameState.status === 'locked') && currentQ) {
    return (
      <main className="min-h-screen bg-gray-950 text-white p-8 flex flex-col">
        <div className="text-center mb-6">
          <p className="text-rose-400 text-sm font-medium uppercase tracking-widest">
            Question {gameState.current_question_index + 1}
          </p>
          <h2 className="text-4xl font-bold mt-1">{currentQ.text}</h2>
          {gameState.status === 'locked' && (
            <p className="text-orange-400 text-lg mt-2 animate-pulse">🔒 Voting Locked — Calculating…</p>
          )}
        </div>

        {/* Images */}
        <div className="grid grid-cols-4 gap-4 mb-6 flex-1">
          {currentQ.options.map((opt) => {
            const count = votes.filter((v) => v.selected_option === opt.id).length
            const isMajority = opt.id === currentMajority?.id && gameState.status === 'locked'
            return (
              <div
                key={opt.id}
                className={`relative rounded-2xl overflow-hidden flex flex-col border-4 transition-all ${
                  isMajority ? 'border-rose-500 scale-105' : 'border-gray-700'
                }`}
              >
                <div className="relative flex-1 min-h-48">
                  <Image src={opt.image_url} alt={opt.label} fill className="object-cover" unoptimized />
                  {isMajority && (
                    <div className="absolute inset-0 bg-rose-600/30 flex items-center justify-center">
                      <span className="text-4xl">😬</span>
                    </div>
                  )}
                </div>
                <div className={`p-2 text-center text-sm font-bold ${isMajority ? 'bg-rose-700' : 'bg-gray-800'}`}>
                  {opt.label} — {count} vote{count !== 1 ? 's' : ''}
                </div>
              </div>
            )
          })}
        </div>

        {/* Bar chart */}
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
                    fill={gameState.status === 'locked' && entry.id === currentMajority?.id ? '#f43f5e' : '#6366f1'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <p className="text-center text-gray-500 text-sm mt-2">
          {votes.length} vote{votes.length !== 1 ? 's' : ''} cast so far
        </p>
      </main>
    )
  }

  return null
}
