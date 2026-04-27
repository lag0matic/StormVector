export type FutureRadarProduct = 'hrrr-reflectivity'

export type FutureRadarFrame = {
  id: string
  runTime: string
  validTime: string
  forecastHour: number
  label: string
  imageUrl: string
  sourceUrl: string
}

const hrrrForecastHours = Array.from({ length: 19 }, (_, index) => index)
const hrrrAvailabilityLagHours = 3
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
  _signal?: AbortSignal,
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

  const runTime = getLatestLikelyHrrrRunTime()
  const frames = hrrrForecastHours.map((forecastHour) =>
    buildFutureRadarFrame(runTime, forecastHour),
  )

  futureRadarTimelineCache = {
    expiresAt: Date.now() + hrrrRunRefreshMs,
    frames,
  }

  return frames
}

function buildFutureRadarFrame(runTime: Date, forecastHour: number): FutureRadarFrame {
  const runDate = formatHrrrRunDate(runTime)
  const runHour = String(runTime.getUTCHours()).padStart(2, '0')
  const forecastHourLabel = String(forecastHour).padStart(2, '0')
  const validTime = new Date(runTime.getTime() + forecastHour * 60 * 60_000)
  const sourceUrl =
    `https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.${runDate}/conus/` +
    `hrrr.t${runHour}z.wrfsfcf${forecastHourLabel}.grib2`

  return {
    id: `${runDate}-${runHour}-${forecastHourLabel}`,
    runTime: runTime.toISOString(),
    validTime: validTime.toISOString(),
    forecastHour,
    label: `F${forecastHourLabel}`,
    sourceUrl,
    imageUrl: buildFutureRadarImageUrl(sourceUrl),
  }
}

function buildFutureRadarImageUrl(sourceUrl: string) {
  const vrtUrl = `vrt://${sourceUrl}?bands=1`
  const colormap = JSON.stringify(hrrrReflectivityColormap)

  return (
    `https://raster.eoapi.dev/external/bbox/` +
    `${hrrrBbox.west},${hrrrBbox.south},${hrrrBbox.east},${hrrrBbox.north}.png` +
    `?url=${encodeURIComponent(vrtUrl)}` +
    `&colormap=${encodeURIComponent(colormap)}` +
    '&dst_crs=epsg:3857'
  )
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
