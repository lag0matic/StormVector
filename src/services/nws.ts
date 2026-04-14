const NWS_API_BASE = 'https://api.weather.gov'

export const nwsHeaders = {
  Accept: 'application/geo+json',
  'User-Agent': '(radar-desktop.local, personal project contact unavailable)',
}

export function buildPointsUrl(latitude: number, longitude: number) {
  return `${NWS_API_BASE}/points/${latitude},${longitude}`
}

export function buildActiveAlertsUrl(point?: string) {
  if (!point) {
    return `${NWS_API_BASE}/alerts/active`
  }

  return `${NWS_API_BASE}/alerts/active?point=${point}`
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...nwsHeaders,
      ...init?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`NWS request failed: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}
