import type { ReactNode } from 'react'
import {
  ArchiveRestore,
  Activity,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  Clock3,
  Fingerprint,
  LayoutDashboard,
  BriefcaseBusiness,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  permission: string
  icon: ReactNode
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAVIGATION: NavGroup[] = [
  {
    label: 'Asosiy',
    items: [
      { to: '/', label: 'Bosh sahifa', permission: 'report:dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Kadrlar',
    items: [
      { to: '/employees', label: 'Xodimlar', permission: 'employee:read', icon: <Users className="h-4 w-4" /> },
      { to: '/departments', label: "Bo'limlar", permission: 'department:read', icon: <Building2 className="h-4 w-4" /> },
      { to: '/positions', label: 'Lavozimlar', permission: 'position:read', icon: <BriefcaseBusiness className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Davomat',
    items: [
      { to: '/attendance', label: 'Davomat', permission: 'attendance:read', icon: <Clock3 className="h-4 w-4" /> },
      { to: '/monitoring', label: 'Face ID monitoring', permission: 'attendance:read', icon: <Activity className="h-4 w-4" /> },
      { to: '/shifts', label: 'Smenalar', permission: 'shift:read', icon: <CalendarClock className="h-4 w-4" /> },
      { to: '/leaves', label: "Ta'tillar", permission: 'leave:read', icon: <CalendarDays className="h-4 w-4" /> },
      { to: '/holidays', label: 'Bayramlar', permission: 'holiday:read', icon: <CalendarOff className="h-4 w-4" /> },
      { to: '/reports', label: 'Hisobotlar', permission: 'report:view', icon: <BarChart3 className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Tizim',
    items: [
      { to: '/devices', label: 'Face ID qurilmalari', permission: 'device:read', icon: <Fingerprint className="h-4 w-4" /> },
      { to: '/users', label: 'Foydalanuvchilar', permission: 'user:read', icon: <ShieldCheck className="h-4 w-4" /> },
      { to: '/audit', label: 'Audit jurnali', permission: 'audit:read', icon: <ScrollText className="h-4 w-4" /> },
      { to: '/settings', label: 'Sozlamalar', permission: 'settings:read', icon: <Settings className="h-4 w-4" /> },
      { to: '/backups', label: 'Zaxira nusxalari', permission: 'settings:backup', icon: <ArchiveRestore className="h-4 w-4" /> },
    ],
  },
]

export const ALL_NAV_ITEMS = NAVIGATION.flatMap((group) => group.items)

export function pageTitle(pathname: string): string {
  const exact = ALL_NAV_ITEMS.find((item) => item.to === pathname)
  if (exact) return exact.label
  return 'FaceSys Enterprise'
}
