import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'
import { useAlertPolygons } from './hooks/useAlertPolygons'
import { useFutureRadarTimeline } from './hooks/useFutureRadarTimeline'
import { useLocalStormReports } from './hooks/useLocalStormReports'
import { useLocalRadarTimeline } from './hooks/useLocalRadarTimeline'
import { useLocationWeather } from './hooks/useLocationWeather'
import { useNearestRadarSite } from './hooks/useNearestRadarSite'
import { useNexradStormTracks } from './hooks/useNexradStormTracks'
import { useRadarSites } from './hooks/useRadarSites'
import { useRegionalRadarTimeline } from './hooks/useRegionalRadarTimeline'
import { useSatelliteTimeline } from './hooks/useSatelliteTimeline'
import { useSpcOutlookPolygons } from './hooks/useSpcOutlookPolygons'
import { useStormTrackPlaces } from './hooks/useStormTrackPlaces'
import { useWinterOutlookPolygons } from './hooks/useWinterOutlookPolygons'
import { geocodeLocation } from './services/geocode'
import type { FutureRadarProduct } from './services/futureRadar'
import {
  defaultSatelliteLayers,
  type SatelliteLayerId,
} from './services/satellite'
import type {
  AlertFeature,
  HazardSelection,
  LocalStormReportFeature,
  NexradStormTrackFeature,
} from './types/weather'
import { distanceBetweenMiles } from './utils/geo'
import { formatEtaDuration } from './utils/time'

const primaryLayers = ['Radar', 'Satellite', 'Forecast'] as const
const forecastOverlays = ['None', 'SPC Storm Risk', 'Winter'] as const
const spcDays = [
  { id: 1, label: 'Day 1' },
  { id: 2, label: 'Day 2' },
  { id: 3, label: 'Day 3' },
] as const
const winterDays = [
  { id: 1, label: 'Day 1' },
  { id: 2, label: 'Day 2' },
  { id: 3, label: 'Day 3' },
  { id: 4, label: 'Day 4' },
] as const
const winterProducts = [
  { id: 'snowfall', label: 'Snowfall' },
  { id: 'freezingRain', label: 'Freezing Rain' },
] as const
const playbackWindows = [
  { id: 30, label: '30m' },
  { id: 60, label: '1h' },
  { id: 120, label: '2h' },
] as const
const playbackSpeeds = [
  { id: 'slow', label: 'Slow', intervalMs: 900 },
  { id: 'normal', label: 'Normal', intervalMs: 650 },
  { id: 'fast', label: 'Fast', intervalMs: 425 },
] as const
const playbackFrames = ['Live', '-15m', '-30m', '-45m', '-60m', '-90m', '-120m']
const stormTrackSpeedOptions = [20, 30, 40, 50, 60] as const
const defaultCoordinates: [number, number] = [-86.1581, 39.7684]
const defaultLocationLabel = 'Indianapolis, IN'
const appVersion = 'v1.3.4'
const regionalRadarProducts = [
  { id: 'base', label: 'Base Reflectivity' },
  { id: 'composite', label: 'Composite Reflectivity' },
] as const
const localRadarProducts = [
  { id: 'reflectivity', label: 'Local Reflectivity' },
  { id: 'velocity', label: 'Velocity' },
] as const
const futureRadarProducts = [
  { id: 'hrrr-reflectivity', label: 'Sim Reflectivity' },
] as const
const radarViews = [
  { id: 'regional', label: 'Regional' },
  { id: 'local', label: 'Local' },
  { id: 'future', label: 'Future' },
] as const
const MapCanvas = lazy(() =>
  import('./components/MapCanvas').then((module) => ({
    default: module.MapCanvas,
  })),
)
let sharedAlertAudioContext: AudioContext | null = null
let sharedAlertAudioUnlockInstalled = false
let sharedAlertAudioUnlockInFlight: Promise<void> | null = null

function getAlertAudioContextClass() {
  return (
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ??
    null
  )
}

function getSharedAlertAudioContext() {
  const AudioContextClass = getAlertAudioContextClass()

  if (!AudioContextClass) {
    return null
  }

  if (!sharedAlertAudioContext || sharedAlertAudioContext.state === 'closed') {
    sharedAlertAudioContext = new AudioContextClass()
  }

  return sharedAlertAudioContext
}

async function ensureAlertAudioReady() {
  if (sharedAlertAudioUnlockInFlight) {
    return sharedAlertAudioUnlockInFlight
  }

  sharedAlertAudioUnlockInFlight = (async () => {
    const audioContext = getSharedAlertAudioContext()

    if (!audioContext) {
      return
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }
  })()

  try {
    await sharedAlertAudioUnlockInFlight
  } finally {
    sharedAlertAudioUnlockInFlight = null
  }
}

function installAlertAudioUnlock() {
  if (sharedAlertAudioUnlockInstalled || typeof window === 'undefined') {
    return
  }

  sharedAlertAudioUnlockInstalled = true

  const unlock = () => {
    void ensureAlertAudioReady()
  }

  const options: AddEventListenerOptions = { once: true, passive: true }
  window.addEventListener('pointerdown', unlock, options)
  window.addEventListener('keydown', unlock, options)
  window.addEventListener('touchstart', unlock, options)
}

type SavedLocation = {
  label: string
  coordinates: [number, number]
}
type AlertTypeFilters = {
  warning: boolean
  watch: boolean
  advisory: boolean
  statement: boolean
}
type AudibleAlertSettings = {
  warning: boolean
  watch: boolean
  target: 'selected' | 'home'
  radiusMiles: 25 | 50 | 70 | 100
}
type ReportTypeFilters = Record<
  LocalStormReportFeature['reportCategory'],
  boolean
>
type StormTrackArrival = {
  label: string
  etaLabel: string
  distanceMiles: number
}
type GeometryBounds = {
  west: number
  south: number
  east: number
  north: number
}
type SidePanelTab = 'forecast' | 'hazards'
type ThemeMode = 'light' | 'dark'
const storageKeys = {
  homeLocation: 'radar-desktop:home-location',
  favoriteLocations: 'radar-desktop:favorite-locations',
  layerOpacity: 'radar-desktop:layer-opacity',
  alertTypeFilters: 'radar-desktop:alert-type-filters',
  reportTypeFilters: 'radar-desktop:report-type-filters',
  audibleAlertSettings: 'radar-desktop:audible-alert-settings',
  themeMode: 'radar-desktop:theme-mode',
}
const defaultLayerOpacity = {
  radar: 78,
  satellite: 78,
  warnings: 30,
  watches: 14,
  polygons: 24,
}
const defaultAlertTypeFilters: AlertTypeFilters = {
  warning: true,
  watch: true,
  advisory: true,
  statement: true,
}
const defaultReportTypeFilters: ReportTypeFilters = {
  tornado: true,
  hail: true,
  wind: true,
  flood: true,
  winter: true,
  rain: true,
  other: true,
}
const defaultAudibleAlertSettings: AudibleAlertSettings = {
  warning: true,
  watch: false,
  target: 'selected',
  radiusMiles: 70,
}

