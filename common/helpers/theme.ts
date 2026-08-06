export type Theme = 'light' | 'dark'

export const THEME_KEY = 'theme'

export function getTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: Theme = getTheme()) {
  if (typeof document === 'undefined') return
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
  else document.documentElement.removeAttribute('data-theme')
}

export function setTheme(theme: Theme) {
  try {
    if (theme === 'dark') localStorage.setItem(THEME_KEY, 'dark')
    else localStorage.removeItem(THEME_KEY)
  } catch {}
  applyTheme(theme)
}
