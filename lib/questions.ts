import { supabase } from './supabase'
import { QUESTIONS } from './constants'

export interface GameOption {
  id: string
  label: string
  image_url: string
}

export interface GameQuestion {
  question_index: number
  text: string
  options: GameOption[]
}

export async function fetchQuestions(): Promise<GameQuestion[]> {
  const { data } = await supabase
    .from('wedding_questions')
    .select('*')
    .order('question_index')

  if (data && data.length > 0) return data

  // Fallback to hardcoded constants if DB is empty
  return QUESTIONS.map((q) => ({
    question_index: q.index,
    text: q.text,
    options: q.options.map((o) => ({ id: o.id, label: o.label, image_url: o.image })),
  }))
}