function App() {
  useEffect(() => {
    installAlertAudioUnlock()
  }, [])

  useEffect(() => {
    const preventBrowserZoomWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
      }
    }
    const preventBrowserZoomKeys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return
      }

      if (['+', '=', '-', '_', '0'].includes(event.key)) {
        event.preventDefault()
      }
    }
    const preventGestureZoom = (event: Event) => {
      event.preventDefault()
    }

    window.addEventListener('wheel', preventBrowserZoomWheel, { passive: false })
    window.addEventListener('keydown', preventBrowserZoomKeys)
    window.addEventListener('gesturestart', preventGestureZoom)
    window.addEventListener('gesturechange', preventGestureZoom)

    return () => {
      window.removeEventListener('wheel', preventBrowserZoomWheel)
      window.removeEventListener('keydown', preventBrowserZoomKeys)
      window.removeEventListener('gesturestart', preventGestureZoom)
      window.removeEventListener('gesturechange', preventGestureZoom)
    }
  }, [])

  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    readStoredJson<ThemeMode>(storageKeys.themeMode, 'light'),
  )
  const [homeLocation, setHomeLocation] = useState<SavedLocation | null>(() =>
    readStoredJson<SavedLocation | null>(storageKeys.homeLocation, null),
  )
  const [favoriteLocations, setFavoriteLocations] = useState<SavedLocation[]>(() =>
    readStoredJson<SavedLocation[]>(storageKeys.favoriteLocations, []),
  )
  const [layerOpacity, setLayerOpacity] = useState(() =>
    normalizeLayerOpacity(
      readStoredJson(storageKeys.layerOpacity, defaultLayerOpacity),
    ),
  )
  const [alertTypeFilters, setAlertTypeFilters] = useState<AlertTypeFilters>(() =>
    readStoredJson(storageKeys.alertTypeFilters, defaultAlertTypeFilters),
  )
  const [reportTypeFilters, setReportTypeFilters] = useState<ReportTypeFilters>(() =>
    normalizeReportTypeFilters(
      readStoredJson(storageKeys.reportTypeFilters, defaultReportTypeFilters),
    ),
  )
  const [audibleAlertSettings, setAudibleAlertSettings] =
    useState<AudibleAlertSettings>(() =>
      readStoredJson(
        storageKeys.audibleAlertSettings,
        defaultAudibleAlertSettings,
      ),
    )
  const [activeLayer, setActiveLayer] =
    useState<(typeof primaryLayers)[number]>('Radar')
  const [radarProduct, setRadarProduct] =
    useState<
      | (typeof regionalRadarProducts)[number]['id']
      | (typeof localRadarProducts)[number]['id']
      | (typeof futureRadarProducts)[number]['id']
    >('base')
  const [radarView, setRadarView] =
    useState<(typeof radarViews)[number]['id']>('regional')
  const [selectedRegionalRadarFrameIndex, setSelectedRegionalRadarFrameIndex] =
    useState(0)
  const [regionalPlaybackRunning, setRegionalPlaybackRunning] = useState(false)
  const [followLatestRegionalFrame, setFollowLatestRegionalFrame] = useState(true)
  const [selectedRadarSiteId, setSelectedRadarSiteId] = useState<string | null>(null)
  const [selectedCoordinates, setSelectedCoordinates] =
    useState<[number, number]>(homeLocation?.coordinates ?? defaultCoordinates)
  const [shouldRecenterMap, setShouldRecenterMap] = useState(true)
  const [satelliteLayer, setSatelliteLayer] =
    useState<SatelliteLayerId>('infrared')
  const [selectedSatelliteFrameIndex, setSelectedSatelliteFrameIndex] = useState(0)
  const [satellitePlaybackRunning, setSatellitePlaybackRunning] = useState(false)
  const [followLatestSatelliteFrame, setFollowLatestSatelliteFrame] = useState(true)
  const [showSpotterReports, setShowSpotterReports] = useState(false)
  const [playbackWindowMinutes, setPlaybackWindowMinutes] = useState<30 | 60 | 120>(30)
  const [playbackSpeed, setPlaybackSpeed] =
    useState<(typeof playbackSpeeds)[number]['id']>('normal')
  const [activeForecastOverlay, setActiveForecastOverlay] =
    useState<(typeof forecastOverlays)[number]>('None')
  const [selectedSpcDay, setSelectedSpcDay] = useState<1 | 2 | 3>(1)
  const [selectedWinterDay, setSelectedWinterDay] = useState<1 | 2 | 3 | 4>(1)
  const [selectedWinterProduct, setSelectedWinterProduct] =
    useState<(typeof winterProducts)[number]['id']>('snowfall')
  const [selectedHazard, setSelectedHazard] = useState<HazardSelection | null>(null)
  const [selectedLocalRadarFrameIndex, setSelectedLocalRadarFrameIndex] = useState(0)
  const [localPlaybackRunning, setLocalPlaybackRunning] = useState(false)
  const [followLatestFrame, setFollowLatestFrame] = useState(true)
  const [selectedFutureRadarFrameIndex, setSelectedFutureRadarFrameIndex] =
    useState(0)
  const [futurePlaybackRunning, setFuturePlaybackRunning] = useState(false)
  const [searchText, setSearchText] = useState(
    homeLocation?.label ?? defaultLocationLabel,
  )
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [showLocationMenu, setShowLocationMenu] = useState(false)
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [sidePanelTab, setSidePanelTab] = useState<SidePanelTab>('forecast')
  const [trackToolEnabled, setTrackToolEnabled] = useState(false)
  const [stormTrackOrigin, setStormTrackOrigin] = useState<[number, number] | null>(null)
  const [stormTrackEnd, setStormTrackEnd] = useState<[number, number] | null>(null)
  const [stormTrackSpeedMph, setStormTrackSpeedMph] = useState(30)
  const [stormTrackResetKey, setStormTrackResetKey] = useState(0)
  const [mapRefreshKey, setMapRefreshKey] = useState(0)
  const seenAudibleAlertsRef = useRef<Set<string>>(new Set())
  const audibleAlertScopeRef = useRef<string | null>(null)
  const { data: weather, error, source } =
    useLocationWeather(selectedCoordinates)
  const {
    sites: radarSites,
  } = useRadarSites()
  const {
    site: nearestRadarSite,
    loading: nearestRadarLoading,
    error: nearestRadarError,
  } = useNearestRadarSite(selectedCoordinates)
  const activeRadarSite =
    radarSites.find((site) => site.id === selectedRadarSiteId) ?? nearestRadarSite
  const {
    tracks: nexradStormTracks,
    loading: nexradStormTracksLoading,
    error: nexradStormTracksError,
  } = useNexradStormTracks(
    activeRadarSite,
    activeLayer === 'Radar' && radarView === 'local',
  )
  const nexradStormTracksObservedAt = useMemo(
    () => getLatestStormTrackObservedAt(nexradStormTracks),
    [nexradStormTracks],
  )
  const {
    definition: localRadarDefinition,
    frames: localRadarFrames,
    loading: localRadarTimelineLoading,
    error: localRadarTimelineError,
  } = useLocalRadarTimeline(
    activeRadarSite,
    radarProduct === 'velocity' ? 'velocity' : 'reflectivity',
  )
  const {
    features: alertFeatures,
    loading: alertFeaturesLoading,
  } = useAlertPolygons()
  const {
    features: localStormReports,
    loading: localStormReportsLoading,
  } = useLocalStormReports(showSpotterReports)
  const {
    features: spcFeatures,
  } = useSpcOutlookPolygons(
    selectedSpcDay,
    activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk',
  )
  const {
    features: winterFeatures = [],
  } = useWinterOutlookPolygons(
    selectedWinterProduct,
    selectedWinterDay,
    activeLayer === 'Forecast' && activeForecastOverlay === 'Winter',
  )
  const {
    frames: regionalRadarFrames,
    loading: regionalRadarTimelineLoading,
    error: regionalRadarTimelineError,
  } = useRegionalRadarTimeline(radarProduct === 'composite' ? 'composite' : 'base')
  const {
    frames: futureRadarFrames,
    loading: futureRadarTimelineLoading,
    error: futureRadarTimelineError,
  } = useFutureRadarTimeline(
    radarProduct === 'hrrr-reflectivity'
      ? (radarProduct as FutureRadarProduct)
      : 'hrrr-reflectivity',
    activeLayer === 'Radar' && radarView === 'future',
  )
  const {
    frames: satelliteFrames,
    loading: satelliteTimelineLoading,
    error: satelliteTimelineError,
  } = useSatelliteTimeline(satelliteLayer)

  const activeRadarProducts = useMemo(
    () =>
      radarView === 'regional'
        ? regionalRadarProducts
        : radarView === 'future'
          ? futureRadarProducts
          : localRadarProducts,
    [radarView],
  )
  const playbackIntervalMs = useMemo(
    () =>
      playbackSpeeds.find((speed) => speed.id === playbackSpeed)?.intervalMs ?? 650,
    [playbackSpeed],
  )
  const activeLocalRadarFrames = useMemo(
    () => filterFramesToWindow(localRadarFrames, playbackWindowMinutes),
    [localRadarFrames, playbackWindowMinutes],
  )
  const activeRegionalRadarFrames = useMemo(
    () => filterFramesToWindow(regionalRadarFrames, playbackWindowMinutes),
    [regionalRadarFrames, playbackWindowMinutes],
  )
  const activeSatelliteFrames = useMemo(
    () => filterFramesToWindow(satelliteFrames, playbackWindowMinutes),
    [satelliteFrames, playbackWindowMinutes],
  )
  const activeFutureRadarFrames = futureRadarFrames
  const latestRegionalRadarFrame = useMemo(
    () => activeRegionalRadarFrames[activeRegionalRadarFrames.length - 1] ?? null,
    [activeRegionalRadarFrames],
  )
  const latestLocalRadarFrame = useMemo(
    () => activeLocalRadarFrames[activeLocalRadarFrames.length - 1] ?? null,
    [activeLocalRadarFrames],
  )
  const latestSatelliteFrame = useMemo(
    () => activeSatelliteFrames[activeSatelliteFrames.length - 1] ?? null,
    [activeSatelliteFrames],
  )
  const selectedFutureRadarFrame = useMemo(
    () =>
      radarView === 'future' && activeFutureRadarFrames.length > 0
        ? activeFutureRadarFrames[
            Math.min(
              selectedFutureRadarFrameIndex,
              activeFutureRadarFrames.length - 1,
            )
          ]
        : null,
    [activeFutureRadarFrames, radarView, selectedFutureRadarFrameIndex],
  )
  const selectedRegionalRadarTime = useMemo(
    () =>
      radarView === 'regional' && activeRegionalRadarFrames.length > 0
        ? activeRegionalRadarFrames[
            Math.min(
              selectedRegionalRadarFrameIndex,
              activeRegionalRadarFrames.length - 1,
            )
          ]
        : null,
    [activeRegionalRadarFrames, radarView, selectedRegionalRadarFrameIndex],
  )
  const selectedLocalRadarTime = useMemo(
    () =>
      radarView === 'local' && activeLocalRadarFrames.length > 0
        ? activeLocalRadarFrames[
            Math.min(selectedLocalRadarFrameIndex, activeLocalRadarFrames.length - 1)
          ]
        : null,
    [activeLocalRadarFrames, radarView, selectedLocalRadarFrameIndex],
  )
  const selectedSatelliteTime = useMemo(
    () =>
      activeLayer === 'Satellite' && activeSatelliteFrames.length > 0
        ? activeSatelliteFrames[
            Math.min(selectedSatelliteFrameIndex, activeSatelliteFrames.length - 1)
          ]
        : null,
    [activeLayer, activeSatelliteFrames, selectedSatelliteFrameIndex],
  )

  const currentTimelineFrames = useMemo(
    () =>
      activeLayer === 'Satellite'
        ? activeSatelliteFrames
        : radarView === 'regional'
          ? activeRegionalRadarFrames
          : radarView === 'future'
            ? activeFutureRadarFrames.map((frame) => frame.validTime)
            : activeLocalRadarFrames,
    [
      activeFutureRadarFrames,
      activeLayer,
      activeLocalRadarFrames,
      activeRegionalRadarFrames,
      activeSatelliteFrames,
      radarView,
    ],
  )

  const activePlaybackIndex = useMemo(() => {
    if (activeLayer === 'Satellite' && activeSatelliteFrames.length > 0) {
      return Math.min(selectedSatelliteFrameIndex, activeSatelliteFrames.length - 1)
    }

    if (radarView === 'regional' && activeRegionalRadarFrames.length > 0) {
      return Math.min(
        selectedRegionalRadarFrameIndex,
        activeRegionalRadarFrames.length - 1,
      )
    }

    if (radarView === 'local' && activeLocalRadarFrames.length > 0) {
      return Math.min(selectedLocalRadarFrameIndex, activeLocalRadarFrames.length - 1)
    }

    if (radarView === 'future' && activeFutureRadarFrames.length > 0) {
      return Math.min(
        selectedFutureRadarFrameIndex,
        activeFutureRadarFrames.length - 1,
      )
    }

    return 0
  }, [
    activeFutureRadarFrames,
    activeLayer,
    activeLocalRadarFrames,
    activeRegionalRadarFrames,
    activeSatelliteFrames,
    radarView,
    selectedFutureRadarFrameIndex,
    selectedLocalRadarFrameIndex,
    selectedRegionalRadarFrameIndex,
    selectedSatelliteFrameIndex,
  ])
  const activePlaybackLabel = useMemo(
    () => {
      if (activeLayer === 'Radar' && radarView === 'future') {
        return selectedFutureRadarFrame
          ? `${selectedFutureRadarFrame.label} ${formatFrameLabel(
              selectedFutureRadarFrame.validTime,
            )}`
          : 'Future radar'
      }

      return currentTimelineFrames.length > 0
        ? activePlaybackIndex === currentTimelineFrames.length - 1
          ? 'Live'
          : formatFrameLabel(currentTimelineFrames[activePlaybackIndex])
        : playbackFrames[0]
    },
    [
      activeLayer,
      activePlaybackIndex,
      currentTimelineFrames,
      radarView,
      selectedFutureRadarFrame,
    ],
  )
  const visibleAlertFeatures = useMemo(
    () => alertFeatures.filter((feature) => alertTypeFilters[feature.alertType]),
    [alertFeatures, alertTypeFilters],
  )
  const alertGeometryBounds = useMemo(
    () => buildAlertGeometryBounds(alertFeatures),
    [alertFeatures],
  )
  const recentLocalStormReports = useMemo(
    () =>
      localStormReports
        .filter((feature) => feature.ageMinutes === null || feature.ageMinutes <= 180)
        .filter((feature) => reportTypeFilters[feature.reportCategory]),
    [localStormReports, reportTypeFilters],
  )
  const nearbyAlerts = useMemo(
    () =>
      getNearbyAlerts(
        visibleAlertFeatures,
        selectedCoordinates,
        70,
        alertGeometryBounds,
      ),
    [alertGeometryBounds, selectedCoordinates, visibleAlertFeatures],
  )
  const nearbyReports = useMemo(
    () => getNearbyReports(recentLocalStormReports, selectedCoordinates, 70),
    [recentLocalStormReports, selectedCoordinates],
  )
  const audibleAlertCoordinates =
    audibleAlertSettings.target === 'home' && homeLocation
      ? homeLocation.coordinates
      : selectedCoordinates
  const audibleAlertLocationLabel =
    audibleAlertSettings.target === 'home'
      ? homeLocation?.label ?? 'Selected point'
      : weather.location.name
  const audibleNearbyAlerts = useMemo(
    () =>
      getNearbyAlerts(
        alertFeatures,
        audibleAlertCoordinates,
        audibleAlertSettings.radiusMiles,
        alertGeometryBounds,
      ).filter(({ alert }) =>
        alert.alertType === 'warning'
          ? audibleAlertSettings.warning
          : alert.alertType === 'watch'
            ? audibleAlertSettings.watch
            : false,
      ),
    [alertFeatures, alertGeometryBounds, audibleAlertCoordinates, audibleAlertSettings],
  )
  const currentSavedLocation = {
    label: weather.location.name,
    coordinates: selectedCoordinates,
  } satisfies SavedLocation
  const stormTrackDistanceMiles = useMemo(
    () =>
      stormTrackOrigin && stormTrackEnd
        ? distanceBetweenMiles(stormTrackOrigin, stormTrackEnd)
        : 0,
    [stormTrackEnd, stormTrackOrigin],
  )
  const stormTrackTravelMinutes = useMemo(
    () =>
      stormTrackDistanceMiles > 0 && stormTrackSpeedMph > 0
        ? (stormTrackDistanceMiles / stormTrackSpeedMph) * 60
        : 0,
    [stormTrackDistanceMiles, stormTrackSpeedMph],
  )
  const stormTrackHeading = useMemo(
    () =>
      stormTrackOrigin && stormTrackEnd
        ? describeTrackHeading(stormTrackOrigin, stormTrackEnd)
        : null,
    [stormTrackEnd, stormTrackOrigin],
  )
  const stormTrackSpeedPresets = useMemo(
    () =>
      stormTrackOrigin && stormTrackEnd
        ? buildStormTrackSpeedPresets(stormTrackDistanceMiles)
        : [],
    [stormTrackDistanceMiles, stormTrackEnd, stormTrackOrigin],
  )
  const {
    places: stormTrackPlaces,
    loading: stormTrackPlacesLoading,
  } = useStormTrackPlaces(
    trackToolEnabled,
    stormTrackOrigin,
    stormTrackEnd,
  )
  const stormTrackArrivals = useMemo(
    () => buildStormTrackArrivals(stormTrackPlaces, stormTrackSpeedMph),
    [stormTrackPlaces, stormTrackSpeedMph],
  )
  const viewingLabel = useMemo(
    () =>
      activeLayer === 'Radar'
        ? activeRadarProducts.find((product) => product.id === radarProduct)?.label ??
          'Radar'
        : activeLayer === 'Satellite'
          ? defaultSatelliteLayers.find((layer) => layer.id === satelliteLayer)?.label ??
            'Satellite'
          : activeForecastOverlay,
    [activeForecastOverlay, activeLayer, activeRadarProducts, radarProduct, satelliteLayer],
  )
  const statusPrimary = useMemo(() => {
    if (activeLayer === 'Radar') {
      if (radarView === 'regional') {
        return selectedRegionalRadarTime
          ? formatFrameTimestamp(selectedRegionalRadarTime)
          : regionalRadarTimelineLoading
            ? 'Loading regional frames...'
            : regionalRadarTimelineError ?? 'Regional playback unavailable'
      }

      if (radarView === 'future') {
        return selectedFutureRadarFrame
          ? `${formatFrameTimestamp(
              selectedFutureRadarFrame.validTime,
            )} valid (${selectedFutureRadarFrame.label})`
          : futureRadarTimelineLoading
            ? 'Loading HRRR guidance...'
            : futureRadarTimelineError ?? 'Future radar unavailable'
      }

      return selectedLocalRadarTime
        ? formatFrameTimestamp(selectedLocalRadarTime)
        : localRadarTimelineLoading
          ? 'Loading local frames...'
          : localRadarTimelineError ?? 'Local playback unavailable'
    }

    if (activeLayer === 'Satellite') {
      return selectedSatelliteTime
        ? formatFrameTimestamp(selectedSatelliteTime)
        : satelliteTimelineLoading
          ? 'Loading GOES frames...'
          : satelliteTimelineError ?? 'Satellite playback unavailable'
    }

    if (activeForecastOverlay === 'SPC Storm Risk') {
      return `${spcFeatures.length} SPC polygons`
    }

    if (activeForecastOverlay === 'Winter') {
      return `${winterFeatures.length} WPC polygons`
    }

    return `${visibleAlertFeatures.length} alert polygons`
  }, [
    activeForecastOverlay,
    activeLayer,
    futureRadarTimelineError,
    futureRadarTimelineLoading,
    localRadarTimelineError,
    localRadarTimelineLoading,
    radarView,
    regionalRadarTimelineError,
    regionalRadarTimelineLoading,
    satelliteTimelineError,
    satelliteTimelineLoading,
    selectedLocalRadarTime,
    selectedFutureRadarFrame,
    selectedRegionalRadarTime,
    selectedSatelliteTime,
    spcFeatures.length,
    visibleAlertFeatures.length,
    winterFeatures.length,
  ])
  const statusSecondary = useMemo(() => {
    if (activeLayer === 'Radar') {
      if (radarView === 'local') {
        return activeRadarSite
          ? `${selectedRadarSiteId ? 'Site' : 'Nearest'} ${activeRadarSite.id}`
          : nearestRadarLoading
            ? 'Resolving site...'
            : nearestRadarError ?? null
      }

      if (radarView === 'future') {
        return selectedFutureRadarFrame
          ? `HRRR run ${formatUtcRunHour(
              selectedFutureRadarFrame.runTime,
            )}; model guidance, not observed radar`
          : 'HRRR simulated reflectivity'
      }

      if (showSpotterReports) {
        return localStormReportsLoading
          ? 'Loading recent reports...'
          : `${recentLocalStormReports.length} recent reports`
      }

      return `${visibleAlertFeatures.length} alerts visible`
    }

    if (activeLayer === 'Satellite') {
      return `${visibleAlertFeatures.length} alerts visible`
    }

    if (activeForecastOverlay === 'SPC Storm Risk') {
      return `Day ${selectedSpcDay}`
    }

    if (activeForecastOverlay === 'Winter') {
      return `${selectedWinterProduct === 'snowfall' ? 'Snowfall' : 'Freezing Rain'} Day ${selectedWinterDay}`
    }

    return `${visibleAlertFeatures.length} alerts visible`
  }, [
    activeForecastOverlay,
    activeLayer,
    activeRadarSite,
    localStormReportsLoading,
    nearestRadarError,
    nearestRadarLoading,
    radarView,
    recentLocalStormReports.length,
    selectedFutureRadarFrame,
    selectedRadarSiteId,
    selectedSpcDay,
    selectedWinterDay,
    selectedWinterProduct,
    showSpotterReports,
    visibleAlertFeatures.length,
  ])
  const stackedHazardAlerts = useMemo(
    () => selectedHazard?.source === 'alerts' ? selectedHazard.relatedAlerts ?? [] : [],
    [selectedHazard],
  )
  const extraStackedHazardAlerts = useMemo(
    () => stackedHazardAlerts.slice(1),
    [stackedHazardAlerts],
  )
  const selectedHazardChipStyle = useMemo(
    () => buildAlertChipStyle(selectedHazard?.accentColor),
    [selectedHazard],
  )

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    window.localStorage.setItem(storageKeys.themeMode, JSON.stringify(themeMode))
  }, [themeMode])

  useEffect(() => {
    window.localStorage.setItem(
      storageKeys.homeLocation,
      JSON.stringify(homeLocation),
    )
  }, [homeLocation])

  useEffect(() => {
    window.localStorage.setItem(
      storageKeys.favoriteLocations,
      JSON.stringify(favoriteLocations),
    )
  }, [favoriteLocations])

  useEffect(() => {
    window.localStorage.setItem(
      storageKeys.layerOpacity,
      JSON.stringify(layerOpacity),
    )
  }, [layerOpacity])

  useEffect(() => {
    window.localStorage.setItem(
      storageKeys.alertTypeFilters,
      JSON.stringify(alertTypeFilters),
    )
  }, [alertTypeFilters])

  useEffect(() => {
    window.localStorage.setItem(
      storageKeys.reportTypeFilters,
      JSON.stringify(reportTypeFilters),
    )
  }, [reportTypeFilters])

  useEffect(() => {
    window.localStorage.setItem(
      storageKeys.audibleAlertSettings,
      JSON.stringify(audibleAlertSettings),
    )
  }, [audibleAlertSettings])

  useEffect(() => {
    if (alertFeaturesLoading) {
      return
    }

    const scopeKey = JSON.stringify({
      target: audibleAlertSettings.target,
      radiusMiles: audibleAlertSettings.radiusMiles,
      warning: audibleAlertSettings.warning,
      watch: audibleAlertSettings.watch,
      coordinates: audibleAlertCoordinates.map((value) => Number(value.toFixed(3))),
    })
    const currentAlertIds = new Set(audibleNearbyAlerts.map(({ alert }) => alert.id))

    if (audibleAlertScopeRef.current !== scopeKey) {
      audibleAlertScopeRef.current = scopeKey
      seenAudibleAlertsRef.current = currentAlertIds
      return
    }

    const newAlerts = audibleNearbyAlerts.filter(
      ({ alert }) => !seenAudibleAlertsRef.current.has(alert.id),
    )

    currentAlertIds.forEach((id) => seenAudibleAlertsRef.current.add(id))

    if (newAlerts.length === 0) {
      return
    }

    const tone = newAlerts.some(({ alert }) => alert.alertType === 'warning')
      ? 'warning'
      : 'watch'
    void playAudibleAlertTone(tone)
  }, [
    alertFeaturesLoading,
    audibleAlertCoordinates,
    audibleAlertSettings,
    audibleNearbyAlerts,
  ])

  useEffect(() => {
    if (activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk') {
      const primarySpc = [...spcFeatures].sort(
        (left, right) => getSpcRank(right.category) - getSpcRank(left.category),
      )[0]

      setSelectedHazard((current) => {
        if (
          current?.source === 'spc' &&
          current.title.startsWith(`SPC Day ${selectedSpcDay} `)
        ) {
          return current
        }

        return primarySpc
          ? {
              source: 'spc',
              title: `SPC Day ${selectedSpcDay} ${primarySpc.category}`,
              subtitle: 'Storm Prediction Center categorical outlook',
              summary: 'Click an SPC outlook polygon on the map to inspect the exact risk area.',
              detailLines: [
                `Valid: ${formatCompactHazardTimestamp(primarySpc.valid)}`,
                `Expires: ${formatCompactHazardTimestamp(primarySpc.expire)}`,
              ],
            }
          : {
              source: 'spc',
              title: `No SPC Day ${selectedSpcDay} polygon selected`,
              subtitle: 'Storm Prediction Center categorical outlook',
              summary: 'Click an SPC outlook polygon on the map to inspect it here.',
              detailLines: [`Loaded polygons: ${spcFeatures.length}`],
            }
      })
      return
    }

    if (activeLayer === 'Forecast' && activeForecastOverlay === 'Winter') {
      const primaryWinter = [...winterFeatures].sort(
        (left, right) => getWinterRank(right.outlook) - getWinterRank(left.outlook),
      )[0]

      setSelectedHazard((current) => {
        if (
          current?.source === 'winter' &&
          current.title.startsWith(`WPC Day ${selectedWinterDay} `)
        ) {
          return current
        }

        return primaryWinter
          ? {
              source: 'winter',
              title: `WPC Day ${selectedWinterDay} ${selectedWinterProduct === 'snowfall' ? 'Snowfall' : 'Freezing Rain'}`,
              subtitle: primaryWinter.outlook,
              summary: primaryWinter.snippet,
              detailLines: [
                `Valid: ${primaryWinter.validTime || 'Unavailable'}`,
                `Issued: ${primaryWinter.issueTime || 'Unavailable'}`,
              ],
            }
          : {
              source: 'winter',
              title: `No Winter Day ${selectedWinterDay} polygon selected`,
              subtitle: 'WPC Winter Storm Outlook',
              summary: 'Click a winter outlook polygon on the map to inspect it here.',
              detailLines: [`Loaded polygons: ${winterFeatures.length}`],
            }
      })
      return
    }
    setSelectedHazard((current) =>
      current?.source === 'alerts' ? null : current,
    )
  }, [
    activeForecastOverlay,
    activeLayer,
    selectedSpcDay,
    selectedWinterDay,
    selectedWinterProduct,
    spcFeatures,
    winterFeatures,
  ])

  useEffect(() => {
    if (
      radarView === 'regional' &&
      activeRegionalRadarFrames.length > 0 &&
      selectedRegionalRadarFrameIndex > activeRegionalRadarFrames.length - 1
    ) {
      setSelectedRegionalRadarFrameIndex(activeRegionalRadarFrames.length - 1)
    }
  }, [
    activeRegionalRadarFrames.length,
    radarView,
    selectedRegionalRadarFrameIndex,
  ])

  useEffect(() => {
    if (
      radarView === 'regional' &&
      followLatestRegionalFrame &&
      latestRegionalRadarFrame
    ) {
      setSelectedRegionalRadarFrameIndex(activeRegionalRadarFrames.length - 1)
    }
  }, [
    activeRegionalRadarFrames.length,
    followLatestRegionalFrame,
    latestRegionalRadarFrame,
    radarView,
  ])

  useEffect(() => {
    if (
      radarView !== 'regional' ||
      !regionalPlaybackRunning ||
      activeRegionalRadarFrames.length < 2
    ) {
      return
    }

    const interval = window.setInterval(() => {
      setSelectedRegionalRadarFrameIndex((current) => {
        const next = current + 1
        return next >= activeRegionalRadarFrames.length ? 0 : next
      })
    }, playbackIntervalMs)

    return () => window.clearInterval(interval)
  }, [
    activeRegionalRadarFrames.length,
    playbackIntervalMs,
    radarView,
    regionalPlaybackRunning,
  ])

  useEffect(() => {
    if (
      radarView === 'local' &&
      activeLocalRadarFrames.length > 0 &&
      selectedLocalRadarFrameIndex > activeLocalRadarFrames.length - 1
    ) {
      setSelectedLocalRadarFrameIndex(activeLocalRadarFrames.length - 1)
    }
  }, [
    activeLocalRadarFrames.length,
    radarView,
    selectedLocalRadarFrameIndex,
  ])

  useEffect(() => {
    if (
      radarView === 'local' &&
      followLatestFrame &&
      latestLocalRadarFrame
    ) {
      setSelectedLocalRadarFrameIndex(activeLocalRadarFrames.length - 1)
    }
  }, [
    activeLocalRadarFrames.length,
    followLatestFrame,
    latestLocalRadarFrame,
    radarView,
  ])

  useEffect(() => {
    if (
      radarView !== 'local' ||
      !localPlaybackRunning ||
      activeLocalRadarFrames.length < 2
    ) {
      return
    }

    const interval = window.setInterval(() => {
      setSelectedLocalRadarFrameIndex((current) => {
        const next = current + 1
        return next >= activeLocalRadarFrames.length ? 0 : next
      })
    }, playbackIntervalMs)

    return () => window.clearInterval(interval)
  }, [
    activeLocalRadarFrames.length,
    localPlaybackRunning,
    playbackIntervalMs,
    radarView,
  ])

  useEffect(() => {
    if (
      radarView === 'future' &&
      activeFutureRadarFrames.length > 0 &&
      selectedFutureRadarFrameIndex > activeFutureRadarFrames.length - 1
    ) {
      setSelectedFutureRadarFrameIndex(activeFutureRadarFrames.length - 1)
    }
  }, [
    activeFutureRadarFrames.length,
    radarView,
    selectedFutureRadarFrameIndex,
  ])

  useEffect(() => {
    if (
      radarView !== 'future' ||
      !futurePlaybackRunning ||
      activeFutureRadarFrames.length < 2
    ) {
      return
    }

    const interval = window.setInterval(() => {
      setSelectedFutureRadarFrameIndex((current) => {
        const next = current + 1
        return next >= activeFutureRadarFrames.length ? 0 : next
      })
    }, playbackIntervalMs)

    return () => window.clearInterval(interval)
  }, [
    activeFutureRadarFrames.length,
    futurePlaybackRunning,
    playbackIntervalMs,
    radarView,
  ])

  useEffect(() => {
    if (
      activeSatelliteFrames.length > 0 &&
      selectedSatelliteFrameIndex > activeSatelliteFrames.length - 1
    ) {
      setSelectedSatelliteFrameIndex(activeSatelliteFrames.length - 1)
    }
  }, [activeSatelliteFrames.length, selectedSatelliteFrameIndex])

  useEffect(() => {
    if (
      followLatestSatelliteFrame &&
      latestSatelliteFrame
    ) {
      setSelectedSatelliteFrameIndex(activeSatelliteFrames.length - 1)
    }
  }, [
    activeSatelliteFrames.length,
    followLatestSatelliteFrame,
    latestSatelliteFrame,
    satelliteLayer,
  ])

  useEffect(() => {
    if (
      activeLayer !== 'Satellite' ||
      !satellitePlaybackRunning ||
      activeSatelliteFrames.length < 2
    ) {
      return
    }

    const interval = window.setInterval(() => {
      setSelectedSatelliteFrameIndex((current) => {
        const next = current + 1
        return next >= activeSatelliteFrames.length ? 0 : next
      })
    }, playbackIntervalMs)

    return () => window.clearInterval(interval)
  }, [
    activeLayer,
    activeSatelliteFrames.length,
    playbackIntervalMs,
    satellitePlaybackRunning,
  ])

  const handleSearchSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setSearching(true)
      setSearchError(null)

      try {
        const result = await geocodeLocation(searchText)
        setSelectedCoordinates(result.coordinates)
        setShouldRecenterMap(true)
        setSelectedHazard(null)
        setSearchText(result.label)
      } catch (searchError) {
        const message =
          searchError instanceof Error
            ? searchError.message
            : 'Location search failed.'
        setSearchError(message)
      } finally {
        setSearching(false)
      }
    },
    [searchText],
  )

  const commitOpacityValue = useCallback(
    <K extends keyof typeof defaultLayerOpacity>(key: K, value: number) => {
      const normalizedValue = clampPercentage(value, layerOpacity[key])
      setLayerOpacity((current) =>
        normalizeLayerOpacity({
          ...current,
          [key]: normalizedValue,
        }),
      )
    },
    [layerOpacity],
  )
  const commitRadarOpacity = useCallback(
    (value: number) => commitOpacityValue('radar', value),
    [commitOpacityValue],
  )
  const commitSatelliteOpacity = useCallback(
    (value: number) => commitOpacityValue('satellite', value),
    [commitOpacityValue],
  )
  const commitWarningOpacity = useCallback(
    (value: number) => commitOpacityValue('warnings', value),
    [commitOpacityValue],
  )
  const commitWatchOpacity = useCallback(
    (value: number) => commitOpacityValue('watches', value),
    [commitOpacityValue],
  )
  const commitPolygonOpacity = useCallback(
    (value: number) => commitOpacityValue('polygons', value),
    [commitOpacityValue],
  )
  const handleHazardSelect = useCallback((selection: HazardSelection) => {
    setSelectedHazard(selection)
    setSidePanelTab('hazards')
  }, [])
  const handleStormTrackOriginSet = useCallback((coordinates: [number, number]) => {
    setStormTrackOrigin(coordinates)
    setStormTrackEnd(null)
  }, [])
  const handleMapClick = useCallback((coordinates: [number, number]) => {
    setSelectedCoordinates(coordinates)
    setShouldRecenterMap(false)
    setSelectedHazard(null)
    setSearchText(`${coordinates[1].toFixed(3)}, ${coordinates[0].toFixed(3)}`)
    setSearchError(null)
  }, [])
  const handleRadarSiteSelect = useCallback((siteId: string) => {
    setSelectedRadarSiteId(siteId)
    setSelectedLocalRadarFrameIndex(0)
    setFollowLatestFrame(true)
    setLocalPlaybackRunning(false)
    setSearchError(null)
  }, [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <p className="eyebrow">StormVector</p>
          <h1>Weather workstation</h1>
        </div>
        <div className="search-panel">
          <form className="search-row" onSubmit={handleSearchSubmit}>
            <input
              id="location-search"
              value={searchText}
              aria-label="Search location"
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search city, state, or address"
            />
            <button type="submit" disabled={searching}>
              {searching ? 'Searching...' : 'Go'}
            </button>
          </form>
          <div className="utility-row">
            <div className="popover-wrap">
              <button
                type="button"
                className="utility-button"
                aria-expanded={showLocationMenu}
                onClick={() => {
                  setShowLocationMenu((current) => !current)
                  setShowSettingsMenu(false)
                }}
              >
                Places
              </button>
              {showLocationMenu ? (
                <div className="popover-panel">
                  <div className="popover-section">
                    <div className="settings-row">
                      <div>
                        <p className="card-label">Home</p>
                        <strong>{homeLocation?.label ?? 'Not set yet'}</strong>
                      </div>
                      <button
                        type="button"
                        className="inline-action"
                        onClick={() => setHomeLocation(currentSavedLocation)}
                      >
                        Set Home
                      </button>
                    </div>
                    {homeLocation ? (
                      <button
                        type="button"
                        className="inline-action"
                          onClick={() => {
                            setSelectedCoordinates(homeLocation.coordinates)
                            setShouldRecenterMap(true)
                            setSelectedHazard(null)
                            setSearchText(homeLocation.label)
                            setSearchError(null)
                            setShowLocationMenu(false)
                        }}
                      >
                        Go Home
                      </button>
                    ) : null}
                  </div>

                  <div className="popover-section">
                    <div className="settings-row">
                      <div>
                        <p className="card-label">Favorites</p>
                        <strong>{favoriteLocations.length} saved</strong>
                      </div>
                      <button
                        type="button"
                        className="inline-action"
                        onClick={() =>
                          setFavoriteLocations((current) =>
                            upsertFavoriteLocation(current, currentSavedLocation),
                          )
                        }
                      >
                        Add Current
                      </button>
                    </div>
                    <div className="favorite-list">
                      {favoriteLocations.length > 0 ? (
                        favoriteLocations.map((location) => (
                          <div
                            key={`${location.label}-${location.coordinates.join(',')}`}
                            className="favorite-item"
                          >
                            <button
                              type="button"
                              className="inline-action"
                              onClick={() => {
                                setSelectedCoordinates(location.coordinates)
                                setShouldRecenterMap(true)
                                setSelectedHazard(null)
                                setSearchText(location.label)
                                setSearchError(null)
                                setShowLocationMenu(false)
                              }}
                            >
                              {location.label}
                            </button>
                            <button
                              type="button"
                              className="inline-action"
                              onClick={() =>
                                setFavoriteLocations((current) =>
                                  current.filter(
                                    (item) =>
                                      item.label !== location.label ||
                                      item.coordinates[0] !== location.coordinates[0] ||
                                      item.coordinates[1] !== location.coordinates[1],
                                  ),
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="muted">Save a few frequently watched areas here.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="popover-wrap">
              <button
                type="button"
                className="utility-button"
                aria-expanded={showSettingsMenu}
                onClick={() => {
                  setShowSettingsMenu((current) => !current)
                  setShowLocationMenu(false)
                }}
              >
                Prefs
              </button>
              {showSettingsMenu ? (
                <div className="popover-panel">
                  <div className="popover-section">
                    <p className="card-label">Theme</p>
                    <div className="chip-group" aria-label="Theme mode">
                      {(['light', 'dark'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={themeMode === mode ? 'chip active' : 'chip'}
                          onClick={() => setThemeMode(mode)}
                        >
                          {mode === 'light' ? 'Light' : 'Dark'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="popover-section">
                    <p className="card-label">Alert types</p>
                    <div className="chip-group">
                      {[
                        ['warning', 'Warnings'],
                        ['watch', 'Watches'],
                        ['advisory', 'Advisories'],
                        ['statement', 'Statements'],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={
                            alertTypeFilters[id as keyof AlertTypeFilters]
                              ? 'chip active'
                              : 'chip'
                          }
                          onClick={() =>
                            setAlertTypeFilters((current) => ({
                              ...current,
                              [id]: !current[id as keyof AlertTypeFilters],
                            }))
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="popover-section">
                    <p className="card-label">Report types</p>
                    <div className="chip-group">
                      {(
                        [
                          ['tornado', 'Tornado'],
                          ['hail', 'Hail'],
                          ['wind', 'Wind'],
                          ['flood', 'Flood'],
                          ['winter', 'Winter'],
                          ['rain', 'Rain'],
                          ['other', 'Other'],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={reportTypeFilters[id] ? 'chip active' : 'chip'}
                          onClick={() =>
                            setReportTypeFilters((current) => ({
                              ...current,
                              [id]: !current[id],
                            }))
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="popover-section">
                    <div className="settings-row">
                      <div>
                        <p className="card-label">Audible alerts</p>
                        <strong>{audibleNearbyAlerts.length} nearby monitored</strong>
                      </div>
                      <div className="chip-group">
                        <button
                          type="button"
                          className="inline-action"
                          onClick={() => void playAudibleAlertTone('watch')}
                        >
                          Test watch
                        </button>
                        <button
                          type="button"
                          className="inline-action"
                          onClick={() => void playAudibleAlertTone('warning')}
                        >
                          Test warning
                        </button>
                      </div>
                    </div>

                    <div className="slider-group">
                      <label className="card-label">Alert on</label>
                      <div className="chip-group">
                        {[
                          ['warning', 'Warnings'],
                          ['watch', 'Watches'],
                        ].map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            className={
                              audibleAlertSettings[id as 'warning' | 'watch']
                                ? 'chip active'
                                : 'chip'
                            }
                            onClick={() =>
                              setAudibleAlertSettings((current) => ({
                                ...current,
                                [id]: !current[id as 'warning' | 'watch'],
                              }))
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="slider-group">
                      <label className="card-label">Watch point</label>
                      <div className="chip-group">
                        {[
                          ['selected', 'Selected point'],
                          ['home', 'Home'],
                        ].map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            className={
                              audibleAlertSettings.target === id
                                ? 'chip active'
                                : 'chip'
                            }
                            onClick={() =>
                              setAudibleAlertSettings((current) => ({
                                ...current,
                                target: id as AudibleAlertSettings['target'],
                              }))
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="slider-group">
                      <label className="card-label">Radius</label>
                      <div className="chip-group">
                        {[25, 50, 70, 100].map((radius) => (
                          <button
                            key={radius}
                            type="button"
                            className={
                              audibleAlertSettings.radiusMiles === radius
                                ? 'chip active'
                                : 'chip'
                            }
                            onClick={() =>
                              setAudibleAlertSettings((current) => ({
                                ...current,
                                radiusMiles:
                                  radius as AudibleAlertSettings['radiusMiles'],
                              }))
                            }
                          >
                            {radius} mi
                          </button>
                        ))}
                      </div>
                    </div>

                    <p className="muted compact-copy">
                      Monitoring {audibleAlertLocationLabel} within{' '}
                      {audibleAlertSettings.radiusMiles} miles for new{' '}
                      {describeAudibleAlertTypes(audibleAlertSettings)}.
                      {audibleAlertSettings.target === 'home' && !homeLocation
                        ? ' Home is not set yet, so this is following the selected point.'
                        : ''}
                    </p>
                  </div>

                  <div className="popover-section">
                    <p className="card-label">Layer opacity</p>
                    <div className="slider-group">
                      <OpacitySlider
                        label="Radar"
                        value={layerOpacity.radar}
                        onCommit={commitRadarOpacity}
                      />
                    </div>
                    <div className="slider-group">
                      <OpacitySlider
                        label="Satellite"
                        value={layerOpacity.satellite}
                        onCommit={commitSatelliteOpacity}
                      />
                    </div>
                    <div className="slider-group">
                      <OpacitySlider
                        label="Warnings"
                        value={layerOpacity.warnings}
                        onCommit={commitWarningOpacity}
                      />
                    </div>
                    <div className="slider-group">
                      <OpacitySlider
                        label="Watches"
                        value={layerOpacity.watches}
                        onCommit={commitWatchOpacity}
                      />
                    </div>
                    <div className="slider-group">
                      <OpacitySlider
                        label="Forecast Polygons"
                        value={layerOpacity.polygons}
                        onCommit={commitPolygonOpacity}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          {searchError ? <p className="error-text">{searchError}</p> : null}
        </div>
      </header>

      <nav className="layer-bar" aria-label="Primary layers">
        {primaryLayers.map((layer) => (
          <button
            key={layer}
            type="button"
            className={activeLayer === layer ? 'active' : ''}
            onClick={() => setActiveLayer(layer)}
            aria-pressed={activeLayer === layer}
          >
            {layer}
          </button>
        ))}
      </nav>

      <main className="workspace">
        <section className="map-panel">
          <div className="map-stage">
            <Suspense fallback={<div className="map-loading">Loading map...</div>}>
              <MapCanvas
                center={selectedCoordinates}
                shouldRecenterMap={shouldRecenterMap}
                themeMode={themeMode}
                activeLayer={activeLayer}
                radarProduct={radarProduct}
                radarView={radarView}
                satelliteLayer={satelliteLayer}
                radarOpacity={layerOpacity.radar / 100}
                satelliteOpacity={layerOpacity.satellite / 100}
                warningOpacity={layerOpacity.warnings / 100}
                watchOpacity={layerOpacity.watches / 100}
                polygonOpacity={layerOpacity.polygons / 100}
                selectedRegionalRadarTime={selectedRegionalRadarTime}
                selectedFutureRadarFrame={selectedFutureRadarFrame}
                selectedSatelliteTime={selectedSatelliteTime}
                radarSites={radarSites}
                nearestRadarSite={activeRadarSite}
                localRadarDefinition={localRadarDefinition}
                selectedRadarSiteId={selectedRadarSiteId}
                selectedLocalRadarTime={selectedLocalRadarTime}
                alertFeatures={alertFeatures}
                alertTypeFilters={alertTypeFilters}
                localStormReports={recentLocalStormReports}
                showSpotterReports={showSpotterReports}
                nexradStormTracks={nexradStormTracks}
                spcFeatures={spcFeatures}
                winterFeatures={winterFeatures}
                activeForecastOverlay={activeForecastOverlay}
                trackToolEnabled={trackToolEnabled}
                stormTrackOrigin={stormTrackOrigin}
                stormTrackEnd={stormTrackEnd}
                stormTrackSpeedMph={stormTrackSpeedMph}
                stormTrackResetKey={stormTrackResetKey}
                mapRefreshKey={mapRefreshKey}
                onHazardSelect={handleHazardSelect}
                onStormTrackOriginSet={handleStormTrackOriginSet}
                onStormTrackEndSet={setStormTrackEnd}
                onMapClick={handleMapClick}
                onRadarSiteSelect={handleRadarSiteSelect}
              />
            </Suspense>

            <div className="map-floating map-floating-top-left">
              <div className="map-toolbar map-glass">
                <div className="toolbar-main">
            {activeLayer === 'Radar' ? (
              <div className="radar-controls">
                <div className="control-tier">
                  <span className="control-label">Scope</span>
                  <div className="segmented-group" aria-label="Radar scope">
                    {radarViews.map((view) => (
                      <button
                        key={view.id}
                        type="button"
                        className={radarView === view.id ? 'chip active' : 'chip'}
                        onClick={() => {
                          setRadarView(view.id)
                          setRadarProduct(
                            view.id === 'regional'
                              ? 'base'
                              : view.id === 'future'
                                ? 'hrrr-reflectivity'
                                : 'reflectivity',
                          )
                          if (view.id === 'regional') {
                            setSelectedRadarSiteId(null)
                          }
                          setSelectedRegionalRadarFrameIndex(0)
                          setFollowLatestRegionalFrame(true)
                          setRegionalPlaybackRunning(false)
                          setSelectedLocalRadarFrameIndex(0)
                          setFollowLatestFrame(true)
                          setLocalPlaybackRunning(false)
                          setSelectedFutureRadarFrameIndex(0)
                          setFuturePlaybackRunning(false)
                        }}
                      >
                        {view.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="control-tier">
                  <span className="control-label">Product</span>
                  <div className="segmented-group" aria-label="Radar product">
                    {activeRadarProducts.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        className={radarProduct === product.id ? 'chip active' : 'chip'}
                        onClick={() => setRadarProduct(product.id)}
                      >
                        {product.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="control-tier">
                  <span className="control-label">Overlays</span>
                  <div className="segmented-group" aria-label="Radar overlays">
                    <button
                      type="button"
                      className={showSpotterReports ? 'chip active' : 'chip'}
                      onClick={() => setShowSpotterReports((current) => !current)}
                    >
                      Reports{recentLocalStormReports.length > 0 ? ` (${recentLocalStormReports.length})` : ''}
                    </button>
                    {radarView === 'local' ? (
                      <span
                        className={
                          nexradStormTracks.length > 0
                            ? 'chip active radar-track-chip'
                            : 'chip radar-track-chip'
                        }
                        aria-live="polite"
                      >
                        Tracks {nexradStormTracksLoading ? '...' : nexradStormTracks.length}
                        {nexradStormTracksObservedAt
                          ? ` / ${formatStormTrackObservedAt(nexradStormTracksObservedAt)}`
                          : ''}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {activeLayer === 'Forecast' ? (
              <div className="chip-group" aria-label="Forecast overlays">
                {forecastOverlays.map((overlay) => (
                  <button
                    key={overlay}
                    type="button"
                    className={activeForecastOverlay === overlay ? 'chip active' : 'chip'}
                    onClick={() => setActiveForecastOverlay(overlay)}
                  >
                    {overlay}
                  </button>
                ))}
              </div>
            ) : null}

            {activeLayer === 'Satellite' ? (
              <div className="chip-group" aria-label="Satellite product">
                {defaultSatelliteLayers.map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                      className={satelliteLayer === layer.id ? 'chip active' : 'chip'}
                    onClick={() => {
                      setSatelliteLayer(layer.id)
                      setSelectedSatelliteFrameIndex(0)
                      setFollowLatestSatelliteFrame(true)
                      setSatellitePlaybackRunning(false)
                    }}
                  >
                    {layer.label}
                  </button>
                ))}
              </div>
            ) : null}

            {activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk' ? (
              <div className="chip-group" aria-label="SPC outlook day">
                {spcDays.map((day) => (
                  <button
                    key={day.id}
                    type="button"
                    className={selectedSpcDay === day.id ? 'chip active' : 'chip'}
                    onClick={() => setSelectedSpcDay(day.id)}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            ) : null}

            {activeLayer === 'Forecast' && activeForecastOverlay === 'Winter' ? (
              <>
                <div className="chip-group" aria-label="Winter outlook product">
                  {winterProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className={
                        selectedWinterProduct === product.id ? 'chip active' : 'chip'
                      }
                      onClick={() => setSelectedWinterProduct(product.id)}
                    >
                      {product.label}
                    </button>
                  ))}
                </div>
                <div className="chip-group" aria-label="Winter outlook day">
                  {winterDays.map((day) => (
                    <button
                      key={day.id}
                      type="button"
                      className={selectedWinterDay === day.id ? 'chip active' : 'chip'}
                      onClick={() => setSelectedWinterDay(day.id)}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
                </div>
              </div>
            </div>

            <div className="map-floating map-floating-top-right">
              <div className="timestamp-card map-glass">
              <span className="timestamp-label">Viewing</span>
              <strong>{viewingLabel}</strong>
              <span>{statusPrimary}</span>
              {statusSecondary ? <span className="source-note">{statusSecondary}</span> : null}
              {activeLayer === 'Radar' && radarView === 'local' ? (
                <div className="station-mode-row">
                  <span className="source-note">
                    {selectedRadarSiteId ? 'Station mode: manual pick' : 'Station mode: nearest'}
                  </span>
                  <button
                    type="button"
                    className="inline-action"
                    disabled={!selectedRadarSiteId}
                    onClick={() => {
                      setSelectedRadarSiteId(null)
                      setSelectedLocalRadarFrameIndex(0)
                      setFollowLatestFrame(true)
                      setLocalPlaybackRunning(false)
                    }}
                  >
                    Use nearest
                  </button>
                </div>
              ) : null}
              {activeLayer === 'Radar' && radarView === 'local' ? (
                <span className="source-note">
                  {nexradStormTracksError
                    ? 'NEXRAD storm tracks unavailable'
                    : nexradStormTracks.length > 0
                      ? `${nexradStormTracks.length} NEXRAD storm track${
                          nexradStormTracks.length === 1 ? '' : 's'
                        } observed ${formatStormTrackObservedAt(
                          nexradStormTracksObservedAt,
                        )}; includes cell motion and 15-minute forecast positions`
                      : 'No NEXRAD storm tracks in the current local radar product'}
                </span>
              ) : null}
              <button
                type="button"
                className="inline-action"
                onClick={() => setMapRefreshKey((current) => current + 1)}
              >
                Refresh map
              </button>
            </div>
            </div>

            <div className="map-floating map-floating-bottom-left">
            <div className="track-bar map-glass">
            <div className="track-bar-main">
              <div className="track-bar-title">
                <p className="card-label">Storm Track</p>
                <strong>
                  {stormTrackOrigin && stormTrackEnd
                    ? `${Math.round(stormTrackDistanceMiles)} mi in ${formatEtaDuration(stormTrackTravelMinutes)}`
                    : stormTrackOrigin
                      ? 'Set the end of motion on the map'
                      : 'Place a storm point to begin'}
                </strong>
                <span className="source-note">
                  {trackToolEnabled
                    ? stormTrackOrigin
                      ? 'Drag or click from the storm point to set motion.'
                      : 'Click the map to place the storm location.'
                    : 'Turn on Track ETA to place a storm point and estimate arrival times.'}
                </span>
                {stormTrackHeading ? (
                  <div className="track-metadata">
                    <span className="badge calm">
                      Heading {stormTrackHeading.cardinal} ({stormTrackHeading.bearingLabel})
                    </span>
                    <span className="badge calm">
                      Distance {Math.round(stormTrackDistanceMiles)} mi
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="track-bar-actions">
                <button
                  type="button"
                  className={trackToolEnabled ? 'chip active' : 'chip'}
                  onClick={() => setTrackToolEnabled((current) => !current)}
                >
                  {trackToolEnabled ? 'Track ETA On' : 'Track ETA'}
                </button>
                <button
                  type="button"
                  className="inline-action"
                  disabled={!stormTrackOrigin && !stormTrackEnd}
                  onClick={() => {
                    setStormTrackOrigin(null)
                    setStormTrackEnd(null)
                    setStormTrackResetKey((current) => current + 1)
                  }}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="track-bar-controls">
              <label className="slider-row">
                <span>Speed</span>
                <strong>{stormTrackSpeedMph} mph</strong>
              </label>
              <input
                type="range"
                min="5"
                max="80"
                step="5"
                value={stormTrackSpeedMph}
                onChange={(event) => setStormTrackSpeedMph(Number(event.target.value))}
              />
              {stormTrackSpeedPresets.length > 0 ? (
                <div className="chip-group" aria-label="Storm motion presets">
                  {stormTrackSpeedPresets.map((preset) => (
                    <button
                      key={preset.speedMph}
                      type="button"
                      className={
                        stormTrackSpeedMph === preset.speedMph ? 'chip active' : 'chip'
                      }
                      onClick={() => setStormTrackSpeedMph(preset.speedMph)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {stormTrackPlacesLoading ? (
              <p className="source-note">Finding towns along the track...</p>
            ) : null}

            {stormTrackArrivals.length > 0 ? (
              <div className="track-arrivals">
                {stormTrackArrivals.map((arrival) => (
                  <span key={arrival.label} className="badge calm">
                    {arrival.label}: {arrival.etaLabel}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
            </div>

            <div className="map-floating map-floating-bottom-center">
              <footer className="timeline-panel map-glass">
              <div className="timeline-header">
                <p className="eyebrow">
                  {activeLayer === 'Radar' && radarView === 'future'
                    ? 'Forecast Playback'
                    : 'Playback'}
                </p>
                <h3>{activePlaybackLabel}</h3>
              </div>

              <div className="timeline-controls">
                {activeLayer === 'Radar' && radarView === 'future' ? (
                  <span className="source-note">
                    HRRR forecast hours from the latest model run
                  </span>
                ) : (
                  <div className="chip-group" aria-label="Playback range">
                    {playbackWindows.map((windowOption) => (
                      <button
                        key={windowOption.id}
                        type="button"
                        className={
                          playbackWindowMinutes === windowOption.id ? 'chip active' : 'chip'
                        }
                        onClick={() => setPlaybackWindowMinutes(windowOption.id)}
                      >
                        {windowOption.label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="chip-group" aria-label="Playback speed">
                  {playbackSpeeds.map((speed) => (
                    <button
                      key={speed.id}
                      type="button"
                      className={playbackSpeed === speed.id ? 'chip active' : 'chip'}
                      onClick={() => setPlaybackSpeed(speed.id)}
                    >
                      {speed.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="timeline-actions">
                <button
                  type="button"
                  className="timeline-action"
                  disabled={
                    activeLayer === 'Satellite'
                      ? activeSatelliteFrames.length < 2
                      : radarView === 'regional'
                        ? activeRegionalRadarFrames.length < 2
                        : radarView === 'future'
                          ? activeFutureRadarFrames.length < 2
                          : activeLocalRadarFrames.length < 2
                  }
                  onClick={() => {
                    if (activeLayer === 'Satellite') {
                      if (
                        followLatestSatelliteFrame &&
                        activeSatelliteFrames.length > 1
                      ) {
                        setSelectedSatelliteFrameIndex(0)
                      }

                      setFollowLatestSatelliteFrame(false)
                      setSatellitePlaybackRunning((current) => !current)
                      return
                    }

                    if (radarView === 'regional') {
                      if (
                        followLatestRegionalFrame &&
                        activeRegionalRadarFrames.length > 1
                      ) {
                        setSelectedRegionalRadarFrameIndex(0)
                      }

                      setFollowLatestRegionalFrame(false)
                      setRegionalPlaybackRunning((current) => !current)
                      return
                    }

                    if (radarView === 'future') {
                      if (activeFutureRadarFrames.length > 1) {
                        setSelectedFutureRadarFrameIndex(0)
                      }

                      setFuturePlaybackRunning((current) => !current)
                      return
                    }

                    if (followLatestFrame && activeLocalRadarFrames.length > 1) {
                      setSelectedLocalRadarFrameIndex(0)
                    }

                    setFollowLatestFrame(false)
                    setLocalPlaybackRunning((current) => !current)
                  }}
                >
                  {activeLayer === 'Satellite'
                    ? satellitePlaybackRunning
                      ? 'Pause'
                      : 'Play'
                    : radarView === 'regional'
                      ? regionalPlaybackRunning
                        ? 'Pause'
                        : 'Play'
                      : radarView === 'future'
                        ? futurePlaybackRunning
                          ? 'Pause'
                          : 'Play'
                      : localPlaybackRunning
                        ? 'Pause'
                        : 'Play'}
                </button>
                <button
                  type="button"
                  className="timeline-action"
                  disabled={
                    activeLayer === 'Satellite'
                      ? activeSatelliteFrames.length === 0
                      : radarView === 'regional'
                        ? activeRegionalRadarFrames.length === 0
                        : radarView === 'future'
                          ? activeFutureRadarFrames.length === 0
                          : activeLocalRadarFrames.length === 0
                  }
                  onClick={() => {
                    if (activeLayer === 'Satellite') {
                      setSatellitePlaybackRunning(false)
                      setFollowLatestSatelliteFrame(true)
                      setSelectedSatelliteFrameIndex(
                        Math.max(activeSatelliteFrames.length - 1, 0),
                      )
                      return
                    }

                    if (radarView === 'regional') {
                      setRegionalPlaybackRunning(false)
                      setFollowLatestRegionalFrame(true)
                      setSelectedRegionalRadarFrameIndex(
                        Math.max(activeRegionalRadarFrames.length - 1, 0),
                      )
                      return
                    }

                    if (radarView === 'future') {
                      setFuturePlaybackRunning(false)
                      setSelectedFutureRadarFrameIndex(0)
                      return
                    }

                    setLocalPlaybackRunning(false)
                    setFollowLatestFrame(true)
                    setSelectedLocalRadarFrameIndex(
                      Math.max(activeLocalRadarFrames.length - 1, 0),
                    )
                  }}
                >
                  {activeLayer === 'Radar' && radarView === 'future' ? 'Run start' : 'Live'}
                </button>
              </div>

              <div className="timeline-scrubber">
                <span className="timeline-edge">
                  {currentTimelineFrames.length > 1
                    ? formatFrameLabel(currentTimelineFrames[0])
                    : 'Start'}
                </span>
                <input
                  type="range"
                  className="timeline-slider"
                  min={0}
                  max={Math.max(currentTimelineFrames.length - 1, 0)}
                  step={1}
                  value={Math.min(activePlaybackIndex, Math.max(currentTimelineFrames.length - 1, 0))}
                  disabled={currentTimelineFrames.length === 0}
                  onChange={(event) => {
                    const index = Number(event.target.value)

                    if (activeLayer === 'Satellite' && activeSatelliteFrames.length > 0) {
                      setSatellitePlaybackRunning(false)
                      setFollowLatestSatelliteFrame(
                        index === activeSatelliteFrames.length - 1,
                      )
                      setSelectedSatelliteFrameIndex(index)
                      return
                    }

                    if (radarView === 'regional' && activeRegionalRadarFrames.length > 0) {
                      setRegionalPlaybackRunning(false)
                      setFollowLatestRegionalFrame(
                        index === activeRegionalRadarFrames.length - 1,
                      )
                      setSelectedRegionalRadarFrameIndex(index)
                      return
                    }

                    if (radarView === 'future' && activeFutureRadarFrames.length > 0) {
                      setFuturePlaybackRunning(false)
                      setSelectedFutureRadarFrameIndex(index)
                      return
                    }

                    if (radarView === 'local' && activeLocalRadarFrames.length > 0) {
                      setLocalPlaybackRunning(false)
                      setFollowLatestFrame(
                        index === activeLocalRadarFrames.length - 1,
                      )
                      setSelectedLocalRadarFrameIndex(index)
                    }
                  }}
                />
                <span className="timeline-edge">
                  {currentTimelineFrames.length > 0
                    ? activeLayer === 'Radar' && radarView === 'future'
                      ? formatFrameLabel(
                          currentTimelineFrames[currentTimelineFrames.length - 1],
                        )
                      : 'Live'
                    : 'End'}
                </span>
              </div>
              </footer>
            </div>

            <div className="map-floating map-floating-bottom-right">
              <div className="version-pill map-glass">{appVersion}</div>
            </div>
          </div>
        </section>

        <aside className="details-panel">
          <section className="panel hero-panel">
            <div>
              <p className="eyebrow">Point</p>
              <h2>{weather.location.name}</h2>
              <p className="muted">
                {weather.location.office}
              </p>
              <p className="muted coordinate-label">
                {selectedCoordinates[1].toFixed(3)},{' '}
                {selectedCoordinates[0].toFixed(3)}
              </p>
              {activeRadarSite && radarView === 'local' ? (
                <p className="muted coordinate-label">
                  Local site: {activeRadarSite.id} ({activeRadarSite.name})
                </p>
              ) : null}
            </div>
            <div className="current-temp">
              <strong>{weather.current.temperature}</strong>
              <span>{weather.current.summary}</span>
            </div>
          </section>

          <section className="panel current-conditions-panel">
            <div className="panel-heading current-conditions-heading">
              <div>
                <p className="eyebrow">Current Conditions</p>
                <h3>Live at Selected Point</h3>
              </div>
              <span className="badge">{weather.current.lastUpdated}</span>
            </div>
            <div className="current-conditions-grid">
              <article className="current-condition-card">
                <p className="card-label">Feels Like</p>
                <strong>{weather.current.feelsLike}</strong>
              </article>
              <article className="current-condition-card">
                <p className="card-label">Dewpoint</p>
                <strong>{weather.current.dewpoint}</strong>
              </article>
              <article className="current-condition-card">
                <p className="card-label">Humidity</p>
                <strong>{weather.current.humidity}</strong>
              </article>
              <article className="current-condition-card">
                <p className="card-label">Wind</p>
                <strong>{weather.current.wind}</strong>
              </article>
              <article className="current-condition-card">
                <p className="card-label">Sky</p>
                <strong>{weather.current.sky}</strong>
              </article>
              <article className="current-condition-card">
                <p className="card-label">Precip</p>
                <strong>{weather.current.precip}</strong>
              </article>
            </div>
            <div className="sun-row">
              <span className="badge calm">Sunrise {weather.sun.sunrise}</span>
              <span className="badge calm">UV {weather.outdoor.uvIndex} ({weather.outdoor.uvRisk})</span>
              <span className="badge calm">AQI {weather.outdoor.airQuality} ({weather.outdoor.airQualityRisk})</span>
              <span className="badge calm">Sunset {weather.sun.sunset}</span>
            </div>
            <p className="source-note outdoor-source">
              Today max UV {weather.outdoor.uvMax} / {weather.outdoor.airQualityDetails} / {weather.outdoor.sourceLabel}
            </p>
          </section>

          <section className="panel side-panel">
            <div className="panel-heading side-panel-heading">
              <div className="chip-group" aria-label="Side panel tabs">
                <button
                  type="button"
                  className={sidePanelTab === 'forecast' ? 'chip active' : 'chip'}
                  onClick={() => setSidePanelTab('forecast')}
                >
                  Forecast
                </button>
                <button
                  type="button"
                  className={sidePanelTab === 'hazards' ? 'chip active' : 'chip'}
                  onClick={() => setSidePanelTab('hazards')}
                  style={sidePanelTab === 'hazards' ? selectedHazardChipStyle : undefined}
                >
                  Hazards
                </button>
                {extraStackedHazardAlerts.map((alert, index) => (
                  <button
                    key={alert.id}
                    type="button"
                    className="chip chip-stack"
                    style={buildAlertChipStyle(alert.accentColor)}
                    onClick={() => {
                      const matchingAlert = alertFeatures.find((feature) => feature.id === alert.id)

                      if (matchingAlert) {
                        const reorderedAlerts = [
                          alert,
                          ...stackedHazardAlerts.filter((item) => item.id !== alert.id),
                        ]

                        setSelectedHazard(
                          buildAlertSelection(matchingAlert, reorderedAlerts),
                        )
                        setSidePanelTab('hazards')
                      }
                    }}
                    title={alert.title}
                  >
                    +{index + 1}
                  </button>
                ))}
              </div>
              <span className={sidePanelTab === 'hazards' ? 'badge danger' : 'badge'}>
                {sidePanelTab === 'forecast'
                  ? source === 'live'
                    ? 'Live NWS'
                    : 'Fallback'
                  : `${nearbyAlerts.length} Nearby`}
              </span>
            </div>

            {sidePanelTab === 'forecast' ? (
              <div className="stack">
                {weather.nextHours.length > 0 ? (
                  <section className="hourly-strip">
                    <div className="panel-heading hourly-strip-heading">
                      <div>
                        <p className="eyebrow">Next 3 Hours</p>
                        <h3>Short-Term Outlook</h3>
                      </div>
                    </div>
                    <div className="hourly-grid">
                      {weather.nextHours.map((period) => (
                        <article className="hourly-card" key={period.label}>
                          <p className="card-label">{period.label}</p>
                          <strong>{period.temperature}</strong>
                          <p className="compact-copy">{period.condition}</p>
                          <div className="hourly-detail-list">
                            <span>Feels {period.feelsLike}</span>
                            <span>{period.wind}</span>
                            <span>{period.precip}</span>
                            {period.secondary ? <span>{period.secondary}</span> : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                <div className="forecast-grid compact-forecast-grid">
                  {weather.forecast.map((period) => (
                    <article className="forecast-card" key={period.name}>
                      <p className="card-label">{period.name}</p>
                      <strong>{period.temperature}</strong>
                      <p className="compact-copy">{period.summary}</p>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {error ? <p className="error-text">{error}</p> : null}

                <div className="stack">
                {selectedHazard ? (
                  <article className="hazard-card">
                    <div>
                      <p className="card-label">
                          {selectedHazard.source === 'alerts'
                            ? 'Selected alert'
                            : selectedHazard.source === 'spc'
                              ? 'Selected SPC area'
                              : selectedHazard.source === 'winter'
                                ? 'Selected winter area'
                                : 'Selected report'}
                      </p>
                        <strong>{selectedHazard.title}</strong>
                      </div>
                      <p className="compact-copy">{selectedHazard.subtitle}</p>
                      {selectedHazard.badges?.length ? (
                        <div className="hazard-badge-row">
                          {selectedHazard.badges.map((badge) => (
                            <span
                              key={`${badge.label}-${badge.value}`}
                              className={`badge ${badge.tone ?? 'calm'}`}
                            >
                              {badge.label}: {badge.value}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <p className="compact-copy">{selectedHazard.summary}</p>
                      {selectedHazard.body ? (
                        <div className="hazard-body">{selectedHazard.body}</div>
                      ) : null}
                      <div className="hazard-detail-list">
                        {selectedHazard.detailLines.map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                      </div>
                    </article>
                  ) : showSpotterReports && nearbyReports.length > 0 ? (
                    nearbyReports.map(({ report, distanceMiles, ageMinutes }) => (
                      <button
                        key={report.id}
                        type="button"
                        className="hazard-card hazard-button"
                        onClick={() =>
                          setSelectedHazard(buildLocalStormReportSelection(report))
                        }
                      >
                        <div>
                          <p className="card-label">
                            {Math.round(distanceMiles)} mi away
                          </p>
                          <strong>{report.eventType}</strong>
                        </div>
                        <p className="compact-copy">
                          {report.city || 'Unknown location'}, {report.state}
                        </p>
                        <p className="compact-copy">
                          {report.remark ||
                            (ageMinutes !== null
                              ? formatReportAge(ageMinutes)
                              : 'Recent local storm report')}
                        </p>
                      </button>
                    ))
                  ) : nearbyAlerts.length > 0 ? (
                    nearbyAlerts.map(({ alert, distanceMiles, containsPoint }) => (
                      <button
                        key={alert.id}
                        type="button"
                        className="hazard-card hazard-button"
                        onClick={() => setSelectedHazard(buildAlertSelection(alert))}
                      >
                        <div>
                          <p className="card-label">
                            {containsPoint
                              ? 'Affects selected point'
                              : `${Math.round(distanceMiles)} mi away`}
                          </p>
                          <strong>{alert.event}</strong>
                        </div>
                        <p className="compact-copy">{alert.headline}</p>
                      </button>
                    ))
                  ) : (
                    <article className="hazard-card">
                      <div>
                        <p className="card-label">Nearby alerts</p>
                        <strong>No active hazards within 70 miles</strong>
                      </div>
                      <p className="compact-copy">
                        {showSpotterReports
                          ? 'Nearby reports and active warning polygons will appear here.'
                          : 'Nearby warning and watch polygons will appear here.'}
                      </p>
                    </article>
                  )}
                </div>
              </>
            )}
          </section>

        </aside>
      </main>

    </div>
  )
}

export default App

function filterFramesToWindow(frames: string[], minutes: 30 | 60 | 120) {
  if (frames.length === 0) {
    return []
  }

  const latestFrame = frames[frames.length - 1]
  const latestTime = new Date(latestFrame).getTime()

  if (Number.isNaN(latestTime)) {
    return frames.slice(-18)
  }

  const threshold = latestTime - minutes * 60_000
  const filteredFrames = frames.filter((frame) => {
    const frameTime = new Date(frame).getTime()
    return !Number.isNaN(frameTime) && frameTime >= threshold
  })

  return filteredFrames.length > 0 ? filteredFrames : [latestFrame]
}

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function normalizeLayerOpacity(value: typeof defaultLayerOpacity) {
  return {
    radar: clampPercentage(value.radar, defaultLayerOpacity.radar),
    satellite: clampPercentage(value.satellite, defaultLayerOpacity.satellite),
    warnings: clampPercentage(value.warnings, defaultLayerOpacity.warnings),
    watches: clampPercentage(value.watches, defaultLayerOpacity.watches),
    polygons: clampPercentage(value.polygons, defaultLayerOpacity.polygons),
  }
}

function normalizeReportTypeFilters(value: ReportTypeFilters) {
  return {
    tornado: Boolean(value.tornado),
    hail: Boolean(value.hail),
    wind: Boolean(value.wind),
    flood: Boolean(value.flood),
    winter: Boolean(value.winter),
    rain: Boolean(value.rain),
    other: Boolean(value.other),
  }
}

function clampPercentage(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.max(0, Math.min(100, Math.round(value)))
}

function upsertFavoriteLocation(
  current: SavedLocation[],
  nextLocation: SavedLocation,
) {
  const exists = current.some(
    (location) =>
      location.label === nextLocation.label &&
      location.coordinates[0] === nextLocation.coordinates[0] &&
      location.coordinates[1] === nextLocation.coordinates[1],
  )

  if (exists) {
    return current
  }

  return [nextLocation, ...current].slice(0, 6)
}

function formatFrameLabel(frame: string) {
  const date = new Date(frame)

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatFrameTimestamp(frame: string) {
  const date = new Date(frame)

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatUtcRunHour(frame: string) {
  const date = new Date(frame)

  if (Number.isNaN(date.getTime())) {
    return 'unknown'
  }

  const day = date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const hour = String(date.getUTCHours()).padStart(2, '0')

  return `${day} ${hour}Z`
}

function getSpcRank(category: string) {
  switch (category) {
    case 'High':
      return 6
    case 'Moderate':
      return 5
    case 'Enhanced':
      return 4
    case 'Slight':
      return 3
    case 'Marginal':
      return 2
    case 'Thunderstorm':
      return 1
    default:
      return 0
  }
}

function getWinterRank(outlook: string) {
  if (outlook.startsWith('80%')) {
    return 4
  }
  if (outlook.startsWith('50%')) {
    return 3
  }
  if (outlook.startsWith('30%')) {
    return 2
  }
  if (outlook.startsWith('10%')) {
    return 1
  }
  return 0
}

function formatCompactHazardTimestamp(value: string) {
  if (value.length !== 12) {
    return 'Unavailable'
  }

  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6)) - 1
  const day = Number(value.slice(6, 8))
  const hour = Number(value.slice(8, 10))
  const minute = Number(value.slice(10, 12))
  const date = new Date(Date.UTC(year, month, day, hour, minute))

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function formatIsoHazardTimestamp(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Unavailable'
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function formatStormTrackObservedAt(value: string | null) {
  if (!value) {
    return 'time unavailable'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'time unavailable'
  }

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function buildAlertNarrative(description: string, instruction: string) {
  const parts = [description.trim(), instruction.trim()].filter(Boolean)
  return parts.join('\n\n')
}

function buildAlertBadges(severity: string, urgency: string) {
  return [
    {
      label: 'Severity',
      value: severity || 'Unknown',
      tone: isElevatedAlertValue(severity) ? 'danger' as const : 'calm' as const,
    },
    {
      label: 'Urgency',
      value: urgency || 'Unknown',
      tone: isElevatedAlertValue(urgency) ? 'danger' as const : 'calm' as const,
    },
  ]
}

function isElevatedAlertValue(value: string) {
  return ['Extreme', 'Severe', 'Immediate', 'Expected', 'Observed'].includes(value)
}

function getLatestStormTrackObservedAt(tracks: NexradStormTrackFeature[]) {
  return tracks.reduce<string | null>((latest, track) => {
    if (!latest) {
      return track.observedAt
    }

    return new Date(track.observedAt).getTime() > new Date(latest).getTime()
      ? track.observedAt
      : latest
  }, null)
}

function buildAlertSelection(
  alert: AlertFeature,
  relatedAlerts?: HazardSelection['relatedAlerts'],
): HazardSelection {
  return {
    source: 'alerts',
    title: alert.event,
    subtitle: alert.headline,
    summary: alert.areaDescription,
    accentColor: alert.fillColor,
    badges: buildAlertBadges(alert.severity, alert.urgency),
    body: buildAlertNarrative(alert.description, alert.instruction),
    detailLines: [
      ...(alert.effective
        ? [`Effective: ${formatIsoHazardTimestamp(alert.effective)}`]
        : []),
      ...(alert.expires
        ? [`Expires: ${formatIsoHazardTimestamp(alert.expires)}`]
        : []),
    ],
    relatedAlerts,
  }
}

function buildAlertChipStyle(accentColor?: string) {
  if (!accentColor) {
    return undefined
  }

  return {
    color: accentColor,
    borderColor: accentColor,
    background: `${accentColor}22`,
  }
}

function buildLocalStormReportSelection(
  report: LocalStormReportFeature,
): HazardSelection {
  return {
    source: 'lsr',
    title: report.eventType,
    subtitle: `${report.city || 'Unknown location'}, ${report.state}`,
    summary: report.remark || 'No report remark available.',
    detailLines: [
      `Reported: ${formatCompactHazardTimestamp(report.valid)}`,
      ...(report.ageMinutes !== null ? [`Age: ${formatReportAge(report.ageMinutes)}`] : []),
      `Source: ${report.source || 'Unknown'}`,
      ...(report.magnitude && report.magnitude !== 'None'
        ? [
            `Magnitude: ${report.magnitude}${
              report.qualifier ? ` (${report.qualifier})` : ''
            }`,
          ]
        : []),
      ...(report.qualifier && report.qualifier !== 'None'
        ? [`Qualifier: ${report.qualifier}`]
        : []),
      `County: ${report.county || 'Unknown'}`,
    ],
  }
}

function getNearbyAlerts(
  alerts: AlertFeature[],
  point: [number, number],
  maxMiles: number,
  geometryBounds: Map<string, GeometryBounds>,
) {
  return alerts
    .filter((alert) =>
      boundsCouldBeWithinMiles(geometryBounds.get(alert.id), point, maxMiles),
    )
    .map((alert) => {
      const containsPoint = geometryContainsPoint(alert.geometry, point)
      const distanceMiles = containsPoint
        ? 0
        : estimateGeometryDistanceMiles(alert.geometry, point)

      return {
        alert,
        containsPoint,
        distanceMiles,
      }
    })
    .filter(({ containsPoint, distanceMiles }) => containsPoint || distanceMiles <= maxMiles)
    .sort((left, right) => {
      if (left.containsPoint !== right.containsPoint) {
        return left.containsPoint ? -1 : 1
      }

      return left.distanceMiles - right.distanceMiles
    })
}

function buildAlertGeometryBounds(alerts: AlertFeature[]) {
  return new Map(
    alerts.map((alert) => [alert.id, calculateGeometryBounds(alert.geometry)]),
  )
}

function calculateGeometryBounds(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): GeometryBounds {
  const vertices =
    geometry.type === 'Polygon'
      ? geometry.coordinates.flat()
      : geometry.coordinates.flat(2)

  return vertices.reduce<GeometryBounds>(
    (bounds, [lon, lat]) => ({
      west: Math.min(bounds.west, lon),
      south: Math.min(bounds.south, lat),
      east: Math.max(bounds.east, lon),
      north: Math.max(bounds.north, lat),
    }),
    {
      west: Number.POSITIVE_INFINITY,
      south: Number.POSITIVE_INFINITY,
      east: Number.NEGATIVE_INFINITY,
      north: Number.NEGATIVE_INFINITY,
    },
  )
}

function boundsCouldBeWithinMiles(
  bounds: GeometryBounds | undefined,
  [lon, lat]: [number, number],
  miles: number,
) {
  if (!bounds) {
    return true
  }

  const latPadding = miles / 69
  const lonPadding = miles / Math.max(Math.cos((lat * Math.PI) / 180) * 69, 1)

  return (
    lon >= bounds.west - lonPadding &&
    lon <= bounds.east + lonPadding &&
    lat >= bounds.south - latPadding &&
    lat <= bounds.north + latPadding
  )
}

function getNearbyReports(
  reports: LocalStormReportFeature[],
  point: [number, number],
  maxMiles: number,
) {
  return reports
    .map((report) => ({
      report,
      distanceMiles: distanceBetweenMiles(point, report.coordinates),
      ageMinutes: report.ageMinutes,
    }))
    .filter(({ distanceMiles }) => distanceMiles <= maxMiles)
    .sort((left, right) => {
      if (left.distanceMiles !== right.distanceMiles) {
        return left.distanceMiles - right.distanceMiles
      }

      return (left.ageMinutes ?? Number.POSITIVE_INFINITY) -
        (right.ageMinutes ?? Number.POSITIVE_INFINITY)
    })
    .slice(0, 8)
}

function geometryContainsPoint(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  point: [number, number],
) {
  if (geometry.type === 'Polygon') {
    return polygonContainsPoint(geometry.coordinates, point)
  }

  return geometry.coordinates.some((polygon) => polygonContainsPoint(polygon, point))
}

function polygonContainsPoint(
  coordinates: number[][][],
  point: [number, number],
) {
  const [outerRing, ...holes] = coordinates

  if (!outerRing || !ringContainsPoint(outerRing, point)) {
    return false
  }

  return !holes.some((ring) => ringContainsPoint(ring, point))
}

function ringContainsPoint(ring: number[][], point: [number, number]) {
  const [x, y] = point
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function estimateGeometryDistanceMiles(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  point: [number, number],
) {
  const vertices =
    geometry.type === 'Polygon'
      ? geometry.coordinates.flat()
      : geometry.coordinates.flat(2)

  return vertices.reduce((closest, vertex) => {
    const candidate = distanceBetweenMiles(point, [vertex[0], vertex[1]])
    return Math.min(closest, candidate)
  }, Number.POSITIVE_INFINITY)
}

function describeAudibleAlertTypes(settings: AudibleAlertSettings) {
  const enabledTypes = [
    settings.warning ? 'warnings' : null,
    settings.watch ? 'watches' : null,
  ].filter(Boolean)

  if (enabledTypes.length === 0) {
    return 'alerts'
  }

  if (enabledTypes.length === 2) {
    return 'warnings and watches'
  }

  return enabledTypes[0] ?? 'alerts'
}

function formatReportAge(ageMinutes: number) {
  if (ageMinutes <= 1) {
    return 'just now'
  }

  if (ageMinutes < 60) {
    return `${ageMinutes} min ago`
  }

  const hours = Math.floor(ageMinutes / 60)
  const minutes = ageMinutes % 60

  if (minutes === 0) {
    return `${hours}h ago`
  }

  return `${hours}h ${minutes}m ago`
}

function buildStormTrackArrivals(
  places: Array<{
    label: string
    alongTrackMiles: number
  }>,
  speedMph: number,
): StormTrackArrival[] {
  const minimumSpacingMiles = Math.max((Math.max(speedMph, 5) / 60) * 10, 6)

  return places
    .sort((left, right) => left.alongTrackMiles - right.alongTrackMiles)
    .reduce<StormTrackArrival[]>((kept, place) => {
      const previous = kept[kept.length - 1]

      if (previous && place.alongTrackMiles - previous.distanceMiles < minimumSpacingMiles) {
        return kept
      }

      kept.push({
        label: place.label,
        etaLabel: formatEtaDuration(
          (place.alongTrackMiles / Math.max(speedMph, 1)) * 60,
        ),
        distanceMiles: place.alongTrackMiles,
      })

      return kept
    }, [])
    .slice(0, 6)
}

function buildStormTrackSpeedPresets(distanceMiles: number) {
  return stormTrackSpeedOptions.map((speedMph) => ({
    speedMph,
    label: `${speedMph} mph · ${formatEtaDuration((distanceMiles / speedMph) * 60)}`,
  }))
}

function describeTrackHeading(
  [startLon, startLat]: [number, number],
  [endLon, endLat]: [number, number],
) {
  const startLatRad = (startLat * Math.PI) / 180
  const endLatRad = (endLat * Math.PI) / 180
  const deltaLonRad = ((endLon - startLon) * Math.PI) / 180
  const y = Math.sin(deltaLonRad) * Math.cos(endLatRad)
  const x =
    Math.cos(startLatRad) * Math.sin(endLatRad) -
    Math.sin(startLatRad) * Math.cos(endLatRad) * Math.cos(deltaLonRad)
  const bearing = (Math.atan2(y, x) * 180) / Math.PI
  const normalizedBearing = (bearing + 360) % 360

  return {
    bearing: normalizedBearing,
    bearingLabel: `${Math.round(normalizedBearing)}°`,
    cardinal: formatCardinalDirection(normalizedBearing),
  }
}

function formatCardinalDirection(bearing: number) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const index = Math.round(bearing / 22.5) % 16
  return directions[index]
}

async function playAudibleAlertTone(tone: 'warning' | 'watch') {
  try {
    await invoke('play_alert_tone', { tone })
    return
  } catch {
    // Fall back to browser audio when the Tauri command is unavailable.
  }

  const audioContext = getSharedAlertAudioContext()

  if (!audioContext) {
    return
  }

  try {
    await ensureAlertAudioReady()

    const now = audioContext.currentTime
    const notes =
      tone === 'warning'
        ? [
            { frequency: 932, duration: 0.12, delay: 0 },
            { frequency: 1244, duration: 0.12, delay: 0.14 },
            { frequency: 932, duration: 0.12, delay: 0.28 },
            { frequency: 1244, duration: 0.2, delay: 0.42 },
          ]
        : [
            { frequency: 660, duration: 0.14, delay: 0 },
            { frequency: 784, duration: 0.18, delay: 0.18 },
          ]

    notes.forEach(({ frequency, duration, delay }) => {
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      const startTime = now + delay
      const endTime = startTime + duration

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, startTime)

      gainNode.gain.setValueAtTime(0.0001, startTime)
      gainNode.gain.exponentialRampToValueAtTime(0.15, startTime + 0.02)
      gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime)

      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      oscillator.start(startTime)
      oscillator.stop(endTime)
    })
  } catch {
    // Alert sounds should never interrupt the warning UI.
  }
}

const OpacitySlider = memo(function OpacitySlider({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (value: number) => void
}) {
  const [draftValue, setDraftValue] = useState(value)

  useEffect(() => {
    setDraftValue(value)
  }, [value])

  return (
    <>
      <label className="slider-row">
        <span>{label}</span>
        <strong>{draftValue}%</strong>
      </label>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={draftValue}
        onChange={(event) => setDraftValue(Number(event.target.value))}
        onMouseUp={(event) => onCommit(Number(event.currentTarget.value))}
        onTouchEnd={(event) => onCommit(Number(event.currentTarget.value))}
        onKeyUp={(event) => onCommit(Number(event.currentTarget.value))}
      />
    </>
  )
})

