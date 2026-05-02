export interface QuestionOption {
  id: string
  image: string
  label: string
}

export interface Question {
  index: number
  text: string
  options: QuestionOption[]
}

export const QUESTIONS: Question[] = [
  {
    index: 0,
    text: "Which pre-wed photo of the couple is your favourite?",
    options: [
      { id: 'a', image: '/images/q1-a.jpg', label: 'Option A' },
      { id: 'b', image: '/images/q1-b.jpg', label: 'Option B' },
      { id: 'c', image: '/images/q1-c.jpg', label: 'Option C' },
      { id: 'd', image: '/images/q1-d.jpg', label: 'Option D' },
    ],
  },
  {
    index: 1,
    text: "Which of these is AI generated?",
    options: [
      { id: 'a', image: '/images/q2-a.jpg', label: 'Image A' },
      { id: 'b', image: '/images/q2-b.jpg', label: 'Image B' },
      { id: 'c', image: '/images/q2-c.jpg', label: 'Image C' },
      { id: 'd', image: '/images/q2-d.jpg', label: 'Image D' },
    ],
  },
  {
    index: 2,
    text: "Where would you recommend they go for their Honeymoon?",
    options: [
      { id: 'a', image: '/images/q3-a.jpg', label: 'Maldives' },
      { id: 'b', image: '/images/q3-b.jpg', label: 'Santorini' },
      { id: 'c', image: '/images/q3-c.jpg', label: 'Tokyo' },
      { id: 'd', image: '/images/q3-d.jpg', label: 'Bali' },
    ],
  },
]

export const TOTAL_QUESTIONS = QUESTIONS.length
