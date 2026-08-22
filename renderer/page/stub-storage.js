try {
  localStorage.setItem('__t', '1')
  localStorage.removeItem('__t')
} catch (e) {
  Object.defineProperty(window, 'localStorage', {
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 },
    configurable: true,
  })
  Object.defineProperty(window, 'sessionStorage', { value: undefined, configurable: true })
  Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'storage', { value: {}, configurable: true })
}
