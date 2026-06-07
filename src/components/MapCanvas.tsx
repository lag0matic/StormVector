import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import maplibregl from 'maplibre-gl'
import {
  findNearestRadarSiteFromList,
  type RadarProductDefinition,
  type RadarSite,
} from '../services/radar'
import {
  buildFutureRadarImageUrl,
  type FutureRadarFrame,
} from '../services/futureRadar'
import {
  buildSatelliteImageUrl,
  type SatelliteLayerId,
} from '../services/satellite'
import type {
  AlertFeature,
  HazardSelection,
  LightningActivityFeature,
  LocalStormReportFeature,
  NexradStormTrackFeature,
  SpcOutlookFeature,
  WinterOutlookFeature,
} from '../types/weather'
import { distanceBetweenMiles } from '../utils/geo'
import { formatEtaDuration } from '../utils/time'

type MapCanvasProps = {
  center: [number, number]
  shouldRecenterMap: boolean
  themeMode: 'light' | 'dark'
  activeLayer: string
  radarProduct: 'base' | 'composite' | 'reflectivity' | 'velocity' | 'hrrr-reflectivity'
  radarView: 'regional' | 'local' | 'future'
  satelliteLayer: SatelliteLayerId
  radarOpacity: number
  satelliteOpacity: number
  warningOpacity: number
  watchOpacity: number
  polygonOpacity: number
  lightningOpacity: number
  selectedRegionalRadarTime: string | null
  selectedFutureRadarFrame: FutureRadarFrame | null
  selectedSatelliteTime: string | null
  radarSites: RadarSite[]
  nearestRadarSite: RadarSite | null
  localRadarDefinition: RadarProductDefinition | null
  selectedRadarSiteId: string | null
  selectedLocalRadarTime: string | null
  alertFeatures: AlertFeature[]
  alertTypeFilters: {
    warning: boolean
    watch: boolean
    advisory: boolean
    statement: boolean
  }
  localStormReports: LocalStormReportFeature[]
  showSpotterReports: boolean
  lightningActivity: LightningActivityFeature[]
  showLightningActivity: boolean
  nexradStormTracks: NexradStormTrackFeature[]
  spcFeatures: SpcOutlookFeature[]
  winterFeatures: WinterOutlookFeature[]
  activeForecastOverlay: 'None' | 'SPC Storm Risk' | 'Winter'
  trackToolEnabled: boolean
  stormTrackOrigin: [number, number] | null
  stormTrackEnd: [number, number] | null
  stormTrackSpeedMph: number
  stormTrackResetKey: number
  mapRefreshKey: number
  onMapClick: (coordinates: [number, number]) => void
  onRadarSiteSelect: (siteId: string) => void
  onHazardSelect: (selection: HazardSelection) => void
  onStormTrackOriginSet: (coordinates: [number, number]) => void
  onStormTrackEndSet: (coordinates: [number, number]) => void
  onFutureRadarFrameLoad: (frameId: string) => void
  onFutureRadarFrameError: (frameId: string) => void
}

type ProjectedTrackLabel = {
  left: number
  top: number
  label: string
  kind: 'origin' | 'eta' | 'heading'
}

type ViewportSnapshot = {
  west: number
  south: number
  east: number
  north: number
  mercatorWest: number
  mercatorSouth: number
  mercatorEast: number
  mercatorNorth: number
  width: number
  height: number
}

type BufferedRasterFrame = {
  url: string
  frameKey: string
  viewport: ViewportSnapshot
}

type NativePinchZoomEvent = CustomEvent<{
  deltaY?: number
  scale?: number
  clientX: number
  clientY: number
}>

const lightBasemapSourceId = 'light-basemap'
const lightBasemapLayerId = 'light-basemap-layer'
const darkBasemapSourceId = 'dark-basemap'
const darkBasemapLayerId = 'dark-basemap-layer'
const regionalRadarSourceId = 'regional-radar-source'
const regionalRadarLayerId = 'regional-radar-layer'
const localRadarSourceId = 'local-radar-source'
const localRadarLayerId = 'local-radar-layer'
const futureRadarSourceId = 'future-radar-source'
const futureRadarLayerId = 'future-radar-layer'
const radarSitesSourceId = 'nws-radar-sites'
const radarSitesLayerId = 'nws-radar-sites-layer'
const selectedRadarSiteLayerId = 'nws-selected-radar-site-layer'
const radarSiteIconId = 'radar-site-icon'
const alertPolygonsSourceId = 'nws-alert-polygons'
const alertPolygonsFillLayerId = 'nws-alert-polygons-fill'
const alertPolygonsLineLayerId = 'nws-alert-polygons-line'
const spcPolygonsSourceId = 'spc-outlook-polygons'
const spcPolygonsFillLayerId = 'spc-outlook-polygons-fill'
const spcPolygonsLineLayerId = 'spc-outlook-polygons-line'
const winterPolygonsSourceId = 'winter-outlook-polygons'
const winterPolygonsFillLayerId = 'winter-outlook-polygons-fill'
const winterPolygonsLineLayerId = 'winter-outlook-polygons-line'
const localStormReportsSourceId = 'local-storm-reports'
const localStormReportsLayerId = 'local-storm-reports-layer'
const lightningActivitySourceId = 'lightning-activity'
const lightningActivityLayerId = 'lightning-activity-layer'
const lightningActivityHaloLayerId = 'lightning-activity-halo-layer'
const lightningActivityIconPrefix = 'lightning-activity-icon-'
const nexradStormTracksSourceId = 'nexrad-storm-tracks'
const nexradStormTracksLineLayerId = 'nexrad-storm-tracks-line'
const nexradStormTracksPointLayerId = 'nexrad-storm-tracks-point'
const nexradStormTracksLabelLayerId = 'nexrad-storm-tracks-label'
const stormTrackSourceId = 'storm-track-source'
const stormTrackLineLayerId = 'storm-track-line'
const stormTrackPointLayerId = 'storm-track-point'
const clickTolerancePixels = 6
const nativePinchZoomScaleRate = 0.35
const nativePinchWheelRate = 0.03
const maxNativePinchZoomDelta = 0.18

