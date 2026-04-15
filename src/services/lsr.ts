import type { LocalStormReportFeature } from '../types/weather'

const recentLsrUrl =
  'https://mesonet.agron.iastate.edu/cgi-bin/request/gis/lsr.py?recent=21600&fmt=csv'

export async function fetchRecentLocalStormReports(
  signal?: AbortSignal,
): Promise<LocalStormReportFeature[]> {
  const response = await fetch(recentLsrUrl, {
    signal,
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`LSR request failed: ${response.status} ${response.statusText}`)
  }

  const csv = await response.text()
  return normalizeLsrFeatures(csv)
}

function normalizeLsrFeatures(csv: string): LocalStormReportFeature[] {
  const rows = parseCsv(csv)

  if (rows.length <= 1) {
    return []
  }

  const [header, ...dataRows] = rows
  const columnIndex = new Map(header.map((column, index) => [column, index]))

  return dataRows
    .map((row, index) => {
      const latitude = Number(row[columnIndex.get('LAT') ?? -1])
      const longitude = Number(row[columnIndex.get('LON') ?? -1])

      if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        return null
      }

      const eventType = row[columnIndex.get('TYPETEXT') ?? -1] ?? 'Local Storm Report'
      const city = row[columnIndex.get('CITY') ?? -1] ?? 'Unknown location'
      const county = row[columnIndex.get('COUNTY') ?? -1] ?? ''
      const state = row[columnIndex.get('STATE') ?? -1] ?? ''
      const source = row[columnIndex.get('SOURCE') ?? -1] ?? 'Unknown source'
      const remark = row[columnIndex.get('REMARK') ?? -1] ?? ''
      const magnitude = row[columnIndex.get('MAG') ?? -1] ?? ''
      const qualifier = row[columnIndex.get('QUALIFIER') ?? -1] ?? ''
      const valid = row[columnIndex.get('VALID') ?? -1] ?? ''
      const reportCategory = resolveLsrCategory(eventType)
      const ageMinutes = resolveLsrAgeMinutes(valid)

      return {
        id: `lsr-${valid}-${index}`,
        eventType,
        reportCategory,
        city,
        county,
        state,
        source,
        remark,
        magnitude,
        qualifier,
        valid,
        ageMinutes,
        ...resolveLsrColors(eventType),
        coordinates: [longitude, latitude] as [number, number],
      }
    })
    .filter((feature): feature is LocalStormReportFeature => feature !== null)
}

function resolveLsrColors(eventType: string) {
  const category = resolveLsrCategory(eventType)

  if (category === 'tornado') {
    return { fillColor: '#d32f2f', strokeColor: '#7f1717' }
  }
  if (category === 'hail') {
    return { fillColor: '#00bcd4', strokeColor: '#0c7380' }
  }
  if (category === 'wind') {
    return { fillColor: '#f57c00', strokeColor: '#8f4600' }
  }
  if (category === 'flood') {
    return { fillColor: '#2e7d32', strokeColor: '#18481b' }
  }
  if (category === 'winter') {
    return { fillColor: '#7e57c2', strokeColor: '#4a2f73' }
  }
  if (category === 'rain') {
    return { fillColor: '#1e88e5', strokeColor: '#12528a' }
  }

  return { fillColor: '#546e7a', strokeColor: '#2c3940' }
}

function resolveLsrCategory(eventType: string) {
  const normalized = eventType.toUpperCase()

  if (normalized.includes('TORNADO') || normalized.includes('FUNNEL')) {
    return 'tornado' as const
  }
  if (normalized.includes('HAIL')) {
    return 'hail' as const
  }
  if (
    normalized.includes('TSTM') ||
    normalized.includes('THUNDERSTORM') ||
    normalized.includes('WIND') ||
    normalized.includes('DOWNBURST')
  ) {
    return 'wind' as const
  }
  if (normalized.includes('FLOOD')) {
    return 'flood' as const
  }
  if (
    normalized.includes('SNOW') ||
    normalized.includes('ICE') ||
    normalized.includes('SLEET') ||
    normalized.includes('BLIZZARD')
  ) {
    return 'winter' as const
  }
  if (normalized.includes('RAIN')) {
    return 'rain' as const
  }

  return 'other' as const
}

function resolveLsrAgeMinutes(valid: string) {
  const timestamp = parseLsrTimestamp(valid)

  if (!timestamp) {
    return null
  }

  return Math.max(0, Math.round((Date.now() - timestamp.getTime()) / 60000))
}

function parseLsrTimestamp(valid: string) {
  const trimmed = valid.trim()

  if (/^\d{12}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4))
    const month = Number(trimmed.slice(4, 6))
    const day = Number(trimmed.slice(6, 8))
    const hour = Number(trimmed.slice(8, 10))
    const minute = Number(trimmed.slice(10, 12))
    const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute))
    return Number.isNaN(candidate.getTime()) ? null : candidate
  }

  const fallback = new Date(trimmed)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

function parseCsv(csv: string) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    const nextCharacter = csv[index + 1]

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        field += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (character === ',' && !inQuotes) {
      row.push(field)
      field = ''
      continue
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1
      }

      row.push(field)
      if (row.some((value) => value.length > 0)) {
        rows.push(row)
      }
      row = []
      field = ''
      continue
    }

    field += character
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}
