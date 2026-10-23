import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { AuthProvider, useAuth } from '@/auth/AuthProvider'
import { ForbiddenPage, GuestOnly, RequireAuth, RequirePermission } from '@/auth/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { ALL_NAV_ITEMS } from '@/components/layout/navigation'
import { Spinner } from '@/components/ui/Feedback'
import { ToastProvider } from '@/components/ui/Toast'

const LoginPage = lazy(() => import('@/pages/LoginPage'))
const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const EmployeesPage = lazy(() => import('@/pages/EmployeesPage'))
const DepartmentsPage = lazy(() => import('@/pages/DepartmentsPage'))
const PositionsPage = lazy(() => import('@/pages/PositionsPage'))
const UsersPage = lazy(() => import('@/pages/UsersPage'))
const AttendancePage = lazy(() => import('@/pages/AttendancePage'))
const DevicesPage = lazy(() => import('@/pages/DevicesPage'))
const ShiftsPage = lazy(() => import('@/pages/ShiftsPage'))
const LeavesPage = lazy(() => import('@/pages/LeavesPage'))
const HolidaysPage = lazy(() => import('@/pages/HolidaysPage'))
const ReportsPage = lazy(() => import('@/pages/ReportsPage'))
const AuditPage = lazy(() => import('@/pages/AuditPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const BackupsPage = lazy(() => import('@/pages/BackupsPage'))
const MonitoringPage = lazy(() => import('@/pages/MonitoringPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
        return failureCount < 2
      },
    },
    mutations: {
      retry: false,
    },
  },
})

function PageFallback() {
  return (
    <div className="flex min-h-[45vh] items-center justify-center gap-2 text-sm text-slate-500">
      <Spinner />
      <span>Sahifa yuklanmoqda…</span>
    </div>
  )
}

function HomeRedirect() {
  const { can } = useAuth()
  if (can('report:dashboard')) return <DashboardPage />
  const target = ALL_NAV_ITEMS.find((item) => can(item.permission))
  if (target) return <Navigate to={target.to} replace />
  return <ForbiddenPage />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
                <Route
                  path="/"
                  element={(
                    <RequireAuth>
                      <AppLayout />
                    </RequireAuth>
                  )}
                >
                  <Route index element={<HomeRedirect />} />
                  <Route path="employees" element={<RequirePermission permission="employee:read"><EmployeesPage /></RequirePermission>} />
                  <Route path="departments" element={<RequirePermission permission="department:read"><DepartmentsPage /></RequirePermission>} />
                  <Route path="positions" element={<RequirePermission permission="position:read"><PositionsPage /></RequirePermission>} />
                  <Route path="users" element={<RequirePermission permission="user:read"><UsersPage /></RequirePermission>} />
                  <Route path="attendance" element={<RequirePermission permission="attendance:read"><AttendancePage /></RequirePermission>} />
                  <Route path="devices" element={<RequirePermission permission="device:read"><DevicesPage /></RequirePermission>} />
                  <Route path="monitoring" element={<RequirePermission permission="attendance:read"><MonitoringPage /></RequirePermission>} />
                  <Route path="shifts" element={<RequirePermission permission="shift:read"><ShiftsPage /></RequirePermission>} />
                  <Route path="leaves" element={<RequirePermission permission="leave:read"><LeavesPage /></RequirePermission>} />
                  <Route path="holidays" element={<RequirePermission permission="holiday:read"><HolidaysPage /></RequirePermission>} />
                  <Route path="reports" element={<RequirePermission permission="report:view"><ReportsPage /></RequirePermission>} />
                  <Route path="audit" element={<RequirePermission permission="audit:read"><AuditPage /></RequirePermission>} />
                  <Route path="settings" element={<RequirePermission permission="settings:read"><SettingsPage /></RequirePermission>} />
                  <Route path="backups" element={<RequirePermission permission="settings:backup"><BackupsPage /></RequirePermission>} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
