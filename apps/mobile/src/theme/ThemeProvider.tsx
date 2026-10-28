import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'dsh-mobile.theme'

export const THEME_COLOR: Record<Theme, string> = {
  light: '#efe9dc',
  dark: '#060809',
}

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function storedTheme(): Theme | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

function initialTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  const attr = document.documentElement.dataset.theme
  if (isTheme(attr)) return attr
  return storedTheme() ?? systemTheme()
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme

  const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  themeColorMeta?.setAttribute('content', THEME_COLOR[theme])

  const colorSchemeMeta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  colorSchemeMeta?.setAttribute('content', theme)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = () => {
      if (storedTheme() !== null) return
      setThemeState(media.matches ? 'light' : 'dark')
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Theme still applies for this session when storage is unavailable.
    }
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [setTheme, theme])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === null) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