export const MapCanvas = memo(function MapCanvas({
  center,
  shouldRecenterMap,
  themeMode,
  activeLayer,
  radarProduct,
  radarView,
  satelliteLayer,
  radarOpacity,
  satelliteOpacity,
  warningOpacity,
  watchOpacity,
  polygonOpacity,
  lightningOpacity,
  selectedRegionalRadarTime,
  selectedFutureRadarFrame,
  selectedSatelliteTime,
  radarSites,
  nearestRadarSite,
  localRadarDefinition,
  selectedRadarSiteId,
  selectedLocalRadarTime,
  alertFeatures,
  alertTypeFilters,
  localStormReports,
  showSpotterReports,
  lightningActivity,
  showLightningActivity,
  nexradStormTracks,
  spcFeatures,
  winterFeatures = [],
  activeForecastOverlay,
  trackToolEnabled,
  stormTrackOrigin,
  stormTrackEnd,
  stormTrackSpeedMph,
  stormTrackResetKey,
  mapRefreshKey,
  onMapClick,
  onRadarSiteSelect,
  onHazardSelect,
  onStormTrackOriginSet,
  onStormTrackEndSet,
  onFutureRadarFrameLoad,
  onFutureRadarFrameError,
}: MapCanvasProps) {
  const [requestViewport, setRequestViewport] = useState<ViewportSnapshot | null>(
    null,
  )
  const [projectedTrackLabels, setProjectedTrackLabels] = useState<
    ProjectedTrackLabel[]
  >([])
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const radarPopupRef = useRef<maplibregl.Popup | null>(null)
  const alertPopupRef = useRef<maplibregl.Popup | null>(null)
  const pointerDownPointRef = useRef<{ x: number; y: number } | null>(null)
  const onMapClickRef = useRef(onMapClick)
  const onRadarSiteSelectRef = useRef(onRadarSiteSelect)
  const onHazardSelectRef = useRef(onHazardSelect)
  const activeLayerRef = useRef(activeLayer)
  const activeForecastOverlayRef = useRef(activeForecastOverlay)
  const radarViewRef = useRef(radarView)
  const stormTrackDragRef = useRef(false)
  const stormTrackPreviewEndRef = useRef<[number, number] | null>(null)
  const regionalRadarSignatureRef = useRef<string | null>(null)
  const localRadarSignatureRef = useRef<string | null>(null)
  const futureRadarSignatureRef = useRef<string | null>(null)
  const onStormTrackOriginSetRef = useRef(onStormTrackOriginSet)
  const onStormTrackEndSetRef = useRef(onStormTrackEndSet)
  const trackToolEnabledRef = useRef(trackToolEnabled)
  const stormTrackOriginRef = useRef(stormTrackOrigin)
  const stormTrackEndRef = useRef(stormTrackEnd)
  const stormTrackSpeedRef = useRef(stormTrackSpeedMph)
  const alertTypeFiltersRef = useRef(alertTypeFilters)
  const showSpotterReportsRef = useRef(showSpotterReports)
  const initialCenterRef = useRef(center)
  const initialThemeModeRef = useRef(themeMode)

  useEffect(() => {
    onMapClickRef.current = onMapClick
    onRadarSiteSelectRef.current = onRadarSiteSelect
    onHazardSelectRef.current = onHazardSelect
    onStormTrackOriginSetRef.current = onStormTrackOriginSet
    onStormTrackEndSetRef.current = onStormTrackEndSet
    activeLayerRef.current = activeLayer
    activeForecastOverlayRef.current = activeForecastOverlay
    radarViewRef.current = radarView
    trackToolEnabledRef.current = trackToolEnabled
    stormTrackOriginRef.current = stormTrackOrigin
    stormTrackEndRef.current = stormTrackEnd
    stormTrackSpeedRef.current = stormTrackSpeedMph
    alertTypeFiltersRef.current = alertTypeFilters
    showSpotterReportsRef.current = showSpotterReports
  }, [
    activeForecastOverlay,
    activeLayer,
    alertTypeFilters,
    onHazardSelect,
    onMapClick,
    onRadarSiteSelect,
    onStormTrackEndSet,
    onStormTrackOriginSet,
    radarView,
    stormTrackEnd,
    stormTrackOrigin,
    stormTrackSpeedMph,
    showSpotterReports,
    trackToolEnabled,
  ])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          [lightBasemapSourceId]: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
          [darkBasemapSourceId]: {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
          },
        },
        layers: [
          {
            id: lightBasemapLayerId,
            type: 'raster',
            source: lightBasemapSourceId,
            layout: {
              visibility: initialThemeModeRef.current === 'light' ? 'visible' : 'none',
            },
          },
          {
            id: darkBasemapLayerId,
            type: 'raster',
            source: darkBasemapSourceId,
            layout: {
              visibility: initialThemeModeRef.current === 'dark' ? 'visible' : 'none',
            },
          },
        ],
      },
      center: initialCenterRef.current,
      zoom: 5.25,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
      }),
      'bottom-right',
    )
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    map.getCanvas().addEventListener('contextmenu', (event) => {
      event.preventDefault()
    })
    const handleNativePinchZoom = (event: Event) => {
      const { clientX, clientY, deltaY, scale } = (event as NativePinchZoomEvent).detail
      const containerBounds = containerRef.current?.getBoundingClientRect()
      if (
        !containerBounds ||
        clientX < containerBounds.left ||
        clientX > containerBounds.right ||
        clientY < containerBounds.top ||
        clientY > containerBounds.bottom
      ) {
        return
      }

      const zoomDelta =
        typeof scale === 'number'
          ? clamp(
              Math.log2(scale) * nativePinchZoomScaleRate,
              -maxNativePinchZoomDelta,
              maxNativePinchZoomDelta,
            )
          : clamp(
              -(deltaY ?? 0) * nativePinchWheelRate,
              -maxNativePinchZoomDelta,
              maxNativePinchZoomDelta,
            )
      if (zoomDelta === 0) {
        return
      }

      const point = new maplibregl.Point(
        clientX - containerBounds.left,
        clientY - containerBounds.top,
      )
      map.zoomTo(map.getZoom() + zoomDelta, {
        around: map.unproject(point),
        duration: 0,
      })
    }

    window.addEventListener('stormvector:native-pinch-zoom', handleNativePinchZoom)
    map.on('mousedown', (event) => {
      if (event.originalEvent.button !== 0) {
        pointerDownPointRef.current = null
        return
      }

      pointerDownPointRef.current = {
        x: event.point.x,
        y: event.point.y,
      }
    })
    map.on('mousemove', (event) => {
      const activeStormTrackOrigin = stormTrackOriginRef.current

      if (!stormTrackDragRef.current || !activeStormTrackOrigin) {
        return
      }

      stormTrackPreviewEndRef.current = [event.lngLat.lng, event.lngLat.lat]
      syncStormTrackSource(
        map,
        activeStormTrackOrigin,
        stormTrackPreviewEndRef.current,
        buildImmediateStormTrackMarkers(
          activeStormTrackOrigin,
          stormTrackPreviewEndRef.current,
          stormTrackSpeedRef.current,
        ),
      )
    })
    map.on('mouseup', () => {
      const activeStormTrackOrigin = stormTrackOriginRef.current

      if (
        !stormTrackDragRef.current ||
        !stormTrackPreviewEndRef.current ||
        !activeStormTrackOrigin
      ) {
        return
      }

      stormTrackDragRef.current = false
      map.dragPan.enable()

      const dragDistanceMiles = distanceBetweenMiles(
        activeStormTrackOrigin,
        stormTrackPreviewEndRef.current,
      )

      if (dragDistanceMiles < 1) {
        stormTrackPreviewEndRef.current = null
        return
      }

      syncStormTrackSource(
        map,
        activeStormTrackOrigin,
        stormTrackPreviewEndRef.current,
        buildImmediateStormTrackMarkers(
          activeStormTrackOrigin,
          stormTrackPreviewEndRef.current,
          stormTrackSpeedRef.current,
        ),
      )
      onStormTrackEndSetRef.current(stormTrackPreviewEndRef.current)
      stormTrackPreviewEndRef.current = null
    })
    map.on('click', (event) => {
      if (event.originalEvent.button !== 0) {
        pointerDownPointRef.current = null
        return
      }

      const pointerDownPoint = pointerDownPointRef.current
      pointerDownPointRef.current = null

      if (pointerDownPoint) {
        const deltaX = event.point.x - pointerDownPoint.x
        const deltaY = event.point.y - pointerDownPoint.y
        const distance = Math.sqrt(deltaX ** 2 + deltaY ** 2)

        if (distance > clickTolerancePixels) {
          return
        }
      }

      if (trackToolEnabledRef.current) {
        const trackPoint: [number, number] = [event.lngLat.lng, event.lngLat.lat]

        if (!stormTrackOriginRef.current) {
          onStormTrackOriginSetRef.current(trackPoint)
          return
        }

        // Once the origin is placed, the track endpoint should be created by
        // click-drag-release from the storm point rather than a second click.
        return
      }

        const hazardLayers = [
        ...(activeLayerRef.current === 'Radar' && showSpotterReportsRef.current
          ? [localStormReportsLayerId]
          : []),
      ]

      if (
        map.queryRenderedFeatures(event.point, { layers: hazardLayers }).length > 0
      ) {
        return
      }

      onMapClickRef.current([event.lngLat.lng, event.lngLat.lat])
    })
    radarPopupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      className: 'radar-site-popup',
    })
    alertPopupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: true,
      offset: 16,
      className: 'alert-popup',
    })
    markerRef.current = new maplibregl.Marker({
      color: '#00d4aa',
      scale: 1.1,
    })
      .setLngLat(initialCenterRef.current)
      .addTo(map)

    let viewportSyncFrame: number | null = null
    const syncRequestViewport = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      const snapshot = readViewportSnapshot(map)

      if (snapshot) {
        setRequestViewport(snapshot)
      }
    }
    const scheduleRequestViewportSync = () => {
      if (viewportSyncFrame !== null) {
        return
      }

      viewportSyncFrame = window.requestAnimationFrame(() => {
        viewportSyncFrame = null
        syncRequestViewport()
      })
    }

    map.on('load', scheduleRequestViewportSync)
    map.on('move', scheduleRequestViewportSync)
    map.on('moveend', scheduleRequestViewportSync)
    map.on('resize', scheduleRequestViewportSync)
    scheduleRequestViewportSync()

    mapRef.current = map
    setMapInstance(map)

    return () => {
      map.off('load', scheduleRequestViewportSync)
      map.off('move', scheduleRequestViewportSync)
      map.off('moveend', scheduleRequestViewportSync)
      map.off('resize', scheduleRequestViewportSync)
      if (viewportSyncFrame !== null) {
        window.cancelAnimationFrame(viewportSyncFrame)
      }
      radarPopupRef.current?.remove()
      radarPopupRef.current = null
      alertPopupRef.current?.remove()
      alertPopupRef.current = null
      markerRef.current?.remove()
      markerRef.current = null
      window.removeEventListener('stormvector:native-pinch-zoom', handleNativePinchZoom)
      setRequestViewport(null)
      setProjectedTrackLabels([])
      map.remove()
      mapRef.current = null
      setMapInstance(null)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const handleTrackMouseDown = (event: maplibregl.MapMouseEvent) => {
      if (!trackToolEnabledRef.current || event.originalEvent.button !== 0) {
        return
      }

      const targetPoint: [number, number] = [event.lngLat.lng, event.lngLat.lat]
      const activeStormTrackOrigin = stormTrackOriginRef.current ?? targetPoint

      if (!stormTrackOriginRef.current) {
        onStormTrackOriginSetRef.current(targetPoint)
      }

      if (
        stormTrackOriginRef.current &&
        distanceBetweenMiles(targetPoint, activeStormTrackOrigin) > 30
      ) {
        return
      }

      stormTrackDragRef.current = true
      stormTrackPreviewEndRef.current = activeStormTrackOrigin
      map.dragPan.disable()
    }

    map.on('mousedown', handleTrackMouseDown)

    return () => {
      map.off('mousedown', handleTrackMouseDown)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    setLayerVisibility(map, lightBasemapLayerId, themeMode === 'light')
    setLayerVisibility(map, darkBasemapLayerId, themeMode === 'dark')
  }, [themeMode])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const handleContextMenu = (event: maplibregl.MapMouseEvent) => {
      if (
        activeLayerRef.current !== 'Radar' ||
        radarViewRef.current !== 'local'
      ) {
        return
      }

      if (radarSites.length === 0) {
        return
      }

      const radarSiteLayers = getExistingLayerIds(map, [
        radarSitesLayerId,
        selectedRadarSiteLayerId,
      ])
      const radarSiteFeature =
        radarSiteLayers.length > 0
          ? map.queryRenderedFeatures(event.point, {
              layers: radarSiteLayers,
            })[0]
          : undefined

      const siteId = radarSiteFeature?.properties?.id

      if (typeof siteId === 'string') {
        onRadarSiteSelectRef.current(siteId)
        return
      }

      const nearestSite = findNearestRadarSiteFromList(
        [event.lngLat.lng, event.lngLat.lat],
        radarSites,
      )

      onRadarSiteSelectRef.current(nearestSite.id)
    }

    map.on('contextmenu', handleContextMenu)

    return () => {
      map.off('contextmenu', handleContextMenu)
    }
  }, [radarSites])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const collection = {
      type: 'FeatureCollection',
      features: radarSites.map((site) => ({
        type: 'Feature',
        properties: {
          id: site.id,
          name: site.name,
          lon: site.coordinates[0],
          lat: site.coordinates[1],
          selected: site.id === selectedRadarSiteId,
        },
        geometry: {
          type: 'Point',
          coordinates: site.coordinates,
        },
      })),
    } as GeoJSON.FeatureCollection<GeoJSON.Point>

    const applySites = () => {
      addRadarSiteIcon(map)

      if (!hasSourceSafe(map, radarSitesSourceId)) {
        map.addSource(radarSitesSourceId, {
          type: 'geojson',
          data: collection,
        })

        map.addLayer({
          id: radarSitesLayerId,
          type: 'symbol',
          source: radarSitesSourceId,
          layout: {
            'icon-image': radarSiteIconId,
            'icon-size': 1.05,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: {
            'icon-opacity': 0.9,
          },
        })

        map.addLayer({
          id: selectedRadarSiteLayerId,
          type: 'symbol',
          source: radarSitesSourceId,
          filter: ['==', ['get', 'id'], selectedRadarSiteId ?? ''],
          layout: {
            'icon-image': radarSiteIconId,
            'icon-size': 1.35,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: {
            'icon-opacity': 1,
          },
        })
      } else {
        const source = getSourceSafe<maplibregl.GeoJSONSource>(map, radarSitesSourceId)
        source?.setData(collection)
      }

      if (hasLayerSafe(map, selectedRadarSiteLayerId)) {
        map.setFilter(selectedRadarSiteLayerId, [
          '==',
          ['get', 'id'],
          selectedRadarSiteId ?? '',
        ])
      }

      const visibility =
        activeLayer === 'Radar' && radarView === 'local' ? 'visible' : 'none'
      setLayoutPropertySafe(map, radarSitesLayerId, 'visibility', visibility)
      setLayoutPropertySafe(map, selectedRadarSiteLayerId, 'visibility', visibility)
      nudgeMapRender(map)
    }

    return runWhenStyleLoaded(map, applySites)
  }, [activeLayer, radarSites, radarView, selectedRadarSiteId])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const collection: GeoJSON.FeatureCollection<
      GeoJSON.Polygon | GeoJSON.MultiPolygon
    > = {
      type: 'FeatureCollection',
      features: alertFeatures.map((feature) => ({
        type: 'Feature',
        properties: {
          id: feature.id,
          alertType: feature.alertType,
          event: feature.event,
          headline: feature.headline,
          description: feature.description,
          instruction: feature.instruction,
          effective: feature.effective,
          expires: feature.expires,
          severity: feature.severity,
          urgency: feature.urgency,
          areaDescription: feature.areaDescription,
          fillColor: feature.fillColor,
          lineColor: feature.lineColor,
        },
        geometry: feature.geometry,
      })),
    }

    const applyAlertPolygons = () => {
      const nextFilter = buildAlertTypeFilter(alertTypeFiltersRef.current)

      if (!hasSourceSafe(map, alertPolygonsSourceId)) {
        map.addSource(alertPolygonsSourceId, {
          type: 'geojson',
          data: collection,
        })

        map.addLayer({
          id: alertPolygonsFillLayerId,
          type: 'fill',
          source: alertPolygonsSourceId,
          paint: {
            'fill-color': ['get', 'fillColor'],
            'fill-opacity': [
              'match',
              ['get', 'alertType'],
              'warning',
              warningOpacity,
              'watch',
              watchOpacity,
              polygonOpacity,
            ],
          },
        })

        map.addLayer({
          id: alertPolygonsLineLayerId,
          type: 'line',
          source: alertPolygonsSourceId,
          paint: {
            'line-color': ['get', 'lineColor'],
            'line-width': 2,
            'line-opacity': 0.9,
          },
        })
      } else {
        const source = getSourceSafe<maplibregl.GeoJSONSource>(map, alertPolygonsSourceId)
        source?.setData(collection)
      }

      const visibility = 'visible'
      setLayoutPropertySafe(map, alertPolygonsFillLayerId, 'visibility', visibility)
      setLayoutPropertySafe(map, alertPolygonsLineLayerId, 'visibility', visibility)
      setFilterSafe(map, alertPolygonsFillLayerId, nextFilter)
      setFilterSafe(map, alertPolygonsLineLayerId, nextFilter)
      nudgeMapRender(map)
    }

    return runWhenStyleLoaded(map, applyAlertPolygons)
  }, [alertFeatures, polygonOpacity, warningOpacity, watchOpacity])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const nextFilter = buildAlertTypeFilter(alertTypeFilters)

    setFilterSafe(map, alertPolygonsFillLayerId, nextFilter)
    setFilterSafe(map, alertPolygonsLineLayerId, nextFilter)
  }, [alertTypeFilters])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const collection: GeoJSON.FeatureCollection<
      GeoJSON.Polygon | GeoJSON.MultiPolygon
    > = {
      type: 'FeatureCollection',
      features: spcFeatures.map((feature) => ({
        type: 'Feature',
        properties: {
          id: feature.id,
          category: feature.category,
          valid: feature.valid,
          expire: feature.expire,
          fillColor: feature.fillColor,
          lineColor: feature.lineColor,
        },
        geometry: feature.geometry,
      })),
    }

    const applySpcPolygons = () => {
      if (!hasSourceSafe(map, spcPolygonsSourceId)) {
        map.addSource(spcPolygonsSourceId, {
          type: 'geojson',
          data: collection,
        })

        const beforeLayerId = hasLayerSafe(map, alertPolygonsFillLayerId)
          ? alertPolygonsFillLayerId
          : undefined

        map.addLayer(
          {
            id: spcPolygonsFillLayerId,
            type: 'fill',
            source: spcPolygonsSourceId,
            layout: {
              visibility: 'none',
            },
            paint: {
              'fill-color': ['get', 'fillColor'],
              'fill-opacity': polygonOpacity,
            },
          },
          beforeLayerId,
        )

        map.addLayer(
          {
            id: spcPolygonsLineLayerId,
            type: 'line',
            source: spcPolygonsSourceId,
            layout: {
              visibility: 'none',
            },
            paint: {
              'line-color': ['get', 'lineColor'],
              'line-width': 2,
              'line-opacity': 0.95,
            },
          },
          beforeLayerId,
        )
      } else {
        const source = getSourceSafe<maplibregl.GeoJSONSource>(map, spcPolygonsSourceId)
        source?.setData(collection)
      }

      const isVisible =
        activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk'
      setLayerVisibility(map, spcPolygonsFillLayerId, isVisible)
      setLayerVisibility(map, spcPolygonsLineLayerId, isVisible)
      setPaintPropertySafe(map, spcPolygonsFillLayerId, 'fill-opacity', polygonOpacity)
      nudgeMapRender(map)
    }

    return runWhenStyleLoaded(map, applySpcPolygons)
  }, [activeForecastOverlay, activeLayer, polygonOpacity, spcFeatures])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const collection: GeoJSON.FeatureCollection<
      GeoJSON.Polygon | GeoJSON.MultiPolygon
    > = {
      type: 'FeatureCollection',
      features: winterFeatures.map((feature) => ({
        type: 'Feature',
        properties: {
          id: feature.id,
          outlook: feature.outlook,
          snippet: feature.snippet,
          issueTime: feature.issueTime,
          validTime: feature.validTime,
          fillColor: feature.fillColor,
          lineColor: feature.lineColor,
        },
        geometry: feature.geometry,
      })),
    }

    const applyWinterPolygons = () => {
      if (!hasSourceSafe(map, winterPolygonsSourceId)) {
        map.addSource(winterPolygonsSourceId, {
          type: 'geojson',
          data: collection,
        })

        const beforeLayerId = hasLayerSafe(map, alertPolygonsFillLayerId)
          ? alertPolygonsFillLayerId
          : undefined

        map.addLayer(
          {
            id: winterPolygonsFillLayerId,
            type: 'fill',
            source: winterPolygonsSourceId,
            layout: {
              visibility: 'none',
            },
            paint: {
              'fill-color': ['get', 'fillColor'],
              'fill-opacity': polygonOpacity,
            },
          },
          beforeLayerId,
        )

        map.addLayer(
          {
            id: winterPolygonsLineLayerId,
            type: 'line',
            source: winterPolygonsSourceId,
            layout: {
              visibility: 'none',
            },
            paint: {
              'line-color': ['get', 'lineColor'],
              'line-width': 2,
              'line-opacity': 0.92,
            },
          },
          beforeLayerId,
        )
      } else {
        const source = getSourceSafe<maplibregl.GeoJSONSource>(
          map,
          winterPolygonsSourceId,
        )
        source?.setData(collection)
      }

      const isVisible =
        activeLayer === 'Forecast' && activeForecastOverlay === 'Winter'
      setLayerVisibility(map, winterPolygonsFillLayerId, isVisible)
      setLayerVisibility(map, winterPolygonsLineLayerId, isVisible)
      setPaintPropertySafe(
        map,
        winterPolygonsFillLayerId,
        'fill-opacity',
        polygonOpacity,
      )
      nudgeMapRender(map)
    }

    return runWhenStyleLoaded(map, applyWinterPolygons)
  }, [activeForecastOverlay, activeLayer, polygonOpacity, winterFeatures])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const collection: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: localStormReports.map((feature) => ({
        type: 'Feature',
        properties: {
          id: feature.id,
          eventType: feature.eventType,
          city: feature.city,
          county: feature.county,
          state: feature.state,
          source: feature.source,
          remark: feature.remark,
          magnitude: feature.magnitude,
          qualifier: feature.qualifier,
          valid: feature.valid,
          ageMinutes: feature.ageMinutes,
          fillColor: feature.fillColor,
          strokeColor: feature.strokeColor,
        },
        geometry: {
          type: 'Point',
          coordinates: feature.coordinates,
        },
      })),
    }

    const applyLocalStormReports = () => {
      if (!hasSourceSafe(map, localStormReportsSourceId)) {
        map.addSource(localStormReportsSourceId, {
          type: 'geojson',
          data: collection,
        })

        map.addLayer({
          id: localStormReportsLayerId,
          type: 'circle',
          source: localStormReportsSourceId,
          paint: {
            'circle-radius': 7,
            'circle-color': ['get', 'fillColor'],
            'circle-stroke-color': ['get', 'strokeColor'],
            'circle-stroke-width': 2.25,
            'circle-opacity': 0.98,
            'circle-blur': 0.1,
          },
        })
      } else {
        const source = getSourceSafe<maplibregl.GeoJSONSource>(
          map,
          localStormReportsSourceId,
        )
        source?.setData(collection)
      }

      setLayerVisibility(
        map,
        localStormReportsLayerId,
        activeLayer === 'Radar' && showSpotterReports,
      )
      nudgeMapRender(map)
    }

    return runWhenStyleLoaded(map, applyLocalStormReports)
  }, [activeLayer, localStormReports, showSpotterReports])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const collection: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: lightningActivity.map((feature) => ({
        type: 'Feature',
        properties: {
          id: feature.id,
          observedAt: feature.observedAt,
          intensity: feature.intensity,
          approxStrikes: feature.approxStrikes,
          icon: `${lightningActivityIconPrefix}${feature.intensity}`,
        },
        geometry: {
          type: 'Point',
          coordinates: feature.coordinates,
        },
      })),
    }

    const applyLightningActivity = () => {
      addLightningActivityIcons(map)

      if (!hasSourceSafe(map, lightningActivitySourceId)) {
        map.addSource(lightningActivitySourceId, {
          type: 'geojson',
          data: collection,
        })

        map.addLayer({
          id: lightningActivityHaloLayerId,
          type: 'circle',
          source: lightningActivitySourceId,
          paint: {
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              4,
              ['*', ['get', 'intensity'], 1.4],
              9,
              ['*', ['get', 'intensity'], 2.2],
              12,
              ['*', ['get', 'intensity'], 3.1],
            ],
            'circle-color': '#ffffff',
            'circle-opacity': [
              '*',
              lightningOpacity,
              ['interpolate', ['linear'], ['get', 'intensity'], 1, 0.05, 4, 0.14],
            ],
            'circle-blur': 0.65,
          },
        })

        map.addLayer({
          id: lightningActivityLayerId,
          type: 'symbol',
          source: lightningActivitySourceId,
          layout: {
            'icon-image': ['get', 'icon'],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.45, 9, 0.64, 12, 0.82],
            'icon-allow-overlap': false,
            'icon-ignore-placement': false,
            'symbol-sort-key': ['get', 'intensity'],
          },
          paint: {
            'icon-opacity': lightningOpacity,
          },
        })
      } else {
        const source = getSourceSafe<maplibregl.GeoJSONSource>(
          map,
          lightningActivitySourceId,
        )
        source?.setData(collection)
      }

      setLayerVisibility(
        map,
        lightningActivityHaloLayerId,
        activeLayer === 'Radar' && showLightningActivity,
      )
      setLayerVisibility(
        map,
        lightningActivityLayerId,
        activeLayer === 'Radar' && showLightningActivity,
      )
      setPaintPropertySafe(
        map,
        lightningActivityHaloLayerId,
        'circle-opacity',
        [
          '*',
          lightningOpacity,
          ['interpolate', ['linear'], ['get', 'intensity'], 1, 0.05, 4, 0.14],
        ],
      )
      setPaintPropertySafe(
        map,
        lightningActivityLayerId,
        'icon-opacity',
        lightningOpacity,
      )
      nudgeMapRender(map)
    }

    return runWhenStyleLoaded(map, applyLightningActivity)
  }, [activeLayer, lightningActivity, lightningOpacity, showLightningActivity])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const syncStormTracks = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      if (activeLayer !== 'Radar' || radarView !== 'local' || nexradStormTracks.length === 0) {
        removeNexradStormTracks(map)
        return
      }

      syncNexradStormTracks(map, nexradStormTracks)
    }

    return runWhenStyleLoaded(map, syncStormTracks)
  }, [activeLayer, nexradStormTracks, radarView])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    setPaintPropertySafe(map, alertPolygonsFillLayerId, 'fill-opacity', [
      'match',
      ['get', 'alertType'],
      'warning',
      warningOpacity,
      'watch',
      watchOpacity,
      polygonOpacity,
    ])
  }, [polygonOpacity, warningOpacity, watchOpacity])

  useEffect(() => {
    const map = mapRef.current
    const popup = radarPopupRef.current

    if (!map || !popup) {
      return
    }

    const handleMove = (event: maplibregl.MapMouseEvent) => {
      if (!(activeLayer === 'Radar' && radarView === 'local')) {
        map.getCanvas().style.cursor = ''
        popup.remove()
        return
      }

      const radarSiteLayers = getExistingLayerIds(map, [
        radarSitesLayerId,
        selectedRadarSiteLayerId,
      ])
      const feature =
        radarSiteLayers.length > 0
          ? map.queryRenderedFeatures(event.point, {
              layers: radarSiteLayers,
            })[0]
          : undefined

      if (!feature) {
        map.getCanvas().style.cursor = ''
        popup.remove()
        return
      }

      map.getCanvas().style.cursor = 'pointer'
      popup
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>${feature.properties?.id ?? 'Radar site'}</strong><div>${feature.properties?.name ?? ''}</div><div>Right-click to select</div>`,
        )
        .addTo(map)
    }

    const handleLeave = () => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    }

    map.on('mousemove', handleMove)
    if (hasLayerSafe(map, radarSitesLayerId)) {
      map.on('mouseleave', radarSitesLayerId, handleLeave)
    }
    if (hasLayerSafe(map, selectedRadarSiteLayerId)) {
      map.on('mouseleave', selectedRadarSiteLayerId, handleLeave)
    }

    return () => {
      map.off('mousemove', handleMove)
      if (hasLayerSafe(map, radarSitesLayerId)) {
        map.off('mouseleave', radarSitesLayerId, handleLeave)
      }
      if (hasLayerSafe(map, selectedRadarSiteLayerId)) {
        map.off('mouseleave', selectedRadarSiteLayerId, handleLeave)
      }
      popup.remove()
      map.getCanvas().style.cursor = ''
    }
  }, [activeLayer, radarView])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const syncLayerVisibility = () => {
      setLayerVisibility(
        map,
        radarSitesLayerId,
        activeLayer === 'Radar' && radarView === 'local',
      )
      setLayerVisibility(
        map,
        selectedRadarSiteLayerId,
        activeLayer === 'Radar' && radarView === 'local',
      )
      setLayerVisibility(
        map,
        alertPolygonsFillLayerId,
        true,
      )
      setLayerVisibility(
        map,
        alertPolygonsLineLayerId,
        true,
      )
      setLayerVisibility(
        map,
        spcPolygonsFillLayerId,
        activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk',
      )
      setLayerVisibility(
        map,
        spcPolygonsLineLayerId,
        activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk',
      )
      setLayerVisibility(
        map,
        winterPolygonsFillLayerId,
        activeLayer === 'Forecast' && activeForecastOverlay === 'Winter',
      )
      setLayerVisibility(
        map,
        winterPolygonsLineLayerId,
        activeLayer === 'Forecast' && activeForecastOverlay === 'Winter',
      )
      setLayerVisibility(
        map,
        localStormReportsLayerId,
        activeLayer === 'Radar' && showSpotterReports,
      )
      setLayerVisibility(
        map,
        regionalRadarLayerId,
        activeLayer === 'Radar' && radarView === 'regional',
      )
      setLayerVisibility(
        map,
        localRadarLayerId,
        activeLayer === 'Radar' && radarView === 'local',
      )
      setLayerVisibility(
        map,
        futureRadarLayerId,
        activeLayer === 'Radar' && radarView === 'future',
      )
    }

    return runWhenStyleLoaded(map, syncLayerVisibility)
  }, [
    activeForecastOverlay,
    activeLayer,
    radarView,
    showSpotterReports,
  ])

  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current

    if (!map || !container || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      map.resize()
    })

    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const handleHazardHover = (event: maplibregl.MapMouseEvent) => {
      const layers = getExistingLayerIds(map, [
        alertPolygonsFillLayerId,
        alertPolygonsLineLayerId,
        ...(activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk'
          ? [spcPolygonsFillLayerId, spcPolygonsLineLayerId]
          : []),
        ...(activeLayer === 'Forecast' && activeForecastOverlay === 'Winter'
          ? [winterPolygonsFillLayerId, winterPolygonsLineLayerId]
          : []),
        ...(activeLayer === 'Radar' && showSpotterReports
          ? [localStormReportsLayerId]
          : []),
      ])

      if (layers.length === 0) {
        map.getCanvas().style.cursor = ''
        return
      }

      const feature = map.queryRenderedFeatures(event.point, { layers })[0]
      map.getCanvas().style.cursor = feature ? 'pointer' : ''
    }

    map.on('mousemove', handleHazardHover)

    return () => {
      map.off('mousemove', handleHazardHover)
      map.getCanvas().style.cursor = ''
    }
  }, [activeForecastOverlay, activeLayer, showSpotterReports])

  useEffect(() => {
    const map = mapRef.current
    const popup = alertPopupRef.current

    if (!map || !popup) {
      return
    }

    const handleAlertClick = (event: maplibregl.MapMouseEvent) => {
      const alertLayers = getExistingLayerIds(map, [
        alertPolygonsFillLayerId,
        alertPolygonsLineLayerId,
      ])
      const clickedAlertFeatures =
        alertLayers.length > 0
          ? map.queryRenderedFeatures(event.point, {
              layers: alertLayers,
            })
          : []
      const feature = prioritizeAlertFeature(clickedAlertFeatures)

      if (!feature) {
        popup.remove()
        return
      }

      popup
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>${feature.properties?.event ?? 'Active alert'}</strong>`,
        )
        .addTo(map)

      onHazardSelectRef.current(
        buildAlertSelectionFromMapFeatures(clickedAlertFeatures),
      )
    }

    map.on('click', handleAlertClick)

    return () => {
      map.off('click', handleAlertClick)
      popup.remove()
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const popup = alertPopupRef.current

    if (!map || !popup) {
      return
    }

    const handleReportClick = (event: maplibregl.MapMouseEvent) => {
      if (
        activeLayerRef.current !== 'Radar' ||
        !showSpotterReports ||
        !hasLayerSafe(map, localStormReportsLayerId)
      ) {
        return
      }

      const feature = map.queryRenderedFeatures(event.point, {
        layers: [localStormReportsLayerId],
      })[0]

      if (!feature) {
        return
      }

      const eventType = String(feature.properties?.eventType ?? 'Spotter report')
      const city = String(feature.properties?.city ?? 'Unknown location')
      const state = String(feature.properties?.state ?? '')
      const source = String(feature.properties?.source ?? 'Unknown source')
      const remark = String(feature.properties?.remark ?? 'No report remark available.')
      const magnitude = String(feature.properties?.magnitude ?? '')
      const qualifier = String(feature.properties?.qualifier ?? '')
      const ageMinutes = normalizeFeatureNumber(feature.properties?.ageMinutes)

      popup
        .setLngLat(event.lngLat)
        .setHTML(
          [
            `<strong>${escapeHtml(eventType)}</strong>`,
            `<div>${escapeHtml(city)}, ${escapeHtml(state)}</div>`,
            ageMinutes !== null ? `<div>${escapeHtml(formatReportAge(ageMinutes))}</div>` : '',
            magnitude && magnitude !== 'None'
              ? `<div>${escapeHtml(`Magnitude: ${magnitude}${qualifier ? ` (${qualifier})` : ''}`)}</div>`
              : '',
            `<div>${escapeHtml(source)}</div>`,
            `<div>${escapeHtml(remark)}</div>`,
          ].filter(Boolean).join(''),
        )
        .addTo(map)

      onHazardSelectRef.current({
        source: 'lsr',
        title: eventType,
        subtitle: `${city}, ${state}`,
        summary: remark,
        detailLines: [
          `Reported: ${formatCompactTimestamp(String(feature.properties?.valid ?? ''))}`,
          ...(ageMinutes !== null ? [`Age: ${formatReportAge(ageMinutes)}`] : []),
          `Source: ${source}`,
          ...(magnitude &&
          magnitude !== 'None'
            ? [
                `Magnitude: ${magnitude}${qualifier ? ` (${qualifier})` : ''}`,
              ]
            : []),
          ...(qualifier && qualifier !== 'None' ? [`Qualifier: ${qualifier}`] : []),
          `County: ${String(feature.properties?.county ?? 'Unknown')}`,
        ],
      })
    }

    map.on('click', handleReportClick)

    return () => {
      map.off('click', handleReportClick)
    }
  }, [showSpotterReports])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const handleForecastClick = (event: maplibregl.MapMouseEvent) => {
      if (activeLayerRef.current !== 'Forecast') {
        return
      }

      const alertLayers = getExistingLayerIds(map, [
        alertPolygonsFillLayerId,
        alertPolygonsLineLayerId,
      ])
      const clickedAlertFeatures =
        alertLayers.length > 0
          ? map.queryRenderedFeatures(event.point, {
              layers: alertLayers,
            })
          : []

      if (prioritizeAlertFeature(clickedAlertFeatures)) {
        onHazardSelectRef.current(
          buildAlertSelectionFromMapFeatures(clickedAlertFeatures),
        )
        return
      }

      if (activeForecastOverlayRef.current === 'SPC Storm Risk') {
        const spcLayers = getExistingLayerIds(map, [
          spcPolygonsFillLayerId,
          spcPolygonsLineLayerId,
        ])
        const feature =
          spcLayers.length > 0
            ? map.queryRenderedFeatures(event.point, {
                layers: spcLayers,
              })[0]
            : undefined

        if (feature) {
          onHazardSelectRef.current(buildSpcSelectionFromFeature(feature))
        }
        return
      }

      if (activeForecastOverlayRef.current === 'Winter') {
        const winterLayers = getExistingLayerIds(map, [
          winterPolygonsFillLayerId,
          winterPolygonsLineLayerId,
        ])
        const feature =
          winterLayers.length > 0
            ? map.queryRenderedFeatures(event.point, {
                layers: winterLayers,
              })[0]
            : undefined

        if (feature) {
          onHazardSelectRef.current(buildWinterSelectionFromFeature(feature))
        }
      }
    }

    map.on('click', handleForecastClick)

    return () => {
      map.off('click', handleForecastClick)
    }
  }, [])

  useEffect(() => {
    if (shouldRecenterMap) {
      mapRef.current?.flyTo({
        center,
        essential: true,
        duration: 900,
      })
    }

    markerRef.current?.setLngLat(center)
  }, [center, shouldRecenterMap])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const runSync = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      if (!trackToolEnabled || !stormTrackOrigin || !stormTrackEnd) {
        removeStormTrack(map)
        return
      }

      const currentMarkers =
        buildImmediateStormTrackMarkers(
          stormTrackOrigin,
          stormTrackEnd,
          stormTrackSpeedMph,
        )

      removeStormTrack(map)
      syncStormTrackSource(map, stormTrackOrigin, stormTrackEnd, currentMarkers)
    }

    return runWhenStyleLoaded(map, runSync)
  }, [
    stormTrackEnd,
    stormTrackOrigin,
    stormTrackResetKey,
    stormTrackSpeedMph,
    trackToolEnabled,
  ])

  useEffect(() => {
    const map = mapRef.current

    if (
      !map ||
      !map.isStyleLoaded() ||
      !trackToolEnabled ||
      !stormTrackOrigin ||
      !stormTrackEnd
    ) {
      return
    }

    removeStormTrack(map)
    syncStormTrackSource(
      map,
      stormTrackOrigin,
      stormTrackEnd,
      buildImmediateStormTrackMarkers(
        stormTrackOrigin,
        stormTrackEnd,
        stormTrackSpeedMph,
      ),
    )
  }, [stormTrackEnd, stormTrackOrigin, stormTrackSpeedMph, trackToolEnabled])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    if (stormTrackResetKey === 0) {
      return
    }

    stormTrackDragRef.current = false
    stormTrackPreviewEndRef.current = null
    map.dragPan.enable()
    removeStormTrack(map)
  }, [stormTrackResetKey])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    if (!trackToolEnabled || !stormTrackOrigin || !stormTrackEnd) {
      setProjectedTrackLabels([])
      return
    }

    let animationFrame: number | null = null

    const syncProjectedLabels = () => {
      if (animationFrame !== null) {
        return
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null
        const activeOrigin = stormTrackOriginRef.current
        const activeEnd = stormTrackEndRef.current
        const activeSpeed = stormTrackSpeedRef.current

        if (
          !trackToolEnabledRef.current ||
          !activeOrigin ||
          !activeEnd ||
          !map.isStyleLoaded()
        ) {
          setProjectedTrackLabels([])
          return
        }

        setProjectedTrackLabels(
          buildProjectedTrackLabels(
            map,
            activeOrigin,
            buildImmediateStormTrackMarkers(activeOrigin, activeEnd, activeSpeed),
          ),
        )
      })
    }

    const syncProjectedLabelsImmediately = () => {
      const activeOrigin = stormTrackOriginRef.current
      const activeEnd = stormTrackEndRef.current
      const activeSpeed = stormTrackSpeedRef.current

      if (
        !trackToolEnabledRef.current ||
        !activeOrigin ||
        !activeEnd ||
        !map.isStyleLoaded()
      ) {
        setProjectedTrackLabels([])
        return
      }

      setProjectedTrackLabels(
        buildProjectedTrackLabels(
          map,
          activeOrigin,
          buildImmediateStormTrackMarkers(activeOrigin, activeEnd, activeSpeed),
        ),
      )
    }

    syncProjectedLabelsImmediately()
    map.on('move', syncProjectedLabels)
    map.on('zoom', syncProjectedLabels)
    map.on('resize', syncProjectedLabels)

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame)
      }
      map.off('move', syncProjectedLabels)
      map.off('zoom', syncProjectedLabels)
      map.off('resize', syncProjectedLabels)
    }
  }, [stormTrackEnd, stormTrackOrigin, trackToolEnabled])

  useEffect(() => {
    const map = mapRef.current

    if (!map || !map.isStyleLoaded() || !trackToolEnabled || !stormTrackOrigin || !stormTrackEnd) {
      setProjectedTrackLabels([])
      return
    }

    setProjectedTrackLabels(
      buildProjectedTrackLabels(
        map,
        stormTrackOrigin,
        buildImmediateStormTrackMarkers(
          stormTrackOrigin,
          stormTrackEnd,
          stormTrackSpeedMph,
        ),
      ),
    )
  }, [stormTrackEnd, stormTrackOrigin, stormTrackSpeedMph, trackToolEnabled, stormTrackResetKey])

  useEffect(() => {
    const map = mapRef.current

    if (!map || mapRefreshKey === 0) {
      return
    }

    const alertSource = getSourceSafe<maplibregl.GeoJSONSource>(map, alertPolygonsSourceId)
    const spcSource = getSourceSafe<maplibregl.GeoJSONSource>(map, spcPolygonsSourceId)
    const winterSource = getSourceSafe<maplibregl.GeoJSONSource>(map, winterPolygonsSourceId)
    const reportsSource = getSourceSafe<maplibregl.GeoJSONSource>(map, localStormReportsSourceId)

    const alertCollection: GeoJSON.FeatureCollection<
      GeoJSON.Polygon | GeoJSON.MultiPolygon
    > = {
      type: 'FeatureCollection',
      features: alertFeatures.map((feature) => ({
        type: 'Feature',
        properties: {
          id: feature.id,
          alertType: feature.alertType,
          event: feature.event,
          headline: feature.headline,
          description: feature.description,
          instruction: feature.instruction,
          effective: feature.effective,
          expires: feature.expires,
          severity: feature.severity,
          urgency: feature.urgency,
          areaDescription: feature.areaDescription,
          fillColor: feature.fillColor,
          lineColor: feature.lineColor,
        },
        geometry: feature.geometry,
      })),
    }

    const spcCollection: GeoJSON.FeatureCollection<
      GeoJSON.Polygon | GeoJSON.MultiPolygon
    > = {
      type: 'FeatureCollection',
      features: spcFeatures.map((feature) => ({
        type: 'Feature',
        properties: {
          id: feature.id,
          category: feature.category,
          valid: feature.valid,
          expire: feature.expire,
          fillColor: feature.fillColor,
          lineColor: feature.lineColor,
        },
        geometry: feature.geometry,
      })),
    }

    const winterCollection: GeoJSON.FeatureCollection<
      GeoJSON.Polygon | GeoJSON.MultiPolygon
    > = {
      type: 'FeatureCollection',
      features: winterFeatures.map((feature) => ({
        type: 'Feature',
        properties: {
          id: feature.id,
          product: feature.product,
          outlook: feature.outlook,
          validTime: feature.validTime,
          issueTime: feature.issueTime,
          snippet: feature.snippet,
          fillColor: feature.fillColor,
          lineColor: feature.lineColor,
        },
        geometry: feature.geometry,
      })),
    }

    const reportsCollection: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: localStormReports.map((feature) => ({
        type: 'Feature',
        properties: {
          id: feature.id,
          eventType: feature.eventType,
          reportCategory: feature.reportCategory,
          city: feature.city,
          county: feature.county,
          state: feature.state,
          source: feature.source,
          remark: feature.remark,
          magnitude: feature.magnitude,
          qualifier: feature.qualifier,
          valid: feature.valid,
          ageMinutes: feature.ageMinutes,
          fillColor: feature.fillColor,
          strokeColor: feature.strokeColor,
        },
        geometry: {
          type: 'Point',
          coordinates: feature.coordinates,
        },
      })),
    }

    alertSource?.setData(alertCollection)
    spcSource?.setData(spcCollection)
    winterSource?.setData(winterCollection)
    reportsSource?.setData(reportsCollection)

    const nextAlertFilter = buildAlertTypeFilter(alertTypeFilters)
    setFilterSafe(map, alertPolygonsFillLayerId, nextAlertFilter)
    setFilterSafe(map, alertPolygonsLineLayerId, nextAlertFilter)
    setPaintPropertySafe(map, alertPolygonsFillLayerId, 'fill-opacity', [
      'match',
      ['get', 'alertType'],
      'warning',
      warningOpacity,
      'watch',
      watchOpacity,
      polygonOpacity,
    ])

    setLayerVisibility(map, alertPolygonsFillLayerId, true)
    setLayerVisibility(map, alertPolygonsLineLayerId, true)
    setLayerVisibility(
      map,
      spcPolygonsFillLayerId,
      activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk',
    )
    setLayerVisibility(
      map,
      spcPolygonsLineLayerId,
      activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk',
    )
    setLayerVisibility(
      map,
      winterPolygonsFillLayerId,
      activeLayer === 'Forecast' && activeForecastOverlay === 'Winter',
    )
    setLayerVisibility(
      map,
      winterPolygonsLineLayerId,
      activeLayer === 'Forecast' && activeForecastOverlay === 'Winter',
    )
    setLayerVisibility(
      map,
      localStormReportsLayerId,
      activeLayer === 'Radar' && showSpotterReports,
    )

    try {
      map.resize()
    } catch {
      // ignore
    }

    nudgeMapRender(map)
  }, [
    activeForecastOverlay,
    activeLayer,
    alertFeatures,
    alertTypeFilters,
    localStormReports,
    mapRefreshKey,
    polygonOpacity,
    showSpotterReports,
    spcFeatures,
    warningOpacity,
    watchOpacity,
    winterFeatures,
  ])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const isVisible = activeLayer === 'Radar' && radarView === 'regional'
    const tileUrl = buildRegionalRadarTileUrl(
      radarProduct === 'composite' ? 'composite' : 'base',
      selectedRegionalRadarTime,
    )
    const sourceSignature = tileUrl

    const applyRegionalRadarLayer = () => {
      if (!isVisible) {
        setLayerVisibility(map, regionalRadarLayerId, false)
        return
      }

      const existingSignature =
        hasLayerSafe(map, regionalRadarLayerId) &&
        hasSourceSafe(map, regionalRadarSourceId)
          ? regionalRadarSignatureRef.current ?? ''
          : ''

      if (!hasSourceSafe(map, regionalRadarSourceId)) {
        map.addSource(regionalRadarSourceId, {
          type: 'raster',
          tiles: [tileUrl],
          tileSize: 256,
          attribution:
            '&copy; <a href="https://www.weather.gov/">NOAA / NWS</a>',
        })
      } else {
        const source = getSourceSafe<
          maplibregl.Source & { setTiles?: (tiles: string[]) => void }
        >(map, regionalRadarSourceId)
        if (existingSignature !== sourceSignature || radarView === 'regional') {
          source?.setTiles?.([tileUrl])
          regionalRadarSignatureRef.current = sourceSignature
        }
      }

      if (!hasLayerSafe(map, regionalRadarLayerId)) {
        const beforeLayerId = hasLayerSafe(map, alertPolygonsFillLayerId)
          ? alertPolygonsFillLayerId
          : undefined

        map.addLayer(
          {
            id: regionalRadarLayerId,
            type: 'raster',
            source: regionalRadarSourceId,
            layout: {
              visibility: 'visible',
            },
            paint: {
              'raster-opacity': radarOpacity,
              'raster-fade-duration': 320,
            },
          },
          beforeLayerId,
        )
      }

      regionalRadarSignatureRef.current = sourceSignature
      setLayerVisibility(map, regionalRadarLayerId, true)
      setPaintPropertySafe(map, regionalRadarLayerId, 'raster-opacity', radarOpacity)

      nudgeMapRender(map)
    }

    return runWhenStyleLoaded(map, applyRegionalRadarLayer)
  }, [activeLayer, radarOpacity, radarProduct, radarView, selectedRegionalRadarTime])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    if (activeLayer !== 'Radar') {
      setLayerVisibility(map, regionalRadarLayerId, false)
      setLayerVisibility(map, localRadarLayerId, false)
      setLayerVisibility(map, futureRadarLayerId, false)
      return
    }

    if (radarView === 'regional') {
      setLayerVisibility(map, regionalRadarLayerId, true)
      setLayerVisibility(map, localRadarLayerId, false)
      setLayerVisibility(map, futureRadarLayerId, false)
    } else if (radarView === 'local') {
      setLayerVisibility(map, localRadarLayerId, true)
      setLayerVisibility(map, regionalRadarLayerId, false)
      setLayerVisibility(map, futureRadarLayerId, false)
    } else {
      setLayerVisibility(map, futureRadarLayerId, true)
      setLayerVisibility(map, regionalRadarLayerId, false)
      setLayerVisibility(map, localRadarLayerId, false)
    }
  }, [activeLayer, radarView])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const isVisible =
      activeLayer === 'Radar' &&
      radarView === 'local' &&
      nearestRadarSite &&
      localRadarDefinition
    const tileUrl =
      nearestRadarSite && localRadarDefinition
        ? buildLocalRadarTileUrl({
            nearestRadarSite,
            localRadarDefinition,
            selectedLocalRadarTime,
          })
        : null
    const sourceSignature = tileUrl ?? ''

    const applyLocalRadarLayer = () => {
      if (!isVisible || !tileUrl) {
        setLayerVisibility(map, localRadarLayerId, false)
        return
      }

      const existingSignature =
        hasLayerSafe(map, localRadarLayerId) && hasSourceSafe(map, localRadarSourceId)
          ? localRadarSignatureRef.current ?? ''
          : ''

      if (!hasSourceSafe(map, localRadarSourceId)) {
        map.addSource(localRadarSourceId, {
          type: 'raster',
          tiles: [tileUrl],
          tileSize: 256,
          attribution:
            '&copy; <a href="https://www.weather.gov/">NOAA / NWS</a>',
        })
      } else {
        const source = getSourceSafe<
          maplibregl.Source & { setTiles?: (tiles: string[]) => void }
        >(map, localRadarSourceId)
        if (existingSignature !== sourceSignature || radarView === 'local') {
          source?.setTiles?.([tileUrl])
          localRadarSignatureRef.current = sourceSignature
        }
      }

      if (!hasLayerSafe(map, localRadarLayerId)) {
        const beforeLayerId = hasLayerSafe(map, alertPolygonsFillLayerId)
          ? alertPolygonsFillLayerId
          : undefined

        map.addLayer(
          {
            id: localRadarLayerId,
            type: 'raster',
            source: localRadarSourceId,
            layout: {
              visibility: 'visible',
            },
            paint: {
              'raster-opacity': radarOpacity,
              'raster-fade-duration': 320,
            },
          },
          beforeLayerId,
        )
      }

      localRadarSignatureRef.current = sourceSignature
      setLayerVisibility(map, localRadarLayerId, true)
      setPaintPropertySafe(map, localRadarLayerId, 'raster-opacity', radarOpacity)

      nudgeMapRender(map)
    }

    return runWhenStyleLoaded(map, applyLocalRadarLayer)
  }, [
    activeLayer,
    localRadarDefinition,
    nearestRadarSite,
    radarOpacity,
    radarView,
    selectedLocalRadarTime,
  ])

  const satelliteOverlayUrl =
    requestViewport && activeLayer === 'Satellite'
      ? buildSatelliteImageUrl(satelliteLayer, {
          west: requestViewport.west,
          south: requestViewport.south,
          east: requestViewport.east,
          north: requestViewport.north,
          width: requestViewport.width,
          height: requestViewport.height,
          time: selectedSatelliteTime,
        })
      : null
  const futureRadarOverlayUrl =
    requestViewport &&
    activeLayer === 'Radar' &&
    radarView === 'future' &&
    selectedFutureRadarFrame
      ? buildFutureRadarImageUrl({
          sourceUrl: selectedFutureRadarFrame.sourceUrl,
          band: selectedFutureRadarFrame.renderBand,
          west: requestViewport.west,
          south: requestViewport.south,
          east: requestViewport.east,
          north: requestViewport.north,
          width: requestViewport.width,
          height: requestViewport.height,
        })
      : null
  const cachedFutureRadarOverlayUrl = useCachedFutureRadarRenderUrl(
    futureRadarOverlayUrl,
    selectedFutureRadarFrame,
    requestViewport,
  )
  const {
    activeFrame: activeSatelliteFrame,
    pendingFrame: pendingSatelliteFrame,
    previousFrame: previousSatelliteFrame,
    promotePendingFrame: promotePendingSatelliteFrame,
  } = useBufferedRasterFrame(satelliteOverlayUrl, requestViewport)
  const {
    activeFrame: activeFutureRadarFrame,
    pendingFrame: pendingFutureRadarFrame,
    promotePendingFrame: promotePendingFutureRadarFrame,
  } = useBufferedRasterFrame(
    cachedFutureRadarOverlayUrl,
    requestViewport,
    selectedFutureRadarFrame?.id,
  )

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const isVisible =
      activeLayer === 'Radar' &&
      radarView === 'future' &&
      Boolean(activeFutureRadarFrame)
    const sourceSignature = activeFutureRadarFrame
      ? `${activeFutureRadarFrame.url}:${activeFutureRadarFrame.viewport.west}:${activeFutureRadarFrame.viewport.south}:${activeFutureRadarFrame.viewport.east}:${activeFutureRadarFrame.viewport.north}`
      : ''

    const applyFutureRadarLayer = () => {
      if (!isVisible || !activeFutureRadarFrame) {
        setLayerVisibility(map, futureRadarLayerId, false)
        return
      }

      const coordinates = getImageCoordinatesFromViewport(activeFutureRadarFrame.viewport)

      if (!hasSourceSafe(map, futureRadarSourceId)) {
        map.addSource(futureRadarSourceId, {
          type: 'image',
          url: activeFutureRadarFrame.url,
          coordinates,
        })
      } else if (futureRadarSignatureRef.current !== sourceSignature) {
        const source = getSourceSafe<
          maplibregl.ImageSource & {
            updateImage?: (image: {
              url: string
              coordinates: ReturnType<typeof getImageCoordinatesFromViewport>
            }) => void
          }
        >(map, futureRadarSourceId)
        source?.updateImage?.({
          url: activeFutureRadarFrame.url,
          coordinates,
        })
      }

      if (!hasLayerSafe(map, futureRadarLayerId)) {
        const beforeLayerId = hasLayerSafe(map, alertPolygonsFillLayerId)
          ? alertPolygonsFillLayerId
          : undefined

        map.addLayer(
          {
            id: futureRadarLayerId,
            type: 'raster',
            source: futureRadarSourceId,
            layout: {
              visibility: 'visible',
            },
            paint: {
              'raster-opacity': radarOpacity,
              'raster-fade-duration': 320,
            },
          },
          beforeLayerId,
        )
      }

      futureRadarSignatureRef.current = sourceSignature
      setLayerVisibility(map, futureRadarLayerId, true)
      setPaintPropertySafe(map, futureRadarLayerId, 'raster-opacity', radarOpacity)

      nudgeMapRender(map)
    }

    return runWhenStyleLoaded(map, applyFutureRadarLayer)
  }, [activeFutureRadarFrame, activeLayer, radarOpacity, radarView])

  const handlePendingFutureRadarLoad = () => {
    if (pendingFutureRadarFrame) {
      onFutureRadarFrameLoad(pendingFutureRadarFrame.frameKey)
    }

    promotePendingFutureRadarFrame()
  }
  const handlePendingFutureRadarError = () => {
    if (pendingFutureRadarFrame) {
      onFutureRadarFrameError(pendingFutureRadarFrame.frameKey)
    }
  }
  useEffect(() => {
    if (!pendingFutureRadarFrame) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      onFutureRadarFrameError(pendingFutureRadarFrame.frameKey)
    }, 20_000)

    return () => window.clearTimeout(timeoutId)
  }, [onFutureRadarFrameError, pendingFutureRadarFrame])

  return (
    <div className="map-surface">
      <div ref={containerRef} className="map-canvas" />
      <div className="map-raster-stack" aria-hidden="true">
        {renderBufferedRasterFrame(
          mapInstance,
          previousSatelliteFrame,
          satelliteOpacity,
          'previous',
        )}
        {renderBufferedRasterFrame(
          mapInstance,
          activeSatelliteFrame ?? (pendingSatelliteFrame && !activeSatelliteFrame ? pendingSatelliteFrame : null),
          satelliteOpacity,
        )}
        {pendingSatelliteFrame && activeSatelliteFrame ? (
          <img
            key={`${pendingSatelliteFrame.url}-preload`}
            className="map-raster-preload"
            src={pendingSatelliteFrame.url}
            alt=""
            onLoad={promotePendingSatelliteFrame}
          />
        ) : null}
        {pendingFutureRadarFrame ? (
          <img
            key={`${pendingFutureRadarFrame.url}-preload`}
            className="map-raster-preload"
            src={pendingFutureRadarFrame.url}
            alt=""
            onLoad={handlePendingFutureRadarLoad}
            onError={handlePendingFutureRadarError}
          />
        ) : null}
      </div>
      <div className="storm-track-overlay">
        {projectedTrackLabels.map((item) => (
          <div
            key={`${item.kind}-${item.label}-${item.left}-${item.top}`}
            className={item.kind === 'origin' ? 'storm-track-label origin' : 'storm-track-label'}
            style={{ left: `${item.left}px`, top: `${item.top}px` }}
          >
            {item.label}
          </div>
        ))}
      </div>
      {radarView === 'local' && nearestRadarSite ? (
        <div className="map-overlay">
          <div className="map-selection-badge">
            <span className="card-label">Radar Site</span>
            <strong>{nearestRadarSite.id}</strong>
            <span>{nearestRadarSite.name}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
})

function formatCompactTimestamp(value: unknown) {
  if (typeof value !== 'string' || value.length !== 12) {
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

function formatIsoTimestamp(value: string) {
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

function normalizeFeatureNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function formatReportAge(ageMinutes: number) {
  if (ageMinutes <= 1) {
    return 'just now'
  }

  if (ageMinutes < 60) {
    return `${Math.round(ageMinutes)} min ago`
  }

  const roundedMinutes = Math.round(ageMinutes)
  const hours = Math.floor(roundedMinutes / 60)
  const minutes = roundedMinutes % 60

  if (minutes === 0) {
    return `${hours}h ago`
  }

  return `${hours}h ${minutes}m ago`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildAlertNarrative(description: string, instruction: string) {
  const parts = [description.trim(), instruction.trim()].filter(Boolean)
  return parts.join('\n\n')
}

function buildAlertSelectionFromMapFeatures(
  features: maplibregl.MapGeoJSONFeature[],
): HazardSelection {
  const feature =
    prioritizeAlertFeature(features) ?? features[0]

  if (!feature) {
    return {
      source: 'alerts',
      title: 'Active alert',
      subtitle: 'NWS active alert',
      summary: 'Area description unavailable.',
      detailLines: [],
    }
  }

  const relatedAlerts = features
    .map((item) => ({
      id: String(item.properties?.id ?? ''),
      title: String(item.properties?.event ?? 'Active alert'),
      subtitle: String(item.properties?.headline ?? 'NWS active alert'),
      alertType: normalizeAlertType(String(item.properties?.alertType ?? '')),
      accentColor: String(item.properties?.fillColor ?? '') || undefined,
    }))
    .filter((item) => item.id.length > 0)
    .filter(
      (item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index,
    )
    .sort((left, right) => getAlertTypePriority(right.alertType) - getAlertTypePriority(left.alertType))

  return {
    source: 'alerts',
    title: String(feature.properties?.event ?? 'Active alert'),
    subtitle: String(feature.properties?.headline ?? 'NWS active alert'),
    summary: String(
      feature.properties?.areaDescription ?? 'Area description unavailable.',
    ),
    accentColor: String(feature.properties?.fillColor ?? '') || undefined,
    badges: buildAlertBadges(
      String(feature.properties?.severity ?? 'Unknown'),
      String(feature.properties?.urgency ?? 'Unknown'),
    ),
    body: buildAlertNarrative(
      String(feature.properties?.description ?? ''),
      String(feature.properties?.instruction ?? ''),
    ),
    detailLines: [
      ...(feature.properties?.effective
        ? [`Effective: ${formatIsoTimestamp(String(feature.properties.effective))}`]
        : []),
      ...(feature.properties?.expires
        ? [`Expires: ${formatIsoTimestamp(String(feature.properties.expires))}`]
        : []),
    ],
    relatedAlerts: relatedAlerts.length > 1 ? relatedAlerts : undefined,
  }
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

function buildSpcSelectionFromFeature(
  feature: maplibregl.MapGeoJSONFeature,
): HazardSelection {
  const category = String(feature.properties?.category ?? 'SPC risk')

  return {
    source: 'spc',
    title: category,
    subtitle: `${category} risk area`,
    summary:
      'This polygon shows the current SPC severe-weather risk area for the selected day.',
    accentColor: String(feature.properties?.fillColor ?? '') || undefined,
    detailLines: [
      `Category: ${category}`,
      `Valid: ${formatCompactTimestamp(feature.properties?.valid)}`,
      `Expires: ${formatCompactTimestamp(feature.properties?.expire)}`,
    ],
  }
}

function buildWinterSelectionFromFeature(
  feature: maplibregl.MapGeoJSONFeature,
): HazardSelection {
  const outlook = String(feature.properties?.outlook ?? 'Winter outlook')

  return {
    source: 'winter',
    title: outlook,
    subtitle: 'WPC winter outlook area',
    summary:
      String(feature.properties?.snippet ?? '') ||
      'Probability of exceeding local winter storm warning criteria.',
    accentColor: String(feature.properties?.fillColor ?? '') || undefined,
    detailLines: [
      `Valid: ${String(feature.properties?.validTime ?? 'Unavailable')}`,
      `Issued: ${String(feature.properties?.issueTime ?? 'Unavailable')}`,
    ],
  }
}

function useBufferedRasterFrame(
  targetUrl: string | null,
  viewport: ViewportSnapshot | null,
  frameKey?: string | null,
) {
  const [activeFrame, setActiveFrame] = useState<BufferedRasterFrame | null>(null)
  const [pendingFrame, setPendingFrame] = useState<BufferedRasterFrame | null>(null)
  const [previousFrame, setPreviousFrame] = useState<BufferedRasterFrame | null>(null)
  const clearPreviousFrameTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (!targetUrl || !viewport) {
      setActiveFrame(null)
      setPendingFrame(null)
      setPreviousFrame(null)
      return
    }

    if (activeFrame?.url === targetUrl || pendingFrame?.url === targetUrl) {
      return
    }

    const nextFrame: BufferedRasterFrame = {
      url: targetUrl,
      frameKey: frameKey ?? targetUrl,
      viewport,
    }

    setPendingFrame(nextFrame)
  }, [activeFrame, frameKey, pendingFrame, targetUrl, viewport])

  useEffect(() => {
    return () => {
      if (clearPreviousFrameTimeoutRef.current !== null) {
        window.clearTimeout(clearPreviousFrameTimeoutRef.current)
      }
    }
  }, [])

  function promotePendingFrame() {
    if (!pendingFrame) {
      return
    }

    if (clearPreviousFrameTimeoutRef.current !== null) {
      window.clearTimeout(clearPreviousFrameTimeoutRef.current)
    }

    setPreviousFrame(activeFrame)
    setActiveFrame(pendingFrame)
    setPendingFrame(null)
    clearPreviousFrameTimeoutRef.current = window.setTimeout(() => {
      setPreviousFrame(null)
      clearPreviousFrameTimeoutRef.current = null
    }, 260)
  }

  return {
    activeFrame,
    pendingFrame,
    previousFrame,
    promotePendingFrame,
  }
}

function useCachedFutureRadarRenderUrl(
  targetUrl: string | null,
  frame: FutureRadarFrame | null,
  viewport: ViewportSnapshot | null,
) {
  const [cachedUrl, setCachedUrl] = useState<string | null>(null)
  const blobUrlsRef = useRef<string[]>([])

  useEffect(() => {
    let active = true

    if (!targetUrl || !frame || !viewport) {
      setCachedUrl(null)
      return
    }

    if (!isTauri()) {
      setCachedUrl(targetUrl)
      return
    }

    void invoke<number[]>('fetch_future_radar_render', {
      request: {
        renderUrl: targetUrl,
        sourceUrl: frame.sourceUrl,
        band: frame.renderBand,
        west: viewport.west,
        south: viewport.south,
        east: viewport.east,
        north: viewport.north,
        width: viewport.width,
        height: viewport.height,
      },
    })
      .then((bytes) => {
        if (!active || bytes.length === 0) {
          return
        }

        const blobUrl = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
        )

        blobUrlsRef.current.push(blobUrl)
        setCachedUrl(blobUrl)
      })
      .catch(() => {
        if (active) {
          setCachedUrl(targetUrl)
        }
      })

    return () => {
      active = false
    }
  }, [frame, targetUrl, viewport])

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((blobUrl) => URL.revokeObjectURL(blobUrl))
      blobUrlsRef.current = []
    }
  }, [])

  return cachedUrl
}

function renderBufferedRasterFrame(
  map: maplibregl.Map | null,
  frame: BufferedRasterFrame | null,
  opacity: number,
  variant: 'active' | 'previous' = 'active',
  onLoad?: () => void,
  onError?: () => void,
) {
  if (!map || !frame) {
    return null
  }

  return (
    <img
      key={`${frame.url}-${variant}`}
      className={
        variant === 'previous'
          ? 'map-raster-image map-raster-image-previous'
          : 'map-raster-image'
      }
      src={frame.url}
      alt=""
      style={buildRasterFrameStyle(map, frame.viewport, opacity)}
      onLoad={onLoad}
      onError={onError}
    />
  )
}

function addRadarSiteIcon(map: maplibregl.Map) {
  if (map.hasImage(radarSiteIconId)) {
    return
  }

  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const context = canvas.getContext('2d')

  if (!context) {
    return
  }

  context.clearRect(0, 0, 32, 32)
  context.strokeStyle = '#00d4aa'
  context.lineWidth = 2.2
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.fillStyle = '#e6f0f4'

  context.beginPath()
  context.arc(16, 16, 12, 0, Math.PI * 2)
  context.fill()

  context.beginPath()
  context.arc(16, 16, 12, 0, Math.PI * 2)
  context.stroke()

  context.beginPath()
  context.arc(16, 13, 5.5, Math.PI * 0.25, Math.PI * 0.75)
  context.stroke()

  context.beginPath()
  context.moveTo(16, 18)
  context.lineTo(16, 24)
  context.moveTo(12.5, 24)
  context.lineTo(19.5, 24)
  context.stroke()

  map.addImage(radarSiteIconId, context.getImageData(0, 0, 32, 32), {
    pixelRatio: 2,
  })
}

function addLightningActivityIcons(map: maplibregl.Map) {
  const colors = {
    1: { fill: '#6f7680', stroke: '#101820' },
    2: { fill: '#a7adb4', stroke: '#111827' },
    3: { fill: '#d9dde2', stroke: '#172033' },
    4: { fill: '#ffffff', stroke: '#1f2937' },
  } as const

  ;([1, 2, 3, 4] as const).forEach((intensity) => {
    const imageId = `${lightningActivityIconPrefix}${intensity}`

    if (map.hasImage(imageId)) {
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = 48
    canvas.height = 48
    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    context.clearRect(0, 0, 48, 48)
    context.lineJoin = 'round'
    context.lineCap = 'round'
    context.shadowColor = 'rgba(0, 0, 0, 0.45)'
    context.shadowBlur = 5
    context.shadowOffsetY = 2
    context.strokeStyle = colors[intensity].stroke
    context.lineWidth = 4
    context.fillStyle = colors[intensity].fill

    context.beginPath()
    context.moveTo(27, 4)
    context.lineTo(12, 27)
    context.lineTo(23, 27)
    context.lineTo(18, 44)
    context.lineTo(36, 20)
    context.lineTo(25, 20)
    context.closePath()
    context.stroke()
    context.fill()

    map.addImage(imageId, context.getImageData(0, 0, 48, 48), {
      pixelRatio: 2,
    })
  })
}

function buildRegionalRadarTileUrl(
  radarProduct: 'base' | 'composite',
  time?: string | null,
) {
  const refreshBucket = Math.floor(Date.now() / 120000)
  const layerName =
    radarProduct === 'composite' ? 'conus_cref_qcd' : 'conus_bref_qcd'
  const timeParam = time ? `&time=${encodeURIComponent(time)}` : ''
  const cacheKey = time ? time : String(refreshBucket)

  return `https://opengeo.ncep.noaa.gov/geoserver/conus/${layerName}/wms?service=WMS&version=1.1.1&request=GetMap&layers=${layerName}&styles=radar_reflectivity&format=image/png&transparent=true&srs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256${timeParam}&frame=${encodeURIComponent(cacheKey)}`
}

function buildLocalRadarTileUrl({
  nearestRadarSite,
  localRadarDefinition,
  selectedLocalRadarTime,
}: {
  nearestRadarSite: RadarSite
  localRadarDefinition: RadarProductDefinition | null
  selectedLocalRadarTime: string | null
}) {
  const refreshBucket = Math.floor(Date.now() / 120000)
  const siteWorkspace = nearestRadarSite.id.toLowerCase()
  const layerName = localRadarDefinition?.layerName
  const styleName = localRadarDefinition?.styleName
  const timeParam = selectedLocalRadarTime
    ? `&time=${encodeURIComponent(selectedLocalRadarTime)}`
    : ''

  if (!layerName || !styleName) {
    return ''
  }

  return `https://opengeo.ncep.noaa.gov/geoserver/${siteWorkspace}/ows?service=WMS&version=1.1.1&request=GetMap&layers=${layerName}&styles=${styleName}&format=image/png&transparent=true&srs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256${timeParam}&refresh=${refreshBucket}`
}

function removeNexradStormTracks(map: maplibregl.Map) {
  if (hasLayerSafe(map, nexradStormTracksLabelLayerId)) {
    map.removeLayer(nexradStormTracksLabelLayerId)
  }

  if (hasLayerSafe(map, nexradStormTracksPointLayerId)) {
    map.removeLayer(nexradStormTracksPointLayerId)
  }

  if (hasLayerSafe(map, nexradStormTracksLineLayerId)) {
    map.removeLayer(nexradStormTracksLineLayerId)
  }

  if (hasSourceSafe(map, nexradStormTracksSourceId)) {
    map.removeSource(nexradStormTracksSourceId)
  }
}

function syncNexradStormTracks(
  map: maplibregl.Map,
  tracks: NexradStormTrackFeature[],
) {
  const features: GeoJSON.Feature[] = tracks.flatMap((track) => {
    const trackFeatures: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: track.currentCoordinates,
        },
        properties: {
          kind: 'cell',
          cellId: track.cellId,
          label:
            track.speedMph !== null
              ? `Cell ${track.cellId} | ${track.headingLabel} ${track.speedMph} mph`
              : `Cell ${track.cellId} | ${track.headingLabel}`,
          sortRank: 2,
        },
      },
    ]

    if (track.forecastCoordinates.length > 0) {
      trackFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [track.currentCoordinates, ...track.forecastCoordinates],
        },
        properties: {
          kind: 'track',
          cellId: track.cellId,
          label:
            track.speedMph !== null
              ? `${track.headingLabel} ${track.speedMph} mph`
              : track.headingLabel,
        },
      })
    }

    track.forecastCoordinates.forEach((coordinates, index) => {
      trackFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates,
        },
        properties: {
          kind: 'forecast',
          cellId: track.cellId,
          label: `${(index + 1) * 15} min`,
          sortRank: 1,
        },
      })
    })

    return trackFeatures
  })

  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features,
  }

  if (!hasSourceSafe(map, nexradStormTracksSourceId)) {
    map.addSource(nexradStormTracksSourceId, {
      type: 'geojson',
      data,
    })

    map.addLayer({
      id: nexradStormTracksLineLayerId,
      type: 'line',
      source: nexradStormTracksSourceId,
      filter: ['==', ['get', 'kind'], 'track'],
      paint: {
        'line-color': '#f8fb5f',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 9, 3, 12, 4],
        'line-dasharray': [1.5, 1.2],
        'line-opacity': 0.9,
      },
    })

    map.addLayer({
      id: nexradStormTracksPointLayerId,
      type: 'circle',
      source: nexradStormTracksSourceId,
      filter: ['!=', ['get', 'kind'], 'track'],
      paint: {
        'circle-radius': [
          'match',
          ['get', 'kind'],
          'cell',
          7,
          4,
        ],
        'circle-color': [
          'match',
          ['get', 'kind'],
          'cell',
          '#f8fb5f',
          '#ffffff',
        ],
        'circle-stroke-color': '#111827',
        'circle-stroke-width': 1.5,
      },
    })

    map.addLayer({
      id: nexradStormTracksLabelLayerId,
      type: 'symbol',
      source: nexradStormTracksSourceId,
      filter: ['!=', ['get', 'kind'], 'track'],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': [
          'match',
          ['get', 'kind'],
          'cell',
          12,
          10,
        ],
        'text-offset': [
          'match',
          ['get', 'kind'],
          'cell',
          ['literal', [0, -1.45]],
          ['literal', [0, 1.15]],
        ],
        'text-anchor': [
          'match',
          ['get', 'kind'],
          'cell',
          'bottom',
          'top',
        ],
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'symbol-sort-key': ['get', 'sortRank'],
      },
      paint: {
        'text-color': [
          'match',
          ['get', 'kind'],
          'cell',
          '#f8fb5f',
          '#ffffff',
        ],
        'text-halo-color': '#061018',
        'text-halo-width': 1.8,
        'text-halo-blur': 0.4,
      },
    })
  } else {
    const source = getSourceSafe<maplibregl.GeoJSONSource>(
      map,
      nexradStormTracksSourceId,
    )
    source?.setData(data)
  }

  nudgeMapRender(map)
}

