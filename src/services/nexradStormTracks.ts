import { invoke } from '@tauri-apps/api/core'
import type { RadarSite } from './radar'
import type { NexradStormTrackFeature } from '../types/weather'

type ParsedStormTrack = {
  cellId: string
  current: { deg: number; nm: number }
  movement: 'new' | { deg: number; kts: number }
  forecast: Array<{ deg: number; nm: number } | null>
}

const nexradLevel3BaseUrl = 'https://unidata-nexrad-level3.s3.amazonaws.com/'
const stormTrackProductCode = 'NST'
const nauticalMilesToMiles = 1.15078

export async function fetchNexradStormTracks(
  site: RadarSite,
): Promise<NexradStormTrackFeature[]> {
  const stationCode = normalizeLevel3StationCode(site.id)
  const key = await findLatestLevel3Key(stationCode, stormTrackProductCode)

  if (!key) {
    return []
  }

  const bytes = await fetchNexradBytes(`${nexradLevel3BaseUrl}${key}`)
  return normalizeStormTracks(parseStormTrackTable(bytes), site, key)
}

async function findLatestLevel3Key(stationCode: string, productCode: string) {
  const dates = buildRecentUtcDatePrefixes()

  for (const date of dates) {
    const prefix = `${stationCode}_${productCode}_${date}`
    const xmlBytes = await fetchNexradBytes(
      `${nexradLevel3BaseUrl}?list-type=2&prefix=${prefix}&max-keys=1000`,
    )
    const xml = new TextDecoder().decode(new Uint8Array(xmlBytes))
    const keys = Array.from(xml.matchAll(/<Key>([^<]+)<\/Key>/g), (match) => match[1])

    if (keys.length > 0) {
      return keys.sort().at(-1) ?? null
    }
  }

  return null
}

async function fetchNexradBytes(url: string): Promise<number[]> {
  return invoke<number[]>('fetch_nexrad_level3', { url })
}

function normalizeStormTracks(
  storms: ParsedStormTrack[],
  site: RadarSite,
  key: string,
): NexradStormTrackFeature[] {
  const radarCoordinates = site.coordinates
  const observedAt = parseLevel3KeyTime(key)

  return storms
    .map((storm) => {
      const currentCoordinates = polarToCoordinates(
        radarCoordinates,
        storm.current.deg,
        storm.current.nm,
      )
      const forecastCoordinates = (storm.forecast ?? [])
        .filter((forecast): forecast is { deg: number; nm: number } => forecast !== null)
        .map((forecast) =>
          polarToCoordinates(radarCoordinates, forecast.deg, forecast.nm),
        )

      const speedKts =
        storm.movement !== 'new'
          ? storm.movement.kts
          : null

      return {
        id: `${site.id}-${storm.cellId}-${observedAt}`,
        cellId: storm.cellId,
        siteId: site.id,
        observedAt,
        currentCoordinates,
        forecastCoordinates,
        speedMph: speedKts !== null ? Math.round(speedKts * nauticalMilesToMiles) : null,
        headingLabel: buildHeadingLabel(currentCoordinates, forecastCoordinates),
      }
    })
}

function parseStormTrackTable(bytes: number[]): ParsedStormTrack[] {
  const text = new TextDecoder('iso-8859-1').decode(new Uint8Array(bytes))
  const tableStart = text.indexOf(' STORM    CURRENT POSITION')
  const tableEnd = text.indexOf('STORM CELL TRACKING', tableStart)

  if (tableStart === -1 || tableEnd === -1) {
    return []
  }

  return text
    .slice(tableStart, tableEnd)
    .replaceAll(`${String.fromCharCode(0)}P`, '\n')
    .split(/\r?\n/)
    .map((line) => line.replace(/[^\x20-\x7e]/g, '').trimEnd())
    .map(parseStormTrackLine)
    .filter((track): track is ParsedStormTrack => track !== null)
}

