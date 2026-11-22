import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true, watch: null } })
try {
  const { matchSpcOutlook, loadSpcBriefing } = await vite.ssrLoadModule('/src/services/spcBriefing.ts')
  const now = Date.parse('2026-11-21T18:00:00Z')
  const { normalizeBriefingAlerts, loadBriefingAlerts } = await vite.ssrLoadModule('/src/services/briefingAlerts.ts')
  const marine = { id: 'marine', properties: { event: 'Special Marine Statement', status: 'Actual',
    messageType: 'Alert', expires: '2026-11-21T20:00:00Z' } }
  const warning = { id: 'warning', properties: { ...marine.properties, event: 'Special Marine Warning',
    ends: '2026-11-21T19:00:00Z', onset: '2026-11-21T18:15:00Z' } }
  const alerts = normalizeBriefingAlerts([marine, warning, marine,
    { properties: { ...marine.properties, status: 'Test' } },
    { properties: { ...marine.properties, ends: '2026-11-21T17:00:00Z' } },
  ], now)
  assert.deepEqual(alerts.map(item => item.event), ['Special Marine Warning', 'Special Marine Statement'])
  assert.equal(alerts[0].startsAt, '2026-11-21T18:15:00.000Z')
  assert.equal(alerts[0].endLabel, 'Ends')
  assert.equal(alerts[1].endLabel, 'Alert expires')
  const sample = (validTime, intervalStartTime) => ({ validTime, intervalStartTime })
  const samples = [
    sample('2026-11-21T18:30:00Z'),
    sample('2026-11-22T00:00:00Z', '2026-11-21T18:00:00Z'),
    sample('2026-11-22T12:00:00Z'),
    sample('2026-11-23T12:00:00Z'),
  ]
  const row = { label: 'TSTM', issue: '202611211630', valid: '202611211900', expire: '202611221200' }
  const selected = matchSpcOutlook([row, { ...row, label: 'SLGT' }], 1, samples, now)
  assert.equal(selected.category, 'SLGT')
  assert.deepEqual(selected.matchingSamples, [2])
  assert.equal(matchSpcOutlook([row], 1, [samples[2]], now), null)
  assert.equal(matchSpcOutlook([{ ...row, valid: '202611311900' }], 1, samples, now), null)
  assert.equal(matchSpcOutlook([{ ...row, issue: '202611211830' }], 1, samples, now), null)
  assert.equal(matchSpcOutlook([row], 1, samples, Date.parse('2026-11-22T12:00:00Z')), null)

  const realFetch = globalThis.fetch
  try {
    let requests = 0
    globalThis.fetch = async input => {
      requests++
      const url = new URL(input)
      assert.equal(url.searchParams.get('geometry'), '-86.16,39.77')
      assert.equal(url.searchParams.get('returnGeometry'), 'false')
      if (url.pathname.endsWith('/9/query')) return Response.json({ error: {} })
      return Response.json({ features: url.pathname.endsWith('/1/query') ? [{ attributes: row }] : [] })
    }
    const evidence = { latitude: 39.77, longitude: -86.16, latest: { hours: samples } }
    const result = await loadSpcBriefing(evidence, now)
    assert.equal(requests, 3)
    assert.equal(result.incomplete, true)
    assert.deepEqual(result.outlooks.map(outlook => outlook.category), ['TSTM'])
    assert.deepEqual(await loadSpcBriefing({ ...evidence, latest: { hours: [sample('2026-11-29T00:00:00Z')] } }, now),
      { outlooks: [], incomplete: false })
    assert.equal(requests, 3)
  } finally {
    globalThis.fetch = realFetch
  }
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).searchParams.get('point'), '25.7000,-80.0000')
      assert.equal(options.cache, 'no-cache')
      return Response.json({ features: [] })
    }
    assert.deepEqual(await loadBriefingAlerts([-80, 25.7]), { alerts: [], unavailable: false })
    globalThis.fetch = async () => Response.json({}, { status: 503 })
    assert.deepEqual(await loadBriefingAlerts([-80, 25.7]), { alerts: [], unavailable: true })
  } finally {
    globalThis.fetch = realFetch
  }
  console.log('SPC briefing point, timing, and partial outage checks passed.')
} finally {
  await vite.close()
}
