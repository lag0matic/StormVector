import { buildPointsUrl, fetchJson, nwsHeaders } from './nws'
import { fetchOutdoorConditions } from './openMeteo'
import { trimCache } from '../utils/cache'
import type {
  ForecastPeriod,
  HazardCard,
  HourlyForecastPeriod,
  LocationWeather,
} from '../types/weather'

type NwsPointResponse = {
  properties: {
    forecast: string
    forecastHourly: string
    forecastGridData?: string
    forecastOffice: string
    observationStations: string
    relativeLocation?: {
      properties?: {
        city?: string
        state?: string
      }
    }
    astronomicalData?: {
      sunrise?: string
      sunset?: string
    }
  }
}

type NwsForecastResponse = {
  properties: {
    periods: Array<{
      name: string
      startTime: string
      temperature: number
      temperatureUnit: string
      shortForecast: string
      isDaytime: boolean
    }>
  }
}

type NwsHourlyForecastResponse = {
  properties: {
    periods: Array<{
      number: number
      startTime: string
      temperature: number
      temperatureUnit: string
      shortForecast: string
      isDaytime?: boolean
      windSpeed: string
      windDirection: string
      probabilityOfPrecipitation?: {
        value: number | null
      }
    }>
  }
}

type GridpointValue = {
  validTime: string
  value: number | null
}

type NwsGridpointResponse = {
  properties: {
    apparentTemperature?: { uom?: string; values?: GridpointValue[] }
    windGust?: { uom?: string; values?: GridpointValue[] }
    relativeHumidity?: { uom?: string; values?: GridpointValue[] }
    dewpoint?: { uom?: string; values?: GridpointValue[] }
    skyCover?: { uom?: string; values?: GridpointValue[] }
  }
}

type NwsStationsResponse = {
  features?: Array<{
    properties?: {
      stationIdentifier?: string
    }
  }>
}

type NwsAlertsResponse = {
  features?: Array<{
    properties?: {
      event?: string
      severity?: string
      expires?: string
    }
  }>
}

type CurrentWeatherAlert = {
  event: string
  severity?: string
  expires?: string
}

type AwcMetarResponse = Array<{
  icaoId?: string
  reportTime?: string
  temp?: number
  dewp?: number
  wdir?: number
  wspd?: number
  wgst?: number
  visib?: string | number
  name?: string
  cover?: string
  clouds?: Array<{
    cover?: string
    base?: number
  }>
  rawOb?: string
}>

type CacheEntry<T> = {
  value: T
  fetchedAt: number
}

const cacheMaxAgeMs = 8 * 60 * 1000
const cacheMaxEntries = 80
const pointResponseCache = new Map<string, CacheEntry<NwsPointResponse>>()
const forecastResponseCache = new Map<string, CacheEntry<NwsForecastResponse>>()
const hourlyForecastResponseCache = new Map<
  string,
  CacheEntry<NwsHourlyForecastResponse>
>()
const gridpointResponseCache = new Map<string, CacheEntry<NwsGridpointResponse>>()
const stationListCache = new Map<string, CacheEntry<NwsStationsResponse>>()
const metarCache = new Map<string, CacheEntry<AwcMetarResponse[number] | null>>()
const pointAlertsCache = new Map<string, CacheEntry<NwsAlertsResponse>>()

