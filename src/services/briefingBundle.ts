import { invoke } from '@tauri-apps/api/core'
import { loadSpcBriefing } from './spcBriefing'
import { fetchStormDeskEvidence, type StormDeskEvidence } from './stormDesk'

const refreshMs = 60 * 60_000
const storageKey = 'stormvector-briefing-bundles-v1'
type Bundle = {
  attemptedAt: number
  models: StormDeskEvidence[]
  missing: string[]
  spc?: Awaited<ReturnType<typeof loadSpcBriefing>>
}
const pending = new Map<string, Promise<Bundle>>()

function records(): Record<string, Bundle> {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? '{}') ?? {} }
  catch { return {} }
}

function store(key: string, value: Bundle) {
  const entries = Object.entries({ ...records(), [key]: value })
    .sort((a, b) => b[1].attemptedAt - a[1].attemptedAt)
    .slice(0, 40)
  localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)))
}

function pointKey(coordinates: [number, number]) {
  return coordinates.join(',')
}

export function cachedBriefing(coordinates: [number, number]) {
  const entry = records()[pointKey(coordinates)]
  const age = Date.now() - (entry?.attemptedAt ?? 0)
  return age >= 0 && age < refreshMs ? entry : undefined
}

export function loadBriefingBundle(coordinates: [number, number]) {
  const key = pointKey(coordinates)
  const running = pending.get(key)
  if (running) return running
  const cached = cachedBriefing(coordinates)
  if (cached) return Promise.resolve(cached)
  const attemptedAt = Date.now()
  const previous = records()[key]?.models ?? []
  const promise = refresh(coordinates, attemptedAt, previous).then(bundle => {
    store(key, bundle)
    return bundle
  }).finally(() => pending.delete(key))
  pending.set(key, promise)
  return promise
}

async function refresh(coordinates: [number, number], attemptedAt: number, previous: StormDeskEvidence[]): Promise<Bundle> {
  const [longitude, latitude] = coordinates
  const labels = ['GFS', 'HRRR', 'AIFS']
  const settled = await Promise.allSettled([
    fetchStormDeskEvidence(coordinates, 'week', previous.find(item => item.latest.model === 'GFS')),
    fetchStormDeskEvidence(coordinates, 'short', previous.find(item => item.latest.model === 'HRRR')),
    (async () => {
      const run = await invoke<string>('latest_aifs_run')
      const runTime = Date.parse(run)
      const dayMs = 24 * 3600_000
      // Match GFS midnight-to-midnight totals when the AIFS run permits it.
      const end = Math.ceil(Math.max(attemptedAt + 1, runTime + dayMs) / dayMs) * dayMs
      const hour = Math.min(72, (end - runTime) / 3600_000)
      const existing = previous.find(item => item.latest.model === 'AIFS')
      if (existing && Date.parse(existing.latest.runTime) === Date.parse(run) &&
        existing.latest.hours.some(sample => sample.forecastHour === hour)) return existing
      return invoke<StormDeskEvidence>('fetch_aifs_point_evidence', {
        run, hour, period: 24, rangeStart: 6, rangeEnd: 72, longitude, latitude,
      })
    })(),
  ])
  const models = [settled[0], ...(settled[0].status === 'fulfilled' ? [settled[2], settled[1]] : [settled[1], settled[2]])]
    .flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const missing = settled.flatMap((result, index) => result.status === 'rejected' ? [labels[index]] : [])
  if (models[0]?.probabilityError) missing.push('NBM')
  const primary = models[0]
  const spc = primary ? await loadSpcBriefing({
    ...primary, latest: { ...primary.latest, hours: models.flatMap(model => model.latest.hours) },
  }, Date.now()) : undefined
  return { attemptedAt, models, missing, spc }
}
