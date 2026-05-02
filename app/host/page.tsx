'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { supabase, GameState, Guest } from '@/lib/supabase'
import { fetchQuestions, GameQuestion } from '@/lib/questions'
import Link from 'next/link'

interface QuestionResult {
  question_index: number
  declared_option: string
}

export default function HostPage() {
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [guestCount, setGuestCount] = useState(0)
  const [voteCount, setVoteCount] = useState(0)
  const [guests, setGuests] = useState<Guest[]>([])
  const [questionResults, setQuestionResults] = useState<QuestionResult[]>([])
  const [questions, setQuestions] = useState<GameQuestion[]>([])
  const [overrideOrder, setOverrideOrder] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchQuestions().then(setQuestions)
    fetchAll()
    const channel = supabase
      .channel('host-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wedding_game_state' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wedding_votes' }, fetchVotes)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wedding_guests' }, fetchGuests)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wedding_question_results' }, fetchResults)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchAll() {
    await Promise.all([fetchGameState(), fetchGuests(), fetchVotes(), fetchResults()])
  }

  async function fetchGameState() {
    const { data } = await supabase.from('wedding_game_state').select('*').eq('id', 1).single()
    if (data) setGameState(data)
  }

  async function fetchGuests() {
    const { data } = await supabase.from('wedding_guests').select('*').order('score', { ascending: true })
    if (data) { setGuests(data); setGuestCount(data.length) }
  }

  async function fetchVotes() {
    const { data: gs } = await supabase.from('wedding_game_state').select('*').eq('id', 1).single()
    if (!gs) return
    const { data } = await supabase.from('wedding_votes').select('*').eq('question_index', gs.current_question_index)
    setVoteCount(data?.length ?? 0)
  }

  async function fetchResults() {
    const { data } = await supabase.from('wedding_question_results').select('*')
    if (data) setQuestionResults(data)
  }

  async function updateGameState(patch: Partial<GameState>) {
    setLoading(true)
    await supabase.from('wedding_game_state').update(patch).eq('id', 1)
    await fetchAll()
    setLoading(false)
  }

  async function handleNextQuestion() {
    if (!gameState) return
    // From waiting: start Q1 without incrementing. From results: advance to next question.
    const nextIndex = gameState.status === 'waiting'
      ? gameState.current_question_index
      : gameState.current_question_index + 1
    await updateGameState({ current_question_index: nextIndex, status: 'voting' })
  }

  async function handleLockVotes() {
    await updateGameState({ status: 'locked' })
  }

  async function handleCalculateMajority() {
    if (!gameState) return
    setLoading(true)
    await supabase.rpc('apply_question_result', { q_index: gameState.current_question_index })
    await updateGameState({ status: 'results' })
    setLoading(false)
  }

  // picks[0]=most penalized(2pts) … picks[3]=least penalized(-1pt)
  // RPC force_order: [rank1(-1pt)…rank4(2pt)] = picks reversed
  async function handleApplyOverride() {
    if (!gameState || overrideOrder.length !== 4) return
    setLoading(true)
    const forceOrder = [...overrideOrder].reverse()
    // Show OVERRIDE on projector, wait 3s for drama before calculating
    await supabase.from('wedding_game_state').update({ status: 'override' }).eq('id', 1)
    await new Promise(r => setTimeout(r, 3000))
    await supabase.rpc('apply_question_result', { q_index: gameState.current_question_index, force_order: forceOrder })
    await supabase.from('wedding_game_state').update({ status: 'results' }).eq('id', 1)
    await fetchAll()
    setOverrideOrder([])
    setLoading(false)
  }

  async function handleResetGame() {
    if (!confirm('Reset ALL game data? This clears all guests, votes, and penalty points.')) return
    setLoading(true)
    await supabase.from('wedding_question_results').delete().neq('question_index', -1)
    await supabase.from('wedding_votes').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('wedding_guests').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('wedding_game_state').update({ current_question_index: 0, status: 'waiting' }).eq('id', 1)
    await fetchAll()
    setLoading(false)
  }

  const currentQ = gameState ? questions[gameState.current_question_index] : null
  const isLastQuestion = gameState ? gameState.current_question_index >= questions.length - 1 : false

  const statusColor: Record<string, string> = {
    waiting: 'bg-yellow-100 text-yellow-800',
    voting: 'bg-green-100 text-green-800',
    locked: 'bg-orange-100 text-orange-800',
    results: 'bg-blue-100 text-blue-800',
    override: 'bg-yellow-400 text-black',
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">🎙️ Host Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">Majority Loses — Wedding Game</p>
          </div>
          <div className="flex gap-2">
            <Link href="/host/setup" className="text-xs bg-indigo-700 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg transition-colors font-medium">
              🛠️ Setup Questions
            </Link>
            <button onClick={handleResetGame} disabled={loading} className="text-xs bg-red-900 hover:bg-red-700 text-red-200 px-3 py-1.5 rounded-lg transition-colors">
              Reset Game
            </button>
          </div>
        </div>

        {/* Status strip */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-800 rounded-2xl p-4 text-center">
            <p className="text-gray-400 text-xs uppercase tracking-wider">Status</p>
            <span className={`inline-block mt-1 px-3 py-1 rounded-full text-sm font-bold ${statusColor[gameState?.status ?? 'waiting']}`}>
              {gameState?.status ?? '…'}
            </span>
          </div>
          <div className="bg-gray-800 rounded-2xl p-4 text-center">
            <p className="text-gray-400 text-xs uppercase tracking-wider">Guests Joined</p>
            <p className="text-3xl font-bold mt-1">{guestCount}</p>
          </div>
          <div className="bg-gray-800 rounded-2xl p-4 text-center">
            <p className="text-gray-400 text-xs uppercase tracking-wider">Votes In</p>
            <p className="text-3xl font-bold mt-1">{voteCount} / {guestCount}</p>
          </div>
        </div>

        {/* Current question */}
        <div className="bg-gray-800 rounded-2xl p-5">
          <p className="text-gray-400 text-sm mb-1">Question {(gameState?.current_question_index ?? 0) + 1} of {questions.length}</p>
          <p className="text-lg font-semibold">{currentQ?.text}</p>
        </div>

        {/* Game flow controls */}
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={handleNextQuestion}
            disabled={loading || gameState?.status === 'voting' || gameState?.status === 'locked' || isLastQuestion && gameState?.status !== 'waiting'}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl text-lg transition-colors"
          >
            {isLastQuestion ? '✅ Last Question Done' : gameState?.status === 'waiting' ? '🚀 Start Game' : '▶️ Next Question'}
          </button>
          <button
            onClick={handleLockVotes}
            disabled={loading || gameState?.status !== 'voting'}
            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl text-lg transition-colors"
          >
            🔒 Lock Voting
          </button>
          <button
            onClick={handleCalculateMajority}
            disabled={loading || gameState?.status !== 'locked'}
            className="col-span-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl text-lg transition-colors"
          >
            🧮 Calculate Majority &amp; Show Results
          </button>
        </div>

        {/* ── GROOM OVERRIDE — shown during results, rank all 4 options ── */}
        {gameState?.status === 'results' && (
          <div className="bg-gray-900 border border-yellow-600/50 rounded-2xl p-5">
            <h2 className="text-yellow-400 font-bold text-lg mb-1">👑 Groom Override</h2>
            <p className="text-yellow-300 text-xs mb-1">
              Tap options in order — 1st tap = most penalized (2 pts) → 4th tap = least penalized (-1 pt)
            </p>
            <p className="text-gray-400 text-sm mb-3 font-medium">
              {overrideOrder.length === 0
                ? 'Tap your 1st choice (gets +2 pts)'
                : overrideOrder.length < 4
                ? `Good — now tap choice #${overrideOrder.length + 1} of 4`
                : '✅ All ranked! Hit Apply when ready.'}
            </p>

            {!currentQ && <p className="text-gray-500 text-sm py-4 text-center">Loading question…</p>}
            <div className="grid grid-cols-4 gap-2 mb-4">
              {(currentQ?.options ?? []).map((opt) => {
                const pickIndex = overrideOrder.indexOf(opt.id)
                const isPicked = pickIndex >= 0
                const rankLabels = ['1st · +2pts', '2nd · +1pt', '3rd · 0pt', '4th · -1pt']
                const rankColors = ['text-rose-400', 'text-orange-400', 'text-gray-300', 'text-emerald-400']
                return (
                  <button
                    key={opt.id}
                    disabled={loading}
                    onClick={() => {
                      if (isPicked) {
                        setOverrideOrder(prev => prev.slice(0, pickIndex))
                      } else if (overrideOrder.length < 4) {
                        setOverrideOrder(prev => [...prev, opt.id])
                      }
                    }}
                    className={`relative rounded-lg overflow-hidden aspect-square border-2 transition-all ${
                      isPicked ? 'border-yellow-400 brightness-110' : 'border-gray-600 hover:border-yellow-500 hover:brightness-110'
                    }`}
                  >
                    <Image src={opt.image_url} alt={opt.label} fill className="object-cover" unoptimized />
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-end pb-1.5">
                      <span className="text-white text-xs font-bold">{opt.label}</span>
                      {isPicked && (
                        <span className={`text-xs font-bold ${rankColors[pickIndex]}`}>{rankLabels[pickIndex]}</span>
                      )}
                    </div>
                    {isPicked && (
                      <div className="absolute top-1.5 left-1.5 bg-yellow-500 text-black text-xs font-black w-6 h-6 rounded-full flex items-center justify-center">
                        {pickIndex + 1}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setOverrideOrder([])}
                disabled={overrideOrder.length === 0 || loading}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-gray-200 text-sm font-bold rounded-xl transition-colors"
              >
                Reset
              </button>
              <button
                onClick={handleApplyOverride}
                disabled={overrideOrder.length !== 4 || loading}
                className="flex-1 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-30 disabled:cursor-not-allowed text-black font-black py-2 rounded-xl text-base transition-colors"
              >
                {loading ? 'Applying…' : overrideOrder.length === 4 ? '✅ Apply Override' : `Rank all 4 first (${overrideOrder.length}/4)`}
              </button>
            </div>
          </div>
        )}

        {/* Leaderboard */}
        <div className="bg-gray-800 rounded-2xl p-5">
          <h2 className="font-bold text-lg mb-3">Live Penalty Leaderboard</h2>
          {guests.length === 0 ? (
            <p className="text-gray-500 text-sm">No guests yet.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {guests.map((g, i) => (
                <div key={g.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">
                    <span className="text-gray-500 mr-2">#{i + 1}</span>
                    {g.name} <span className="text-gray-500">· Table {g.table_number}</span>
                  </span>
                  <span className={`font-bold ${g.score > 0 ? 'text-rose-400' : 'text-gray-500'}`}>
                    {g.score} pts
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </main>
  )
}