export async function fetchLocationWeather(
  coordinates: [number, number],
  signal?: AbortSignal,
): Promise<LocationWeather> {
  const latitude = Number(coordinates[1].toFixed(3))
  const longitude = Number(coordinates[0].toFixed(3))
  const pointCacheKey = `${latitude},${longitude}`

  const point = await getCachedOrFetch(
    pointResponseCache,
    pointCacheKey,
    () =>
      fetchJson<NwsPointResponse>(buildPointsUrl(latitude, longitude), {
        signal,
      }),
  )

  const city = point.properties.relativeLocation?.properties?.city ?? 'Selected point'
  const state = point.properties.relativeLocation?.properties?.state ?? 'US'

  const forecast = await getCachedOrFetch(
    forecastResponseCache,
    point.properties.forecast,
    () =>
      fetchJson<NwsForecastResponse>(point.properties.forecast, {
        signal,
      }),
  )

  const hourlyForecast = await getCachedOrFetch(
    hourlyForecastResponseCache,
    point.properties.forecastHourly,
    () =>
      fetchJson<NwsHourlyForecastResponse>(point.properties.forecastHourly, {
        signal,
      }),
  )

  const gridpoint = point.properties.forecastGridData
    ? await getCachedOrFetch(
        gridpointResponseCache,
        point.properties.forecastGridData,
        () =>
          fetchJson<NwsGridpointResponse>(point.properties.forecastGridData!, {
            signal,
          }),
      ).catch(() => null)
    : null

  const stationList = await getCachedOrFetch(
    stationListCache,
    point.properties.observationStations,
    () =>
      fetchJson<NwsStationsResponse>(point.properties.observationStations, {
        signal,
      }),
  ).catch(() => ({ features: [] }))

  const stationId = stationList.features?.[0]?.properties?.stationIdentifier ?? null

  const currentObservation = stationId
    ? await getCachedOrFetch(metarCache, stationId, () =>
        fetchAwcMetar(stationId, signal),
      ).catch(() => null)
    : null
  const pointAlerts = await getCachedOrFetch(
    pointAlertsCache,
    pointCacheKey,
    () => fetchPointAlerts(latitude, longitude, signal),
  ).catch(() => ({ features: [] }))
  const activeWeatherAlert = getHighestCurrentAlert(pointAlerts)
  const outdoorConditions = await fetchOutdoorConditions(coordinates, signal).catch(() => null)

  const currentHour = hourlyForecast.properties.periods[0] ?? null
  const currentGridTime = currentHour ? new Date(currentHour.startTime) : new Date()

  const currentSkyCover = getGridpointValueAtTime(
    gridpoint?.properties.skyCover?.values,
    currentGridTime,
  )
  const currentApparent = normalizeGridpointTemperature(
    getGridpointValueAtTime(gridpoint?.properties.apparentTemperature?.values, currentGridTime),
    gridpoint?.properties.apparentTemperature?.uom,
    'F',
  )

  const currentWindGust = normalizeWindGust(
    getGridpointValueAtTime(gridpoint?.properties.windGust?.values, currentGridTime),
    gridpoint?.properties.windGust?.uom,
  )
  const currentRelativeHumidity = getGridpointValueAtTime(
    gridpoint?.properties.relativeHumidity?.values,
    currentGridTime,
  )
  const currentGridDewpoint = normalizeGridpointTemperature(
    getGridpointValueAtTime(gridpoint?.properties.dewpoint?.values, currentGridTime),
    gridpoint?.properties.dewpoint?.uom,
    'F',
  )

  const currentTempF =
    currentObservation?.temp !== undefined && currentObservation?.temp !== null
      ? celsiusToFahrenheit(currentObservation.temp)
      : currentHour?.temperature ?? null

  const currentDewpointF =
    currentObservation?.dewp !== undefined && currentObservation?.dewp !== null
      ? celsiusToFahrenheit(currentObservation.dewp)
      : currentGridDewpoint

  const currentFeelsLike =
    currentTempF !== null
      ? deriveFeelsLike(
          currentTempF,
          currentObservation?.wspd ?? parseWindSpeedMph(currentHour?.windSpeed),
          currentDewpointF,
          currentApparent,
        )
      : null
  const currentHumidity =
    currentRelativeHumidity !== null
      ? currentRelativeHumidity
      : currentTempF !== null && currentDewpointF !== null
        ? relativeHumidityFromTempDewpoint(currentTempF, currentDewpointF)
        : null

  return {
    location: {
      name: `${city}, ${state}`,
      office: point.properties.forecastOffice.split('/').at(-1) ?? 'NWS',
      coordinates,
    },
    current: {
      temperature: formatTemperature(currentTempF, 'F'),
      summary:
        activeWeatherAlert?.event ??
        normalizeObservationSummary(currentObservation) ??
        normalizeForecastSummary(currentHour?.shortForecast, currentHour?.isDaytime) ??
        forecast.properties.periods[0]?.shortForecast ??
        'Current conditions unavailable',
      feelsLike: formatTemperature(currentFeelsLike, 'F'),
      dewpoint: formatTemperature(currentDewpointF, 'F'),
      humidity: formatPercent(currentHumidity),
      wind: buildCurrentWindSummary(
        currentObservation?.wdir,
        currentObservation?.wspd ?? parseWindSpeedMph(currentHour?.windSpeed),
        currentObservation?.wgst ?? currentWindGust,
        currentHour?.windDirection,
      ),
      sky: normalizeSkyCover(currentObservation, currentSkyCover, currentHour?.isDaytime),
      precip: activeWeatherAlert ? alertPrecipSummary(activeWeatherAlert.event) : normalizeCurrentPrecip(currentObservation),
      lastUpdated: formatObservationTimestamp(
        currentObservation?.reportTime ?? currentHour?.startTime,
      ),
      activeAlert: activeWeatherAlert
        ? {
            event: activeWeatherAlert.event,
            expires: formatAlertExpiration(activeWeatherAlert.expires),
          }
        : undefined,
    },
    sun: {
      sunrise: formatSunTime(point.properties.astronomicalData?.sunrise),
      sunset: formatSunTime(point.properties.astronomicalData?.sunset),
    },
    outdoor: buildOutdoorSummary(outdoorConditions),
    nextHours: buildNextHours(hourlyForecast.properties.periods.slice(0, 3), gridpoint),
    forecast: buildDailyForecastCards(forecast.properties.periods),
    hazards: buildForecastPlaceholders(),
    radar: {
      currentFrameLabel: 'Live radar mosaic',
      sourceLabel: 'NWS services, with playback adapter coming next',
    },
    services: [
      {
        name: 'forecast-service',
        role: 'Live NWS point forecast for the selected location.',
      },
      {
        name: 'alerts-service',
        role: 'Active alerts are loaded through the dedicated map/polygon pipeline.',
      },
      {
        name: 'radar-service',
        role: 'Next step: live radar frames and playback metadata.',
      },
      {
        name: 'satellite-service',
        role: 'Next step: GOES imagery and shared timeline support.',
      },
      {
        name: 'outlook-service',
        role: 'Next step: SPC and winter outlook overlays.',
      },
    ],
  }
}

