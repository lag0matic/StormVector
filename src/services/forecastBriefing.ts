import { buildActiveAlertsUrl, buildPointsUrl, fetchJson } from './nws'

export const briefingRanges = [
  ['hourly', '24 hours'], ['early', 'Days 1–3'], ['week', 'Days 4–7'],
  ['extended', 'Extended range'], ['seasonal', 'Seasonal'],
] as const
export type BriefingRange = typeof briefingRanges[number][0]
type Point = [number, number]
export const models = [ ['gfs_global', 'GFS'], ['ecmwf_ifs025', 'Euro IFS'], ['gfs_hrrr', 'HRRR'] ] as const
export type Phase = 'dry' | 'rain' | 'snow' | 'mix' | 'freezing-rain' | 'sleet'
export type Conditions = 'sun' | 'partly' | 'cloud' | 'storm' | 'fog' | Exclude<Phase, 'dry'>
export type OfficialPeriod = {
  name: string; startTime: string; endTime: string; isDaytime: boolean
  temperature: number; temperatureUnit: string; shortForecast: string; detailedForecast?: string
  windSpeed?: string; probabilityOfPrecipitation?: { value: number | null }
}
type PointProperties = {
  timeZone: string; forecast: string; forecastHourly: string
  relativeLocation?: { properties?: { city?: string; state?: string } }
}
type ModelResponse = {
  timezone: string
  hourly?: Record<string, Array<number | null>> & { time: number[] }
  daily?: { time: string[]; [key: string]: Array<number | null> | string[] }
}
export type Hour = { start: number; official: OfficialPeriod | undefined; modeled: (Phase | null)[] }
export type ModelDay = { date: string; values: ({ high: number; low: number; total: number; snow: number | null } | null)[] }
export type Alert = { id: string; event: string; ends: string; level: 'warning' | 'watch' | 'advisory' }
export type SeasonalSignal = { category: 'Above' | 'Below' | 'Normal' | 'EC'; probability: number; issued: number; season: string }
type Base = { place: string; zone: string; alerts: Alert[] }
export type Briefing = Base & (
  | { range: 'hourly'; hours: Hour[]; nwsAvailable: boolean; modelsAvailable: boolean }
  | { range: 'early' | 'week'; periods: OfficialPeriod[] }
  | { range: 'extended'; days: ModelDay[] }
  | { range: 'seasonal'; season: string; temperature: SeasonalSignal | null; precipitation: SeasonalSignal | null }
)

const hourMs = 3_600_000
const cpcBase = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks'
const pointUrlPattern = /^https:\/\/api\.weather\.gov\/gridpoints\/[A-Z]{3}\/-?\d+,-?\d+\/forecast(?:\/hourly)?$/

export function dateAt(timestamp: number, timeZone: string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp)
}

export function datePlus(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 24 * hourMs).toISOString().slice(0, 10)
}

