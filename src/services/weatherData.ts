import { buildActiveAlertsUrl, buildPointsUrl, fetchJson } from './nws'
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

type NwsAlertsResponse = {
  features: Array<{
    properties: {
      event?: string
      severity?: string
      headline?: string
      description?: string
    }
  }>
}

export async function fetchLocationWeather(
  coordinates: [number, number],
  signal?: AbortSignal,
): Promise<LocationWeather> {
  const latitude = Number(coordinates[1].toFixed(4))
  const longitude = Number(coordinates[0].toFixed(4))

  const point = await fetchJson<NwsPointResponse>(
    buildPointsUrl(latitude, longitude),
    {
      signal,
    },
  )

  const city = point.properties.relativeLocation?.properties?.city ?? 'Selected point'
  const state = point.properties.relativeLocation?.properties?.state ?? 'US'

  const [forecast, alerts] = await Promise.all([
    fetchJson<NwsForecastResponse>(point.properties.forecast, { signal }),
    fetchJson<NwsAlertsResponse>(buildActiveAlertsUrl(`${latitude},${longitude}`), {
      signal,
    }).catch(() => ({ features: [] })),
  ])

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
    hazards: buildHazards(alerts),
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
        role: 'Active alerts near the selected point.',
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

function buildHazards(alerts: NwsAlertsResponse): HazardCard[] {
  if (alerts.features.length === 0) {
    return [
      {
        type: 'Alerts',
        title: 'No active alerts nearby',
        summary: 'The live NWS alerts feed did not return active products for this point.',
      },
      {
        type: 'Storm Risk',
        title: 'SPC integration next',
        summary: 'Storm outlook polygons will be added as map layers rather than cards.',
      },
    ]
  }

  return alerts.features.slice(0, 3).map((feature) => ({
    type: feature.properties.severity ?? 'Alert',
    title: feature.properties.event ?? feature.properties.headline ?? 'Active alert',
    summary:
      feature.properties.headline ??
      feature.properties.description?.slice(0, 140) ??
      'Alert details available from NWS.',
  }))
}
