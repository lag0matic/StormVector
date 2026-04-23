type CensusMatch = {
  matchedAddress: string
  coordinates: {
    x: number
    y: number
  }
}

type CensusGeocodeResponse = {
  result: {
    addressMatches: CensusMatch[]
  }
}

type NominatimMatch = {
  display_name?: string
  lat?: string
  lon?: string
}
type NominatimReverseMatch = {
  display_name?: string
  address?: {
    city?: string
    town?: string
    village?: string
    hamlet?: string
    municipality?: string
    county?: string
    state?: string
    state_code?: string
  }
  lat?: string
  lon?: string
}

export type GeocodeResult = {
  label: string
  coordinates: [number, number]
}

const reversePlaceCache = new Map<string, GeocodeResult | null>()

const CENSUS_BENCHMARK = 'Public_AR_Current'
const censusJsonpTimeoutMs = 3500
const reverseGeocodeTimeoutMs = 2200
const reversePlaceCacheMaxEntries = 120

export function geocodeLocation(query: string): Promise<GeocodeResult> {
  const trimmedQuery = query.trim()

  if (!trimmedQuery) {
    return Promise.reject(new Error('Enter a city, state, or address to search.'))
  }

  return fetchCensusJsonp<CensusGeocodeResponse>(
    `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(trimmedQuery)}&benchmark=${CENSUS_BENCHMARK}&format=jsonp`,
  )
    .then((response) => {
      const match = response.result.addressMatches[0]

      if (!match) {
        return fetchPlaceGeocode(trimmedQuery)
      }

      return {
        label: match.matchedAddress,
        coordinates: [match.coordinates.x, match.coordinates.y] as [number, number],
      }
    })
    .catch(() => fetchPlaceGeocode(trimmedQuery))
}

function fetchCensusJsonp<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const callbackName = `censusJsonp_${crypto.randomUUID().replace(/-/g, '')}`
    const script = document.createElement('script')
    let timeoutId: number | null = null
    const callbackRegistry = window as Window &
      typeof globalThis & {
        [key: string]: unknown
      }
    const cleanup = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      delete callbackRegistry[callbackName]
      script.remove()
    }

    callbackRegistry[callbackName] = (payload: T) => {
      cleanup()
      resolve(payload)
    }

    script.onerror = () => {
      cleanup()
      reject(new Error('Location search failed. Please try another query.'))
    }

    script.src = `${url}&callback=${callbackName}`
    document.body.appendChild(script)
    timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('Location search timed out. Please try another query.'))
    }, censusJsonpTimeoutMs)
  })
}

async function fetchPlaceGeocode(query: string): Promise<GeocodeResult> {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`,
    {
      headers: {
        Accept: 'application/json',
      },
    },
  )

  if (!response.ok) {
    throw new Error('Location search failed. Please try another query.')
  }

  const matches = (await response.json()) as NominatimMatch[]
  const match = matches[0]
  const latitude = Number(match?.lat)
  const longitude = Number(match?.lon)

  if (!match || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new Error(`No location match found for "${query}".`)
  }

  return {
    label: simplifyPlaceLabel(match.display_name ?? query),
    coordinates: [longitude, latitude],
  }
}

export async function reverseGeocodePlace(
  coordinates: [number, number],
): Promise<GeocodeResult | null> {
  const cacheKey = `${coordinates[0].toFixed(3)},${coordinates[1].toFixed(3)}`
  const cached = reversePlaceCache.get(cacheKey)

  if (cached !== undefined) {
    return cached
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), reverseGeocodeTimeoutMs)

  let response: Response

  try {
    response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&lat=${coordinates[1]}&lon=${coordinates[0]}`,
      {
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      },
    )
  } catch {
    reversePlaceCache.set(cacheKey, null)
    return null
  } finally {
    window.clearTimeout(timeout)
  }

  if (!response.ok) {
    reversePlaceCache.set(cacheKey, null)
    return null
  }

  const match = (await response.json()) as NominatimReverseMatch
  const label = simplifyReversePlaceLabel(match)
  const latitude = Number(match.lat)
  const longitude = Number(match.lon)

  if (!label || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    reversePlaceCache.set(cacheKey, null)
    return null
  }

  const result = {
    label,
    coordinates: [longitude, latitude] as [number, number],
  }
  reversePlaceCache.set(cacheKey, result)
  trimCache(reversePlaceCache, reversePlaceCacheMaxEntries)
  return result
}

function trimCache<K, V>(cache: Map<K, V>, maxEntries: number) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value

    if (oldestKey === undefined) {
      return
    }

    cache.delete(oldestKey)
  }
}

function simplifyPlaceLabel(displayName: string) {
  const parts = displayName.split(',').map((value) => value.trim())

  if (parts.length >= 3) {
    const state = parts.find((part) => part.length === 2 || part === 'Indiana')

    if (state) {
      return `${parts[0]}, ${state === 'Indiana' ? 'IN' : state}`
    }
  }

  return parts.slice(0, 2).join(', ')
}

function simplifyReversePlaceLabel(match: NominatimReverseMatch) {
  const placeName =
    match.address?.city ??
    match.address?.town ??
    match.address?.village ??
    match.address?.hamlet ??
    match.address?.municipality ??
    match.address?.county

  if (!placeName) {
    return null
  }

  const state =
    match.address?.state_code?.toUpperCase() ??
    match.address?.state ??
    extractStateFromDisplayName(match.display_name)

  if (!state) {
    return placeName
  }

  return `${placeName}, ${state === 'Indiana' ? 'IN' : state}`
}

function extractStateFromDisplayName(displayName?: string) {
  if (!displayName) {
    return null
  }

  const parts = displayName.split(',').map((value) => value.trim())
  return parts.find((part) => part.length === 2 || part === 'Indiana') ?? null
}