export function dayName(date: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T00:00:00Z`))
}

export function clockLabel(time: number, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(time)
}

export function conditionFor(text: string, daytime = true): Conditions {
  const words = text.toLowerCase()
  if (/thunder/.test(words)) return 'storm'
  if (/freezing (?:rain|drizzle)/.test(words)) return 'freezing-rain'
  if (/sleet|ice pellet/.test(words)) return 'sleet'
  if (/rain|drizzle/.test(words) && /snow|flurr/.test(words)) return 'mix'
  if (/snow|flurr/.test(words)) return 'snow'
  if (/rain|shower|drizzle/.test(words)) return 'rain'
  if (/fog|mist/.test(words)) return 'fog'
  if (/partly|mostly (sunny|clear)/.test(words)) return 'partly'
  if (/clear|sunny/.test(words)) return 'sun'
  return /cloud|overcast/.test(words) || daytime ? 'cloud' : 'partly'
}

export function modelPhase(total: number | null, rain: number | null, showers: number | null, snow: number | null, code: number | null): Phase | null {
  if (total == null || !Number.isFinite(total) || total < 0) return null
  if (total === 0 && !(snow && snow > 0)) return 'dry'
  if (code != null && [56, 57, 66, 67].includes(code)) return 'freezing-rain'
  const liquid = (rain ?? 0) > 0 || (showers ?? 0) > 0 || (code != null && [51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code))
  const frozen = (snow ?? 0) > 0 || (code != null && [71, 73, 75, 77, 85, 86].includes(code))
  if (liquid && frozen) return 'mix'
  if (frozen) return 'snow'
  if (liquid) return 'rain'
  return null
}

function normalizeHours(now: number, periods: OfficialPeriod[], response: ModelResponse | null): Hour[] {
  const floor = Math.floor(now / hourMs) * hourMs
  const data = response?.hourly
  const byEnd = new Map(data?.time.map((seconds, i) => [seconds * 1000, i]))
  const valid = periods.map(period => ({ period, start: Date.parse(period.startTime), end: Date.parse(period.endTime) }))
  return Array.from({ length: 24 }, (_, hour) => {
    const start = floor + hour * hourMs
    const i = byEnd.get(start + hourMs)
    return { start, official: valid.find(period => period.start <= start && period.end > start)?.period,
      modeled: models.map(([id]) => i == null ? null : modelPhase(...(['precipitation', 'rain', 'showers', 'snowfall', 'weather_code'] as const)
        .map(key => data?.[`${key}_${id}`]?.[i] ?? null) as [number | null, number | null, number | null, number | null, number | null])) }
  })
}

function daysFromModels(response: ModelResponse, today: string): ModelDay[] {
  const daily = response.daily
  if (!daily) return []
  const number = (key: string, i: number) => {
    const value = daily[key]?.[i]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  return daily.time.flatMap((date, i) => date >= datePlus(today, 7) && date < datePlus(today, 15) ? [{
    date, values: models.slice(0, 2).map(([id]) => {
      const high = number(`temperature_2m_max_${id}`, i), low = number(`temperature_2m_min_${id}`, i)
      const total = number(`precipitation_sum_${id}`, i), snow = number(`snowfall_sum_${id}`, i)
      return high == null || low == null || total == null ? null : { high, low, total, snow }
    }),
  }] : [])
}

export function summarizeHours(hours: Hour[], zone: string) {
  const phrases = new Map<Conditions, string>([['rain', 'Rain'], ['snow', 'Snow'], ['mix', 'Rain and snow'], ['freezing-rain', 'Freezing rain'], ['sleet', 'Sleet'], ['storm', 'Thunderstorms']])
  const changes: string[] = []
  let last: string | null = null
  for (const hour of hours) {
    const period = hour.official
    if (!period) { last = null; continue }
    const condition = conditionFor(period.shortForecast, period.isDaytime)
    const current = phrases.has(condition) ? condition : 'dry'
    const possible = current !== 'dry' && /chance|possible/i.test(period.shortForecast)
    const state = possible ? `${current}-possible` : current
    if (last !== state && (current !== 'dry' || (last != null && last !== 'dry'))) {
      const phrase = current === 'dry' ? 'Drier' : `${phrases.get(current)}${possible ? ' possible' : last === `${current}-possible` ? ' more likely' : ''}`
      const afterMidnight = hour !== hours[0] && dateAt(hour.start, zone) !== dateAt(hours[0].start, zone)
      changes.push(`${phrase} ${hour === hours[0] ? 'now' : `around ${clockLabel(hour.start, zone)}${afterMidnight ? ` ${dayName(dateAt(hour.start, zone)).split(',')[0]}` : ''}`}`)
    }
    last = state
  }
  if (changes.length) return `${changes.slice(0, 3).join('; ')}.`
  return hours.every(hour => hour.official) ? 'Dry in the hourly forecast.' : hours.some(hour => hour.official) ? 'No precipitation in the available hourly forecast.' : 'NWS hourly forecast unavailable.'
}

type ArcRow = { attributes: { cat: string; prob: number; fcst_date: number; valid_seas: string } }
const seasons: Record<string, string> = {
  JFM: 'January–March', FMA: 'February–April', MAM: 'March–May', AMJ: 'April–June', MJJ: 'May–July', JJA: 'June–August',
  JAS: 'July–September', ASO: 'August–October', SON: 'September–November', OND: 'October–December', NDJ: 'November–January', DJF: 'December–February',
}

export function seasonLabel(season: string) {
  const [code, ...years] = season.split(' ')
  return seasons[code] ? `${seasons[code]} ${years.join(' ')}` : season
}

export function seasonalSignal(features: ArcRow[], now: number): SeasonalSignal | null {
  const rows = features.map(feature => feature.attributes)
  const first = rows[0]
  if (!first || rows.some(row => row.cat !== first.cat || row.prob !== first.prob || row.fcst_date !== first.fcst_date || row.valid_seas !== first.valid_seas)) return null
  const category = (['Above', 'Below', 'Normal', 'EC'] as const).find(item => item === first.cat)
  const [code, year] = first.valid_seas.split(' ')
  if (!category || !seasons[code] || !/^\d{4}(?:-\d{4})?$/.test(year) || !(first.prob >= 33 && first.prob <= 100) ||
      !Number.isFinite(first.fcst_date) || first.fcst_date > now || now - first.fcst_date > 50 * 24 * hourMs) return null
  return { category, probability: first.prob, issued: first.fcst_date, season: first.valid_seas }
}

async function request<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Weather data unavailable (${response.status})`)
  return response.json() as Promise<T>
}

