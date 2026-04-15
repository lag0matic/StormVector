export const nowCoastLightningServiceUrl =
  'https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows'

export const defaultLightningLayer = {
  id: 'density',
  label: 'Strike Density',
  layerName: 'ldn_lightning_strike_density',
  styleName: 'lightning_density',
} as const

export type LightningLayerId = typeof defaultLightningLayer.id
export type LightningTimelineDefinition = {
  layerName: string
  styleName: string
  frames: string[]
  defaultTime: string | null
}

const lightningMetadataCache = new Map<LightningLayerId, LightningTimelineDefinition>()

type FetchOptions = {
  forceRefresh?: boolean
}

export function buildLightningImageUrl(
  _layerId: LightningLayerId,
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
  const refreshBucket = Math.floor(Date.now() / 900000)
  const timeParam = time ? `&time=${encodeURIComponent(time)}` : ''
  const cacheKey = time ? time : String(refreshBucket)

  return `${nowCoastLightningServiceUrl}?service=WMS&version=1.3.0&request=GetMap&layers=${defaultLightningLayer.layerName}&styles=${defaultLightningLayer.styleName}&format=image/png&transparent=true&crs=CRS:84&bbox=${west},${south},${east},${north}&width=${width}&height=${height}${timeParam}&frame=${encodeURIComponent(cacheKey)}`
}

export async function fetchLightningTimeline(
  layerId: LightningLayerId,
  signal?: AbortSignal,
  options?: FetchOptions,
): Promise<LightningTimelineDefinition> {
  if (!options?.forceRefresh && lightningMetadataCache.has(layerId)) {
    return lightningMetadataCache.get(layerId) as LightningTimelineDefinition
  }

  const response = await fetch(
    `${nowCoastLightningServiceUrl}?service=WMS&version=1.3.0&request=GetCapabilities`,
    {
      signal,
      cache: options?.forceRefresh ? 'no-store' : 'default',
    },
  )

  if (!response.ok) {
    throw new Error(`Lightning timeline request failed: ${response.status}`)
  }

  const xml = await response.text()
  const document = new DOMParser().parseFromString(xml, 'text/xml')
  const layer = Array.from(document.getElementsByTagName('Layer')).find((node) => {
    const name = node.getElementsByTagName('Name')[0]?.textContent?.trim()
    return name === defaultLightningLayer.layerName
  })

  if (!layer) {
    throw new Error('Lightning timeline metadata was unavailable.')
  }

  const dimensionNode = Array.from(layer.getElementsByTagName('Dimension')).find(
    (node) => node.getAttribute('name')?.toLowerCase() === 'time',
  )
  const styleNode = layer.getElementsByTagName('Style')[0]
  const definition = {
    layerName:
      layer.getElementsByTagName('Name')[0]?.textContent?.trim() ??
      defaultLightningLayer.layerName,
    styleName:
      styleNode?.getElementsByTagName('Name')[0]?.textContent?.trim() ??
      defaultLightningLayer.styleName,
    frames:
      dimensionNode?.textContent
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean) ?? [],
    defaultTime: dimensionNode?.getAttribute('default')?.trim() ?? null,
  }

  lightningMetadataCache.set(layerId, definition)
  return definition
}