function removeStormTrack(map: maplibregl.Map) {
  if (hasLayerSafe(map, stormTrackPointLayerId)) {
    map.removeLayer(stormTrackPointLayerId)
  }

  if (hasLayerSafe(map, stormTrackLineLayerId)) {
    map.removeLayer(stormTrackLineLayerId)
  }

  if (hasSourceSafe(map, stormTrackSourceId)) {
    map.removeSource(stormTrackSourceId)
  }
}

function syncStormTrackSource(
  map: maplibregl.Map,
  stormTrackOrigin: [number, number] | null,
  stormTrackEnd: [number, number] | null,
  stormTrackMarkers: Array<{
    coordinates: [number, number]
    label: string
  }>,
) {
  const features: GeoJSON.Feature[] = []

  if (stormTrackOrigin) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: stormTrackOrigin,
      },
      properties: {
        kind: 'origin',
        label: 'Storm',
      },
    })
  }

  if (stormTrackOrigin && stormTrackEnd) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [stormTrackOrigin, stormTrackEnd],
      },
      properties: {
        kind: 'track',
      },
    })
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: stormTrackEnd,
      },
      properties: {
        kind: 'end',
        label: 'ETA end',
      },
    })
  }

  stormTrackMarkers.forEach((marker) => {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: marker.coordinates,
      },
      properties: {
        kind: 'marker',
        label: marker.label,
      },
    })
  })

  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features,
  }

  if (!hasSourceSafe(map, stormTrackSourceId)) {
    map.addSource(stormTrackSourceId, {
      type: 'geojson',
      data,
    })

    map.addLayer({
      id: stormTrackLineLayerId,
      type: 'line',
      source: stormTrackSourceId,
      filter: ['==', ['get', 'kind'], 'track'],
      paint: {
        'line-color': '#00d4aa',
        'line-width': 4,
        'line-dasharray': [2, 1.5],
        'line-opacity': 0.92,
      },
    })

    map.addLayer({
      id: stormTrackPointLayerId,
      type: 'circle',
      source: stormTrackSourceId,
      filter: ['!=', ['get', 'kind'], 'track'],
      paint: {
        'circle-radius': [
          'match',
          ['get', 'kind'],
          'origin',
          7,
          'end',
          8,
          4,
        ],
        'circle-color': [
          'match',
          ['get', 'kind'],
          'origin',
          '#00d4aa',
          'end',
          '#7dd3c7',
          '#ffffff',
        ],
        'circle-stroke-color': '#0f2533',
        'circle-stroke-width': 1.5,
      },
    })

  } else {
    const source = getSourceSafe<maplibregl.GeoJSONSource>(map, stormTrackSourceId)
    source?.setData(data)
  }

  map.triggerRepaint()
}

