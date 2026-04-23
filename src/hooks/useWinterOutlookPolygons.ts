import { useEffect, useState } from 'react'
import { buildWinterStormOutlookQueryUrl } from '../services/outlooks'
import type { WinterOutlookFeature } from '../types/weather'

type WinterGeoJsonResponse = {
  features?: Array<{
    id?: string | number
    geometry?: GeoJSON.Geometry | null
    properties?: {
      id?: number
      product?: string
      outlook?: string
      valid_time?: string
      issue_time?: string
      snippet?: string
    }
  }>
}

type WinterOutlookState = {
  features: WinterOutlookFeature[]
  loading: boolean
  error: string | null
}

export function useWinterOutlookPolygons(
  product: 'snowfall' | 'freezingRain',
  day: 1 | 2 | 3 | 4,
  enabled = true,
): WinterOutlookState {
  const [state, setState] = useState<WinterOutlookState>({
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

    fetch(buildWinterStormOutlookQueryUrl(product, day), {
      signal: controller.signal,
      headers: {
        Accept: 'application/geo+json',
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Winter outlook request failed: ${response.status} ${response.statusText}`,
          )
        }

        return response.json() as Promise<WinterGeoJsonResponse>
      })
      .then((response) => {
        if (controller.signal.aborted) {
          return
        }

        setState({
          features: normalizeWinterFeatures(response, product),
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
  }, [day, enabled, product])

  return state
}

function normalizeWinterFeatures(
  response: WinterGeoJsonResponse,
  product: 'snowfall' | 'freezingRain',
): WinterOutlookFeature[] {
  return (response.features ?? [])
    .filter((feature): feature is NonNullable<WinterGeoJsonResponse['features']>[number] => {
      return (
        feature.geometry?.type === 'Polygon' ||
        feature.geometry?.type === 'MultiPolygon'
      )
    })
    .map((feature, index) => {
      const outlook =
        feature.properties?.outlook ?? '<10% Probability of Exceeding Warning Criteria'

      return {
        id: String(feature.id ?? feature.properties?.id ?? `winter-${index}`),
        product,
        outlook,
        validTime: feature.properties?.valid_time ?? '',
        issueTime: feature.properties?.issue_time ?? '',
        snippet:
          feature.properties?.snippet ??
          'Probability of exceeding local winter storm warning criteria.',
        ...resolveWinterOutlookColors(outlook),
        geometry: feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      }
    })
}

function resolveWinterOutlookColors(outlook: string) {
  if (outlook.startsWith('80%')) {
    return { fillColor: '#990099', lineColor: '#6f006f' }
  }

  if (outlook.startsWith('50%')) {
    return { fillColor: '#ff0000', lineColor: '#9f1d1d' }
  }

  if (outlook.startsWith('30%')) {
    return { fillColor: '#f7ff03', lineColor: '#9a9d14' }
  }

  if (outlook.startsWith('10%')) {
    return { fillColor: '#04bcca', lineColor: '#0d7c84' }
  }

  return { fillColor: '#00000000', lineColor: '#555555' }
}
