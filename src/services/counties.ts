const censusCountyServiceUrl =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query'

const countyGeometryCache = new Map<string, GeoJSON.Polygon | GeoJSON.MultiPolygon>()

export async function fetchCountyGeometries(
  countyFipsCodes: string[],
  signal?: AbortSignal,
): Promise<Array<GeoJSON.Polygon | GeoJSON.MultiPolygon>> {
  const normalizedCodes = [...new Set(
    countyFipsCodes
      .map((code) => code.trim())
      .filter((code) => /^\d{5}$/.test(code)),
  )]

  if (normalizedCodes.length === 0) {
    return []
  }

  const cachedGeometries = normalizedCodes
    .map((code) => countyGeometryCache.get(code))
    .filter((geometry): geometry is GeoJSON.Polygon | GeoJSON.MultiPolygon => Boolean(geometry))

  const missingCodes = normalizedCodes.filter((code) => !countyGeometryCache.has(code))

  if (missingCodes.length === 0) {
    return cachedGeometries
  }

  for (const chunk of chunkArray(missingCodes, 40)) {
    const whereClause = `GEOID IN (${chunk.map((code) => `'${code}'`).join(',')})`
    const url =
      `${censusCountyServiceUrl}?where=${encodeURIComponent(whereClause)}` +
      '&outFields=GEOID,NAME&returnGeometry=true&f=geojson'

    const response = await fetch(url, {
      signal,
      cache: 'force-cache',
    })

    if (!response.ok) {
      throw new Error(`County geometry request failed: ${response.status}`)
    }

    const payload = (await response.json()) as {
      features?: Array<{
        geometry?: GeoJSON.Geometry | null
        properties?: {
          GEOID?: string
        }
      }>
    }

    for (const feature of payload.features ?? []) {
      const geoid = feature.properties?.GEOID?.trim()
      const geometry = feature.geometry

      if (!geoid) {
        continue
      }

      if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') {
        countyGeometryCache.set(geoid, geometry)
      }
    }
  }

  return normalizedCodes
    .map((code) => countyGeometryCache.get(code))
    .filter((geometry): geometry is GeoJSON.Polygon | GeoJSON.MultiPolygon => Boolean(geometry))
}

export function geometryCollectionToMultiPolygon(
  geometries: Array<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (geometries.length === 0) {
    return null
  }

  if (geometries.length === 1) {
    return geometries[0]
  }

  return {
    type: 'MultiPolygon',
    coordinates: geometries.flatMap((geometry) =>
      geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates,
    ),
  }
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
}