function buildImmediateStormTrackMarkers(
  stormTrackOrigin: [number, number],
  stormTrackEnd: [number, number],
  stormTrackSpeedMph: number,
) {
  const totalDistanceMiles = distanceBetweenMiles(
    stormTrackOrigin,
    stormTrackEnd,
  )

  if (totalDistanceMiles < 8 || stormTrackSpeedMph <= 0) {
    return [
      {
        coordinates: stormTrackEnd,
        label: formatEtaDuration((totalDistanceMiles / Math.max(stormTrackSpeedMph, 1)) * 60),
      },
    ]
  }

  const stepMiles = totalDistanceMiles >= 60 ? 20 : 10
  const markers: Array<{
    coordinates: [number, number]
    label: string
  }> = []

  for (
    let traveledMiles = stepMiles;
    traveledMiles < totalDistanceMiles;
    traveledMiles += stepMiles
  ) {
    const fraction = traveledMiles / totalDistanceMiles
    markers.push({
      coordinates: interpolateCoordinates(stormTrackOrigin, stormTrackEnd, fraction),
      label: formatEtaDuration((traveledMiles / stormTrackSpeedMph) * 60),
    })
  }

  markers.push({
    coordinates: stormTrackEnd,
    label: formatEtaDuration((totalDistanceMiles / stormTrackSpeedMph) * 60),
  })

  return markers
}

