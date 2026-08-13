// Whole-message hate blur. Paste more chat trash and say "update the HATE".
const HATE = [
  /kill\s+jews?\b/i,
  /\bgas\s+the\s+jews?\b/i,
  /\bgas\s+chambers?\b/i,
  /\bhitler\s+was\s+right\b/i,
  /\bheil\s+hitler\b/i,
  /\bjews?\s+will\s+not\s+replace\b/i,
  /\bdeath\s+to\s+(all\s+)?jews?\b/i,
]

export function isHate(text: string) {
  return HATE.some((re) => re.test(text))
}
