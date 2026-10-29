import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Copy,
  KeyRound,
  Pencil,
  Plus,
  Shield,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react'
import { departmentsApi, permissionsApi, rolesApi, usersApi } from '@/api/services'
import type { Permission, User, UserCreateInput, UserUpdateInput } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { EmployeeCombobox } from '@/components/forms/EmployeeCombobox'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable'
import { Checkbox, Field, Input, Select } from '@/components/ui/Field'
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/Feedback'
import { FilterBar, PageHeader, SearchInput } from '@/components/ui/LayoutBits'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks'
import { formatDateTime, initials } from '@/lib/format'
import {
  collectErrors,
  emailError,
  hasErrors,
  minLength,
  nullableText,
  required,
  type ValidationErrors,
} from '@/lib/validation'

const CATEGORY_LABELS: Record<string, string> = {
  user: 'Foydalanuvchilar',
  role: 'Rollar',
  department: "Bo'limlar",
  employee: 'Xodimlar',
  position: 'Lavozimlar',
  device: 'Qurilmalar',
  attendance: 'Davomat',
  shift: 'Smenalar',
  holiday: 'Bayramlar',
  leave: "Ta'tillar",
  report: 'Hisobotlar',
  audit: 'Audit',
  settings: 'Sozlamalar',
  system: 'Tizim',
}

interface UserForm {
  username: string
  email: string
  full_name: string
  phone: string
  password: string
  department_id: string
  employee_id: number | null
  is_active: boolean
  role_ids: number[]
}

const emptyForm = (): UserForm => ({
  username: '',
  email: '',
  full_name: '',
  phone: '',
  password: '',
  department_id: '',
  employee_id: null,
  is_active: true,
  role_ids: [],
})

function fromUser(user: User): UserForm {
  return {
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    phone: user.phone || '',
    password: '',
    department_id: user.department_id ? String(user.department_id) : '',
    employee_id: user.employee_id ?? null,
    is_active: user.is_active,
    role_ids: user.roles.map((role) => role.id),
  }
}

function groupPermissions(permissions: Permission[]): Array<[string, Permission[]]> {
  const groups = new Map<string, Permission[]>()
  for (const permission of permissions) {
    const list = groups.get(permission.category) || []
    list.push(permission)
    groups.set(permission.category, list)
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
}

// Cyrillic/Uzbek -> latin so a login can be derived from the full name.
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '',
  э: 'e', ю: 'yu', я: 'ya', ў: 'u', қ: 'q', ғ: 'g', ҳ: 'h', ʼ: '', '‘': '', '’': '',
}

function usernameFromName(fullName: string): string {
  const latin = fullName.toLowerCase().split('').map((char) => TRANSLIT[char] ?? char).join('')
  const parts = latin.replace(/[^a-z0-9\s._-]/g, ' ').split(/\s+/).filter(Boolean)
  const base = parts.slice(0, 2).join('.').replace(/[^a-z0-9._-]/g, '')
  return base.length >= 3 ? base.slice(0, 50) : 'foydalanuvchi'
}