function buildOutdoorSummary(
  outdoorConditions: Awaited<ReturnType<typeof fetchOutdoorConditions>>,
) {
  if (!outdoorConditions) {
    return {
      uvIndex: 'N/A',
      uvRisk: 'Unavailable',
      uvMax: 'N/A',
      airQuality: 'N/A',
      airQualityRisk: 'Unavailable',
      airQualityDetails: 'Outdoor exposure data unavailable',
      sourceLabel: 'Open-Meteo unavailable',
    }
  }

  return {
    uvIndex: formatIndex(outdoorConditions.uvIndex),
    uvRisk: describeUvRisk(outdoorConditions.uvIndex),
    uvMax: formatIndex(outdoorConditions.uvMax),
    airQuality: formatIndex(outdoorConditions.usAqi),
    airQualityRisk: describeAqiRisk(outdoorConditions.usAqi),
    airQualityDetails: buildAirQualityDetails(outdoorConditions),
    sourceLabel: 'Open-Meteo',
  }
}

function formatIndex(value: number | null) {
  return value === null ? 'N/A' : String(Math.round(value))
}

function describeUvRisk(value: number | null) {
  if (value === null) return 'Unavailable'
  if (value < 3) return 'Low'
  if (value < 6) return 'Moderate'
  if (value < 8) return 'High'
  if (value < 11) return 'Very high'
  return 'Extreme'
}

function describeAqiRisk(value: number | null) {
  if (value === null) return 'Unavailable'
  if (value <= 50) return 'Good'
  if (value <= 100) return 'Moderate'
  if (value <= 150) return 'Unhealthy for sensitive groups'
  if (value <= 200) return 'Unhealthy'
  if (value <= 300) return 'Very unhealthy'
  return 'Hazardous'
}

function buildAirQualityDetails(
  outdoorConditions: NonNullable<Awaited<ReturnType<typeof fetchOutdoorConditions>>>,
) {
  const details = [
    outdoorConditions.pm25 !== null
      ? `PM2.5 ${Math.round(outdoorConditions.pm25)} ug/m3`
      : null,
    outdoorConditions.ozone !== null
      ? `O3 ${Math.round(outdoorConditions.ozone)} ug/m3`
      : null,
  ].filter(Boolean)

  return details.join(' · ') || 'AQI details unavailable'
}

async function fetchAwcMetar(stationId: string, signal?: AbortSignal) {
  const response = await fetch(
    `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(
      stationId,
    )}&format=json`,
    {
      signal,
      headers: {
        ...nwsHeaders,
        Accept: 'application/json',
      },
    },
  )

  if (!response.ok) {
    throw new Error(`AWC METAR request failed: ${response.status} ${response.statusText}`)
  }

  const payload = (await response.json()) as AwcMetarResponse
  return payload[0] ?? null
}

async function fetchPointAlerts(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
) {
  return fetchJson<NwsAlertsResponse>(
    `https://api.weather.gov/alerts/active?point=${latitude},${longitude}`,
    {
      signal,
    },
  )
}