function parseStormTrackLine(line: string): ParsedStormTrack | null {
  const match = line.match(/^\s*([A-Z]\d)\s+(.+)$/)

  if (!match) {
    return null
  }

  const [, cellId, rawRest] = match
  const rest = rawRest.replace(/\s+\d+\.\d\/\s*\d+\.\d\s*$/, '')
  const pairs = Array.from(rest.matchAll(/(\d{1,3})\/\s*(\d{1,3})/g), (pair) => ({
    deg: Number(pair[1]),
    nm: Number(pair[2]),
  }))

  if (pairs.length === 0) {
    return null
  }

  const newCell = /\bNEW\b/.test(rest)
  const movement = newCell
    ? 'new'
    : {
        deg: pairs[1]?.deg ?? 0,
        kts: pairs[1]?.nm ?? 0,
      }
  const forecast = newCell
    ? []
    : pairs
        .slice(2, 6)
        .map((pair) => (Number.isFinite(pair.deg) && Number.isFinite(pair.nm) ? pair : null))

  while (forecast.length < 4) {
    forecast.push(null)
  }

  return {
    cellId,
    current: pairs[0],
    movement,
    forecast,
  }
}

function normalizeLevel3StationCode(siteId: string) {
  const upperId = siteId.toUpperCase()
  return upperId.length === 4 && upperId.startsWith('K') ? upperId.slice(1) : upperId
}

function buildRecentUtcDatePrefixes() {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setUTCDate(today.getUTCDate() - 1)

  return [today, yesterday].map((date) =>
    [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('_'),
  )
}

function parseLevel3KeyTime(key: string) {
  const match = key.match(/_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})$/)

  if (!match) {
    return new Date().toISOString()
  }

  const [, year, month, day, hour, minute, second] = match
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString()
}

function polarToCoordinates(
  [lon, lat]: [number, number],
  bearingDegrees: number,
  distanceNauticalMiles: number,
): [number, number] {
  const earthRadiusMiles = 3958.8
  const distanceRadians = (distanceNauticalMiles * nauticalMilesToMiles) / earthRadiusMiles
  const bearing = toRadians(bearingDegrees)
  const latRadians = toRadians(lat)
  const lonRadians = toRadians(lon)
  const destinationLat = Math.asin(
    Math.sin(latRadians) * Math.cos(distanceRadians) +
      Math.cos(latRadians) * Math.sin(distanceRadians) * Math.cos(bearing),
  )
  const destinationLon =
    lonRadians +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distanceRadians) * Math.cos(latRadians),
      Math.cos(distanceRadians) - Math.sin(latRadians) * Math.sin(destinationLat),
    )

  return [normalizeLongitude(toDegrees(destinationLon)), toDegrees(destinationLat)]
}

function buildHeadingLabel(
  currentCoordinates: [number, number],
  forecastCoordinates: [number, number][],
) {
  const nextCoordinate = forecastCoordinates[0]

  if (!nextCoordinate) {
    return 'New cell'
  }

  return degreesToCardinal(calculateBearing(currentCoordinates, nextCoordinate))
}

function calculateBearing(
  [startLon, startLat]: [number, number],
  [endLon, endLat]: [number, number],
) {
  const startLatRad = toRadians(startLat)
  const endLatRad = toRadians(endLat)
  const deltaLonRad = toRadians(endLon - startLon)
  const y = Math.sin(deltaLonRad) * Math.cos(endLatRad)
  const x =
    Math.cos(startLatRad) * Math.sin(endLatRad) -
    Math.sin(startLatRad) * Math.cos(endLatRad) * Math.cos(deltaLonRad)

  return (toDegrees(Math.atan2(y, x)) + 360) % 360
}

function degreesToCardinal(value: number) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return directions[Math.round(value / 45) % directions.length]
}

function normalizeLongitude(value: number) {
  return ((value + 540) % 360) - 180
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI
}
