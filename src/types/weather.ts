export type ForecastPeriod = {
  name: string
  temperature: string
  summary: string
}

export type HazardCard = {
  type: string
  title: string
  summary: string
}

export type AlertFeature = {
  id: string
  alertType: 'warning' | 'watch' | 'advisory' | 'statement'
  event: string
  headline: string
  description: string
  instruction: string
  effective: string
  expires: string
  severity: string
  urgency: string
  areaDescription: string
  fillColor: string
  lineColor: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}

export type SpcOutlookFeature = {
  id: string
  category: string
  valid: string
  expire: string
  fillColor: string
  lineColor: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}

export type WinterOutlookFeature = {
  id: string
  product: 'snowfall' | 'freezingRain'
  outlook: string
  validTime: string
  issueTime: string
  snippet: string
  fillColor: string
  lineColor: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}

export type HazardSelection = {
  source: 'alerts' | 'spc' | 'winter'
  title: string
  subtitle: string
  summary: string
  body?: string
  detailLines: string[]
}

export type ServiceCard = {
  name: string
  role: string
}

export type LocationWeather = {
  location: {
    name: string
    office: string
    coordinates: [number, number]
  }
  current: {
    temperature: string
    summary: string
  }
  forecast: ForecastPeriod[]
  hazards: HazardCard[]
  radar: {
    currentFrameLabel: string
    sourceLabel: string
  }
  services: ServiceCard[]
}

export type WeatherLoadState = {
  data: LocationWeather
  loading: boolean
  error: string | null
  source: 'live' | 'mock'
}