function buildProjectedTrackLabels(
  map: maplibregl.Map,
  stormTrackOrigin: [number, number],
  stormTrackMarkers: Array<{
    coordinates: [number, number]
    label: string
  }>,
) {
  const originPoint = map.project(stormTrackOrigin)
  const labels: ProjectedTrackLabel[] = [
    {
      left: originPoint.x + 8,
      top: originPoint.y - 26,
      label: 'Storm',
      kind: 'origin' as const,
    },
  ]

  stormTrackMarkers.forEach((marker, index) => {
    const point = map.project(marker.coordinates)
    labels.push({
      left: point.x,
      top: point.y - 24,
      label: marker.label,
      kind: 'eta' as const,
    })

    if (index === stormTrackMarkers.length - 1) {
      labels.push({
        left: point.x + 12,
        top: point.y + 18,
        label: buildTrackHeadingLabel(stormTrackOrigin, marker.coordinates),
        kind: 'heading' as const,
      })
    }
  })

  return labels
}

function buildTrackHeadingLabel(
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
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return directions[Math.round(bearing / 22.5) % 16]
}

function setLayerVisibility(
  map: maplibregl.Map,
  layerId: string,
  isVisible: boolean,
) {
  if (!hasLayerSafe(map, layerId)) {
    return
  }

  setLayoutPropertySafe(map, layerId, 'visibility', isVisible ? 'visible' : 'none')
}