async function getCachedOrFetch<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  loader: () => Promise<T>,
) {
  const cached = cache.get(key)

  if (cached && Date.now() - cached.fetchedAt < cacheMaxAgeMs) {
    return cached.value
  }

  const value = await loader()
  cache.set(key, {
    value,
    fetchedAt: Date.now(),
  })
  trimCache(cache, cacheMaxEntries)
  return value
}

function buildNextHours(
  periods: NwsHourlyForecastResponse['properties']['periods'],
  gridpoint: NwsGridpointResponse | null,
): HourlyForecastPeriod[] {
  return periods.map((period, index) => {
    const start = new Date(period.startTime)
    const apparent = getGridpointValueAtTime(
      gridpoint?.properties.apparentTemperature?.values,
      start,
    )
    const gust = getGridpointValueAtTime(
      gridpoint?.properties.windGust?.values,
      start,
    )
    const skyCover = getGridpointValueAtTime(
      gridpoint?.properties.skyCover?.values,
      start,
    )

    return {
      label: `+${index + 1}h`,
      condition: period.shortForecast,
      temperature: formatTemperature(period.temperature, period.temperatureUnit),
      feelsLike: formatTemperature(
        normalizeGridpointTemperature(
          apparent,
          gridpoint?.properties.apparentTemperature?.uom,
          period.temperatureUnit,
        ) ?? period.temperature,
        period.temperatureUnit,
      ),
      wind: buildWindSummary(
        period.windDirection,
        period.windSpeed,
        normalizeWindGust(gust, gridpoint?.properties.windGust?.uom),
      ),
      precip: buildPrecipSummary(period),
      secondary:
        skyCover !== null && Number.isFinite(skyCover)
          ? `Cloud cover ${Math.round(skyCover)}%`
          : undefined,
    }
  })
}

function buildDailyForecastCards(
  periods: NwsForecastResponse['properties']['periods'],
): ForecastPeriod[] {
  const daytimePeriods = periods.filter((period) => period.isDaytime)
  const chosenPeriods = (daytimePeriods.length > 0 ? daytimePeriods : periods).slice(0, 5)

  return chosenPeriods.map((period) => ({
    name: formatForecastDay(period.startTime),
    temperature: formatTemperature(period.temperature, period.temperatureUnit),
    summary: period.shortForecast,
  }))
}

function buildWindSummary(
  direction: string,
  speedText: string,
  gust: number | null,
) {
  const compactSpeed = speedText.replace(/\s+/g, ' ').trim()
  const parts = [compactSpeed]

  if (direction) {
    parts.push(direction)
  }

  if (gust !== null && Number.isFinite(gust)) {
    parts.push(`gusts ${Math.round(gust)} mph`)
  }

  return parts.join(' • ')
}

function buildCurrentWindSummary(
  direction: number | null | undefined,
  speed: number | null | undefined,
  gust: number | null | undefined,
  fallbackDirection?: string,
) {
  if ((speed === null || speed === undefined) && (gust === null || gust === undefined)) {
    return 'Wind unavailable'
  }

  const parts: string[] = []

  if (speed !== null && speed !== undefined) {
    parts.push(`${Math.round(speed)} mph`)
  }

  if (direction !== null && direction !== undefined) {
    parts.push(degreesToCardinal(direction))
  } else if (fallbackDirection) {
    parts.push(fallbackDirection)
  }

  let summary = parts.join(' • ')

  if (gust !== null && gust !== undefined) {
    summary = `${summary}${summary ? ' • ' : ''}gusts ${Math.round(gust)} mph`
  }

  return summary || 'Wind unavailable'
}

function buildPrecipSummary(
  period: NwsHourlyForecastResponse['properties']['periods'][number],
) {
  const pop = period.probabilityOfPrecipitation?.value
  const lowerSummary = period.shortForecast.toLowerCase()

  if (typeof pop === 'number') {
    if (lowerSummary.includes('thunder')) {
      return `${pop}% storms`
    }

    if (lowerSummary.includes('snow')) {
      return `${pop}% snow`
    }

    if (lowerSummary.includes('rain') || lowerSummary.includes('shower')) {
      return `${pop}% rain`
    }

    return `${pop}% precip`
  }

  return period.shortForecast
}

