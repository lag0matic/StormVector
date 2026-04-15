import { buildPointsUrl, fetchJson } from './nws'
import type { HazardCard, LocationWeather } from '../types/weather'

type NwsPointResponse = {
  properties: {
    forecast: string
    forecastOffice: string
    relativeLocation?: {
      properties?: {
        city?: string
        state?: string
      }
    }
  }
}

type NwsForecastResponse = {
  properties: {
    periods: Array<{
      name: string
      temperature: number
      temperatureUnit: string
      shortForecast: string
      isDaytime: boolean
    }>
  }
}

const pointResponseCache = new Map<string, NwsPointResponse>()
const forecastResponseCache = new Map<string, NwsForecastResponse>()

export async function fetchLocationWeather(
  coordinates: [number, number],
  signal?: AbortSignal,
): Promise<LocationWeather> {
  const latitude = Number(coordinates[1].toFixed(3))
  const longitude = Number(coordinates[0].toFixed(3))
  const pointCacheKey = `${latitude},${longitude}`

  const point =
    pointResponseCache.get(pointCacheKey) ??
    (await fetchJson<NwsPointResponse>(buildPointsUrl(latitude, longitude), {
      signal,
    }))

  pointResponseCache.set(pointCacheKey, point)

  const city = point.properties.relativeLocation?.properties?.city ?? 'Selected point'
  const state = point.properties.relativeLocation?.properties?.state ?? 'US'
  const forecastCacheKey = point.properties.forecast

  const forecast =
    forecastResponseCache.get(forecastCacheKey) ??
    (await fetchJson<NwsForecastResponse>(point.properties.forecast, {
      signal,
    }))

  forecastResponseCache.set(forecastCacheKey, forecast)

  return {
    location: {
      name: `${city}, ${state}`,
      office: point.properties.forecastOffice.split('/').at(-1) ?? 'NWS',
      coordinates,
    },
    current: {
      temperature: formatTemperature(
        forecast.properties.periods[0]?.temperature,
        forecast.properties.periods[0]?.temperatureUnit,
      ),
      summary: forecast.properties.periods[0]?.shortForecast ?? 'Forecast unavailable',
    },
    forecast: forecast.properties.periods.slice(0, 4).map((period) => ({
      name: period.name,
      temperature: formatTemperature(period.temperature, period.temperatureUnit),
      summary: period.shortForecast,
    })),
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

function formatTemperature(value?: number, unit?: string) {
  if (value === undefined || value === null) {
    return '--'
  }

  return `${value}°${unit ?? ''}`
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
