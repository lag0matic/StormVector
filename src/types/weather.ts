export type ForecastPeriod = {
  name: string
  temperature: string
  summary: string
}

export type HourlyForecastPeriod = {
  label: string
  condition: string
  temperature: string
  feelsLike: string
  wind: string
  precip: string
  secondary?: string
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

export type LocalStormReportFeature = {
  id: string
  eventType: string
  reportCategory:
    | 'tornado'
    | 'hail'
    | 'wind'
    | 'flood'
    | 'winter'
    | 'rain'
    | 'other'
  city: string
  county: string
  state: string
  source: string
  remark: string
  magnitude: string
  qualifier: string
  valid: string
  ageMinutes: number | null
  fillColor: string
  strokeColor: string
  coordinates: [number, number]
}

export type SpotterNetworkFeature = {
  id: string
  label: string
  platform: string
  timestamp: string
  heading: string
  note: string
  pageUrl?: string
  embedUrl?: string
  coordinates: [number, number]
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
  source: 'alerts' | 'spc' | 'winter' | 'lsr'
  title: string
  subtitle: string
  summary: string
  accentColor?: string
  body?: string
  detailLines: string[]
  pageUrl?: string
  embedUrl?: string
  relatedAlerts?: Array<{
    id: string
    title: string
    subtitle: string
    alertType: 'warning' | 'watch' | 'advisory' | 'statement'
    accentColor?: string
  }>
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
    feelsLike: string
    wind: string
    sky: string
    precip: string
    lastUpdated: string
  }
  sun: {
    sunrise: string
    sunset: string
  }
  nextHours: HourlyForecastPeriod[]
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
