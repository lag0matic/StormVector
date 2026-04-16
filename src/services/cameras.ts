export type CameraFeed = {
  id: string
  name: string
  provider: 'custom' | 'ohgo' | 'indot'
  state?: string
  coordinates: [number, number]
  pageUrl?: string
  imageUrl?: string
  embedUrl?: string
  description?: string
}

export type CameraFeedInput = Omit<CameraFeed, 'provider'> & {
  provider?: CameraFeed['provider']
}

type OhgoCameraCollection = {
  links?: Array<{ href?: string; rel?: string }>
  results?: Array<{
    id?: string
    latitude?: number
    longitude?: number
    location?: string
    description?: string
    cameraViews?: Array<{
      smallUrl?: string
      largeUrl?: string
      direction?: string
      mainRoute?: string
    }>
  }>
}

type IndotMapFeaturesResponse = {
  data?: {
    mapFeaturesQuery?: {
      mapFeatures?: Array<{
        __typename?: string
        title?: string
        uri?: string
        bbox?: [number, number, number, number]
        active?: boolean
        views?: Array<{
          uri?: string
          category?: string
          url?: string
          title?: string
          sources?: Array<{
            type?: string
            src?: string
          }>
        }>
      }>
      error?: {
        message?: string
        type?: string
      } | null
    }
  }
}

const ohgoApiKey = '12d06af6-19a6-46bc-ae85-25613c8914f4'
const indotGraphqlUrl = 'https://511in.org/api/graphql'
const indotPageUrl = 'https://511in.org/'

const builtInCustomCameraFeeds: CameraFeed[] = [
  {
    id: 'richmond-power-light-weather-cam',
    name: 'Richmond Power & Light Weather Cam',
    provider: 'custom',
    state: 'IN',
    coordinates: [-84.8889, 39.8289],
    pageUrl: 'https://www.rp-l.com/weather-cam/',
    embedUrl: 'https://g1.ipcamlive.com/player/player.php?alias=rplcam&autoplay=1',
    description: 'Richmond, IN live weather camera hosted by Richmond Power & Light.',
  },
]

export async function fetchCameraFeeds(
  customCameraFeeds: CameraFeedInput[] = [],
): Promise<CameraFeed[]> {
  const [ohgoResult, indotResult] = await Promise.allSettled([
    fetchOhgoCameraFeeds(),
    fetchIndotCameraFeeds(),
  ])

  const ohgoFeeds = ohgoResult.status === 'fulfilled' ? ohgoResult.value : []
  const indotFeeds = indotResult.status === 'fulfilled' ? indotResult.value : []
  const normalizedCustomFeeds = customCameraFeeds.map(normalizeCustomCameraFeed)

  return dedupeCameraFeeds([
    ...builtInCustomCameraFeeds,
    ...normalizedCustomFeeds,
    ...indotFeeds,
    ...ohgoFeeds,
  ])
}

async function fetchOhgoCameraFeeds(): Promise<CameraFeed[]> {
  const headers = {
    Authorization: `APIKEY ${ohgoApiKey}`,
  }
  const feeds: CameraFeed[] = []
  let nextUrl = 'https://publicapi.ohgo.com/api/v1/cameras?page-size=500'
  let pagesFetched = 0

  while (nextUrl && pagesFetched < 5) {
    const response = await fetch(nextUrl, { headers })

    if (!response.ok) {
      throw new Error('OHGO camera request failed.')
    }

    const payload = (await response.json()) as OhgoCameraCollection

    feeds.push(
      ...(payload.results ?? [])
        .filter(
          (camera) =>
            Number.isFinite(camera.latitude) &&
            Number.isFinite(camera.longitude) &&
            Array.isArray(camera.cameraViews) &&
            camera.cameraViews.length > 0,
        )
        .map((camera) => {
          const primaryView = camera.cameraViews?.[0]
          const summaryParts = [
            'OHGO traffic camera',
            camera.description ?? camera.location ?? '',
            primaryView?.direction ? `View: ${primaryView.direction}` : '',
          ].filter(Boolean)

          return {
            id: `ohgo-${camera.id ?? `${camera.latitude},${camera.longitude}`}`,
            name: camera.location ?? camera.description ?? 'OHGO Camera',
            provider: 'ohgo' as const,
            state: 'OH',
            coordinates: [camera.longitude as number, camera.latitude as number],
            pageUrl: primaryView?.largeUrl ?? primaryView?.smallUrl,
            imageUrl: primaryView?.largeUrl ?? primaryView?.smallUrl,
            description: summaryParts.join(' | '),
          } satisfies CameraFeed
        }),
    )

    nextUrl = payload.links?.find((link) => link.rel === 'next-page')?.href ?? ''
    pagesFetched += 1
  }

  return feeds
}

