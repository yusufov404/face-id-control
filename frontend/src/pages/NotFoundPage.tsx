import { Link } from 'react-router-dom'
import { Compass, Home } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <Compass className="h-7 w-7" />
        </div>
        <p className="mt-4 text-4xl font-black tracking-tight text-slate-900">404</p>
        <h1 className="mt-1 text-lg font-bold text-slate-900">Sahifa topilmadi</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          So'ralgan sahifa mavjud emas yoki ko'chirilgan.
        </p>
        <Link to="/" className="mt-5 inline-flex">
          <Button variant="primary" icon={<Home className="h-4 w-4" />}>Bosh sahifaga qaytish</Button>
        </Link>
      </div>
    </div>
  )
}