function getGridpointValueAtTime(values: GridpointValue[] | undefined, time: Date) {
  if (!values || values.length === 0) {
    return null
  }

  const timestamp = time.getTime()

  for (const entry of values) {
    const [startText, durationText = 'PT0H'] = entry.validTime.split('/')
    const start = new Date(startText).getTime()
    const durationMs = parseIsoDurationToMs(durationText)
    const end = start + durationMs

    if (timestamp >= start && timestamp < end) {
      return entry.value ?? null
    }
  }

  return values[0]?.value ?? null
}

function parseIsoDurationToMs(duration: string) {
  const match = duration.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  )

  if (!match) {
    return 0
  }

  const days = Number(match[1] ?? 0)
  const hours = Number(match[2] ?? 0)
  const minutes = Number(match[3] ?? 0)
  const seconds = Number(match[4] ?? 0)

  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000
}

function celsiusToFahrenheit(value: number) {
  return value * (9 / 5) + 32
}

function fahrenheitToCelsius(value: number) {
  return (value - 32) * (5 / 9)
}

function kilometersPerHourToMph(value: number) {
  return value * 0.621371
}

function metersPerSecondToMph(value: number) {
  return value * 2.23694
}

function normalizeGridpointTemperature(
  value: number | null,
  uom: string | undefined,
  targetUnit: string | undefined,
) {
  if (value === null) {
    return null
  }

  if (targetUnit === 'F' && uom?.includes('degC')) {
    return celsiusToFahrenheit(value)
  }

  return value
}

function normalizeWindGust(value: number | null, uom: string | undefined) {
  if (value === null) {
    return null
  }

  if (uom?.includes('km_h')) {
    return kilometersPerHourToMph(value)
  }

  if (uom?.includes('m_s-1')) {
    return metersPerSecondToMph(value)
  }

  return value
}

function formatTemperature(value?: number | null, unit?: string) {
  if (value === undefined || value === null) {
    return '--'
  }

  return `${Math.round(value)}°${unit ?? ''}`
}

function formatPercent(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '--'
  }

  return `${Math.round(Math.max(0, Math.min(100, value)))}%`
}

function formatForecastDay(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Forecast'
  }

  const weekday = date.toLocaleDateString([], {
    weekday: 'long',
  })
  const month = date.toLocaleDateString([], {
    month: 'long',
  })

  return `${weekday}, ${month} ${getOrdinalDay(date.getDate())}`
}