async function seasonalAt([lon, lat]: Point, kind: 'temp' | 'precip', now: number, signal: AbortSignal) {
  const query = new URLSearchParams({ f: 'json', where: '1=1', geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
    returnGeometry: 'false', outFields: 'fcst_date,valid_seas,cat,prob' })
  const result = await request<{ features?: ArcRow[]; exceededTransferLimit?: boolean }>(`${cpcBase}/cpc_sea_${kind}_outlk/MapServer/0/query?${query}`, signal)
  return result.exceededTransferLimit ? null : seasonalSignal(result.features ?? [], now)
}

async function readAlerts([lon, lat]: Point, now: number, signal: AbortSignal): Promise<Alert[]> {
  const input = await fetchJson<{ features?: { id: string; properties: { event: string; status: string; messageType: string; ends: string | null; expires: string } }[] }>(buildActiveAlertsUrl(`${lat},${lon}`), { signal })
  const priority = { warning: 0, watch: 1, advisory: 2 }
  return (input.features ?? []).flatMap(({ id, properties }) => {
    const { event, status, messageType, ends, expires } = properties
    const level = (['warning', 'watch', 'advisory'] as const).find(item => event?.toLowerCase().includes(item))
    return status === 'Actual' && (messageType === 'Alert' || messageType === 'Update') && level && Date.parse(expires) > now && Date.parse(ends ?? expires) > now ? [{ id, event, level, ends: ends ?? expires }] : []
  }).sort((a, b) => priority[a.level] - priority[b.level] || Date.parse(a.ends) - Date.parse(b.ends))
}

export async function loadForecastBriefing(coordinates: Point, range: BriefingRange, abort: AbortSignal, now = Date.now()): Promise<Briefing> {
  const point = coordinates.map(value => Number(value.toFixed(4))) as Point
  const [longitude, latitude] = point
  const signal = AbortSignal.any([abort, AbortSignal.timeout(range === 'seasonal' ? 18_000 : 12_000)])
  const pointPromise = fetchJson<{ properties: PointProperties }>(buildPointsUrl(latitude, longitude), { signal }).then(result => result.properties).catch(() => null)
  const alertsPromise = readAlerts(point, now, signal).catch(() => [])
  const base = async (alternateZone?: string): Promise<Base> => {
    const [local, alerts] = await Promise.all([pointPromise, alertsPromise])
    const relative = local?.relativeLocation?.properties
    return { place: relative?.city ? [relative.city, relative.state].filter(Boolean).join(', ') : `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
      zone: local?.timeZone || alternateZone || Intl.DateTimeFormat().resolvedOptions().timeZone, alerts }
  }
  const weather = (hourly: boolean) => pointPromise.then(async info => {
    const url = hourly ? info?.forecastHourly : info?.forecast
    if (!url || !pointUrlPattern.test(url) || url.endsWith('/hourly') !== hourly) return []
    return (await fetchJson<{ properties: { periods: OfficialPeriod[] } }>(url, { signal })).properties.periods
      .filter(period => Date.parse(period.endTime) > now && Number.isFinite(period.temperature) && typeof period.shortForecast === 'string')
  }).catch(() => [])
  const model = (params: Record<string, string>) => request<ModelResponse>(`https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), timezone: 'auto', temperature_unit: 'fahrenheit', ...params })}`, signal).catch(() => null)

  if (range === 'hourly') {
    const [periods, result] = await Promise.all([weather(true), model({ hourly: 'precipitation,rain,showers,snowfall,weather_code', models: models.map(([id]) => id).join(','), forecast_days: '2', timeformat: 'unixtime' })])
    const hours = normalizeHours(now, periods, result)
    return { ...await base(result?.timezone), range, hours, nwsAvailable: hours.some(hour => hour.official), modelsAvailable: hours.some(hour => hour.modeled.some(Boolean)) }
  }
  if (range === 'extended') {
    const result = await model({ daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum', models: models.slice(0, 2).map(([id]) => id).join(','), forecast_days: '15' })
    const meta = await base(result?.timezone)
    return { ...meta, range, days: result ? daysFromModels(result, dateAt(now, meta.zone)) : [] }
  }
  if (range === 'seasonal') {
    const [meta, temperature, precipitation] = await Promise.all([base(), seasonalAt(point, 'temp', now, signal).catch(() => null), seasonalAt(point, 'precip', now, signal).catch(() => null)])
    const season = temperature?.season ?? precipitation?.season ?? ''
    return { ...meta, range, season, temperature, precipitation: precipitation?.season === season ? precipitation : null }
  }
  const [meta, periods] = await Promise.all([base(), weather(false)])
  const today = dateAt(now, meta.zone)
  const start = datePlus(today, range === 'early' ? 0 : 3), end = datePlus(today, range === 'early' ? 3 : 7)
  return { ...meta, range, periods: periods.filter(period => {
    const date = dateAt(Math.max(now, Date.parse(period.startTime)), meta.zone)
    return date >= start && date < end
  }) }
}