async function fetchIndotCameraFeeds(): Promise<CameraFeed[]> {
  const query = `
    query StormVectorIndianaCameras($input: MapFeaturesArgs!) {
      mapFeaturesQuery(input: $input) {
        mapFeatures {
          __typename
          title
          uri
          bbox
          ... on Camera {
            active
            views(limit: 1) {
              uri
              category
              ... on CameraView {
                url
                title
                sources {
                  type
                  src
                }
              }
            }
          }
        }
        error {
          message
          type
        }
      }
    }
  `

  const requests: Array<Promise<IndotMapFeaturesResponse>> = []
  const west = -88.3
  const east = -84.6
  const south = 37.7
  const north = 41.9
  const cols = 4
  const rows = 3

  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      const tileWest = west + ((east - west) * col) / cols
      const tileEast = west + ((east - west) * (col + 1)) / cols
      const tileSouth = south + ((north - south) * row) / rows
      const tileNorth = south + ((north - south) * (row + 1)) / rows
      const url = new URL(indotGraphqlUrl)
      url.searchParams.set('query', query)
      url.searchParams.set(
        'variables',
        JSON.stringify({
          input: {
            north: tileNorth,
            south: tileSouth,
            east: tileEast,
            west: tileWest,
            zoom: 11,
            layerSlugs: ['normalCameras'],
          },
        }),
      )

      requests.push(
        fetch(url.toString()).then(async (response) => {
          if (!response.ok) {
            throw new Error(`INDOT camera request failed with status ${response.status}.`)
          }

          return (await response.json()) as IndotMapFeaturesResponse
        }),
      )
    }
  }

  const responses = await Promise.allSettled(requests)

  const feeds = responses.flatMap((response) =>
    (response.status === 'fulfilled'
      ? response.value.data?.mapFeaturesQuery?.mapFeatures ?? []
      : [])
      .filter(
        (feature) =>
          feature.__typename === 'Camera' &&
          typeof feature.uri === 'string' &&
          Array.isArray(feature.bbox) &&
          feature.bbox.length >= 2 &&
          Number.isFinite(feature.bbox[0]) &&
          Number.isFinite(feature.bbox[1]),
      )
      .map((feature) => {
        const primaryView = feature.views?.[0]
        const summaryParts = [
          'INDOT Trafficwise camera',
          primaryView?.category ?? '',
          feature.active === false ? 'Inactive feed' : 'Live feed',
        ].filter(Boolean)

        return {
          id: `indot-${feature.uri}`,
          name: feature.title ?? primaryView?.title ?? 'INDOT Camera',
          provider: 'indot' as const,
          state: 'IN',
          coordinates: [feature.bbox![0], feature.bbox![1]],
          pageUrl: indotPageUrl,
          imageUrl: primaryView?.url,
          description: summaryParts.join(' | '),
        } satisfies CameraFeed
      }),
  )

  return dedupeCameraFeeds(feeds)
}

function normalizeCustomCameraFeed(feed: CameraFeedInput): CameraFeed {
  return {
    ...feed,
    provider: 'custom',
    state: feed.state,
  }
}

function dedupeCameraFeeds(feeds: CameraFeed[]) {
  const seen = new Set<string>()

  return feeds.filter((feed) => {
    if (seen.has(feed.id)) {
      return false
    }

    seen.add(feed.id)
    return true
  })
}