function setLayoutPropertySafe(
  map: maplibregl.Map,
  layerId: string,
  name: string,
  value: unknown,
) {
  if (!hasLayerSafe(map, layerId)) {
    return
  }

  try {
    map.setLayoutProperty(layerId, name, value)
    nudgeMapRender(map)
  } catch {
    return
  }
}

function setPaintPropertySafe(
  map: maplibregl.Map,
  layerId: string,
  name: string,
  value: unknown,
) {
  if (!hasLayerSafe(map, layerId)) {
    return
  }

  try {
    map.setPaintProperty(layerId, name, value)
    nudgeMapRender(map)
  } catch {
    return
  }
}

function setFilterSafe(
  map: maplibregl.Map,
  layerId: string,
  filter: unknown[] | null,
) {
  if (!hasLayerSafe(map, layerId)) {
    return
  }

  try {
    map.setFilter(layerId, filter as maplibregl.FilterSpecification | null)
    nudgeMapRender(map)
  } catch {
    return
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function buildAlertTypeFilter(alertTypeFilters: MapCanvasProps['alertTypeFilters']) {
  const enabledAlertTypes = (Object.entries(alertTypeFilters) as Array<
    [keyof MapCanvasProps['alertTypeFilters'], boolean]
  >)
    .filter(([, enabled]) => enabled)
    .map(([type]) => type)

  if (enabledAlertTypes.length === 4) {
    return null
  }

  if (enabledAlertTypes.length === 0) {
    return ['==', ['get', 'alertType'], '__none__']
  }

  return [
    'any',
    ...enabledAlertTypes.map((type) => ['==', ['get', 'alertType'], type]),
  ]
}

function nudgeMapRender(map: maplibregl.Map) {
  try {
    map.triggerRepaint()
  } catch {
    return
  }
}

function runWhenStyleLoaded(map: maplibregl.Map, callback: () => void) {
  let active = true
  let frameId: number | null = null

  const cleanupListeners = () => {
    map.off('load', tryRun)
    map.off('styledata', tryRun)
    map.off('idle', tryRun)
  }

  const tryRun = () => {
    if (!active) {
      return
    }

    if (map.isStyleLoaded()) {
      cleanupListeners()
      callback()
      return
    }

    if (frameId === null) {
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        tryRun()
      })
    }
  }

  map.on('load', tryRun)
  map.on('styledata', tryRun)
  map.on('idle', tryRun)
  tryRun()

  return () => {
    active = false
    cleanupListeners()
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
    }
  }
}

