import { useEffect, useState } from 'react'
import { buildSpcCategoricalQueryUrl } from '../services/outlooks'
import type { SpcOutlookFeature } from '../types/weather'

type SpcGeoJsonResponse = {
  features?: Array<{
    id?: string | number
    geometry?: GeoJSON.Geometry | null
    properties?: {
      dn?: number
      label?: string
      valid?: string
      expire?: string
    }
  }>
}

type SpcOutlookState = {
  features: SpcOutlookFeature[]
  loading: boolean
  error: string | null
}

export function useSpcOutlookPolygons(
  day: 1 | 2 | 3,
  enabled = true,
): SpcOutlookState {
  const [state, setState] = useState<SpcOutlookState>({
    features: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    if (!enabled) {
      setState({
        features: [],
        loading: false,
        error: null,
      })
      return
    }

    const controller = new AbortController()

    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }))

    fetch(buildSpcCategoricalQueryUrl(day), {
      signal: controller.signal,
      headers: {
        Accept: 'application/geo+json',
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`SPC request failed: ${response.status} ${response.statusText}`)
        }

        return response.json() as Promise<SpcGeoJsonResponse>
      })
      .then((response) => {
        if (controller.signal.aborted) {
          return
        }

        setState({
          features: normalizeSpcFeatures(response),
          loading: false,
          error: null,
        })
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) {
          return
        }

        setState({
          features: [],
          loading: false,
          error: error.message,
        })
      })

    return () => controller.abort()
  }, [day, enabled])

  return state
}

function normalizeSpcFeatures(response: SpcGeoJsonResponse): SpcOutlookFeature[] {
  return (response.features ?? [])
    .filter((feature): feature is NonNullable<SpcGeoJsonResponse['features']>[number] => {
      return (
        feature.geometry?.type === 'Polygon' ||
        feature.geometry?.type === 'MultiPolygon'
      )
    })
    .map((feature, index) => ({
      id: String(feature.id ?? `spc-${index}`),
      ...resolveSpcColors(normalizeSpcCategory(feature.properties?.label)),
      category: normalizeSpcCategory(feature.properties?.label),
      valid: feature.properties?.valid ?? '',
      expire: feature.properties?.expire ?? '',
      geometry: feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    }))
}

function normalizeSpcCategory(label?: string) {
  switch (label) {
    case 'TSTM':
      return 'Thunderstorm'
    case 'MRGL':
      return 'Marginal'
    case 'SLGT':
      return 'Slight'
    case 'ENH':
      return 'Enhanced'
    case 'MDT':
      return 'Moderate'
    case 'HIGH':
      return 'High'
    default:
      return label ?? 'Outlook'
  }
}

function resolveSpcColors(category: string) {
  switch (category) {
    case 'Thunderstorm':
      return { fillColor: '#bdffbd', lineColor: '#5c985c' }
    case 'Marginal':
      return { fillColor: '#73b273', lineColor: '#447b44' }
    case 'Slight':
      return { fillColor: '#f7f78f', lineColor: '#b59d1b' }
    case 'Enhanced':
      return { fillColor: '#e69800', lineColor: '#9a5e00' }
    case 'Moderate':
      return { fillColor: '#ff0000', lineColor: '#a61d1d' }
    case 'High':
      return { fillColor: '#ff00c5', lineColor: '#a60082' }
    default:
      return { fillColor: '#aab7be', lineColor: '#6f7f87' }
  }
}