function uniqueUsername(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}${index}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}${Date.now().toString().slice(-4)}`
}

function generatePassword(length = 10): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

interface SaveVariables {
  username: string
  password: string
  email: string | null
  roleIds: number[]
}

export default function UsersPage() {
  const { can, user: currentUser } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  useDocumentTitle('Foydalanuvchilar')

  const [tab, setTab] = useState('users')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [mode, setMode] = useState<'create' | 'edit' | null>(null)
  const [form, setForm] = useState<UserForm>(emptyForm())
  const [formErrors, setFormErrors] = useState<ValidationErrors>({})
  const [formError, setFormError] = useState('')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [rolesTarget, setRolesTarget] = useState<User | null>(null)
  const [roleIds, setRoleIds] = useState<number[]>([])
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null)
  const [permissionDraft, setPermissionDraft] = useState<{ roleId: number; ids: Set<number> } | null>(null)
  const [permissionSearch, setPermissionSearch] = useState('')
  const [createMode, setCreateMode] = useState<'user' | 'department_head'>('user')
  const [autoCredentials, setAutoCredentials] = useState(true)
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null)

  const isSuperAdmin = Boolean(currentUser?.is_superuser)

  const debouncedSearch = useDebouncedValue(search)

  const usersQuery = useQuery({
    queryKey: ['users', page, pageSize, debouncedSearch, activeFilter],
    queryFn: () => usersApi.list({
      page,
      page_size: pageSize,
      search: debouncedSearch || undefined,
      is_active: activeFilter === '' ? undefined : activeFilter === 'true',
    }),
  })
  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: rolesApi.list,
    enabled: can('role:read'),
  })
  const permissionsQuery = useQuery({
    queryKey: ['permissions'],
    queryFn: () => permissionsApi.list(),
    enabled: can('role:read'),
  })
  const departmentsQuery = useQuery({ queryKey: ['departments', 'options'], queryFn: departmentsApi.options })
  // Small lookup list: used to detect departments that already have a head and to
  // keep generated logins unique. Accounts are few compared to employees.
  const accountsQuery = useQuery({
    queryKey: ['users', 'accounts-index'],
    queryFn: () => usersApi.list({ page: 1, page_size: 100 }),
    enabled: can('user:create') || can('user:read'),
  })

  const departmentHeadRoleId = rolesQuery.data?.find((role) => role.name === 'department_head')?.id ?? null
  const headDepartmentIds = new Set(
    (accountsQuery.data?.items ?? [])
      .filter((account) => account.roles.some((role) => role.name === 'department_head'))
      .map((account) => account.department_id)
      .filter((id): id is number => typeof id === 'number'),
  )
  const takenUsernames = new Set((accountsQuery.data?.items ?? []).map((account) => account.username))
  const selectedDepartmentHasHead = form.department_id ? headDepartmentIds.has(Number(form.department_id)) : false

  const effectiveRoleId = selectedRoleId ?? rolesQuery.data?.[0]?.id ?? null
  const rolePermissionsQuery = useQuery({
    queryKey: ['role-permissions', effectiveRoleId],
    queryFn: () => rolesApi.permissions(effectiveRoleId as number),
    enabled: effectiveRoleId !== null,
  })
  const selectedPermissionIds = permissionDraft && permissionDraft.roleId === effectiveRoleId
    ? permissionDraft.ids
    : new Set((rolePermissionsQuery.data || []).map((permission) => permission.id))

  const saveMutation = useMutation({
    mutationFn: async (variables: SaveVariables) => {
      if (mode === 'create') {
        const payload: UserCreateInput = {
          username: variables.username,
          email: variables.email,
          password: variables.password,
          full_name: form.full_name.trim(),
          phone: nullableText(form.phone),
          department_id: form.department_id ? Number(form.department_id) : null,
          employee_id: form.employee_id,
          role_ids: variables.roleIds,
          is_active: form.is_active,
        }
        return usersApi.create(payload)
      }
      if (mode === 'edit' && selectedUser) {
        const payload: UserUpdateInput = {
          full_name: form.full_name.trim(),
          phone: nullableText(form.phone),
          department_id: form.department_id ? Number(form.department_id) : null,
          employee_id: form.employee_id,
          is_active: form.is_active,
        }
        if (form.email.trim()) payload.email = form.email.trim()
        return usersApi.update(selectedUser.id, payload)
      }
      throw new Error('Amal aniqlanmadi')
    },
    onSuccess: (_created, variables) => {
      if (mode === 'create') {
        setCredentials({ username: variables.username, password: variables.password })
      }
      toast.success(mode === 'create' ? "Foydalanuvchi qo'shildi" : "Foydalanuvchi yangilandi")
      setMode(null)
      setSelectedUser(null)
      setFormError('')
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "Foydalanuvchini saqlab bo'lmadi"),
  })

  const rolesMutation = useMutation({
    mutationFn: () => {
      if (!rolesTarget) throw new Error('Foydalanuvchi tanlanmagan')
      return usersApi.assignRoles(rolesTarget.id, { role_ids: roleIds })
    },
    onSuccess: () => {
      toast.success('Rollar yangilandi')
      setRolesTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Rollarni saqlab bo'lmadi"),
  })

  const deleteMutation = useMutation({
    mutationFn: (user: User) => usersApi.remove(user.id),
    onSuccess: (response) => {
      toast.success(response.detail)
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Foydalanuvchini o'chirib bo'lmadi"),
  })

  const permissionsMutation = useMutation({
    mutationFn: () => {
      if (!effectiveRoleId) throw new Error('Rol tanlanmagan')
      return rolesApi.setPermissions(effectiveRoleId, Array.from(selectedPermissionIds))
    },
    onSuccess: () => {
      toast.success('Rol ruxsatlari saqlandi')
      setPermissionDraft(null)
      void queryClient.invalidateQueries({ queryKey: ['role-permissions', effectiveRoleId] })
      void queryClient.invalidateQueries({ queryKey: ['roles'] })
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Ruxsatlarni saqlab bo'lmadi"),
  })

  function openCreate() {
    setForm(emptyForm())
    setFormErrors({})
    setFormError('')
    setSelectedUser(null)
    setCreateMode('user')
    setAutoCredentials(true)
    setMode('create')
  }

  function openEdit(user: User) {
    setForm(fromUser(user))
    setSelectedUser(user)
    setFormErrors({})
    setFormError('')
    setMode('edit')
  }

  function openRoles(user: User) {
    setRolesTarget(user)
    setRoleIds(user.roles.map((role) => role.id))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const isHeadMode = createMode === 'department_head'
    const manualLogin = !isHeadMode && !autoCredentials
    const nextErrors = collectErrors([
      ['full_name', required(form.full_name, 'F.I.Sh.')],
      ['department_id', isHeadMode ? required(form.department_id, "Bo'lim") : null],
      ['role', isHeadMode && !departmentHeadRoleId ? "Bo'lim boshlig'i roli topilmadi. Sahifani yangilang." : null],
      ['username', manualLogin ? required(form.username, 'Login') : null],
      ['username_pattern', manualLogin && form.username && !/^[A-Za-z0-9_.-]+$/.test(form.username) ? "Login faqat harf, raqam, nuqta, _ va - belgilaridan iborat bo'lishi kerak" : null],
      ['email', form.email.trim() ? emailError(form.email) : null],
      ['password', manualLogin ? required(form.password, 'Parol') || minLength(form.password, 8, 'Parol') : null],
    ])
    setFormErrors(nextErrors)
    setFormError('')
    if (hasErrors(nextErrors)) return

    const generated = isHeadMode || autoCredentials
    const username = generated
      ? uniqueUsername(usernameFromName(form.full_name), takenUsernames)
      : form.username.trim()
    const password = generated ? generatePassword() : form.password
    // Boshliq rejimida ham emailni server o'zi yasaydi: <login>@facesys.local
    const email = form.email.trim() || null
    const roleIds = !isSuperAdmin
      ? []
      : isHeadMode && departmentHeadRoleId
        ? [departmentHeadRoleId]
        : form.role_ids
    saveMutation.mutate({ username, password, email, roleIds })
  }

  async function copyCredentials(value: { username: string; password: string }) {
    try {
      await navigator.clipboard.writeText(`Login: ${value.username}\nParol: ${value.password}`)
      toast.success('Login va parol nusxalandi')
    } catch {
      toast.error("Nusxalab bo'lmadi. Qo'lda ko'chiring.")
    }
  }

  function toggleRole(roleId: number) {
    setRoleIds((current) => current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId])
  }

  function updatePermissions(updater: (current: Set<number>) => Set<number>) {
    if (!effectiveRoleId) return
    setPermissionDraft((current) => {
      const roleId = effectiveRoleId
      const base = current && current.roleId === roleId
        ? current.ids
        : new Set((rolePermissionsQuery.data || []).map((permission) => permission.id))
      return { roleId, ids: updater(base) }
    })
  }

  function togglePermission(permissionId: number) {
    updatePermissions((current) => {
      const next = new Set(current)
      if (next.has(permissionId)) next.delete(permissionId)
      else next.add(permissionId)
      return next
    })
  }

  function toggleCategory(permissions: Permission[], checked: boolean) {
    updatePermissions((current) => {
      const next = new Set(current)
      for (const permission of permissions) {
        if (checked) next.add(permission.id)
        else next.delete(permission.id)
      }
      return next
    })
  }

  const columns: Column<User>[] = [
    {
      key: 'user',
      header: 'Foydalanuvchi',
      cell: (user) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">{initials(user.full_name)}</span>
          <div className="min-w-0">
            <p className="max-w-[220px] truncate text-xs font-semibold text-slate-900">
              {user.full_name} {user.id === currentUser?.id ? <span className="font-normal text-teal-600">(siz)</span> : null}
            </p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">{user.username} · {user.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Rollar',
      cell: (user) => (
        <div className="flex max-w-[260px] flex-wrap gap-1">
          {user.roles.length ? user.roles.map((role) => <Badge key={role.id} tone={role.name === 'super_admin' ? 'violet' : 'teal'}>{role.display_name}</Badge>) : <span className="text-xs text-slate-400">Rol yo‘q</span>}
        </div>
      ),
    },
    {
      key: 'department',
      header: "Bo'lim",
      cell: (user) => <span className="text-xs text-slate-600">{user.department_name || 'Barchasi'}</span>,
    },
    {
      key: 'status',
      header: 'Holat',
      cell: (user) => <Badge tone={user.is_active ? 'green' : 'slate'}>{user.is_active ? 'Faol' : 'Bloklangan'}</Badge>,
    },
    {
      key: 'last',
      header: 'Oxirgi kirish',
      cell: (user) => <span className="whitespace-nowrap text-[11px] text-slate-500">{user.last_login ? formatDateTime(user.last_login) : 'Hech qachon'}</span>,
    },
    {
      key: 'actions',
      header: '',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (user) => (
        <div className="flex items-center justify-end gap-0.5">
          {can('user:update') ? (
            <button type="button" onClick={() => openEdit(user)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-teal-700" title="Tahrirlash"><Pencil className="h-4 w-4" /></button>
          ) : null}
          {isSuperAdmin ? (
            <button type="button" onClick={() => openRoles(user)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-violet-700" title="Rollarni boshqarish"><UserCog className="h-4 w-4" /></button>
          ) : null}
          {can('user:delete') && user.id !== currentUser?.id ? (
            <button type="button" onClick={() => setDeleteTarget(user)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="O'chirish"><Trash2 className="h-4 w-4" /></button>
          ) : null}
        </div>
      ),
    },
  ]

  const selectedRole = rolesQuery.data?.find((role) => role.id === effectiveRoleId) || null
  const permissionGroups = groupPermissions(permissionsQuery.data || [])
  const filteredPermissionGroups = groupPermissions((permissionsQuery.data || []).filter((permission) => {
    if (!permissionSearch.trim()) return true
    const query = permissionSearch.toLowerCase()
    return permission.name.toLowerCase().includes(query) || permission.display_name.toLowerCase().includes(query)
  }))
  const rolePermissions = rolePermissionsQuery.data || []

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Tizim"
        title="Foydalanuvchilar va ruxsatlar"
        description="Tizim hisoblari, rollar va ruxsatlar matritsasi. Ruxsatlar server tomonida har bir so'rovda qayta tekshiriladi."
        actions={tab === 'users' && can('user:create') ? (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Yangi foydalanuvchi</Button>
        ) : undefined}
      />

      <Tabs
        className="mb-4"
        value={tab}
        onChange={(value) => { setTab(value); setPage(1) }}
        items={[
          { key: 'users', label: 'Foydalanuvchilar', icon: <Users className="h-3.5 w-3.5" />, count: usersQuery.data?.total },
          ...(isSuperAdmin ? [{ key: 'roles', label: 'Rollar', icon: <ShieldCheck className="h-3.5 w-3.5" />, count: rolesQuery.data?.length }] : []),
          ...(isSuperAdmin ? [{ key: 'permissions', label: 'Ruxsatlar', icon: <KeyRound className="h-3.5 w-3.5" />, count: permissionsQuery.data?.length }] : []),
        ]}
      />

      {tab === 'users' ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <FilterBar>
            <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder="F.I.Sh., login yoki email…" className="lg:w-72" />
            <Select value={activeFilter} onChange={(event) => { setActiveFilter(event.target.value); setPage(1) }} className="lg:w-44" aria-label="Faollik">
              <option value="">Barcha hisoblar</option>
              <option value="true">Faol</option>
              <option value="false">Bloklangan</option>
            </Select>
            <div className="flex-1" />
            <span className="text-[11px] text-slate-400">{usersQuery.data ? `${usersQuery.data.total} ta hisob` : ''}</span>
          </FilterBar>
          <DataTable
            columns={columns}
            rows={usersQuery.data?.items}
            rowKey={(user) => user.id}
            loading={usersQuery.isLoading}
            error={usersQuery.error instanceof Error ? usersQuery.error.message : null}
            onRetry={() => void usersQuery.refetch()}
            emptyTitle="Foydalanuvchilar topilmadi"
            emptyDescription="Qidiruvni o'zgartiring yoki yangi hisob yarating."
            emptyIcon={<Users className="h-6 w-6" />}
            footer={usersQuery.data ? (
              <Pagination
                page={usersQuery.data.page}
                pages={usersQuery.data.pages}
                total={usersQuery.data.total}
                pageSize={usersQuery.data.page_size}
                onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
                loading={usersQuery.isFetching}
              />
            ) : null}
          />
        </div>
      ) : null}

      {tab === 'roles' ? (
        <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-bold text-slate-900">Rollar</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Ruxsatlarni tahrirlash uchun rolni tanlang.</p>
            </div>
            {rolesQuery.isLoading ? <LoadingState compact /> : rolesQuery.isError ? (
              <ErrorState compact message={rolesQuery.error instanceof Error ? rolesQuery.error.message : "Rollar yuklanmadi"} onRetry={() => void rolesQuery.refetch()} />
            ) : (
              <div className="divide-y divide-slate-100">
                {rolesQuery.data?.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => { setSelectedRoleId(role.id); setPermissionDraft(null) }}
                    className={`w-full px-4 py-3 text-left transition ${effectiveRoleId === role.id ? 'bg-teal-50/70' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">{role.display_name}</span>
                      {role.is_system ? <Badge tone="violet">Tizim</Badge> : null}
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400">{role.name}</p>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500">{role.description || 'Tavsif yo‘q'}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {selectedRole ? (
              <>
                <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">{selectedRole.display_name}</h2>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400">{selectedRole.name}</p>
                  </div>
                  {isSuperAdmin ? (
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Check className="h-3.5 w-3.5" />}
                      loading={permissionsMutation.isPending}
                      disabled={selectedRole.is_system && !currentUser?.is_superuser}
                      onClick={() => permissionsMutation.mutate()}
                    >
                      Ruxsatlarni saqlash
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-3 text-[11px] text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                  <span>Foydalanuvchilar: <b>{selectedRole.can_manage_users ? 'boshqaradi' : 'yo‘q'}</b></span>
                  <span>Barcha bo'limlar: <b>{selectedRole.can_access_all_departments ? 'ha' : 'yo‘q'}</b></span>
                  <span>Davomat tuzatish: <b>{selectedRole.can_modify_attendance ? 'ha' : 'yo‘q'}</b></span>
                  <span>Audit: <b>{selectedRole.can_view_audit_logs ? 'ha' : 'yo‘q'}</b></span>
                </div>
                {selectedRole.is_system && !currentUser?.is_superuser ? (
                  <div className="p-4 pb-0"><Alert tone="warning">Tizim rolini faqat Super Admin tahrirlay oladi. Sizga faqat ko'rish mumkin.</Alert></div>
                ) : null}
                <div className="p-4">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs font-semibold text-slate-700">
                      Tanlangan ruxsatlar: <span className="text-teal-700">{selectedPermissionIds.size}</span> / {permissionsQuery.data?.length || 0}
                    </p>
                    <div className="w-full sm:w-64">
                      <SearchInput value={permissionSearch} onChange={setPermissionSearch} placeholder="Ruxsat qidirish…" />
                    </div>
                  </div>
                  {rolePermissionsQuery.isLoading ? <LoadingState compact /> : rolePermissionsQuery.isError ? (
                    <ErrorState compact message={rolePermissionsQuery.error instanceof Error ? rolePermissionsQuery.error.message : "Ruxsatlar yuklanmadi"} onRetry={() => void rolePermissionsQuery.refetch()} />
                  ) : !filteredPermissionGroups.length ? (
                    <EmptyState compact title="Ruxsat topilmadi" description="Qidiruv so'zini o'zgartiring." />
                  ) : (
                    <div className="space-y-4">
                      {filteredPermissionGroups.map(([category, permissions]) => {
                        const allChecked = permissions.every((permission) => selectedPermissionIds.has(permission.id))
                        return (
                          <div key={category} className="rounded-xl border border-slate-200">
                            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
                              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">{CATEGORY_LABELS[category] || category}</span>
                              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-500">
                                <input type="checkbox" checked={allChecked} onChange={(event) => toggleCategory(permissions, event.target.checked)} disabled={!isSuperAdmin || (selectedRole.is_system && !currentUser?.is_superuser)} className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                                Hammasi
                              </label>
                            </div>
                            <div className="grid gap-1.5 p-2 sm:grid-cols-2 lg:grid-cols-3">
                              {permissions.map((permission) => (
                                <label key={permission.id} className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition hover:bg-slate-50 ${!isSuperAdmin || (selectedRole.is_system && !currentUser?.is_superuser) ? 'cursor-not-allowed opacity-70' : ''}`}>
                                  <input
                                    type="checkbox"
                                    checked={selectedPermissionIds.has(permission.id)}
                                    onChange={() => togglePermission(permission.id)}
                                    disabled={!isSuperAdmin || (selectedRole.is_system && !currentUser?.is_superuser)}
                                    className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                                  />
                                  <span>
                                    <span className="block text-[11px] font-medium text-slate-700">{permission.display_name}</span>
                                    <span className="block font-mono text-[9px] text-slate-400">{permission.name}</span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
                    Hozirgi rol ruxsatlari: {rolePermissions.length} ta. O'zgarishlar keyingi so'rovdan boshlab amal qiladi.
                  </p>
                </div>
              </>
            ) : (
              <EmptyState title="Rol tanlanmagan" description="Chap tomondagi ro'yxatdan rolni tanlang." />
            )}
          </div>
        </div>
      ) : null}

      {tab === 'permissions' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Ruxsatlar katalogi</h2>
              <p className="mt-0.5 text-xs text-slate-500">Tizimdagi barcha ruxsatlar. Rolga biriktirish "Rollar" bo'limida amalga oshiriladi.</p>
            </div>
            <div className="w-full sm:w-64"><SearchInput value={permissionSearch} onChange={setPermissionSearch} placeholder="Ruxsat qidirish…" /></div>
          </div>
          {permissionsQuery.isLoading ? <LoadingState compact /> : permissionsQuery.isError ? (
            <ErrorState compact message={permissionsQuery.error instanceof Error ? permissionsQuery.error.message : "Ruxsatlar yuklanmadi"} onRetry={() => void permissionsQuery.refetch()} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {permissionGroups.map(([category, permissions]) => (
                <div key={category} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-slate-400" />
                    <h3 className="text-xs font-bold text-slate-800">{CATEGORY_LABELS[category] || category}</h3>
                    <Badge tone="slate">{permissions.length}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    {permissions.map((permission) => (
                      <div key={permission.id} className="flex items-start justify-between gap-2 text-[11px]">
                        <span className="text-slate-600">{permission.display_name}</span>
                        <span className="shrink-0 font-mono text-[9px] text-slate-400">{permission.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === 'create' ? 'Yangi foydalanuvchi' : 'Foydalanuvchini tahrirlash'}
        description="Hisob ma'lumotlari va bo'lim doirasini belgilang. Parol hech qachon ochiq ko'rinishda saqlanmaydi."
        size="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={saveMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => document.getElementById('user-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))} loading={saveMutation.isPending}>
              {mode === 'create' ? 'Saqlash' : 'Yangilash'}
            </Button>
          </>
        )}
      >
        <form id="user-form" onSubmit={submit} className="space-y-4" noValidate>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}

          {mode === 'create' && isSuperAdmin && departmentHeadRoleId ? (
            <div className="grid gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setCreateMode('user')}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${createMode === 'user' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Oddiy foydalanuvchi
              </button>
              <button
                type="button"
                onClick={() => setCreateMode('department_head')}
                disabled={selectedDepartmentHasHead}
                title={selectedDepartmentHasHead
                  ? "Bu bo'limda allaqachon boshliq bor"
                  : undefined}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${createMode === 'department_head' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'} disabled:cursor-not-allowed disabled:text-slate-300`}
              >
                Bo'lim boshlig'i sifatida ochish
              </button>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="To'liq ism" htmlFor="user_full_name" required error={formErrors.full_name} hint={createMode === 'department_head' && mode === 'create' ? 'Login shu nomdan avtomatik yasaladi' : undefined}>
              <Input id="user_full_name" value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} invalid={Boolean(formErrors.full_name)} />
            </Field>
            <Field
              label="Bo'lim"
              htmlFor="user_department"
              required={createMode === 'department_head' && mode === 'create'}
              error={formErrors.department_id}
              hint={selectedDepartmentHasHead && createMode === 'department_head' ? "Bu bo'limda allaqachon boshliq bor" : "Bo'sh qoldirilsa, barcha bo'limlar doirasida ishlaydi"}
            >
              <Select
                id="user_department"
                value={form.department_id}
                onChange={(event) => {
                  const value = event.target.value
                  setForm({ ...form, department_id: value })
                  if (value && headDepartmentIds.has(Number(value))) setCreateMode('user')
                }}
                invalid={Boolean(formErrors.department_id)}
              >
                <option value="">Barcha bo'limlar</option>
                {departmentsQuery.data?.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </Select>
            </Field>
            {createMode === 'user' || mode === 'edit' ? (
              <Field
                label="Login"
                htmlFor="user_username"
                required={mode === 'create' && !autoCredentials}
                error={formErrors.username || formErrors.username_pattern}
                hint={mode === 'edit' ? "Login o'zgartirilmaydi" : autoCredentials ? 'F.I.Sh.dan avtomatik yaratiladi' : 'Faqat lotin harflari, raqam, nuqta, _ va -'}
              >
                <Input
                  id="user_username"
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                  disabled={mode === 'edit' || (mode === 'create' && autoCredentials)}
                  placeholder={mode === 'create' && autoCredentials ? 'avtomatik' : undefined}
                  invalid={Boolean(formErrors.username || formErrors.username_pattern)}
                />
              </Field>
            ) : null}
            {mode === 'create' && createMode === 'user' ? (
              <Field
                label="Parol"
                htmlFor="user_password"
                required={!autoCredentials}
                error={formErrors.password}
                hint={autoCredentials ? 'Tasodifiy parol yaratiladi' : 'Kamida 8 belgi'}
              >
                <Input
                  id="user_password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  disabled={autoCredentials}
                  placeholder={autoCredentials ? 'avtomatik' : undefined}
                  invalid={Boolean(formErrors.password)}
                />
              </Field>
            ) : null}
            <Field label="Email" htmlFor="user_email" error={formErrors.email} hint="Bo'sh qoldirilsa, login@facesys.local avtomatik yasaladi">
              <Input id="user_email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} invalid={Boolean(formErrors.email)} />
            </Field>
            <Field label="Telefon" htmlFor="user_phone">
              <Input id="user_phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </Field>
            <Field label="Bog'langan xodim" htmlFor="user_employee">
              <EmployeeCombobox id="user_employee" value={form.employee_id} onChange={(id) => setForm({ ...form, employee_id: id })} />
            </Field>
          </div>

          {mode === 'create' && createMode === 'department_head' ? (
            <Alert tone="info">Hisobga "Bo'lim boshlig'i" roli avtomatik beriladi. Login va parol tizim tomonidan yaratiladi va yaratilgandan keyin faqat bir marta ko'rsatiladi.</Alert>
          ) : null}

          {mode === 'create' && createMode === 'user' ? (
            <Checkbox
              label="Login va parolni avtomatik yaratish"
              description="Login F.I.Sh.dan yasaladi, parol tasodifiy tanlanadi. Yaratilgandan keyin bir marta ko'rsatiladi."
              checked={autoCredentials}
              onChange={(event) => setAutoCredentials(event.target.checked)}
            />
          ) : null}

          {mode === 'create' && createMode === 'user' && isSuperAdmin ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-700">Boshlang'ich rollar</p>
              {rolesQuery.isLoading ? <LoadingState compact /> : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {rolesQuery.data?.map((role) => (
                    <label key={role.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2.5 transition hover:bg-slate-50">
                      <input type="checkbox" checked={form.role_ids.includes(role.id)} onChange={() => setForm({ ...form, role_ids: form.role_ids.includes(role.id) ? form.role_ids.filter((id) => id !== role.id) : [...form.role_ids, role.id] })} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                      <span>
                        <span className="block text-xs font-medium text-slate-800">{role.display_name}</span>
                        <span className="block font-mono text-[9px] text-slate-400">{role.name}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <Checkbox label="Faol hisob" description="Bloklangan hisob tizimga kira olmaydi" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
        </form>
      </Modal>

      <Modal
        open={Boolean(rolesTarget)}
        onClose={() => setRolesTarget(null)}
        title="Foydalanuvchi rollari"
        description={rolesTarget ? `${rolesTarget.full_name} uchun rollarni tanlang` : undefined}
        size="md"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setRolesTarget(null)} disabled={rolesMutation.isPending}>Bekor qilish</Button>
            <Button variant="primary" onClick={() => rolesMutation.mutate()} loading={rolesMutation.isPending}>Rollarni saqlash</Button>
          </>
        )}
      >
        <div className="space-y-2">
          {rolesQuery.data?.map((role) => (
            <label key={role.id} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50">
              <input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => toggleRole(role.id)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">{role.display_name}{role.is_system ? <Badge tone="violet">Tizim</Badge> : null}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{role.name}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{role.description || 'Tavsif yo‘q'}</span>
              </span>
            </label>
          ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Foydalanuvchini o'chirish"
        message={deleteTarget ? <><strong>{deleteTarget.full_name}</strong> hisobini o'chirmoqchimisiz? Hisob arxivlanadi va tizimga kira olmaydi.</> : ''}
        confirmLabel="O'chirish"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />

      <Modal
        open={Boolean(credentials)}
        onClose={() => setCredentials(null)}
        title="Hisob yaratildi"
        description="Login va parolni xodimga bering — bu ma'lumot boshqa ko'rsatilmaydi."
        size="sm"
        footer={<Button variant="primary" onClick={() => setCredentials(null)}>Tushundim</Button>}
      >
        {credentials ? (
          <div className="space-y-3">
            <Alert tone="warning">Parolni hoziroq saqlang yoki xodimga bering. Keyinchalik u faqat o'zgartirilishi mumkin, ko'rish mumkin emas.</Alert>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Login</p>
              <p className="mt-1 font-mono text-sm font-semibold text-slate-900">{credentials.username}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Parol</p>
              <p className="mt-1 font-mono text-sm font-semibold text-slate-900">{credentials.password}</p>
            </div>
            <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void copyCredentials(credentials)}>
              Nusxalash
            </Button>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
