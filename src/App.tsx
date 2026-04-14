import { useEffect, useState } from 'react'
import './App.css'
import { MapCanvas } from './components/MapCanvas'
import { useAlertPolygons } from './hooks/useAlertPolygons'
import { useLocalRadarTimeline } from './hooks/useLocalRadarTimeline'
import { useLocationWeather } from './hooks/useLocationWeather'
import { useNearestRadarSite } from './hooks/useNearestRadarSite'
import { useRadarSites } from './hooks/useRadarSites'
import { useRegionalRadarTimeline } from './hooks/useRegionalRadarTimeline'
import { useSatelliteTimeline } from './hooks/useSatelliteTimeline'
import { useSpcOutlookPolygons } from './hooks/useSpcOutlookPolygons'
import { useWinterOutlookPolygons } from './hooks/useWinterOutlookPolygons'
import { geocodeLocation } from './services/geocode'
import {
  defaultSatelliteLayers,
  type SatelliteLayerId,
} from './services/satellite'
import type { AlertFeature, HazardSelection } from './types/weather'

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
const defaultCoordinates: [number, number] = [-86.1581, 39.7684]
const regionalRadarProducts = [
  { id: 'base', label: 'Base Reflectivity' },
  { id: 'composite', label: 'Composite Reflectivity' },
] as const
const localRadarProducts = [
  { id: 'reflectivity', label: 'Local Reflectivity' },
  { id: 'velocity', label: 'Velocity' },
] as const
const radarViews = [
  { id: 'regional', label: 'Regional' },
  { id: 'local', label: 'Local' },
] as const
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
type ThemeMode = 'light' | 'dark'
const storageKeys = {
  homeLocation: 'radar-desktop:home-location',
  favoriteLocations: 'radar-desktop:favorite-locations',
  layerOpacity: 'radar-desktop:layer-opacity',
  alertTypeFilters: 'radar-desktop:alert-type-filters',
  themeMode: 'radar-desktop:theme-mode',
}
const defaultLayerOpacity = {
  radar: 78,
  satellite: 78,
  polygons: 24,
}
const defaultAlertTypeFilters: AlertTypeFilters = {
  warning: true,
  watch: true,
  advisory: true,
  statement: true,
}

