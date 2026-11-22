import { buildSpcPointQueryUrl } from './outlooks'
import type { StormDeskEvidence, StormDeskHour } from './stormDesk'

const categories = ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'] as const
export const spcCategoryLabel = {
  TSTM: 'General thunderstorms', MRGL: 'Marginal severe risk', SLGT: 'Slight severe risk',
  ENH: 'Enhanced severe risk', MDT: 'Moderate severe risk', HIGH: 'High severe risk',
} satisfies Record<typeof categories[number], string>

export type SpcBriefingOutlook = {
  day: 1 | 2 | 3
  category: typeof categories[number]
  issuedAt: string
  validFrom: string
  validUntil: string
  matchingSamples: number[]
}
type Row = { label?: string; issue?: string; valid?: string; expire?: string }

function spcUtc(value: string | undefined) {
  if (!value || !/^\d{12}$/.test(value)) return null
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10)}:00.000Z`
  const timestamp = Date.parse(iso)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === iso ? timestamp : null
}

export function matchSpcOutlook(rows: Row[], day: 1 | 2 | 3, samples: StormDeskHour[], now: number): SpcBriefingOutlook | null {
  const candidates = rows.flatMap(row => {
    const category = categories.find(value => value === row.label)
    const issue = spcUtc(row.issue)
    const start = spcUtc(row.valid)
    const end = spcUtc(row.expire)
    if (!category || issue == null || start == null || end == null || issue > now || end <= Math.max(start, now)) return []
    return [{ category, issue, start, end }]
  }).sort((a, b) => b.issue - a.issue || categories.indexOf(b.category) - categories.indexOf(a.category))
  const best = candidates[0]
  if (!best) return null
  const matchingSamples = samples.flatMap((sample, index) => {
    const end = Date.parse(sample.validTime)
    const start = sample.intervalStartTime ? Date.parse(sample.intervalStartTime) : end
    const lower = Math.max(now, best.start)
    const matches = start === end ? end >= lower && end < best.end :
      Math.max(start, lower) < Math.min(end, best.end)
    return matches ? [index + 1] : []
  })
  if (!matchingSamples.length) return null
  return {
    day, category: best.category, matchingSamples,
    issuedAt: new Date(best.issue).toISOString(),
    validFrom: new Date(best.start).toISOString(),
    validUntil: new Date(best.end).toISOString(),
  }
}

export async function loadSpcBriefing(evidence: StormDeskEvidence, now: number) {
  const { latitude, longitude, latest: { hours } } = evidence
  if (!hours.some(hour => Date.parse(hour.validTime) >= now &&
      Date.parse(hour.intervalStartTime ?? hour.validTime) < now + 4 * 86_400_000)) {
    return { outlooks: [], incomplete: false }
  }
  const days = await Promise.allSettled(([1, 2, 3] as const).map(async day => {
    const response = await fetch(buildSpcPointQueryUrl(day, longitude, latitude), { signal: AbortSignal.timeout(7000) })
    if (!response.ok) throw new Error('SPC outlook unavailable')
    const data = await response.json() as { features?: { attributes: Row }[] }
    if (!Array.isArray(data.features)) throw new Error('Invalid SPC outlook')
    return matchSpcOutlook(data.features.map(row => row.attributes), day, hours, now)
  }))
  return {
    outlooks: days.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []),
    incomplete: days.some(result => result.status === 'rejected'),
  }
}
