/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { authApi } from '@/api/services'
import { SESSION_EXPIRED_EVENT, tokenStore } from '@/api/client'
import type { CurrentUser } from '@/api/types'

type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  user: CurrentUser | null
  status: AuthStatus
  login: (username: string, password: string) => Promise<CurrentUser>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  can: (permission: string) => boolean
  canAny: (...permissions: string[]) => boolean
  hasRole: (role: string) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>(() => (tokenStore.access || tokenStore.refresh ? 'loading' : 'anonymous'))

  useEffect(() => {
    let active = true
    const expire = () => {
      if (!active) return
      setUser(null)
      setStatus('anonymous')
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, expire)

    if (!tokenStore.access && !tokenStore.refresh) {
      return () => {
        active = false
        window.removeEventListener(SESSION_EXPIRED_EVENT, expire)
      }
    }

    authApi.me()
      .then((current) => {
        if (!active) return
        setUser(current)
        setStatus('authenticated')
      })
      .catch(() => {
        if (!active) return
        tokenStore.clear()
        setUser(null)
        setStatus('anonymous')
      })

    return () => {
      active = false
      window.removeEventListener(SESSION_EXPIRED_EVENT, expire)
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const tokens = await authApi.login({ username, password })
    tokenStore.set(tokens)
    try {
      const current = await authApi.me()
      setUser(current)
      setStatus('authenticated')
      return current
    } catch (error) {
      tokenStore.clear()
      setUser(null)
      setStatus('anonymous')
      throw error
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // Token allaqachon yaroqsiz bo'lishi mumkin; lokal sessiyani baribir tozalaymiz.
    } finally {
      tokenStore.clear()
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  const refreshUser = useCallback(async () => {
    const current = await authApi.me()
    setUser(current)
    setStatus('authenticated')
  }, [])

  const can = useCallback((permission: string) => {
    if (!user) return false
    return Boolean(user.is_superuser || user.permissions.includes(permission))
  }, [user])

  const canAny = useCallback((...permissions: string[]) => permissions.some((permission) => can(permission)), [can])

  const hasRole = useCallback((role: string) => Boolean(user?.roles.includes(role)), [user])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    status,
    login,
    logout,
    refreshUser,
    can,
    canAny,
    hasRole,
  }), [user, status, login, logout, refreshUser, can, canAny, hasRole])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth AuthProvider ichida ishlatilishi kerak')
  return context
}
