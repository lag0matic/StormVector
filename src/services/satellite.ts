export const goesProducts = {
  viewer: 'https://www.ospo.noaa.gov/products/imagery/goes.html',
  nodd: 'https://www.ncei.noaa.gov/products/ncei-data-noaa-open-dissemination-program',
}

export const nowCoastSatelliteServiceUrl =
  'https://nowcoast.noaa.gov/geoserver/observations/satellite/ows'

export const defaultSatelliteLayers = [
  {
    id: 'visible',
    label: 'Visible',
    layerName: 'goes_visible_imagery',
    styleName: 'goes-vis',
  },
  {
    id: 'infrared',
    label: 'Infrared',
    layerName: 'goes_longwave_imagery',
    styleName: 'goes-lir',
  },
  {
    id: 'water-vapor',
    label: 'Water Vapor',
    layerName: 'goes_water_vapor_imagery',
    styleName: 'goes-wv',
  },
] as const

export type SatelliteLayerId = (typeof defaultSatelliteLayers)[number]['id']
export type SatelliteTimelineDefinition = {
  layerName: string
  styleName: string
  frames: string[]
  defaultTime: string | null
}

const satelliteMetadataCache = new Map<SatelliteLayerId, SatelliteTimelineDefinition>()

type FetchOptions = {
  forceRefresh?: boolean
}

export function buildSatelliteImageUrl(
  layerId: SatelliteLayerId,
  {
    west,
    south,
    east,
    north,
    width,
    height,
    time,
  }: {
    west: number
    south: number
    east: number
    north: number
    width: number
    height: number
    time?: string | null
  },
) {
  const layer =
    defaultSatelliteLayers.find((candidate) => candidate.id === layerId) ??
    defaultSatelliteLayers[1]
  const refreshBucket = Math.floor(Date.now() / 300000)
  const timeParam = time ? `&time=${encodeURIComponent(time)}` : ''
  const cacheKey = time ? time : String(refreshBucket)

  return `${nowCoastSatelliteServiceUrl}?service=WMS&version=1.3.0&request=GetMap&layers=${layer.layerName}&styles=${layer.styleName}&format=image/png&transparent=true&crs=CRS:84&bbox=${west},${south},${east},${north}&width=${width}&height=${height}${timeParam}&frame=${encodeURIComponent(cacheKey)}`
}

export async function fetchSatelliteTimeline(
  layerId: SatelliteLayerId,
  signal?: AbortSignal,
  options?: FetchOptions,
): Promise<SatelliteTimelineDefinition> {
  if (!options?.forceRefresh && satelliteMetadataCache.has(layerId)) {
    return satelliteMetadataCache.get(layerId) as SatelliteTimelineDefinition
  }

  const response = await fetch(
    `${nowCoastSatelliteServiceUrl}?service=WMS&version=1.3.0&request=GetCapabilities`,
    {
      signal,
      cache: options?.forceRefresh ? 'no-store' : 'default',
    },
  )

  if (!response.ok) {
    throw new Error(`Satellite timeline request failed: ${response.status}`)
  }

  const xml = await response.text()
  const document = new DOMParser().parseFromString(xml, 'text/xml')
  const layer = resolveSatelliteLayerNode(document, layerId)

  if (!layer) {
    throw new Error('Satellite timeline metadata was unavailable.')
  }

  const dimensionNode = Array.from(layer.getElementsByTagName('Dimension')).find(
    (node) => node.getAttribute('name')?.toLowerCase() === 'time',
  )
  const styleNode = layer.getElementsByTagName('Style')[0]
  const definition = {
    layerName:
      layer.getElementsByTagName('Name')[0]?.textContent?.trim() ??
      defaultSatelliteLayers[1].layerName,
    styleName:
      styleNode?.getElementsByTagName('Name')[0]?.textContent?.trim() ??
      defaultSatelliteLayers.find((candidate) => candidate.id === layerId)?.styleName ??
      defaultSatelliteLayers[1].styleName,
    frames:
      dimensionNode?.textContent
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean) ?? [],
    defaultTime: dimensionNode?.getAttribute('default')?.trim() ?? null,
  }

  satelliteMetadataCache.set(layerId, definition)
  return definition
}

function resolveSatelliteLayerNode(
  document: Document,
  layerId: SatelliteLayerId,
) {
  const layerName =
    defaultSatelliteLayers.find((candidate) => candidate.id === layerId)?.layerName ??
    defaultSatelliteLayers[1].layerName

  return Array.from(document.getElementsByTagName('Layer')).find((layer) => {
    const name = layer.getElementsByTagName('Name')[0]?.textContent?.trim()
    return name === layerName
  })
}
