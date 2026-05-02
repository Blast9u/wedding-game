'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { supabase, GameState, Guest } from '@/lib/supabase'
import { QUESTIONS } from '@/lib/constants'

type Screen = 'login' | 'waiting' | 'voting' | 'voted' | 'results'

export default function GuestPage() {
  const [screen, setScreen] = useState<Screen>('login')
  const [name, setName] = useState('')
  const [tableNumber, setTableNumber] = useState(1)
  const [guest, setGuest] = useState<Guest | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [myVotes, setMyVotes] = useState<Record<number, string>>({})
  const [error, setError] = useState('')

  const syncScreen = useCallback((gs: GameState, hasVoted: boolean) => {
    if (gs.status === 'waiting') setScreen('waiting')
    else if (gs.status === 'voting') setScreen(hasVoted ? 'voted' : 'voting')
    else if (gs.status === 'locked') setScreen(hasVoted ? 'voted' : 'voting')
    else if (gs.status === 'results') setScreen('results')
  }, [])

  // Subscribe to game_state changes after login
  useEffect(() => {
    if (!guest) return

    // Fetch current game state
    supabase
      .from('wedding_game_state')
      .select('*')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        if (data) {
          setGameState(data)
          const hasVoted = !!myVotes[data.current_question_index]
          syncScreen(data, hasVoted)
        }
      })

    const channel = supabase
      .channel('game-state-guest')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wedding_game_state', filter: 'id=eq.1' },
        (payload) => {
          const gs = payload.new as GameState
          setGameState(gs)
          setSelectedOption(null)
          setMyVotes((prev) => {
            const hasVoted = !!prev[gs.current_question_index]
            syncScreen(gs, hasVoted)
            return prev
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [guest, myVotes, syncScreen])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Please enter your name.'); return }

    const { data, error: dbErr } = await supabase
      .from('wedding_guests')
      .insert({ name: name.trim(), table_number: tableNumber })
      .select()
      .single()

    if (dbErr) { setError('Could not join. Try again.'); return }
    setGuest(data)
    setScreen('waiting')
  }

  async function handleVote(optionId: string) {
    if (!guest || !gameState || selectedOption) return
    setSelectedOption(optionId)

    const { error: dbErr } = await supabase.from('wedding_votes').insert({
      guest_id: guest.id,
      question_index: gameState.current_question_index,
      selected_option: optionId,
    })

    if (dbErr) {
      setError('Vote failed — already voted?')
      setSelectedOption(null)
      return
    }

    setMyVotes((prev) => ({ ...prev, [gameState.current_question_index]: optionId }))
    setScreen('voted')
  }

  const currentQ = gameState ? QUESTIONS[gameState.current_question_index] : null

  if (screen === 'login') {
    return (
      <main className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">💍</div>
            <h1 className="text-2xl font-bold text-rose-700">Majority Loses</h1>
            <p className="text-sm text-gray-500 mt-1">The wedding game where the crowd loses!</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
              <input
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-rose-400"
                placeholder="e.g. Ahmad"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Table</label>
              <select
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-rose-400"
                value={tableNumber}
                onChange={(e) => setTableNumber(Number(e.target.value))}
              >
                {[1,2,3,4,5,6,7,8,9].map((n) => (
                  <option key={n} value={n}>Table {n}</option>
                ))}
              </select>
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 rounded-xl text-base transition-colors"
            >
              Join the Game 🎉
            </button>
          </form>
        </div>
      </main>
    )
  }

  if (screen === 'waiting') {
    return (
      <main className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-100 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">⏳</div>
          <h2 className="text-2xl font-bold text-rose-700">Welcome, {guest?.name}!</h2>
          <p className="text-gray-600 mt-2">Table {guest?.table_number}</p>
          <p className="text-gray-500 mt-6">Waiting for the host to start…</p>
          <div className="mt-4 flex gap-1 justify-center">
            {[0,1,2].map((i) => (
              <div key={i} className="w-2 h-2 rounded-full bg-rose-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      </main>
    )
  }

  if (screen === 'voting' && currentQ) {
    return (
      <main className="min-h-screen bg-gray-900 text-white p-4">
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-6 pt-4">
            <p className="text-rose-400 text-sm font-medium uppercase tracking-widest">Question {(gameState?.current_question_index ?? 0) + 1}</p>
            <h2 className="text-xl font-bold mt-1 leading-snug">{currentQ.text}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {currentQ.options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleVote(opt.id)}
                disabled={!!selectedOption}
                className={`relative rounded-2xl overflow-hidden aspect-square border-4 transition-all ${
                  selectedOption === opt.id
                    ? 'border-rose-500 scale-95'
                    : 'border-transparent hover:border-white/40 active:scale-95'
                }`}
              >
                <Image
                  src={opt.image}
                  alt={opt.label}
                  fill
                  className="object-cover"
                  unoptimized
                />
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 py-1 text-sm font-medium">
                  {opt.label}
                </div>
              </button>
            ))}
          </div>
          {error && <p className="text-red-400 text-sm text-center mt-4">{error}</p>}
        </div>
      </main>
    )
  }

  if (screen === 'voted') {
    return (
      <main className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-2xl font-bold">Vote Cast!</h2>
          <p className="text-gray-400 mt-2">Waiting for others…</p>
          <p className="text-sm text-rose-400 mt-6">🤞 Hope you didn&apos;t pick the majority!</p>
        </div>
      </main>
    )
  }

  if (screen === 'results') {
    return (
      <main className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl mb-4">🎭</div>
          <h2 className="text-2xl font-bold">Results are in!</h2>
          <p className="text-gray-400 mt-2">Check the big screen for the reveal.</p>
          <p className="text-sm text-gray-500 mt-1">
            Your penalty points: <span className="text-rose-400 font-bold">{guest?.penalty_points ?? 0}</span>
          </p>
        </div>
      </main>
    )
  }

  return null
}
