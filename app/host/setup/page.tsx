'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '@/lib/supabase'
import { fetchQuestions, GameQuestion } from '@/lib/questions'

const BUCKET = 'wedding-images'

// ── Sortable question card ──────────────────────────────────────────────────

function SortableQuestion({
  q,
  displayIndex,
  uploading,
  onTextChange,
  onLabelChange,
  onImageUpload,
}: {
  q: GameQuestion
  displayIndex: number
  uploading: string | null
  onTextChange: (qIndex: number, text: string) => void
  onLabelChange: (qIndex: number, optId: string, label: string) => void
  onImageUpload: (qIndex: number, optId: string, file: File) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: q.question_index })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="bg-gray-800 rounded-2xl p-6 space-y-5">
      {/* Question header with drag handle */}
      <div className="flex items-start gap-3">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-2.5 shrink-0 cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300 transition-colors touch-none"
          title="Drag to reorder"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <circle cx="6" cy="4" r="1.5"/><circle cx="12" cy="4" r="1.5"/>
            <circle cx="6" cy="9" r="1.5"/><circle cx="12" cy="9" r="1.5"/>
            <circle cx="6" cy="14" r="1.5"/><circle cx="12" cy="14" r="1.5"/>
          </svg>
        </button>

        <span className="text-rose-400 font-bold text-sm mt-2.5 shrink-0">Q{displayIndex + 1}</span>

        <input
          className="flex-1 bg-gray-700 rounded-xl px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-rose-400"
          value={q.text}
          onChange={(e) => onTextChange(q.question_index, e.target.value)}
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
              <label className="relative block aspect-video cursor-pointer group">
                {hasImage ? (
                  <Image src={opt.image_url} alt={opt.label} fill className="object-cover" unoptimized />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-600 gap-1">
                    <span className="text-2xl">📷</span>
                    <span className="text-gray-400 text-xs">Click to upload</span>
                  </div>
                )}
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
                    if (file) onImageUpload(q.question_index, opt.id, file)
                    e.target.value = ''
                  }}
                />
              </label>
              <div className="p-2">
                <input
                  className="w-full bg-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                  value={opt.label}
                  onChange={(e) => onLabelChange(q.question_index, opt.id, e.target.value)}
                  placeholder={`Option ${opt.id.toUpperCase()} label`}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function SetupPage() {
  const [questions, setQuestions] = useState<GameQuestion[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [flashSaved, setFlashSaved] = useState(false)
  const [error, setError] = useState('')

  const sensors = useSensors(useSensor(PointerSensor))

  useEffect(() => {
    fetchQuestions().then(setQuestions)
  }, [])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setQuestions((prev) => {
      const oldIndex = prev.findIndex((q) => q.question_index === active.id)
      const newIndex = prev.findIndex((q) => q.question_index === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  function updateText(qIndex: number, text: string) {
    setQuestions((prev) => prev.map((q) => (q.question_index === qIndex ? { ...q, text } : q)))
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

    const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
    if (uploadErr) { setError(`Upload failed: ${uploadErr.message}`); setUploading(null); return }

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)
    const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`

    setQuestions((prev) =>
      prev.map((q) =>
        q.question_index === qIndex
          ? { ...q, options: q.options.map((o) => (o.id === optId ? { ...o, image_url: cacheBustedUrl } : o)) }
          : q
      )
    )
    setUploading(null)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    // Reassign question_index based on current display order before saving
    const ordered = questions.map((q, i) => ({ ...q, question_index: i }))
    const { error: dbErr } = await supabase.from('wedding_questions').upsert(
      ordered.map((q) => ({ question_index: q.question_index, text: q.text, options: q.options }))
    )
    if (dbErr) {
      setError('Save failed: ' + dbErr.message)
    } else {
      setQuestions(ordered)
      setFlashSaved(true)
      setTimeout(() => setFlashSaved(false), 2500)
    }
    setSaving(false)
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">🛠️ Question Setup</h1>
            <p className="text-gray-400 text-sm mt-1">Drag to reorder · click image to upload</p>
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

        {/* Draggable question list */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={questions.map((q) => q.question_index)} strategy={verticalListSortingStrategy}>
            <div className="space-y-4">
              {questions.map((q, i) => (
                <SortableQuestion
                  key={q.question_index}
                  q={q}
                  displayIndex={i}
                  uploading={uploading}
                  onTextChange={updateText}
                  onLabelChange={updateLabel}
                  onImageUpload={handleImageUpload}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-lg transition-colors"
        >
          {flashSaved ? '✓ All Questions Saved!' : saving ? 'Saving…' : 'Save All Questions'}
        </button>

        <p className="text-center text-gray-500 text-xs pb-4">
          Drag the ⠿ handle to reorder. Order is saved when you hit Save All.
        </p>
      </div>
    </main>
  )
}
