import { useEffect, useState } from 'react'
import { buildPointsUrl, fetchJson } from '../services/nws'

export type StormTrackPlace = {
  label: string
  coordinates: [number, number]
  alongTrackMiles: number
}

type StormTrackPlacesState = {
  places: StormTrackPlace[]
  loading: boolean
}

type NwsPointLookupResponse = {
  properties?: {
    relativeLocation?: {
      properties?: {
        city?: string
        state?: string
      }
    }
  }
}

const maxSamples = 6
const maxPlaces = 6
const pointPlaceCache = new Map<string, { label: string; coordinates: [number, number] } | null>()

export function useStormTrackPlaces(
  enabled: boolean,
  origin: [number, number] | null,
  end: [number, number] | null,
) {
  const [state, setState] = useState<StormTrackPlacesState>({
    places: [],
    loading: false,
  })

  useEffect(() => {
    if (!enabled || !origin || !end) {
      setState({
        places: [],
        loading: false,
      })
      return
    }

    let cancelled = false

    const loadPlaces = async () => {
      setState((current) => ({
        ...current,
        loading: true,
      }))

      const nextPlaces = await lookupPlacesAlongTrack(origin, end)

      if (cancelled) {
        return
      }

      setState({
        places: nextPlaces,
        loading: false,
      })
    }

    void loadPlaces()

    return () => {
      cancelled = true
    }
  }, [enabled, end, origin])

  return state
}

async function lookupPlacesAlongTrack(
  origin: [number, number],
  end: [number, number],
) {
  const totalDistanceMiles = distanceBetweenMiles(origin, end)

  if (totalDistanceMiles < 8) {
    return []
  }

  const minimumSpacingMiles = 6
  const sampleSpacingMiles = 10
  const sampleCount = Math.min(
    maxSamples,
    Math.max(2, Math.floor(totalDistanceMiles / sampleSpacingMiles)),
  )
  const samplePoints = Array.from({ length: sampleCount }, (_, index) => {
    const fraction = (index + 1) / (sampleCount + 1)
    return {
      coordinates: interpolateAlongLine(origin, end, fraction),
      alongTrackMiles: totalDistanceMiles * fraction,
    }
  })

  const resolvedPlaces = await Promise.allSettled(
    samplePoints.map(async (samplePoint) => {
      const place = await lookupPlaceFromPointMetadata(samplePoint.coordinates)

      if (!place) {
        return null
      }

      return {
        ...place,
        alongTrackMiles: samplePoint.alongTrackMiles,
      }
    }),
  )

  return resolvedPlaces
    .map((result) => (result.status === 'fulfilled' ? result.value : null))
    .filter((place): place is StormTrackPlace => Boolean(place))
    .sort((left, right) => left.alongTrackMiles - right.alongTrackMiles)
    .reduce<StormTrackPlace[]>((kept, place) => {
      const previous = kept[kept.length - 1]

      if (kept.some((entry) => entry.label === place.label)) {
        return kept
      }

      if (
        previous &&
        place.alongTrackMiles - previous.alongTrackMiles < minimumSpacingMiles
      ) {
        return kept
      }

      kept.push(place)
      return kept
    }, [])
    .slice(0, maxPlaces)
}

async function lookupPlaceFromPointMetadata(
  coordinates: [number, number],
): Promise<{ label: string; coordinates: [number, number] } | null> {
  const latitude = Number(coordinates[1].toFixed(4))
  const longitude = Number(coordinates[0].toFixed(4))
  const cacheKey = `${longitude.toFixed(3)},${latitude.toFixed(3)}`
  const cached = pointPlaceCache.get(cacheKey)

  if (cached !== undefined) {
    return cached
  }

  try {
    const response = await fetchJson<NwsPointLookupResponse>(
      buildPointsUrl(latitude, longitude),
    )
    const city = response.properties?.relativeLocation?.properties?.city
    const state = response.properties?.relativeLocation?.properties?.state

    if (!city || !state) {
      pointPlaceCache.set(cacheKey, null)
      return null
    }

    const result = {
      label: `${city}, ${state}`,
      coordinates: [longitude, latitude] as [number, number],
    }
    pointPlaceCache.set(cacheKey, result)
    return result
  } catch {
    pointPlaceCache.set(cacheKey, null)
    return null
  }
}

function interpolateAlongLine(
  [startLon, startLat]: [number, number],
  [endLon, endLat]: [number, number],
  fraction: number,
): [number, number] {
  return [
    startLon + (endLon - startLon) * fraction,
    startLat + (endLat - startLat) * fraction,
  ]
}

function distanceBetweenMiles(
  [lonA, latA]: [number, number],
  [lonB, latB]: [number, number],
) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const earthRadiusMiles = 3958.8
  const deltaLat = toRadians(latB - latA)
  const deltaLon = toRadians(lonB - lonA)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(latA)) *
      Math.cos(toRadians(latB)) *
      Math.sin(deltaLon / 2) ** 2

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