function getExistingLayerIds(
  map: maplibregl.Map,
  layerIds: string[],
) {
  return layerIds.filter((layerId) => hasLayerSafe(map, layerId))
}

function getSourceSafe<T extends maplibregl.Source>(
  map: maplibregl.Map,
  sourceId: string,
) {
  try {
    return map.getSource(sourceId) as T | undefined
  } catch {
    return undefined
  }
}

function hasLayerSafe(map: maplibregl.Map, layerId: string) {
  try {
    return Boolean(map.getLayer(layerId))
  } catch {
    return false
  }
}

function hasSourceSafe(map: maplibregl.Map, sourceId: string) {
  try {
    return Boolean(map.getSource(sourceId))
  } catch {
    return false
  }
}

function readViewportSnapshot(map: maplibregl.Map): ViewportSnapshot | null {
  try {
    const bounds = map.getBounds()
    const container = map.getContainer()

    return {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
      mercatorWest: lngLatToWebMercator(bounds.getWest(), bounds.getSouth())[0],
      mercatorSouth: lngLatToWebMercator(bounds.getWest(), bounds.getSouth())[1],
      mercatorEast: lngLatToWebMercator(bounds.getEast(), bounds.getNorth())[0],
      mercatorNorth: lngLatToWebMercator(bounds.getEast(), bounds.getNorth())[1],
      width: Math.max(Math.round(container.clientWidth), 256),
      height: Math.max(Math.round(container.clientHeight), 256),
    }
  } catch {
    return null
  }
}