function formatSunTime(value?: string) {
  if (!value) {
    return '--'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatObservationTimestamp(value?: string) {
  if (!value) {
    return 'Updated --'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Updated --'
  }

  return `Updated ${date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

function normalizeObservationSummary(observation: AwcMetarResponse[number] | null) {
  if (!observation) {
    return null
  }

  const sky = normalizeSkyCover(observation, null, null)
  const precip = normalizeCurrentPrecip(observation)

  if (precip === 'Dry') {
    return sky
  }

  return `${sky} with ${precip.toLowerCase()}`
}

function normalizeForecastSummary(summary?: string, isDaytime?: boolean) {
  if (!summary) {
    return null
  }

  if (isDaytime === false) {
    return summary
      .replace(/\bmostly sunny\b/gi, 'Mostly clear')
      .replace(/\bpartly sunny\b/gi, 'Partly cloudy')
      .replace(/\bsunny\b/gi, 'Clear')
  }

  return summary
}

function normalizeSkyCover(
  observation: AwcMetarResponse[number] | null,
  skyCover: number | null,
  isDaytime: boolean | null | undefined,
) {
  const cover = observation?.cover

  if (cover === 'OVC') return 'Overcast'
  if (cover === 'BKN') return 'Mostly cloudy'
  if (cover === 'SCT') return 'Partly cloudy'
  if (cover === 'FEW') return isDaytime === false ? 'Mostly clear' : 'Mostly sunny'
  if (cover === 'CLR' || cover === 'SKC') return 'Clear'

  if (skyCover !== null) {
    if (skyCover >= 90) return 'Overcast'
    if (skyCover >= 70) return 'Mostly cloudy'
    if (skyCover >= 35) return 'Partly cloudy'
    if (skyCover >= 10) return isDaytime === false ? 'Mostly clear' : 'Mostly sunny'
    return 'Clear'
  }

  return 'Sky cover unavailable'
}

function normalizeCurrentPrecip(observation: AwcMetarResponse[number] | null) {
  const raw = observation?.rawOb ?? ''

  if (/TS/.test(raw)) return 'Thunderstorms'
  if (/GR|GS/.test(raw)) return 'Hail'
  if (/SN/.test(raw)) return 'Snow'
  if (/PL/.test(raw)) return 'Ice pellets'
  if (/FZRA|FZDZ/.test(raw)) return 'Freezing precip'
  if (/RA|DZ|SHRA|SH/.test(raw)) return 'Rain'

  return 'Dry'
}

function getHighestCurrentAlert(alerts: NwsAlertsResponse): CurrentWeatherAlert | undefined {
  const activeAlerts =
    alerts.features
      ?.map((feature) => feature.properties)
      .filter((properties): properties is CurrentWeatherAlert =>
        typeof properties?.event === 'string' && properties.event.length > 0,
      ) ?? []

  return activeAlerts.sort(
    (left, right) => alertPriority(right.event) - alertPriority(left.event),
  )[0]
}

function alertPriority(event?: string) {
  const normalizedEvent = event?.toLowerCase() ?? ''

  if (normalizedEvent.includes('tornado warning')) return 100
  if (normalizedEvent.includes('severe thunderstorm warning')) return 90
  if (normalizedEvent.includes('flash flood warning')) return 85
  if (normalizedEvent.includes('warning')) return 80
  if (normalizedEvent.includes('watch')) return 60
  if (normalizedEvent.includes('statement')) return 40
  if (normalizedEvent.includes('advisory')) return 30
  return 10
}

function alertPrecipSummary(event: string) {
  const normalizedEvent = event.toLowerCase()

  if (normalizedEvent.includes('thunderstorm')) return 'Thunderstorms'
  if (normalizedEvent.includes('tornado')) return 'Tornadic storm'
  if (normalizedEvent.includes('flood')) return 'Flooding threat'
  if (normalizedEvent.includes('winter')) return 'Winter weather'
  return 'Active alert'
}

function formatAlertExpiration(value?: string) {
  if (!value) {
    return 'Expires --'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Expires --'
  }

  return `Expires ${date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

function parseWindSpeedMph(value?: string) {
  if (!value) {
    return null
  }

  const match = value.match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : null
}

function degreesToCardinal(value: number) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return directions[Math.round(value / 22.5) % 16]
}

function deriveFeelsLike(
  tempF: number,
  windMph: number | null | undefined,
  dewpointF: number | null,
  apparentFromGrid: number | null,
) {
  if (apparentFromGrid !== null) {
    return apparentFromGrid
  }

  const humidity = dewpointF !== null ? relativeHumidityFromTempDewpoint(tempF, dewpointF) : null

  if (tempF <= 50 && windMph !== null && windMph !== undefined && windMph > 3) {
    return windChillFahrenheit(tempF, windMph)
  }

  if (tempF >= 80 && humidity !== null) {
    return heatIndexFahrenheit(tempF, humidity)
  }

  return tempF
}

function relativeHumidityFromTempDewpoint(tempF: number, dewpointF: number) {
  const tempC = fahrenheitToCelsius(tempF)
  const dewC = fahrenheitToCelsius(dewpointF)
  const saturation =
    Math.exp((17.625 * dewC) / (243.04 + dewC)) /
    Math.exp((17.625 * tempC) / (243.04 + tempC))
  return Math.max(0, Math.min(100, saturation * 100))
}

function windChillFahrenheit(tempF: number, windMph: number) {
  return (
    35.74 +
    0.6215 * tempF -
    35.75 * Math.pow(windMph, 0.16) +
    0.4275 * tempF * Math.pow(windMph, 0.16)
  )
}

function heatIndexFahrenheit(tempF: number, rh: number) {
  return (
    -42.379 +
    2.04901523 * tempF +
    10.14333127 * rh -
    0.22475541 * tempF * rh -
    0.00683783 * tempF * tempF -
    0.05481717 * rh * rh +
    0.00122874 * tempF * tempF * rh +
    0.00085282 * tempF * rh * rh -
    0.00000199 * tempF * tempF * rh * rh
  )
}

function buildForecastPlaceholders(): HazardCard[] {
  return [
    {
      type: 'Alerts',
      title: 'Alerts on map',
      summary: 'Warning and watch details are driven by the dedicated polygon layer.',
    },
    {
      type: 'Storm Risk',
      title: 'SPC outlooks on map',
      summary: 'Severe-weather outlooks are shown as forecast overlays rather than cards.',
    },
  ]
}

function getOrdinalDay(day: number) {
  const suffix =
    day % 10 === 1 && day % 100 !== 11
      ? 'st'
      : day % 10 === 2 && day % 100 !== 12
        ? 'nd'
        : day % 10 === 3 && day % 100 !== 13
          ? 'rd'
          : 'th'

  return `${day}${suffix}`
}
