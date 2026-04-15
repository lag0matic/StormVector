export type RadarSite = {
  id: string
  name: string
  coordinates: [number, number]
}

export type LocalRadarProduct = 'reflectivity' | 'velocity'
export type RegionalRadarProduct = 'base' | 'composite'
export type RadarProductDefinition = {
  layerName: string
  styleName: string
  frames: string[]
}

let radarSiteCache: RadarSite[] | null = null
const radarMetadataCache = new Map<string, Document>()
const radarProductCache = new Map<string, RadarProductDefinition | null>()
const regionalRadarTimelineCache = new Map<RegionalRadarProduct, string[]>()

type FetchOptions = {
  forceRefresh?: boolean
}

export async function fetchRadarSites(signal?: AbortSignal): Promise<RadarSite[]> {
  if (radarSiteCache) {
    return radarSiteCache
  }

  const response = await fetch(
    'https://opengeo.ncep.noaa.gov/geoserver/nws/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=nws:radar_sites',
    { signal },
  )

  if (!response.ok) {
    throw new Error(`Radar site request failed: ${response.status}`)
  }

  const xml = await response.text()
  const document = new DOMParser().parseFromString(xml, 'text/xml')
  const members = Array.from(document.getElementsByTagName('gml:featureMember'))

  radarSiteCache = members
    .map((member) => {
      const id = member.getElementsByTagName('nws:rda_id')[0]?.textContent?.trim()
      const name = member.getElementsByTagName('nws:name')[0]?.textContent?.trim()
      const lon = Number(
        member.getElementsByTagName('nws:lon')[0]?.textContent?.trim(),
      )
      const lat = Number(
        member.getElementsByTagName('nws:lat')[0]?.textContent?.trim(),
      )

      if (!id || !name || Number.isNaN(lon) || Number.isNaN(lat)) {
        return null
      }

      return {
        id,
        name,
        coordinates: [lon, lat] as [number, number],
      }
    })
    .filter((site): site is RadarSite => site !== null)

  return radarSiteCache
}

export async function findNearestRadarSite(
  coordinates: [number, number],
  signal?: AbortSignal,
): Promise<RadarSite> {
  const sites = await fetchRadarSites(signal)
  return findNearestRadarSiteFromList(coordinates, sites)
}

export function findNearestRadarSiteFromList(
  coordinates: [number, number],
  sites: RadarSite[],
): RadarSite {
  const nearest = sites.reduce<{ site: RadarSite; distance: number } | null>(
    (best, site) => {
      const distance = distanceBetweenMiles(coordinates, site.coordinates)

      if (!best || distance < best.distance) {
        return { site, distance }
      }

      return best
    },
    null,
  )

  if (!nearest) {
    throw new Error('No radar sites were available.')
  }

  return nearest.site
}

export async function fetchRadarTimeline(
  site: RadarSite,
  product: LocalRadarProduct,
  signal?: AbortSignal,
): Promise<string[]> {
  const definition = await fetchRadarProductDefinition(site, product, signal)
  return definition?.frames ?? []
}

export async function fetchRadarProductDefinition(
  site: RadarSite,
  product: LocalRadarProduct,
  signal?: AbortSignal,
  options?: FetchOptions,
): Promise<RadarProductDefinition | null> {
  const cacheKey = `${site.id}:${product}`

  if (!options?.forceRefresh && radarProductCache.has(cacheKey)) {
    return radarProductCache.get(cacheKey) ?? null
  }

  const document = await fetchRadarMetadata(site, signal, options)
  const sitePrefix = site.id.toLowerCase()
  const candidates =
    product === 'velocity'
      ? [`${sitePrefix}_sr_bvel`, `${sitePrefix}_bvel`]
      : [`${sitePrefix}_sr_bref`, `${sitePrefix}_bref1`, `${sitePrefix}_brefl`]
  const preferredStyle =
    product === 'velocity' ? 'radar_velocity' : 'radar_reflectivity'
  const layers = Array.from(document.getElementsByTagName('Layer'))

  for (const candidate of candidates) {
    const layer = layers.find((item) => {
      const name = item.getElementsByTagName('Name')[0]?.textContent?.trim()
      return name === candidate
    })

    if (!layer) {
      continue
    }

    const frames =
      layer
        .getElementsByTagName('Extent')[0]
        ?.textContent?.trim()
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean) ?? []

    const styleName =
      layer
        .getElementsByTagName('Style')[0]
        ?.getElementsByTagName('Name')[0]
        ?.textContent?.trim() ?? preferredStyle

    const definition = {
      layerName: candidate,
      styleName,
      frames,
    }

    radarProductCache.set(cacheKey, definition)
    return definition
  }

  radarProductCache.set(cacheKey, null)
  return null
}

export async function fetchRegionalRadarTimeline(
  product: RegionalRadarProduct,
  signal?: AbortSignal,
  options?: FetchOptions,
): Promise<string[]> {
  if (!options?.forceRefresh && regionalRadarTimelineCache.has(product)) {
    return regionalRadarTimelineCache.get(product) ?? []
  }

  const layerName =
    product === 'composite' ? 'conus_cref_qcd' : 'conus_bref_qcd'
  const response = await fetch(
    `https://opengeo.ncep.noaa.gov/geoserver/conus/${layerName}/wms?service=WMS&version=1.1.1&request=GetCapabilities`,
    {
      signal,
      cache: options?.forceRefresh ? 'no-store' : 'default',
    },
  )

  if (!response.ok) {
    throw new Error(`Regional radar timeline request failed: ${response.status}`)
  }

  const xml = await response.text()
  const document = new DOMParser().parseFromString(xml, 'text/xml')
  const layers = Array.from(document.getElementsByTagName('Layer'))
  const layer = layers.find((item) => {
    const name = item.getElementsByTagName('Name')[0]?.textContent?.trim()
    return name === layerName
  })

  const frames =
    layer
      ?.getElementsByTagName('Extent')[0]
      ?.textContent?.trim()
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? []

  regionalRadarTimelineCache.set(product, frames)
  return frames
}

async function fetchRadarMetadata(
  site: RadarSite,
  signal?: AbortSignal,
  options?: FetchOptions,
): Promise<Document> {
  if (!options?.forceRefresh && radarMetadataCache.has(site.id)) {
    return radarMetadataCache.get(site.id) as Document
  }

  const response = await fetch(
    `https://opengeo.ncep.noaa.gov/geoserver/${site.id.toLowerCase()}/ows?service=WMS&version=1.1.1&request=GetCapabilities`,
    {
      signal,
      cache: options?.forceRefresh ? 'no-store' : 'default',
    },
  )

  if (!response.ok) {
    throw new Error(`Radar timeline request failed: ${response.status}`)
  }

  const xml = await response.text()
  const document = new DOMParser().parseFromString(xml, 'text/xml')
  radarMetadataCache.set(site.id, document)
  return document
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
