import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Clock3,
  Eye,
  EyeOff,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Alert } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { required } from '@/lib/validation'
import { useDocumentTitle } from '@/lib/hooks'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [expired, setExpired] = useState(() => {
    const wasExpired = Boolean(sessionStorage.getItem('facesys.session-expired'))
    if (wasExpired) sessionStorage.removeItem('facesys.session-expired')
    return wasExpired
  })
  const [loading, setLoading] = useState(false)
  useDocumentTitle('Kirish')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const nextErrors: Record<string, string> = {}
    const usernameError = required(username, 'Login')
    const passwordError = required(password, 'Parol')
    if (usernameError) nextErrors.username = usernameError
    if (passwordError) nextErrors.password = passwordError
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setLoading(true)
    setFormError('')
    setExpired(false)
    try {
      await login(username.trim(), password)
      const state = location.state as { from?: string } | null
      const target = state?.from && state.from !== '/login' ? state.from : '/'
      navigate(target, { replace: true })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Tizimga kirib bo'lmadi")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-screen bg-slate-100 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-slate-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_20%_10%,rgba(20,184,166,.28),transparent_38%),radial-gradient(circle_at_80%_80%,rgba(56,189,248,.18),transparent_36%)]" />
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.35)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.35)_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-500/15 text-sm font-black text-teal-300 ring-1 ring-teal-400/25">
              FS
            </div>
            <div>
              <p className="text-base font-bold tracking-tight">FaceSys Enterprise</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Klinika boshqaruv tizimi</p>
            </div>
          </div>

          <div className="mt-20 max-w-lg">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-400">HR + Face ID davomat</p>
            <h1 className="mt-3 text-4xl font-bold leading-[1.08] tracking-tight">
              Xodimlar, davomat va qurilmalar — yagona xavfsiz tizimda.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
              Klinika uchun mo'ljallangan lokal tarmoq yechimi. Barcha ko'rsatkichlar
              faqat haqiqiy ma'lumotlar bazasidan hisoblanadi.
            </p>
          </div>

          <div className="mt-10 grid max-w-lg gap-3 sm:grid-cols-2">
            {[
              { icon: <Users className="h-4 w-4" />, title: 'Kadrlar boshqaruvi', text: "Bo'limlar, lavozimlar va xodimlar" },
              { icon: <Clock3 className="h-4 w-4" />, title: 'Davomat hisobi', text: 'Smena, kechikish va ta’tillar' },
              { icon: <Fingerprint className="h-4 w-4" />, title: 'Face ID integratsiyasi', text: 'Hikvision ISAPI diagnostikasi' },
              { icon: <ShieldCheck className="h-4 w-4" />, title: 'Nazorat va audit', text: 'Rollar, ruxsatlar va jurnal' },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-400/10 text-teal-300">{item.icon}</div>
                <p className="mt-2.5 text-xs font-semibold text-slate-100">{item.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center justify-between text-[10px] text-slate-600">
          <span>Lokal tarmoq uchun · v1.0</span>
          <span>Asia/Tashkent</span>
        </div>
      </section>

      <section className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-xs font-black text-teal-300">FS</div>
            <div>
              <p className="text-sm font-bold text-slate-900">FaceSys Enterprise</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Klinika boshqaruv tizimi</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8">
            <div className="mb-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-teal-100">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">Tizimga kirish</h2>
              <p className="mt-1 text-sm text-slate-500">Hisobingizga kirish uchun login va parolni kiriting.</p>
            </div>

            {expired ? <Alert tone="warning" className="mb-4">Sessiya muddati tugagan. Iltimos, qayta kiring.</Alert> : null}
            {formError ? <Alert tone="danger" className="mb-4">{formError}</Alert> : null}

            <form onSubmit={submit} noValidate className="space-y-4">
              <Field label="Login yoki email" htmlFor="login-username" required error={errors.username}>
                <Input
                  id="login-username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  invalid={Boolean(errors.username)}
                  placeholder="admin yoki admin@example.com"
                />
              </Field>
              <Field label="Parol" htmlFor="login-password" required error={errors.password}>
                <div className="relative">
                  <Input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    invalid={Boolean(errors.password)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                    aria-label={showPassword ? 'Parolni yashirish' : "Parolni ko'rsatish"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full" icon={<ArrowRight className="h-4 w-4" />}>
                Kirish
              </Button>
            </form>

            <div className="mt-5 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>Parolni hech kim bilan bo'lishmang. Barcha kirish urinishlari audit jurnaliga yoziladi.</span>
            </div>
          </div>

          <p className="mt-5 text-center text-[10px] leading-relaxed text-slate-400">
            FaceSys Enterprise · Mahalliy tarmoq ilovasi<br />
            Muammo bo'lsa, tizim administratoriga murojaat qiling.
          </p>
        </div>
      </section>
    </div>
  )
}
