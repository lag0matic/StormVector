import { useEffect, useState } from 'react'
import {
  fetchCountyGeometries,
  geometryCollectionToMultiPolygon,
} from '../services/counties'
import { buildActiveAlertsUrl, fetchJson } from '../services/nws'
import type { AlertFeature } from '../types/weather'

type NwsAlertsGeoJsonResponse = {
  features?: Array<{
    id?: string
    geometry?: GeoJSON.Geometry | null
    properties?: {
      event?: string
      headline?: string
      description?: string
      instruction?: string
      effective?: string
      expires?: string
      severity?: string
      urgency?: string
      areaDesc?: string
      geocode?: {
        UGC?: string[]
        SAME?: string[]
      }
    }
  }>
}

type AlertPolygonState = {
  features: AlertFeature[]
  loading: boolean
  error: string | null
}

const refreshIntervalMs = 5 * 60 * 1000

export function useAlertPolygons(): AlertPolygonState {
  const [state, setState] = useState<AlertPolygonState>({
    features: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    const controller = new AbortController()

    const loadAlerts = async () => {
      try {
        const response = await fetchJson<NwsAlertsGeoJsonResponse>(
          buildActiveAlertsUrl(),
          {
            signal: controller.signal,
          },
        )

        if (controller.signal.aborted) {
          return
        }

        setState({
          features: await normalizeAlertFeatures(response, controller.signal),
          loading: false,
          error: null,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setState({
          features: [],
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Active alert polygons are unavailable.',
        })
      }
    }

    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }))

    loadAlerts()
    const interval = window.setInterval(loadAlerts, refreshIntervalMs)

    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [])

  return state
}

async function normalizeAlertFeatures(
  response: NwsAlertsGeoJsonResponse,
  signal?: AbortSignal,
): Promise<AlertFeature[]> {
  const resolvedFeatures = await Promise.all(
    (response.features ?? []).map(async (feature, index) => {
      const geometry = await resolveAlertGeometry(feature, signal)

      if (!geometry) {
        return null
      }

      return {
      ...resolveAlertColors(feature.properties?.event),
      id: feature.id ?? `alert-${index}`,
      alertType: classifyAlertType(feature.properties?.event),
      event: feature.properties?.event ?? 'Alert',
      headline:
        feature.properties?.headline ??
        feature.properties?.event ??
        'NWS active alert',
      description: feature.properties?.description?.trim() ?? '',
      instruction: feature.properties?.instruction?.trim() ?? '',
      effective: feature.properties?.effective ?? '',
      expires: feature.properties?.expires ?? '',
      severity: feature.properties?.severity ?? 'Unknown',
      urgency: feature.properties?.urgency ?? 'Unknown',
      areaDescription: feature.properties?.areaDesc ?? 'Area description unavailable',
        geometry,
      }
    }),
  )

  return resolvedFeatures.filter((feature): feature is AlertFeature => feature !== null)
}

async function resolveAlertGeometry(
  feature: NonNullable<NwsAlertsGeoJsonResponse['features']>[number],
  signal?: AbortSignal,
): Promise<GeoJSON.Polygon | GeoJSON.MultiPolygon | null> {
  if (feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon') {
    return feature.geometry
  }

  const countyFipsCodes = extractCountyFipsCodes(feature.properties?.geocode)

  if (countyFipsCodes.length === 0) {
    return null
  }

  const countyGeometries = await fetchCountyGeometries(countyFipsCodes, signal)
  return geometryCollectionToMultiPolygon(countyGeometries)
}

function extractCountyFipsCodes(
  geocode?: {
    UGC?: string[]
    SAME?: string[]
  },
) {
  const sameCodes = (geocode?.SAME ?? [])
    .map((code) => code.replace(/\D/g, '').slice(-5))
    .filter((code) => /^\d{5}$/.test(code))

  if (sameCodes.length > 0) {
    return [...new Set(sameCodes)]
  }

  return [...new Set(
    (geocode?.UGC ?? [])
      .map((code) => {
        const match = code.match(/^[A-Z]{2}C(\d{3})$/)
        const stateCode = stateAbbreviationToFips[code.slice(0, 2)]

        if (!match || !stateCode) {
          return null
        }

        return `${stateCode}${match[1]}`
      })
      .filter((code): code is string => code !== null),
  )]
}

function resolveAlertColors(eventName?: string) {
  const officialColor = eventName ? nwsHazardColors[eventName] : undefined

  if (officialColor) {
    return {
      fillColor: officialColor,
      lineColor: deriveOutlineColor(officialColor),
    }
  }

  return { fillColor: '#4d93ab', lineColor: '#245d71' }
}

function classifyAlertType(eventName?: string) {
  if (eventName?.endsWith('Warning')) {
    return 'warning' as const
  }

  if (eventName?.endsWith('Watch')) {
    return 'watch' as const
  }

  if (eventName?.endsWith('Advisory')) {
    return 'advisory' as const
  }

  return 'statement' as const
}

