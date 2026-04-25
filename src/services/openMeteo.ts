export type OutdoorConditions = {
  uvIndex: number | null
  uvMax: number | null
  usAqi: number | null
  pm25: number | null
  pm10: number | null
  ozone: number | null
  observedAt: string
}

type OpenMeteoUvResponse = {
  current?: {
    time?: string
    uv_index?: number | null
  }
  daily?: {
    uv_index_max?: Array<number | null>
  }
}

type OpenMeteoAirQualityResponse = {
  current?: {
    time?: string
    us_aqi?: number | null
    pm2_5?: number | null
    pm10?: number | null
    ozone?: number | null
  }
}

const outdoorTimeoutMs = 8000

export async function fetchOutdoorConditions(
  coordinates: [number, number],
  signal?: AbortSignal,
): Promise<OutdoorConditions | null> {
  const latitude = Number(coordinates[1].toFixed(3))
  const longitude = Number(coordinates[0].toFixed(3))

  const uvUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    '&current=uv_index&daily=uv_index_max&timezone=auto'
  const airQualityUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}` +
    '&current=us_aqi,pm2_5,pm10,ozone&timezone=auto'

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), outdoorTimeoutMs)
  const abortOutdoorRequest = () => controller.abort()
  signal?.addEventListener('abort', abortOutdoorRequest, { once: true })

  try {
    const [uv, airQuality] = await Promise.all([
      fetchJson<OpenMeteoUvResponse>(uvUrl, controller.signal),
      fetchJson<OpenMeteoAirQualityResponse>(airQualityUrl, controller.signal),
    ])

    return {
      uvIndex: normalizeNumber(uv.current?.uv_index),
      uvMax: normalizeNumber(uv.daily?.uv_index_max?.[0]),
      usAqi: normalizeNumber(airQuality.current?.us_aqi),
      pm25: normalizeNumber(airQuality.current?.pm2_5),
      pm10: normalizeNumber(airQuality.current?.pm10),
      ozone: normalizeNumber(airQuality.current?.ozone),
      observedAt: airQuality.current?.time ?? uv.current?.time ?? '',
    }
  } finally {
    window.clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortOutdoorRequest)
  }
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new Error(`Open-Meteo request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

function normalizeNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
