'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { supabase, GameState, Guest } from '@/lib/supabase'
import { fetchQuestions, GameQuestion } from '@/lib/questions'

type Screen = 'login' | 'waiting' | 'voting' | 'voted' | 'results'

export default function GuestPage() {
  const [screen, setScreen] = useState<Screen>('login')
  const [name, setName] = useState('')
  const [tableNumber, setTableNumber] = useState(1)
  const [guest, setGuest] = useState<Guest | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [questions, setQuestions] = useState<GameQuestion[]>([])
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [myVotes, setMyVotes] = useState<Record<number, string>>({})
  const myVotesRef = useRef<Record<number, string>>({})
  const [rank, setRank] = useState<number | null>(null)
  const [totalGuests, setTotalGuests] = useState(0)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState(true)

  // Keep ref in sync so subscription closure always reads latest votes
  useEffect(() => { myVotesRef.current = myVotes }, [myVotes])

  // Fetch rank whenever on results screen or score changes (covers groom override)
  useEffect(() => {
    if (screen !== 'results' || !guest) return
    Promise.all([
      supabase.from('wedding_guests').select('*', { count: 'exact', head: true }).gt('score', guest.score),
      supabase.from('wedding_guests').select('*', { count: 'exact', head: true }),
    ]).then(([{ count: above }, { count: total }]) => {
      setRank((above ?? 0) + 1)
      setTotalGuests(total ?? 0)
    })
  }, [screen, guest?.score])

  useEffect(() => { fetchQuestions().then(setQuestions) }, [])

  const syncScreen = useCallback((gs: GameState, hasVoted: boolean) => {
    if (gs.status === 'waiting') setScreen('waiting')
    else if (gs.status === 'voting') setScreen(hasVoted ? 'voted' : 'voting')
    else if (gs.status === 'locked') setScreen(hasVoted ? 'voted' : 'voting')
    else if (gs.status === 'results') setScreen('results')
  }, [])

  // Restore session from localStorage on page load / refresh
  useEffect(() => {
    const savedId = localStorage.getItem('wedding_guest_id')
    // Only load cached votes if there's also a saved guest ID — otherwise they're stale from a past game
    if (!savedId) { setRestoring(false); return }
    const savedVotes = localStorage.getItem('wedding_guest_votes')
    if (savedVotes) {
      try {
        const parsed = JSON.parse(savedVotes)
        setMyVotes(parsed)
        myVotesRef.current = parsed
      } catch {}
    }
    supabase.from('wedding_guests').select('*').eq('id', savedId).single()
      .then(({ data, error }) => {
        if (error || !data) {
          localStorage.removeItem('wedding_guest_id')
          localStorage.removeItem('wedding_guest_votes')
          myVotesRef.current = {}
        } else {
          setGuest(data)
        }
        setRestoring(false)
      })
  }, [])

  // Subscribe to game_state changes after login
  useEffect(() => {
    if (!guest) return

    // Always reads from ref so this never needs to re-run when votes change
    const resync = () => {
      supabase.from('wedding_game_state').select('*').eq('id', 1).single()
        .then(({ data }) => {
          if (!data) return
          setGameState(data)
          syncScreen(data, !!myVotesRef.current[data.current_question_index])
        })
    }
    resync()

    // Polling fallback in case Realtime drops (every 5s)
    const poll = setInterval(resync, 5000)

    // Re-sync when phone screen unlocks / tab becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') resync()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    const guestChannel = supabase
      .channel('guest-score')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wedding_guests', filter: `id=eq.${guest.id}` },
        (payload) => setGuest(payload.new as Guest)
      )
      .subscribe()

    const channel = supabase
      .channel('game-state-guest')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wedding_game_state', filter: 'id=eq.1' },
        (payload) => {
          const gs = payload.new as GameState
          if (gs.status === 'waiting' && gs.current_question_index === 0) {
            localStorage.removeItem('wedding_guest_id')
            localStorage.removeItem('wedding_guest_votes')
            myVotesRef.current = {}
            setMyVotes({})
            setGuest(null)
            setSelectedOption(null)
            setGameState(null)
            setScreen('login')
            return
          }
          setGameState(gs)
          setSelectedOption(null)
          // Read ref directly — no stale closure, no re-subscription needed
          syncScreen(gs, !!myVotesRef.current[gs.current_question_index])
        }
      )
      .subscribe()

    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', handleVisibility)
      supabase.removeChannel(channel)
      supabase.removeChannel(guestChannel)
    }
  }, [guest, syncScreen])

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
    localStorage.setItem('wedding_guest_id', data.id)
    localStorage.removeItem('wedding_guest_votes')
    myVotesRef.current = {}
    setMyVotes({})
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

    setMyVotes((prev) => {
      const next = { ...prev, [gameState.current_question_index]: optionId }
      localStorage.setItem('wedding_guest_votes', JSON.stringify(next))
      return next
    })
    setScreen('voted')
  }

  const currentQ = gameState ? questions[gameState.current_question_index] : null

  if (restoring) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-100 flex items-center justify-center">
        <div className="text-rose-400 text-5xl animate-pulse">💍</div>
      </main>
    )
  }

  if (screen === 'login') {
    return (
      <main className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">💍</div>
            <h1 className="text-2xl font-bold text-rose-700">I wanna be the very BEST,<br />Like no one EVER WAS</h1>
            <p className="text-sm text-gray-500 mt-1">The Game where u WIN if you&apos;re UNIQUE</p>
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
                {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
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
    const pts = guest?.score ?? 0
    return (
      <main className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-100 flex flex-col items-center justify-center p-6 gap-6">
        {/* Name + table */}
        <div className="text-center">
          <div className="text-5xl mb-3">💍</div>
          <h2 className="text-2xl font-bold text-rose-700">{guest?.name}</h2>
          <p className="text-gray-500 text-sm mt-1">Table {guest?.table_number}</p>
        </div>

        {/* Live score card */}
        <div className="bg-white rounded-3xl shadow-lg px-10 py-6 text-center w-full max-w-xs">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Your Score</p>
          <p className={`text-5xl font-black ${pts < 0 ? 'text-emerald-500' : pts === 0 ? 'text-gray-400' : 'text-rose-600'}`}>
            {pts > 0 ? `+${pts}` : pts}
          </p>
          <p className="text-xs text-gray-400 mt-1">pts</p>
        </div>

        {/* Catchphrase */}
        <div className="bg-rose-600 text-white rounded-2xl px-6 py-4 text-center max-w-xs shadow-lg">
          <p className="font-bold text-lg leading-snug">Don't lah be so Common!</p>
          <p className="text-rose-200 text-xs mt-1">Stand out, or pay the price 😬</p>
        </div>

        {/* Waiting indicator */}
        <div className="text-center">
          <p className="text-gray-400 text-sm">Waiting for host to start…</p>
          <div className="mt-2 flex gap-1 justify-center">
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
      <main className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-100 p-4">
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-6 pt-4">
            <p className="text-rose-500 text-sm font-medium uppercase tracking-widest">Question {(gameState?.current_question_index ?? 0) + 1}</p>
            <h2 className="text-xl font-bold mt-1 leading-snug text-stone-900">{currentQ.text}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {currentQ.options.map((opt) => {
              const hasImage = opt.image_url && !opt.image_url.startsWith('/images/')
              const noImgBg: Record<string, string> = { a: 'bg-rose-200', b: 'bg-violet-200', c: 'bg-amber-200', d: 'bg-teal-200' }
              return (
                <button
                  key={opt.id}
                  onClick={() => handleVote(opt.id)}
                  disabled={!!selectedOption}
                  className={`relative rounded-2xl overflow-hidden aspect-square border-4 transition-all ${
                    selectedOption === opt.id ? 'border-rose-500 scale-95' : 'border-transparent hover:border-stone-400 active:scale-95'
                  } ${!hasImage ? (noImgBg[opt.id] ?? 'bg-stone-200') : ''}`}
                >
                  {hasImage
                    ? <>
                        <Image src={opt.image_url} alt={opt.label} fill className="object-cover" unoptimized />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 py-1 text-sm font-medium text-white">{opt.label}</div>
                      </>
                    : <div className="absolute inset-0 flex items-center justify-center p-4">
                        <span className="text-stone-800 font-black text-2xl text-center leading-tight">{opt.label}</span>
                      </div>
                  }
                </button>
              )
            })}
          </div>
          {error && <p className="text-red-600 text-sm text-center mt-4">{error}</p>}
        </div>
      </main>
    )
  }

  if (screen === 'voted') {
    const pts = guest?.score ?? 0
    return (
      <main className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-100 flex flex-col items-center justify-center p-4 gap-5">
        <div className="text-6xl">✅</div>
        <h2 className="text-2xl font-bold text-stone-900">Vote Cast!</h2>
        <p className="text-stone-500">Waiting for others…</p>
        <div className="bg-stone-100 rounded-2xl px-10 py-5 text-center shadow-sm">
          <p className="text-xs text-stone-400 uppercase tracking-widest mb-1">Your Score</p>
          <p className={`text-5xl font-black ${pts < 0 ? 'text-emerald-600' : pts === 0 ? 'text-stone-400' : 'text-rose-600'}`}>
            {pts > 0 ? `+${pts}` : pts}
          </p>
        </div>
        <p className="text-sm text-rose-500">Don&apos;t lah be so Common!</p>
      </main>
    )
  }

  if (screen === 'results') {
    const pts = guest?.score ?? 0
    return (
      <main className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-100 flex flex-col items-center justify-center p-4 gap-5">
        <div className="text-center">
          <div className="text-5xl mb-2">🎭</div>
          <h2 className="text-2xl font-bold text-stone-900">Results are in!</h2>
          <p className="text-stone-500 text-sm mt-1">Check the big screen for the reveal.</p>
        </div>

        <div className="bg-white rounded-3xl shadow-lg px-10 py-6 text-center w-full max-w-xs">
          <p className="text-xs text-stone-400 uppercase tracking-widest mb-1">Your Score</p>
          <p className={`text-6xl font-black ${pts > 0 ? 'text-emerald-600' : pts === 0 ? 'text-stone-400' : 'text-rose-600'}`}>
            {pts > 0 ? `+${pts}` : pts}
          </p>
        </div>

        {rank !== null && (
          <div className="bg-white rounded-3xl shadow-lg px-10 py-5 text-center w-full max-w-xs">
            <p className="text-xs text-stone-400 uppercase tracking-widest mb-1">Your Ranking</p>
            <p className="text-5xl font-black text-stone-800">#{rank}</p>
            <p className="text-stone-400 text-xs mt-1">of {totalGuests} players</p>
          </div>
        )}
      </main>
    )
  }

  return null
}
