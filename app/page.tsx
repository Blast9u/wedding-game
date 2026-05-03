import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-rose-50 to-pink-100 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="text-6xl mb-4">💍</div>
        <h1 className="text-4xl font-bold text-rose-700 mb-2">What do u mean where is the crowd? I am the crowd</h1>
        <p className="text-gray-500 mb-10">Wedding Game — Choose your role</p>
        <div className="flex flex-col gap-4 items-center">
          <Link href="/guest" className="w-64 bg-rose-600 hover:bg-rose-700 text-white font-bold py-4 rounded-2xl text-lg transition-colors text-center">
            📱 Guest (mobile)
          </Link>
          <Link href="/host" className="w-64 bg-gray-800 hover:bg-gray-700 text-white font-bold py-4 rounded-2xl text-lg transition-colors text-center">
            🎙️ Host (laptop)
          </Link>
          <Link href="/projector" className="w-64 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl text-lg transition-colors text-center">
            📽️ Projector (big screen)
          </Link>
        </div>
      </div>
    </main>
  )
}
