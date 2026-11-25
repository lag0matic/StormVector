import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const vite = await createServer({
  configFile: false, optimizeDeps: { noDiscovery: true },
  ssr: { external: ['react', 'react/jsx-dev-runtime', 'react/jsx-runtime'] },
  server: { middlewareMode: true, watch: null },
})
const originalFetch = globalThis.fetch
try {
  const { loadForecastBriefing, modelPhase, conditionFor, dateAt, summarizeHours, seasonalSignal } = await vite.ssrLoadModule('/src/services/forecastBriefing.ts')
  const { ForecastTemperature } = await vite.ssrLoadModule('/src/components/ForecastTemperature.tsx')
  for (const [value, band] of [[-1,'subzero'],[0,'cold'],[19,'cold'],[20,'blue'],[39,'blue'],[40,'teal'],[59,'teal'],[60,'green'],[69,'green'],[70,'neutral'],[71,'gold'],[79,'gold'],[80,'orange'],[89,'orange'],[90,'hot']]) {
    assert.ok(renderToStaticMarkup(createElement(ForecastTemperature, { value })).includes(`data-band="${band}"`))
  }
  assert.match(renderToStaticMarkup(createElement(ForecastTemperature, { value: 0, unit: 'C' })), /data-band="blue">0°C/)
  for (const [words, phase] of [['Chance of Freezing Rain','freezing-rain'],['Freezing Drizzle','freezing-rain'],['Sleet Likely','sleet'],['Ice Pellets','sleet'],['Rain and Snow','mix'],['Snow Showers','snow']]) {
    assert.equal(conditionFor(words), phase)
  }
  const now = Date.parse('2026-11-26T22:30:00Z')
  const zone = 'America/Indiana/Indianapolis'
  assert.equal(dateAt(now, zone), '2026-11-26')
  assert.equal(modelPhase(null, 0, 0, 0, 0), null)
  assert.equal(modelPhase(0, 0, 0, 0, 61), 'dry')
  assert.equal(modelPhase(0.7, 0.4, 0, 0.2, 71), 'mix')
  for (const code of [56, 57, 66, 67]) assert.equal(modelPhase(0.3, 0, 0, 0, code), 'freezing-rain')
  assert.equal(modelPhase(0.5, 0, 0.5, 0, null), 'rain')

  const grid = 'https://api.weather.gov/gridpoints/ILN/20,69/forecast'
  const sample = (name, start, end, shortForecast, isDaytime = true) => ({
    name, startTime: start, endTime: end, shortForecast, temperature: 42, temperatureUnit: 'F', isDaytime,
  })
  const hourly = [sample('Thursday', '2026-11-26T22:00:00Z', '2026-11-26T23:00:00Z', 'Rain'),
    sample('Thursday Night', '2026-11-26T23:00:00Z', '2026-11-27T00:00:00Z', 'Rain And Snow', false)]
  const daily = [sample('Thursday Night', '2026-11-26T22:00:00Z', '2026-11-27T11:00:00Z', 'Rain', false),
    sample('Sunday', '2026-11-29T11:00:00Z', '2026-11-29T23:00:00Z', 'Partly Sunny')]
  const cpc = (cat, prob, valid_seas = 'DJF 2026-2027') => ({ attributes: { cat, prob, valid_seas, fcst_date: Date.parse('2026-11-19T00:00:00Z') } })
  assert.equal(seasonalSignal([cpc('EC', 33)], now)?.category, 'EC')
  assert.equal(seasonalSignal([], now), null)
  assert.equal(seasonalSignal([cpc('Above', 40), cpc('Below', 40)], now), null)
  const requested = []
  globalThis.fetch = async url => {
    const request = new URL(url)
    requested.push(request.hostname)
    if (request.pathname.startsWith('/points')) return Response.json({ properties: { forecast: grid, forecastHourly: `${grid}/hourly`, timeZone: zone, relativeLocation: { properties: { city: 'Richmond', state: 'IN' } } } })
    if (request.pathname.startsWith('/alerts')) return Response.json({ features: ['Watch', 'Warning'].map(event => ({ id: event, properties: { event, status: 'Actual', messageType: 'Alert', ends: '2026-11-27T02:00:00Z', expires: '2026-11-27T02:00:00Z' } })) })
    if (url === grid) return Response.json({ properties: { periods: daily } })
    if (url === `${grid}/hourly`) return Response.json({ properties: { periods: hourly } })
    if (request.hostname.startsWith('mapservices')) return Response.json({ features: [request.pathname.includes('temp') ? cpc('Above', 40) : cpc('EC', 33)] })
    if (request.searchParams.has('hourly')) return Response.json({ timezone: zone, hourly: { time: ['2026-11-26T22:00:00Z', '2026-11-26T23:00:00Z', '2026-11-27T00:00:00Z'].map(value => Date.parse(value) / 1000), precipitation_gfs_global: [9, 0.8, 0.4], rain_gfs_global: [9, 0.8, 0.2], snowfall_gfs_global: [0, 0, 0.2], weather_code_gfs_global: [61, 61, 71] } })
    return Response.json({ timezone: zone, daily: { time: ['2026-12-02', '2026-12-03', '2026-12-11'], temperature_2m_max_gfs_global: [43, 40, 39], temperature_2m_min_gfs_global: [30, 25, 24], precipitation_sum_gfs_global: [1, 2, 3] } })
  }
  const load = range => loadForecastBriefing([-84.8947, 39.8173], range, new AbortController().signal, now)
  const first = await load('hourly')
  assert.equal(first.hours.length, 24)
  assert.deepEqual(first.hours[0].modeled, ['rain', null, null])
  assert.deepEqual(first.hours[1].modeled, ['mix', null, null])
  assert.match(summarizeHours(first.hours, zone), /Rain now; Rain and snow around 6:00 PM/)
  assert.deepEqual(first.alerts.map(alert => alert.level), ['warning', 'watch'])
  requested.length = 0
  assert.deepEqual((await load('early')).periods.map(period => period.name), ['Thursday Night'])
  assert.deepEqual((await load('week')).periods.map(period => period.name), ['Sunday'])
  assert(requested.every(host => host === 'api.weather.gov'))
  assert.deepEqual((await load('extended')).days.map(day => day.date), ['2026-12-03'])
  const outlook = await load('seasonal')
  assert.equal(outlook.temperature?.category, 'Above')
  assert.equal(outlook.precipitation?.category, 'EC')
  console.log('Forecast Briefing checks passed: phase, missing values, hour alignment, range selection, alerts, and seasonal signals.')

  if (process.argv.includes('--live')) {
    globalThis.fetch = originalFetch
    for (const range of ['hourly', 'early', 'week', 'extended', 'seasonal']) {
      const data = await loadForecastBriefing([-84.8947, 39.8173], range, new AbortController().signal)
      if (data.range === 'hourly') assert(data.nwsAvailable && data.modelsAvailable)
      if (data.range === 'early' || data.range === 'week') assert(data.periods.length > 0)
      if (data.range === 'extended') assert(data.days.some(day => day.values.every(Boolean)))
      if (data.range === 'seasonal') {
        assert(data.temperature || data.precipitation)
        if (!data.temperature || !data.precipitation) console.log('Live seasonal data is partial; the missing NOAA series is shown as unavailable.')
      }
      console.log(`Live Richmond ${range} passed (${data.place}).`)
    }
  }
} finally {
  globalThis.fetch = originalFetch
  await vite.close()
}
