import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getSupabase() {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return _client
}

// Convenience proxy — works identically to the old `supabase` export
// but defers client creation to first use (avoids build-time crash)
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as never)[prop]
  },
})

export type GameStatus = 'waiting' | 'voting' | 'locked' | 'results'

export interface GameState {
  id: number
  current_question_index: number
  status: GameStatus
}

export interface Guest {
  id: string
  name: string
  table_number: number
  score: number
}

export interface Vote {
  id: string
  guest_id: string
  question_index: number
  selected_option: string
}
