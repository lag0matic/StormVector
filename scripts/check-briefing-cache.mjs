import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true, watch: null } })
const saved = new Map()
const realNow = Date.now
const RealDate = Date
const realFetch = globalThis.fetch
try {
  let now = Date.parse('2026-11-21T21:00:00Z')
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }
  globalThis.fetch = async () => Response.json({ features: [] })
  const calls = []
  let aifsRun = '2026-11-21T12:00:00Z'
  const makeEvidence = (latest, previous, longitude, latitude) => ({ latest, previous, longitude, latitude })
  const gridRun = item => ({ ...item, hours: item.files })
  globalThis.window = { __TAURI_INTERNALS__: { async invoke(command, args) {
    calls.push([command, args])
    if (command === 'check_hrrr_source_available') return true
    if (command === 'latest_aifs_run') return aifsRun
    if (command === 'fetch_aifs_point_evidence') {
      const latest = { model: 'AIFS', runTime: args.run, hours: [{ forecastHour: args.hour, validTime: '2026-11-23T00:00:00Z' }] }
      return makeEvidence(latest, { ...latest, hours: [] }, args.longitude, args.latitude)
    }
    if (command === 'fetch_storm_desk_evidence') {
      const request = args.request
      return makeEvidence(gridRun(request.latest), gridRun(request.previous), request.longitude, request.latitude)
    }
    if (command === 'fetch_storm_desk_probabilities') return gridRun(args.request)
    if (command === 'save_storm_desk_enriched') return
    throw new Error(command)
  } } }
  const { loadBriefingBundle, cachedBriefing } = await vite.ssrLoadModule('/src/services/briefingBundle.ts')
  const point = [-86.16, 39.77]
  const [first, concurrent] = await Promise.all([loadBriefingBundle(point), loadBriefingBundle(point)])
  assert.equal(first, concurrent)
  assert.deepEqual(first.models.map(item => item.latest.model), ['GFS', 'AIFS', 'HRRR'])
  const persisted = [...saved.entries()]
  now += 15 * 60_000
  const count = calls.length
  saved.clear()
  for (const [key, value] of persisted) saved.set(key, value)
  assert.equal((await loadBriefingBundle(point)).attemptedAt, first.attemptedAt)
  assert.equal(calls.length, count)
  assert.equal(cachedBriefing([-96.8, 32.78]), undefined)

  now = first.attemptedAt + 3600_000
  assert.equal(cachedBriefing(point), undefined)
  calls.length = 0
  await loadBriefingBundle(point)
  assert(calls.some(([command]) => command === 'latest_aifs_run'))
  assert(!calls.some(([command]) => command === 'fetch_aifs_point_evidence'))
  assert(!calls.some(([command, args]) => command === 'fetch_storm_desk_evidence' && args.request.latest.model === 'GFS'))
  assert(calls.some(([command, args]) => command === 'fetch_storm_desk_evidence' && args.request.latest.model === 'HRRR'))

  now += 5 * 3600_000
  aifsRun = '2026-11-21T18:00:00Z'
  calls.length = 0
  await loadBriefingBundle(point)
  assert(calls.some(([command]) => command === 'fetch_aifs_point_evidence'))
  assert(calls.some(([command, args]) => command === 'fetch_storm_desk_evidence' && args.request.latest.model === 'GFS'))
  console.log('Persistent briefing cooldown, location isolation, and AIFS/GFS run reuse passed.')
} finally {
  globalThis.Date = RealDate
  Date.now = realNow
  globalThis.fetch = realFetch
  delete globalThis.localStorage
  delete globalThis.window
  await vite.close()
}
