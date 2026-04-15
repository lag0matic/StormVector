import type { SpotterNetworkFeature } from '../types/weather'

const streamerFeedUrl = 'https://www.spotternetwork.org/feeds/gr-stream-no.txt'

export async function fetchSpotterNetworkStreamers(
  signal?: AbortSignal,
): Promise<SpotterNetworkFeature[]> {
  const response = await fetch(streamerFeedUrl, {
    signal,
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(
      `Spotter Network request failed: ${response.status} ${response.statusText}`,
    )
  }

  const text = await response.text()
  return parseSpotterNetworkFeed(text)
}

function parseSpotterNetworkFeed(text: string): SpotterNetworkFeature[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const features: SpotterNetworkFeature[] = []
  let currentCoordinates: [number, number] | null = null
  let currentTooltip = ''

  const flushCurrent = () => {
    if (!currentCoordinates || !currentTooltip) {
      currentCoordinates = null
      currentTooltip = ''
      return
    }

    const parsed = parseSpotterTooltip(currentTooltip)

    features.push({
      id: `sn-${currentCoordinates[1].toFixed(4)}-${currentCoordinates[0].toFixed(4)}-${parsed.timestamp}`,
      coordinates: currentCoordinates,
      ...parsed,
    })

    currentCoordinates = null
    currentTooltip = ''
  }

  lines.forEach((line) => {
    if (line.startsWith('Object:')) {
      flushCurrent()
      const payload = line.slice('Object:'.length).trim()
      const [latitudeText, longitudeText] = payload.split(',')
      const latitude = Number(latitudeText)
      const longitude = Number(longitudeText)

      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        currentCoordinates = [longitude, latitude]
      }
      return
    }

    if (line.startsWith('Icon:')) {
      const tooltipMatch = line.match(/"([\s\S]*)"$/)

      if (tooltipMatch) {
        currentTooltip = tooltipMatch[1].replace(/\\n/g, '\n')
      }
      return
    }

    if (line === 'End:') {
      flushCurrent()
    }
  })

  flushCurrent()
  return dedupeSpotterFeatures(features)
}

function parseSpotterTooltip(tooltip: string) {
  const parts = tooltip
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const [_name = 'Spotter Network streamer', timestamp = 'Unknown time', heading = 'Unknown heading', ...rest] =
    parts
  const noteLine =
    rest.find((line) => line.startsWith('Note:')) ??
    rest.find((line) => line.startsWith('Web:')) ??
    rest.find((line) => line.startsWith('Twitter:')) ??
    rest[0] ??
    'Affiliated live streamer'
  const platform = detectStreamingPlatform(rest.join(' '), noteLine)
  const pageUrl = extractStreamUrl(rest, noteLine)

  return {
    label: platform === 'Unknown' ? 'Live chaser feed' : `${platform} chaser feed`,
    platform,
    timestamp,
    heading,
    note: noteLine.replace(/^(Note|Web|Twitter):\s*/i, ''),
    pageUrl,
    embedUrl: buildStreamEmbedUrl(pageUrl),
  }
}

function dedupeSpotterFeatures(features: SpotterNetworkFeature[]) {
  const seen = new Set<string>()

  return features.filter((feature) => {
    if (feature.platform !== 'YouTube' || !feature.pageUrl) {
      return false
    }

    const key = `${feature.pageUrl}-${feature.coordinates[0].toFixed(3)}-${feature.coordinates[1].toFixed(3)}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function detectStreamingPlatform(rawText: string, noteLine: string) {
  const haystack = `${rawText} ${noteLine}`.toLowerCase()

  if (haystack.includes('youtube') || haystack.includes('youtu.be')) {
    return 'YouTube'
  }

  return 'Unknown'
}

function extractStreamUrl(lines: string[], noteLine: string) {
  const candidates = [...lines, noteLine]
  const urlMatch = candidates
    .map((line) => extractYoutubeUrl(line))
    .find(Boolean)

  if (!urlMatch) {
    return undefined
  }

  return urlMatch
}

function buildStreamEmbedUrl(pageUrl?: string) {
  if (!pageUrl) {
    return undefined
  }

  try {
    const url = new URL(pageUrl)
    const host = url.hostname.toLowerCase()

    if (host.includes('youtu.be')) {
      const videoId = url.pathname.replace('/', '')
      return videoId ? `https://www.youtube.com/embed/${videoId}` : undefined
    }

    if (host.includes('youtube.com')) {
      const videoId = url.searchParams.get('v')

      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}`
      }

      const liveMatch = url.pathname.match(/\/live\/([^/]+)/)
      if (liveMatch) {
        return `https://www.youtube.com/embed/${liveMatch[1]}`
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

function extractYoutubeUrl(line: string) {
  const httpMatch = line.match(/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s"]+/i)?.[0]

  if (httpMatch) {
    return httpMatch
  }

  const bareMatch = line.match(/(?:youtube\.com|youtu\.be)\/[^\s"]+/i)?.[0]

  if (!bareMatch) {
    return undefined
  }

  return `https://${bareMatch}`
}