function buildRasterFrameStyle(
  map: maplibregl.Map,
  viewport: ViewportSnapshot,
  opacity: number,
): CSSProperties {
  try {
    const northWest = map.project([viewport.west, viewport.north])
    const southEast = map.project([viewport.east, viewport.south])
    const left = Math.min(northWest.x, southEast.x)
    const top = Math.min(northWest.y, southEast.y)
    const width = Math.max(Math.abs(southEast.x - northWest.x), 1)
    const height = Math.max(Math.abs(southEast.y - northWest.y), 1)

    return {
      left,
      top,
      width,
      height,
      opacity,
    }
  } catch {
    return {
      inset: 0,
      opacity,
    }
  }
}

function getImageCoordinatesFromViewport(viewport: ViewportSnapshot): [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] {
  return [
    [viewport.west, viewport.north],
    [viewport.east, viewport.north],
    [viewport.east, viewport.south],
    [viewport.west, viewport.south],
  ]
}

function lngLatToWebMercator(lon: number, lat: number): [number, number] {
  const earthRadius = 6378137
  const clampedLat = Math.max(Math.min(lat, 85.05112878), -85.05112878)
  const x = earthRadius * ((lon * Math.PI) / 180)
  const y =
    earthRadius *
    Math.log(Math.tan(Math.PI / 4 + ((clampedLat * Math.PI) / 180) / 2))

  return [x, y]
}

function interpolateCoordinates(
  [startLon, startLat]: [number, number],
  [endLon, endLat]: [number, number],
  fraction: number,
): [number, number] {
  return [
    startLon + (endLon - startLon) * fraction,
    startLat + (endLat - startLat) * fraction,
  ]
}

function prioritizeAlertFeature(
  features: maplibregl.MapGeoJSONFeature[],
) {
  if (features.length === 0) {
    return undefined
  }

  return [...features].sort((left, right) => {
    return getAlertFeaturePriority(right) - getAlertFeaturePriority(left)
  })[0]
}

function getAlertFeaturePriority(feature: maplibregl.MapGeoJSONFeature) {
  const alertType = normalizeAlertType(String(feature.properties?.alertType ?? ''))

  return getAlertTypePriority(alertType)
}

function getAlertTypePriority(
  alertType: 'warning' | 'watch' | 'advisory' | 'statement',
) {
  switch (alertType) {
    case 'warning':
      return 4
    case 'watch':
      return 3
    case 'advisory':
      return 2
    case 'statement':
      return 1
    default:
      return 0
  }
}

function normalizeAlertType(
  alertType: string,
): 'warning' | 'watch' | 'advisory' | 'statement' {
  switch (alertType) {
    case 'warning':
      return 'warning'
    case 'watch':
      return 'watch'
    case 'advisory':
      return 'advisory'
    case 'statement':
    default:
      return 'statement'
  }
}
