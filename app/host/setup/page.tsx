'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fetchQuestions, GameQuestion } from '@/lib/questions'

const BUCKET = 'wedding-images'

export default function SetupPage() {
  const [questions, setQuestions] = useState<GameQuestion[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [flashSaved, setFlashSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchQuestions().then(setQuestions)
  }, [])

  function updateText(qIndex: number, text: string) {
    setQuestions((prev) =>
      prev.map((q) => (q.question_index === qIndex ? { ...q, text } : q))
    )
  }

  function updateLabel(qIndex: number, optId: string, label: string) {
    setQuestions((prev) =>
      prev.map((q) =>
        q.question_index === qIndex
          ? { ...q, options: q.options.map((o) => (o.id === optId ? { ...o, label } : o)) }
          : q
      )
    )
  }

  async function handleImageUpload(qIndex: number, optId: string, file: File) {
    const key = `q${qIndex}-${optId}`
    setUploading(key)
    setError('')

    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `q${qIndex}-${optId}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: true })

    if (uploadErr) {
      setError(`Upload failed: ${uploadErr.message}`)
      setUploading(null)
      return
    }

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

    setQuestions((prev) =>
      prev.map((q) =>
        q.question_index === qIndex
          ? { ...q, options: q.options.map((o) => (o.id === optId ? { ...o, image_url: publicUrl } : o)) }
          : q
      )
    )
    setUploading(null)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    const { error: dbErr } = await supabase.from('wedding_questions').upsert(
      questions.map((q) => ({
        question_index: q.question_index,
        text: q.text,
        options: q.options,
      }))
    )
    if (dbErr) {
      setError('Save failed: ' + dbErr.message)
    } else {
      setFlashSaved(true)
      setTimeout(() => setFlashSaved(false), 2500)
    }
    setSaving(false)
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-3xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">🛠️ Question Setup</h1>
            <p className="text-gray-400 text-sm mt-1">Edit questions, labels, and upload images</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/host" className="text-sm text-gray-400 hover:text-white transition-colors">
              ← Back to host
            </Link>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-xl transition-colors"
            >
              {flashSaved ? '✓ Saved!' : saving ? 'Saving…' : 'Save All'}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-600 text-red-200 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Questions */}
        {questions.map((q) => (
          <div key={q.question_index} className="bg-gray-800 rounded-2xl p-6 space-y-5">
            {/* Question text */}
            <div className="flex items-start gap-3">
              <span className="text-rose-400 font-bold text-sm mt-2.5 shrink-0">Q{q.question_index + 1}</span>
              <input
                className="flex-1 bg-gray-700 rounded-xl px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-rose-400"
                value={q.text}
                onChange={(e) => updateText(q.question_index, e.target.value)}
                placeholder="Question text…"
              />
            </div>

            {/* Options grid */}
            <div className="grid grid-cols-2 gap-4">
              {q.options.map((opt) => {
                const key = `q${q.question_index}-${opt.id}`
                const isUploading = uploading === key
                const hasImage = opt.image_url && !opt.image_url.startsWith('/images/')

                return (
                  <div key={opt.id} className="bg-gray-700 rounded-xl overflow-hidden">
                    {/* Image upload area */}
                    <label className="relative block aspect-video cursor-pointer group">
                      {hasImage ? (
                        <Image
                          src={opt.image_url}
                          alt={opt.label}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-600 gap-1">
                          <span className="text-2xl">📷</span>
                          <span className="text-gray-400 text-xs">Click to upload</span>
                        </div>
                      )}

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all flex items-center justify-center">
                        {isUploading ? (
                          <span className="text-white text-sm font-bold">Uploading…</span>
                        ) : (
                          <span className="text-white text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                            {hasImage ? '🔄 Replace' : '📷 Upload'}
                          </span>
                        )}
                      </div>

                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={isUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleImageUpload(q.question_index, opt.id, file)
                          e.target.value = ''
                        }}
                      />
                    </label>

                    {/* Label input */}
                    <div className="p-2">
                      <input
                        className="w-full bg-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                        value={opt.label}
                        onChange={(e) => updateLabel(q.question_index, opt.id, e.target.value)}
                        placeholder={`Option ${opt.id.toUpperCase()} label`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Bottom save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-lg transition-colors"
        >
          {flashSaved ? '✓ All Questions Saved!' : saving ? 'Saving…' : 'Save All Questions'}
        </button>

        <p className="text-center text-gray-500 text-xs pb-4">
          Images are stored in Supabase Storage → wedding-images bucket.<br />
          Delete the bucket after the wedding to clean up.
        </p>
      </div>
    </main>
  )
}
