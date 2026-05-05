// CMDIY light/dark theme toggle.
// - Persists choice in localStorage under "cmdiy-theme"
// - Falls back to the OS prefers-color-scheme on first visit
// - SSR-safe: server always renders the cmdiy (light) attribute set in
//   nuxt.config.ts htmlAttrs; we flip on the client during onMounted to
//   avoid a hydration mismatch on the document root.

export type Theme = 'cmdiy' | 'cmdiy-dark'

const STORAGE_KEY = 'cmdiy-theme'

export function useTheme() {
  const theme = useState<Theme>('cmdiy-theme', () => 'cmdiy')

  function apply(value: Theme) {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-theme', value)
  }

  function set(value: Theme) {
    theme.value = value
    apply(value)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, value)
    }
  }

  function toggle() {
    set(theme.value === 'cmdiy' ? 'cmdiy-dark' : 'cmdiy')
  }

  // Resolve the effective initial theme on the client. Stored choice wins;
  // otherwise we follow the OS until the user explicitly toggles.
  onMounted(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    if (stored === 'cmdiy' || stored === 'cmdiy-dark') {
      set(stored)
      return
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    set(prefersDark ? 'cmdiy-dark' : 'cmdiy')
  })

  return { theme: readonly(theme), set, toggle }
}
