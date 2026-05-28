import { invoke } from '@tauri-apps/api/core'

export type FutureRadarProduct = 'hrrr-reflectivity'

export type FutureRadarFrame = {
  id: string
  runTime: string
  validTime: string
  forecastHour: number
  forecastMinute: number
  renderBand: number
  label: string
  sourceUrl: string
}

const hrrrForecastFiles = Array.from({ length: 19 }, (_, index) => index)
const hrrrSubhourBands = [
  { minuteOffset: 15, band: 1 },
  { minuteOffset: 30, band: 50 },
  { minuteOffset: 45, band: 99 },
  { minuteOffset: 60, band: 148 },
] as const
const hrrrAvailabilityLagHours = 3
const hrrrRunAvailabilityLookbackHours = 8
const hrrrRunRefreshMs = 15 * 60_000
const hrrrBbox = {
  west: -134.12,
  south: 21.12,
  east: -60.9,
  north: 52.62,
}
const hrrrReflectivityColormap = [
  [[5, 10], [0, 236, 236, 255]],
  [[10, 15], [1, 160, 246, 255]],
  [[15, 20], [0, 0, 246, 255]],
  [[20, 25], [0, 255, 0, 255]],
  [[25, 30], [0, 200, 0, 255]],
  [[30, 35], [0, 144, 0, 255]],
  [[35, 40], [255, 255, 0, 255]],
  [[40, 45], [231, 192, 0, 255]],
  [[45, 50], [255, 144, 0, 255]],
  [[50, 55], [255, 0, 0, 255]],
  [[55, 60], [214, 0, 0, 255]],
  [[60, 65], [192, 0, 0, 255]],
  [[65, 70], [255, 0, 255, 255]],
  [[70, 75], [153, 85, 201, 255]],
] as const

let futureRadarTimelineCache: {
  expiresAt: number
  frames: FutureRadarFrame[]
} | null = null

type FetchOptions = {
  forceRefresh?: boolean
}

export function getFutureRadarImageCoordinates(): [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] {
  return [
    [hrrrBbox.west, hrrrBbox.north],
    [hrrrBbox.east, hrrrBbox.north],
    [hrrrBbox.east, hrrrBbox.south],
    [hrrrBbox.west, hrrrBbox.south],
  ]
}

export async function fetchFutureRadarTimeline(
  product: FutureRadarProduct,
  signal?: AbortSignal,
  options?: FetchOptions,
): Promise<FutureRadarFrame[]> {
  if (product !== 'hrrr-reflectivity') {
    throw new Error('Future radar product is unavailable.')
  }

  if (
    !options?.forceRefresh &&
    futureRadarTimelineCache &&
    futureRadarTimelineCache.expiresAt > Date.now()
  ) {
    return futureRadarTimelineCache.frames
  }

  const runTime = await resolveLatestAvailableHrrrRunTime(signal)
  const frames = buildFutureRadarFrames(runTime)

  futureRadarTimelineCache = {
    expiresAt: Date.now() + hrrrRunRefreshMs,
    frames,
  }

  return frames
}

async function resolveLatestAvailableHrrrRunTime(signal?: AbortSignal) {
  const candidates = buildHrrrRunCandidates()

  for (const candidate of candidates) {
    if (signal?.aborted) {
      throw new DOMException('Future radar refresh aborted.', 'AbortError')
    }

    const sourceAvailable = await checkHrrrSourceAvailable(
      buildFutureRadarFrame(candidate, 0, 0, 1).sourceUrl,
    )

    if (sourceAvailable === true) {
      return candidate
    }

    if (sourceAvailable === null) {
      return candidates[0]
    }
  }

  return candidates[0]
}

function buildHrrrRunCandidates() {
  const latestRunTime = getLatestLikelyHrrrRunTime()

  return Array.from({ length: hrrrRunAvailabilityLookbackHours + 1 }, (_, index) => {
    const candidate = new Date(latestRunTime)
    candidate.setUTCHours(candidate.getUTCHours() - index)
    return candidate
  })
}

async function checkHrrrSourceAvailable(url: string): Promise<boolean | null> {
  try {
    return await invoke<boolean>('check_hrrr_source_available', { url })
  } catch {
    return null
  }
}

function buildFutureRadarFrames(runTime: Date) {
  return hrrrForecastFiles.flatMap((forecastFileHour) => {
    if (forecastFileHour === 0) {
      return [buildFutureRadarFrame(runTime, forecastFileHour, 0, 1)]
    }

    return hrrrSubhourBands.map(({ minuteOffset, band }) =>
      buildFutureRadarFrame(
        runTime,
        forecastFileHour,
        (forecastFileHour - 1) * 60 + minuteOffset,
        band,
      ),
    )
  })
}

function buildFutureRadarFrame(
  runTime: Date,
  forecastFileHour: number,
  forecastMinute: number,
  band: number,
): FutureRadarFrame {
  const runDate = formatHrrrRunDate(runTime)
  const runHour = String(runTime.getUTCHours()).padStart(2, '0')
  const forecastHourLabel = String(forecastFileHour).padStart(2, '0')
  const validTime = new Date(runTime.getTime() + forecastMinute * 60_000)
  const sourceUrl =
    `https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.${runDate}/conus/` +
    `hrrr.t${runHour}z.wrfsubhf${forecastHourLabel}.grib2`

  return {
    id: `${runDate}-${runHour}-${forecastHourLabel}-${band}`,
    runTime: runTime.toISOString(),
    validTime: validTime.toISOString(),
    forecastHour: Math.floor(forecastMinute / 60),
    forecastMinute,
    renderBand: band,
    label: formatForecastMinuteLabel(forecastMinute),
    sourceUrl,
  }
}

export function buildFutureRadarImageUrl({
  sourceUrl,
  band,
  west = hrrrBbox.west,
  south = hrrrBbox.south,
  east = hrrrBbox.east,
  north = hrrrBbox.north,
  width,
  height,
}: {
  sourceUrl: string
  band: number
  west?: number
  south?: number
  east?: number
  north?: number
  width?: number
  height?: number
}) {
  const vrtUrl = `vrt://${sourceUrl}?bands=${band}`
  const colormap = JSON.stringify(hrrrReflectivityColormap)
  const sizeParams =
    typeof width === 'number' && typeof height === 'number'
      ? `&width=${Math.max(Math.round(width), 256)}` +
        `&height=${Math.max(Math.round(height), 256)}`
      : ''

  return (
    `https://raster.eoapi.dev/external/bbox/` +
    `${west},${south},${east},${north}.png` +
    `?url=${encodeURIComponent(vrtUrl)}` +
    `&colormap=${encodeURIComponent(colormap)}` +
    '&dst_crs=epsg:3857' +
    sizeParams
  )
}

function formatForecastMinuteLabel(forecastMinute: number) {
  if (forecastMinute === 0) {
    return 'F00'
  }

  const hours = Math.floor(forecastMinute / 60)
  const minutes = forecastMinute % 60

  return minutes === 0
    ? `F${String(hours).padStart(2, '0')}`
    : `F${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function getLatestLikelyHrrrRunTime() {
  const now = new Date()
  const runTime = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
    ),
  )
  runTime.setUTCHours(runTime.getUTCHours() - hrrrAvailabilityLagHours)
  return runTime
}

function formatHrrrRunDate(date: Date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}${month}${day}`
}