function App() {
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
    readStoredJson(storageKeys.layerOpacity, defaultLayerOpacity),
  )
  const [alertTypeFilters, setAlertTypeFilters] = useState<AlertTypeFilters>(() =>
    readStoredJson(storageKeys.alertTypeFilters, defaultAlertTypeFilters),
  )
  const [activeLayer, setActiveLayer] =
    useState<(typeof primaryLayers)[number]>('Radar')
  const [radarProduct, setRadarProduct] =
    useState<
      | (typeof regionalRadarProducts)[number]['id']
      | (typeof localRadarProducts)[number]['id']
    >('base')
  const [radarView, setRadarView] =
    useState<(typeof radarViews)[number]['id']>('regional')
  const [selectedRegionalRadarFrameIndex, setSelectedRegionalRadarFrameIndex] =
    useState(0)
  const [regionalPlaybackRunning, setRegionalPlaybackRunning] = useState(false)
  const [followLatestRegionalFrame, setFollowLatestRegionalFrame] = useState(true)
  const [selectedRadarSiteId, setSelectedRadarSiteId] = useState<string | null>(null)
  const [selectedCoordinates, setSelectedCoordinates] =
    useState<[number, number]>(defaultCoordinates)
  const [shouldRecenterMap, setShouldRecenterMap] = useState(true)
  const [satelliteLayer, setSatelliteLayer] =
    useState<SatelliteLayerId>('infrared')
  const [selectedSatelliteFrameIndex, setSelectedSatelliteFrameIndex] = useState(0)
  const [satellitePlaybackRunning, setSatellitePlaybackRunning] = useState(false)
  const [followLatestSatelliteFrame, setFollowLatestSatelliteFrame] = useState(true)
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
  const [searchText, setSearchText] = useState('Indianapolis, IN')
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [showLocationMenu, setShowLocationMenu] = useState(false)
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
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
  } = useAlertPolygons()
  const {
    features: spcFeatures,
  } = useSpcOutlookPolygons(selectedSpcDay)
  const {
    features: winterFeatures = [],
  } = useWinterOutlookPolygons(selectedWinterProduct, selectedWinterDay)
  const {
    frames: regionalRadarFrames,
    loading: regionalRadarTimelineLoading,
    error: regionalRadarTimelineError,
  } = useRegionalRadarTimeline(radarProduct === 'composite' ? 'composite' : 'base')
  const {
    frames: satelliteFrames,
    loading: satelliteTimelineLoading,
    error: satelliteTimelineError,
  } = useSatelliteTimeline(satelliteLayer)

  const activeRadarProducts =
    radarView === 'regional' ? regionalRadarProducts : localRadarProducts
  const playbackIntervalMs =
    playbackSpeeds.find((speed) => speed.id === playbackSpeed)?.intervalMs ?? 650
  const activeLocalRadarFrames = filterFramesToWindow(
    localRadarFrames,
    playbackWindowMinutes,
  )
  const activeRegionalRadarFrames = filterFramesToWindow(
    regionalRadarFrames,
    playbackWindowMinutes,
  )
  const activeSatelliteFrames = filterFramesToWindow(
    satelliteFrames,
    playbackWindowMinutes,
  )
  const selectedRegionalRadarTime =
    radarView === 'regional' && activeRegionalRadarFrames.length > 0
      ? activeRegionalRadarFrames[
          Math.min(
            selectedRegionalRadarFrameIndex,
            activeRegionalRadarFrames.length - 1,
          )
        ]
      : null
  const selectedLocalRadarTime =
    radarView === 'local' && activeLocalRadarFrames.length > 0
      ? activeLocalRadarFrames[
          Math.min(selectedLocalRadarFrameIndex, activeLocalRadarFrames.length - 1)
        ]
      : null
  const selectedSatelliteTime =
    activeLayer === 'Satellite' && activeSatelliteFrames.length > 0
      ? activeSatelliteFrames[
          Math.min(selectedSatelliteFrameIndex, activeSatelliteFrames.length - 1)
        ]
      : null

  const currentTimelineFrames =
    activeLayer === 'Satellite'
      ? activeSatelliteFrames
      : radarView === 'regional'
        ? activeRegionalRadarFrames
        : activeLocalRadarFrames

  const activePlaybackIndex =
    activeLayer === 'Satellite' && activeSatelliteFrames.length > 0
      ? Math.min(selectedSatelliteFrameIndex, activeSatelliteFrames.length - 1)
      : radarView === 'regional' && activeRegionalRadarFrames.length > 0
        ? Math.min(
            selectedRegionalRadarFrameIndex,
            activeRegionalRadarFrames.length - 1,
          )
      : radarView === 'local' && activeLocalRadarFrames.length > 0
      ? Math.min(selectedLocalRadarFrameIndex, activeLocalRadarFrames.length - 1)
      : 0
  const activePlaybackLabel =
    currentTimelineFrames.length > 0
      ? activePlaybackIndex === currentTimelineFrames.length - 1
        ? 'Live'
        : formatFrameLabel(currentTimelineFrames[activePlaybackIndex])
      : playbackFrames[0]
  const visibleAlertFeatures = alertFeatures.filter(
    (feature) => alertTypeFilters[feature.alertType],
  )
  const nearbyAlerts = getNearbyAlerts(visibleAlertFeatures, selectedCoordinates, 70)
  const currentSavedLocation = {
    label: weather.location.name,
    coordinates: selectedCoordinates,
  } satisfies SavedLocation
  const viewingLabel =
    activeLayer === 'Radar'
      ? activeRadarProducts.find((product) => product.id === radarProduct)?.label ?? 'Radar'
      : activeLayer === 'Satellite'
        ? defaultSatelliteLayers.find((layer) => layer.id === satelliteLayer)?.label ??
          'Satellite'
        : activeForecastOverlay
  const statusPrimary =
    activeLayer === 'Radar'
      ? radarView === 'regional'
        ? selectedRegionalRadarTime
          ? formatFrameTimestamp(selectedRegionalRadarTime)
          : regionalRadarTimelineLoading
            ? 'Loading regional frames...'
            : regionalRadarTimelineError ?? 'Regional playback unavailable'
        : selectedLocalRadarTime
          ? formatFrameTimestamp(selectedLocalRadarTime)
          : localRadarTimelineLoading
            ? 'Loading local frames...'
            : localRadarTimelineError ?? 'Local playback unavailable'
      : activeLayer === 'Satellite'
        ? selectedSatelliteTime
          ? formatFrameTimestamp(selectedSatelliteTime)
          : satelliteTimelineLoading
            ? 'Loading GOES frames...'
            : satelliteTimelineError ?? 'Satellite playback unavailable'
        : activeForecastOverlay === 'SPC Storm Risk'
          ? `${spcFeatures.length} SPC polygons`
          : activeForecastOverlay === 'Winter'
            ? `${winterFeatures.length} WPC polygons`
            : `${visibleAlertFeatures.length} alert polygons`
  const statusSecondary =
    activeLayer === 'Radar'
      ? radarView === 'local'
        ? activeRadarSite
          ? `${selectedRadarSiteId ? 'Site' : 'Nearest'} ${activeRadarSite.id}`
          : nearestRadarLoading
            ? 'Resolving site...'
            : nearestRadarError ?? null
        : `${visibleAlertFeatures.length} alerts visible`
      : activeLayer === 'Satellite'
        ? `${visibleAlertFeatures.length} alerts visible`
        : activeForecastOverlay === 'SPC Storm Risk'
          ? `Day ${selectedSpcDay}`
          : activeForecastOverlay === 'Winter'
            ? `${selectedWinterProduct === 'snowfall' ? 'Snowfall' : 'Freezing Rain'} Day ${selectedWinterDay}`
            : `${visibleAlertFeatures.length} alerts visible`

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
    if (activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk') {
      const primarySpc = [...spcFeatures].sort(
        (left, right) => getSpcRank(right.category) - getSpcRank(left.category),
      )[0]

      setSelectedHazard(
        primarySpc
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
            },
      )
      return
    }

    if (activeLayer === 'Forecast' && activeForecastOverlay === 'Winter') {
      const primaryWinter = [...winterFeatures].sort(
        (left, right) => getWinterRank(right.outlook) - getWinterRank(left.outlook),
      )[0]

      setSelectedHazard(
        primaryWinter
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
            },
      )
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
      activeRegionalRadarFrames.length > 0
    ) {
      setSelectedRegionalRadarFrameIndex(activeRegionalRadarFrames.length - 1)
    }
  }, [activeRegionalRadarFrames.length, followLatestRegionalFrame, radarView])

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
      activeLocalRadarFrames.length > 0
    ) {
      setSelectedLocalRadarFrameIndex(activeLocalRadarFrames.length - 1)
    }
  }, [activeLocalRadarFrames.length, followLatestFrame, radarView])

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
      activeSatelliteFrames.length > 0 &&
      selectedSatelliteFrameIndex > activeSatelliteFrames.length - 1
    ) {
      setSelectedSatelliteFrameIndex(activeSatelliteFrames.length - 1)
    }
  }, [activeSatelliteFrames.length, selectedSatelliteFrameIndex])

  useEffect(() => {
    if (
      followLatestSatelliteFrame &&
      activeSatelliteFrames.length > 0
    ) {
      setSelectedSatelliteFrameIndex(activeSatelliteFrames.length - 1)
    }
  }, [activeSatelliteFrames.length, followLatestSatelliteFrame, satelliteLayer])

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

  async function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSearching(true)
    setSearchError(null)

    try {
      const result = await geocodeLocation(searchText)
      setSelectedCoordinates(result.coordinates)
      setShouldRecenterMap(true)
      setSelectedHazard(null)
      setSearchText(result.label)
      setSelectedRadarSiteId(null)
      setSelectedLocalRadarFrameIndex(0)
      setFollowLatestFrame(true)
      setLocalPlaybackRunning(false)
    } catch (searchError) {
      const message =
        searchError instanceof Error
          ? searchError.message
          : 'Location search failed.'
      setSearchError(message)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <p className="eyebrow">StormVector</p>
          <h1>Live weather workstation</h1>
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
              {searching ? 'Searching...' : 'Search'}
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
                Saved Places
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
                Settings
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
                    <p className="card-label">Layer opacity</p>
                    <div className="slider-group">
                      <label className="slider-row">
                        <span>Radar</span>
                        <strong>{layerOpacity.radar}%</strong>
                      </label>
                      <input
                        type="range"
                        min="20"
                        max="100"
                        value={layerOpacity.radar}
                        onChange={(event) =>
                          setLayerOpacity((current) => ({
                            ...current,
                            radar: Number(event.target.value),
                          }))
                        }
                      />
                    </div>
                    <div className="slider-group">
                      <label className="slider-row">
                        <span>Satellite</span>
                        <strong>{layerOpacity.satellite}%</strong>
                      </label>
                      <input
                        type="range"
                        min="20"
                        max="100"
                        value={layerOpacity.satellite}
                        onChange={(event) =>
                          setLayerOpacity((current) => ({
                            ...current,
                            satellite: Number(event.target.value),
                          }))
                        }
                      />
                    </div>
                    <div className="slider-group">
                      <label className="slider-row">
                        <span>Polygons</span>
                        <strong>{layerOpacity.polygons}%</strong>
                      </label>
                      <input
                        type="range"
                        min="8"
                        max="60"
                        value={layerOpacity.polygons}
                        onChange={(event) =>
                          setLayerOpacity((current) => ({
                            ...current,
                            polygons: Number(event.target.value),
                          }))
                        }
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
            <div className="map-toolbar">
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
                          setRadarProduct(view.id === 'regional' ? 'base' : 'reflectivity')
                          if (view.id === 'regional') {
                            setSelectedRadarSiteId(null)
                          }
                          setSelectedRegionalRadarFrameIndex(0)
                          setFollowLatestRegionalFrame(true)
                          setRegionalPlaybackRunning(false)
                          setSelectedLocalRadarFrameIndex(0)
                          setFollowLatestFrame(true)
                          setLocalPlaybackRunning(false)
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

            <div className="timestamp-card">
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
            </div>
          </div>

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
            polygonOpacity={layerOpacity.polygons / 100}
            selectedRegionalRadarTime={selectedRegionalRadarTime}
            selectedSatelliteTime={selectedSatelliteTime}
            radarSites={radarSites}
            nearestRadarSite={activeRadarSite}
            localRadarDefinition={localRadarDefinition}
            selectedRadarSiteId={selectedRadarSiteId}
            selectedLocalRadarTime={selectedLocalRadarTime}
            alertFeatures={visibleAlertFeatures}
            spcFeatures={spcFeatures}
            winterFeatures={winterFeatures}
            activeForecastOverlay={activeForecastOverlay}
            selectedSpcDay={selectedSpcDay}
            selectedWinterDay={selectedWinterDay}
            selectedWinterProduct={selectedWinterProduct}
            onHazardSelect={setSelectedHazard}
              onMapClick={(coordinates) => {
                setSelectedCoordinates(coordinates)
                setShouldRecenterMap(false)
                setSelectedHazard(null)
                setSelectedRadarSiteId(null)
              setSelectedLocalRadarFrameIndex(0)
              setFollowLatestFrame(true)
              setLocalPlaybackRunning(false)
              setSearchText(
                `${coordinates[1].toFixed(3)}, ${coordinates[0].toFixed(3)}`,
              )
              setSearchError(null)
            }}
            onRadarSiteSelect={(siteId) => {
              setSelectedRadarSiteId(siteId)
              setRadarView('local')
              setRadarProduct('reflectivity')
              setSelectedLocalRadarFrameIndex(0)
              setFollowLatestFrame(true)
              setLocalPlaybackRunning(false)
              setSearchError(null)
            }}
          />
        </section>

        <aside className="details-panel">
          <section className="panel hero-panel">
            <div>
              <p className="eyebrow">Location</p>
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

          <section className="panel">
            <div className="panel-heading">
              <h3>Forecast</h3>
              <span className="badge">
                {source === 'live' ? 'Live NWS' : 'Fallback data'}
              </span>
            </div>

            <div className="forecast-grid">
                {weather.forecast.map((period) => (
                  <article className="forecast-card" key={period.name}>
                    <p className="card-label">{period.name}</p>
                    <strong>{period.temperature}</strong>
                    <p className="compact-copy">{period.summary}</p>
                  </article>
                ))}
              </div>
          </section>

          <section className="panel">
              <div className="panel-heading">
                <h3>Hazards</h3>
                <span className="badge danger">{nearbyAlerts.length} Nearby</span>
              </div>

            {error ? <p className="error-text">{error}</p> : null}

            <div className="stack">
                {selectedHazard ? (
                  <article className="hazard-card">
                  <div>
                    <p className="card-label">
                      {selectedHazard.source === 'alerts'
                        ? 'Selected alert polygon'
                        : selectedHazard.source === 'spc'
                          ? 'Selected SPC polygon'
                          : 'Selected winter polygon'}
                    </p>
                    <strong>{selectedHazard.title}</strong>
                  </div>
                  <p className="compact-copy">{selectedHazard.subtitle}</p>
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
                ) : (
                  nearbyAlerts.length > 0 ? (
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
                        <p className="compact-copy">{alert.areaDescription}</p>
                      </button>
                    ))
                  ) : (
                    <article className="hazard-card">
                      <div>
                        <p className="card-label">Nearby alerts</p>
                        <strong>No active hazards within 70 miles</strong>
                      </div>
                      <p className="compact-copy">
                        Warning, watch, advisory, and statement polygons near the
                        selected forecast point will appear here until one is clicked.
                      </p>
                    </article>
                  )
                )}
              </div>
          </section>

        </aside>
      </main>

      <footer className="timeline-panel">
        <div className="timeline-header">
          <p className="eyebrow">Playback</p>
          <h3>{activePlaybackLabel}</h3>
        </div>

        <div className="timeline-controls">
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

              setLocalPlaybackRunning(false)
              setFollowLatestFrame(true)
              setSelectedLocalRadarFrameIndex(
                Math.max(activeLocalRadarFrames.length - 1, 0),
              )
            }}
          >
            Live
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
              ? 'Live'
              : 'End'}
          </span>
        </div>
      </footer>
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

function buildAlertNarrative(description: string, instruction: string) {
  const parts = [description.trim(), instruction.trim()].filter(Boolean)
  return parts.join('\n\n')
}

function buildAlertSelection(alert: AlertFeature): HazardSelection {
  return {
    source: 'alerts',
    title: alert.event,
    subtitle: alert.headline,
    summary: alert.areaDescription,
    body: buildAlertNarrative(alert.description, alert.instruction),
    detailLines: [
      `Severity: ${alert.severity}`,
      `Urgency: ${alert.urgency}`,
      ...(alert.effective
        ? [`Effective: ${formatIsoHazardTimestamp(alert.effective)}`]
        : []),
      ...(alert.expires
        ? [`Expires: ${formatIsoHazardTimestamp(alert.expires)}`]
        : []),
    ],
  }
}

function getNearbyAlerts(
  alerts: AlertFeature[],
  point: [number, number],
  maxMiles: number,
) {
  return alerts
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
  const [x, y] = point

  return coordinates.some((ring) => {
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
  })
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