const nwsHazardColors: Record<string, string> = {
  'Tsunami Warning': '#FD6347',
  'Tornado Warning': '#FF0000',
  'Extreme Wind Warning': '#FF8C00',
  'Severe Thunderstorm Warning': '#FFA500',
  'Flash Flood Warning': '#8B0000',
  'Flash Flood Statement': '#8B0000',
  'Severe Weather Statement': '#00FFFF',
  'Special Marine Warning': '#FFA500',
  'Blizzard Warning': '#FF4500',
  'Snow Squall Warning': '#C71585',
  'Ice Storm Warning': '#8B008B',
  'Winter Storm Warning': '#FF69B4',
  'Lake Effect Snow Warning': '#008B8B',
  'High Wind Warning': '#DAA520',
  'Tropical Storm Warning': '#B22222',
  'Storm Warning': '#9400D3',
  'Flood Warning': '#00FF00',
  'Coastal Flood Warning': '#228B22',
  'Lakeshore Flood Warning': '#228B22',
  'High Surf Warning': '#228B22',
  'Extreme Heat Warning': '#C71585',
  'Tornado Watch': '#FFFF00',
  'Severe Thunderstorm Watch': '#DB7093',
  'Flash Flood Watch': '#2E8B57',
  'Gale Warning': '#DDA0DD',
  'Flood Statement': '#00FF00',
  'Extreme Cold Warning': '#0000FF',
  'Freeze Warning': '#483D8B',
  'Red Flag Warning': '#FF1493',
  'Hurricane Watch': '#FF00FF',
  'Tropical Storm Watch': '#F08080',
  'Winter Weather Advisory': '#7B68EE',
  'Cold Weather Advisory': '#AFEEEE',
  'Heat Advisory': '#FF7F50',
  'Flood Advisory': '#00FF7F',
  'Coastal Flood Advisory': '#7CFC00',
  'Lakeshore Flood Advisory': '#7CFC00',
  'Dense Fog Advisory': '#708090',
  'Dense Smoke Advisory': '#F0E68C',
  'Small Craft Advisory': '#D8BFD8',
  'Brisk Wind Advisory': '#D8BFD8',
  'Hazardous Seas Warning': '#D8BFD8',
  'Lake Wind Advisory': '#D2B48C',
  'Wind Advisory': '#D2B48C',
  'Frost Advisory': '#6495ED',
  'Freezing Fog Advisory': '#008080',
  'Freezing Spray Advisory': '#00BFFF',
  'Winter Storm Watch': '#4682B4',
  'Rip Current Statement': '#40E0D0',
  'Beach Hazards Statement': '#40E0D0',
  'Gale Watch': '#FFC0CB',
  'Flood Watch': '#2E8B57',
  'Coastal Flood Watch': '#66CDAA',
  'Lakeshore Flood Watch': '#66CDAA',
  'High Wind Watch': '#B8860B',
  'Extreme Heat Watch': '#800000',
  'Extreme Cold Watch': '#5F9EA0',
  'Freeze Watch': '#00FFFF',
  'Fire Weather Watch': '#FFDEAD',
  'Special Weather Statement': '#FFE4B5',
  'Marine Weather Statement': '#FFDAB9',
  'Air Quality Alert': '#808080',
  'Air Stagnation Advisory': '#808080',
  'Hazardous Weather Outlook': '#EEE8AA',
  'Hydrologic Outlook': '#90EE90',
  'Short Term Forecast': '#98FB98',
}

const stateAbbreviationToFips: Record<string, string> = {
  AL: '01',
  AK: '02',
  AZ: '04',
  AR: '05',
  CA: '06',
  CO: '08',
  CT: '09',
  DE: '10',
  FL: '12',
  GA: '13',
  HI: '15',
  ID: '16',
  IL: '17',
  IN: '18',
  IA: '19',
  KS: '20',
  KY: '21',
  LA: '22',
  ME: '23',
  MD: '24',
  MA: '25',
  MI: '26',
  MN: '27',
  MS: '28',
  MO: '29',
  MT: '30',
  NE: '31',
  NV: '32',
  NH: '33',
  NJ: '34',
  NM: '35',
  NY: '36',
  NC: '37',
  ND: '38',
  OH: '39',
  OK: '40',
  OR: '41',
  PA: '42',
  RI: '44',
  SC: '45',
  SD: '46',
  TN: '47',
  TX: '48',
  UT: '49',
  VT: '50',
  VA: '51',
  WA: '53',
  WV: '54',
  WI: '55',
  WY: '56',
  DC: '11',
  PR: '72',
}

function deriveOutlineColor(hexColor: string) {
  const normalized = hexColor.replace('#', '')
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  const amount = 0.34
  const darken = (value: number) => Math.max(0, Math.round(value * (1 - amount)))

  return `#${darken(red).toString(16).padStart(2, '0')}${darken(green)
    .toString(16)
    .padStart(2, '0')}${darken(blue).toString(16).padStart(2, '0')}`
}
