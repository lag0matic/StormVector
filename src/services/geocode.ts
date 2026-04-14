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

export type GeocodeResult = {
  label: string
  coordinates: [number, number]
}

const CENSUS_BENCHMARK = 'Public_AR_Current'

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
    const callbackRegistry = window as Window &
      typeof globalThis & {
        [key: string]: unknown
      }
    const cleanup = () => {
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
