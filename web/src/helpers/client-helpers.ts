// THE GREAT MERGE: one bundle. This now points at the merged app.js (already the
// running bundle, so any prefetch is effectively a no-op).
export function getClientPath(version: string): string {
  const isProduction = process.env.NODE_ENV === 'production'
  const file = `${version}-app.js`
  return isProduction ? `/${file}` : `/proxy/web/${file}`
}
