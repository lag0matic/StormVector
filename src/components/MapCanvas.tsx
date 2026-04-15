import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import {
  findNearestRadarSiteFromList,
  type RadarProductDefinition,
  type RadarSite,
} from '../services/radar'
import {
  buildSatelliteImageUrl,
  type SatelliteLayerId,
} from '../services/satellite'
import type { CameraFeed } from '../services/cameras'
import type {
  AlertFeature,
  CameraSelection,
  HazardSelection,
  LocalStormReportFeature,
  SpotterNetworkFeature,
  SpcOutlookFeature,
  WinterOutlookFeature,
} from '../types/weather'

type MapCanvasProps = {
  center: [number, number]
  shouldRecenterMap: boolean
  themeMode: 'light' | 'dark'
  activeLayer: string
  radarProduct: 'base' | 'composite' | 'reflectivity' | 'velocity'
  radarView: 'regional' | 'local'
  satelliteLayer: SatelliteLayerId
  radarOpacity: number
  satelliteOpacity: number
  warningOpacity: number
  watchOpacity: number
  polygonOpacity: number
  selectedRegionalRadarTime: string | null
  selectedSatelliteTime: string | null
  radarSites: RadarSite[]
  nearestRadarSite: RadarSite | null
  localRadarDefinition: RadarProductDefinition | null
  selectedRadarSiteId: string | null
  selectedLocalRadarTime: string | null
  alertFeatures: AlertFeature[]
  localStormReports: LocalStormReportFeature[]
  cameraFeeds: CameraFeed[]
  spotterNetworkFeatures: SpotterNetworkFeature[]
  showCameras: boolean
  showSpotterReports: boolean
  showChasers: boolean
  spcFeatures: SpcOutlookFeature[]
  winterFeatures: WinterOutlookFeature[]
  activeForecastOverlay: 'None' | 'SPC Storm Risk' | 'Winter'
  selectedSpcDay: 1 | 2 | 3
  selectedWinterDay: 1 | 2 | 3 | 4
  selectedWinterProduct: 'snowfall' | 'freezingRain'
  trackToolEnabled: boolean
  stormTrackOrigin: [number, number] | null
  stormTrackEnd: [number, number] | null
  stormTrackSpeedMph: number
  stormTrackResetKey: number
  onMapClick: (coordinates: [number, number]) => void
  onRadarSiteSelect: (siteId: string) => void
  onHazardSelect: (selection: HazardSelection) => void
  onCameraSelect: (selection: CameraSelection) => void
  onStormTrackOriginSet: (coordinates: [number, number]) => void
  onStormTrackEndSet: (coordinates: [number, number]) => void
}

const lightBasemapSourceId = 'light-basemap'
const lightBasemapLayerId = 'light-basemap-layer'
const darkBasemapSourceId = 'dark-basemap'
const darkBasemapLayerId = 'dark-basemap-layer'
const radarSitesSourceId = 'nws-radar-sites'
const radarSitesLayerId = 'nws-radar-sites-layer'
const selectedRadarSiteLayerId = 'nws-selected-radar-site-layer'
const radarSiteIconId = 'radar-site-icon'
const alertPolygonsSourceId = 'nws-alert-polygons'
const alertPolygonsFillLayerId = 'nws-alert-polygons-fill'
const alertPolygonsLineLayerId = 'nws-alert-polygons-line'
const localStormReportsSourceId = 'local-storm-reports'
const localStormReportsLayerId = 'local-storm-reports-layer'
const cameraFeedsSourceId = 'camera-feeds'
const cameraFeedsLayerId = 'camera-feeds-layer'
const spcPolygonsSourceId = 'spc-outlook-polygons'
const spcPolygonsFillLayerId = 'spc-outlook-polygons-fill'
const spcPolygonsLineLayerId = 'spc-outlook-polygons-line'
const winterPolygonsSourceId = 'winter-outlook-polygons'
const winterPolygonsFillLayerId = 'winter-outlook-polygons-fill'
const winterPolygonsLineLayerId = 'winter-outlook-polygons-line'
const stormTrackSourceId = 'storm-track-source'
const stormTrackLineLayerId = 'storm-track-line'
const stormTrackPointLayerId = 'storm-track-point'
const clickTolerancePixels = 6

export function MapCanvas({
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
  selectedRegionalRadarTime,
  selectedSatelliteTime,
  radarSites,
  nearestRadarSite,
  localRadarDefinition,
  selectedRadarSiteId,
  selectedLocalRadarTime,
  alertFeatures,
  localStormReports,
  cameraFeeds,
  spotterNetworkFeatures,
  showCameras,
  showSpotterReports,
  showChasers,
  spcFeatures,
  winterFeatures = [],
  activeForecastOverlay,
  selectedSpcDay,
  selectedWinterDay,
  selectedWinterProduct,
  trackToolEnabled,
  stormTrackOrigin,
  stormTrackEnd,
  stormTrackSpeedMph,
  stormTrackResetKey,
  onMapClick,
  onRadarSiteSelect,
  onHazardSelect,
  onCameraSelect,
  onStormTrackOriginSet,
  onStormTrackEndSet,
}: MapCanvasProps) {
  const [mapViewport, setMapViewport] = useState<{
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
  } | null>(null)
  const [projectedTrackLabels, setProjectedTrackLabels] = useState<
    Array<{ left: number; top: number; label: string; kind: 'origin' | 'eta' }>
  >([])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const radarPopupRef = useRef<maplibregl.Popup | null>(null)
  const alertPopupRef = useRef<maplibregl.Popup | null>(null)
  const spcPopupRef = useRef<maplibregl.Popup | null>(null)
  const stormTrackLabelMarkersRef = useRef<maplibregl.Marker[]>([])
  const pointerDownPointRef = useRef<{ x: number; y: number } | null>(null)
  const onMapClickRef = useRef(onMapClick)
  const onRadarSiteSelectRef = useRef(onRadarSiteSelect)
  const onHazardSelectRef = useRef(onHazardSelect)
  const onCameraSelectRef = useRef(onCameraSelect)
  const activeLayerRef = useRef(activeLayer)
  const activeForecastOverlayRef = useRef(activeForecastOverlay)
  const stormTrackDragRef = useRef(false)
  const stormTrackPreviewEndRef = useRef<[number, number] | null>(null)
  const onStormTrackOriginSetRef = useRef(onStormTrackOriginSet)
  const onStormTrackEndSetRef = useRef(onStormTrackEndSet)
  const trackToolEnabledRef = useRef(trackToolEnabled)
  const stormTrackOriginRef = useRef(stormTrackOrigin)
  const stormTrackEndRef = useRef(stormTrackEnd)
  const stormTrackSpeedRef = useRef(stormTrackSpeedMph)

  onMapClickRef.current = onMapClick
  onRadarSiteSelectRef.current = onRadarSiteSelect
  onHazardSelectRef.current = onHazardSelect
  onCameraSelectRef.current = onCameraSelect
  onStormTrackOriginSetRef.current = onStormTrackOriginSet
  onStormTrackEndSetRef.current = onStormTrackEndSet
  activeLayerRef.current = activeLayer
  activeForecastOverlayRef.current = activeForecastOverlay
  trackToolEnabledRef.current = trackToolEnabled
  stormTrackOriginRef.current = stormTrackOrigin
  stormTrackEndRef.current = stormTrackEnd
  stormTrackSpeedRef.current = stormTrackSpeedMph

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
              visibility: themeMode === 'light' ? 'visible' : 'none',
            },
          },
          {
            id: darkBasemapLayerId,
            type: 'raster',
            source: darkBasemapSourceId,
            layout: {
              visibility: themeMode === 'dark' ? 'visible' : 'none',
            },
          },
        ],
      },
      center,
      zoom: 5.25,
      attributionControl: false,
    })

    ;(map as maplibregl.Map & { repaint?: boolean }).repaint = true

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
    map.on('mousedown', (event) => {
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
      syncStormTrackLabelMarkers(
        map,
        stormTrackLabelMarkersRef.current,
        activeStormTrackOrigin,
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
      syncStormTrackLabelMarkers(
        map,
        stormTrackLabelMarkersRef.current,
        activeStormTrackOrigin,
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

        syncStormTrackSource(
          map,
          stormTrackOriginRef.current,
          trackPoint,
          buildImmediateStormTrackMarkers(
            stormTrackOriginRef.current,
            trackPoint,
            stormTrackSpeedRef.current,
          ),
        )
        syncStormTrackLabelMarkers(
          map,
          stormTrackLabelMarkersRef.current,
          stormTrackOriginRef.current,
          buildImmediateStormTrackMarkers(
            stormTrackOriginRef.current,
            trackPoint,
            stormTrackSpeedRef.current,
          ),
        )
        onStormTrackEndSetRef.current(trackPoint)
        return
      }

        const hazardLayers = [
        ...(activeLayerRef.current === 'Radar' && showCameras
          ? [cameraFeedsLayerId]
          : []),
        ...(activeLayerRef.current === 'Radar' && showSpotterReports
          ? [localStormReportsLayerId]
          : []),
        ...(activeLayerRef.current === 'Forecast' &&
        activeForecastOverlayRef.current === 'SPC Storm Risk'
          ? [spcPolygonsFillLayerId, spcPolygonsLineLayerId]
          : []),
        ...(activeLayerRef.current === 'Forecast' &&
        activeForecastOverlayRef.current === 'Winter'
          ? [winterPolygonsFillLayerId, winterPolygonsLineLayerId]
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
    spcPopupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: true,
      offset: 16,
      className: 'alert-popup',
    })

    markerRef.current = new maplibregl.Marker({
      color: '#184f6b',
      scale: 1.1,
    })
      .setLngLat(center)
      .addTo(map)

    const syncViewport = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      const bounds = map.getBounds()
      const container = map.getContainer()
      setMapViewport({
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
      })
    }

    map.on('load', syncViewport)
    map.on('moveend', syncViewport)
    map.on('resize', syncViewport)
    window.requestAnimationFrame(syncViewport)

    mapRef.current = map

    return () => {
      map.off('load', syncViewport)
      map.off('moveend', syncViewport)
      map.off('resize', syncViewport)
      radarPopupRef.current?.remove()
      radarPopupRef.current = null
      alertPopupRef.current?.remove()
      alertPopupRef.current = null
      spcPopupRef.current?.remove()
      spcPopupRef.current = null
      markerRef.current?.remove()
      markerRef.current = null
      setProjectedTrackLabels([])
      clearStormTrackLabelMarkers(stormTrackLabelMarkersRef.current)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const handleTrackMouseDown = (event: maplibregl.MapMouseEvent) => {
      const activeStormTrackOrigin = stormTrackOriginRef.current

      if (
        !trackToolEnabledRef.current ||
        !activeStormTrackOrigin ||
        event.originalEvent.button !== 0
      ) {
        return
      }

      const targetPoint: [number, number] = [event.lngLat.lng, event.lngLat.lat]

      if (distanceBetweenCoordinatesMiles(targetPoint, activeStormTrackOrigin) > 30) {
        return
      }

      stormTrackDragRef.current = true
      stormTrackPreviewEndRef.current = stormTrackEndRef.current ?? activeStormTrackOrigin
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

    if (map.isStyleLoaded()) {
      applySites()
    } else {
      map.once('load', applySites)
    }
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
      nudgeMapRender(map)
    }

    if (map.isStyleLoaded()) {
      applyAlertPolygons()
    } else {
      map.once('load', applyAlertPolygons)
    }
  }, [alertFeatures, polygonOpacity, warningOpacity, watchOpacity])

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

    if (map.isStyleLoaded()) {
      applyLocalStormReports()
    } else {
      map.once('load', applyLocalStormReports)
    }
  }, [activeLayer, localStormReports, showSpotterReports])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const collection: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: cameraFeeds.map((feed) => ({
        type: 'Feature',
        properties: {
          id: feed.id,
          name: feed.name,
          provider: feed.provider,
          pageUrl: feed.pageUrl ?? '',
          imageUrl: feed.imageUrl ?? '',
          embedUrl: feed.embedUrl ?? '',
          description: feed.description ?? '',
        },
        geometry: {
          type: 'Point',
          coordinates: feed.coordinates,
        },
      })),
    }

    const applyCameraFeeds = () => {
      if (!hasSourceSafe(map, cameraFeedsSourceId)) {
        map.addSource(cameraFeedsSourceId, {
          type: 'geojson',
          data: collection,
        })

        map.addLayer({
          id: cameraFeedsLayerId,
          type: 'circle',
          source: cameraFeedsSourceId,
          paint: {
            'circle-radius': 8,
            'circle-color': '#f7fbff',
            'circle-stroke-color': '#0f2533',
            'circle-stroke-width': 2.5,
            'circle-opacity': 0.98,
            'circle-blur': 0.08,
          },
        })
      } else {
        const source = getSourceSafe<maplibregl.GeoJSONSource>(map, cameraFeedsSourceId)
        source?.setData(collection)
      }

      setLayerVisibility(
        map,
        cameraFeedsLayerId,
        activeLayer === 'Radar' && showCameras,
      )
      nudgeMapRender(map)
    }

    if (map.isStyleLoaded()) {
      applyCameraFeeds()
    } else {
      map.once('load', applyCameraFeeds)
    }
  }, [activeLayer, cameraFeeds, showCameras])

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
      if (!(activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk')) {
        removeLayerSafe(map, spcPolygonsLineLayerId)
        removeLayerAndSourceSafe(map, spcPolygonsFillLayerId, spcPolygonsSourceId)
        nudgeMapRender(map)
        return
      }

      if (!hasSourceSafe(map, spcPolygonsSourceId)) {
        map.addSource(spcPolygonsSourceId, {
          type: 'geojson',
          data: collection,
        })

        map.addLayer({
          id: spcPolygonsFillLayerId,
          type: 'fill',
          source: spcPolygonsSourceId,
          paint: {
            'fill-color': ['get', 'fillColor'],
            'fill-opacity': polygonOpacity,
          },
        })

        map.addLayer({
          id: spcPolygonsLineLayerId,
          type: 'line',
          source: spcPolygonsSourceId,
          paint: {
            'line-color': ['get', 'lineColor'],
            'line-width': 2,
            'line-opacity': 0.95,
          },
        })
      } else {
        const source = getSourceSafe<maplibregl.GeoJSONSource>(map, spcPolygonsSourceId)
        source?.setData(collection)
      }
      nudgeMapRender(map)
    }

    if (map.isStyleLoaded()) {
      applySpcPolygons()
    } else {
      map.once('load', applySpcPolygons)
    }
  }, [activeForecastOverlay, activeLayer, spcFeatures])

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

    const applyWinterPolygons = () => {
      if (!(activeLayer === 'Forecast' && activeForecastOverlay === 'Winter')) {
        removeLayerSafe(map, winterPolygonsLineLayerId)
        removeLayerAndSourceSafe(map, winterPolygonsFillLayerId, winterPolygonsSourceId)
        nudgeMapRender(map)
        return
      }

      if (!hasSourceSafe(map, winterPolygonsSourceId)) {
        map.addSource(winterPolygonsSourceId, {
          type: 'geojson',
          data: collection,
        })

        map.addLayer({
          id: winterPolygonsFillLayerId,
          type: 'fill',
          source: winterPolygonsSourceId,
          paint: {
            'fill-color': ['get', 'fillColor'],
            'fill-opacity': polygonOpacity,
          },
        })

        map.addLayer({
          id: winterPolygonsLineLayerId,
          type: 'line',
          source: winterPolygonsSourceId,
          paint: {
            'line-color': ['get', 'lineColor'],
            'line-width': 2,
            'line-opacity': 0.92,
          },
        })
      } else {
        const source = getSourceSafe<maplibregl.GeoJSONSource>(map, winterPolygonsSourceId)
        source?.setData(collection)
      }
      nudgeMapRender(map)
    }

    if (map.isStyleLoaded()) {
      applyWinterPolygons()
    } else {
      map.once('load', applyWinterPolygons)
    }
  }, [activeForecastOverlay, activeLayer, winterFeatures])

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
    setPaintPropertySafe(map, spcPolygonsFillLayerId, 'fill-opacity', polygonOpacity)
    setPaintPropertySafe(map, winterPolygonsFillLayerId, 'fill-opacity', polygonOpacity)
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
        localStormReportsLayerId,
        activeLayer === 'Radar' && showSpotterReports,
      )
      setLayerVisibility(
        map,
        cameraFeedsLayerId,
        activeLayer === 'Radar' && showCameras,
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
    }

    if (map.isStyleLoaded()) {
      syncLayerVisibility()
    } else {
      map.once('load', syncLayerVisibility)
    }
  }, [activeForecastOverlay, activeLayer, radarView, showCameras, showSpotterReports])

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
        ...(activeLayer === 'Radar' && showCameras
          ? [cameraFeedsLayerId]
          : []),
        ...(activeLayer === 'Radar' && showSpotterReports
          ? [localStormReportsLayerId]
          : []),
        ...(activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk'
          ? [spcPolygonsFillLayerId, spcPolygonsLineLayerId]
          : []),
        ...(activeLayer === 'Forecast' && activeForecastOverlay === 'Winter'
          ? [winterPolygonsFillLayerId, winterPolygonsLineLayerId]
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
  }, [activeForecastOverlay, activeLayer, showCameras, showSpotterReports])

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
      const feature =
        alertLayers.length > 0
          ? prioritizeAlertFeature(
              map.queryRenderedFeatures(event.point, {
                layers: alertLayers,
              }),
            )
          : undefined

      if (!feature) {
        popup.remove()
        return
      }

      popup
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>${feature.properties?.event ?? 'Active alert'}</strong><div>${feature.properties?.headline ?? ''}</div><div>${feature.properties?.severity ?? 'Unknown'} severity | ${feature.properties?.urgency ?? 'Unknown'} urgency</div><div>${feature.properties?.areaDescription ?? ''}</div>`,
        )
        .addTo(map)

      onHazardSelectRef.current({
        source: 'alerts',
        title: String(feature.properties?.event ?? 'Active alert'),
        subtitle: String(feature.properties?.headline ?? 'NWS active alert'),
        summary: String(
          feature.properties?.areaDescription ?? 'Area description unavailable.',
        ),
        body: buildAlertNarrative(
          String(feature.properties?.description ?? ''),
          String(feature.properties?.instruction ?? ''),
        ),
        detailLines: [
          `Severity: ${String(feature.properties?.severity ?? 'Unknown')}`,
          `Urgency: ${String(feature.properties?.urgency ?? 'Unknown')}`,
          ...(feature.properties?.effective
            ? [`Effective: ${formatIsoTimestamp(String(feature.properties.effective))}`]
            : []),
          ...(feature.properties?.expires
            ? [`Expires: ${formatIsoTimestamp(String(feature.properties.expires))}`]
            : []),
        ],
      })
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

      popup
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>${feature.properties?.eventType ?? 'Spotter report'}</strong><div>${feature.properties?.city ?? ''}, ${feature.properties?.state ?? ''}</div><div>${feature.properties?.source ?? ''}</div>`,
        )
        .addTo(map)

      onHazardSelectRef.current({
        source: 'lsr',
        title: String(feature.properties?.eventType ?? 'Spotter report'),
        subtitle: `${String(feature.properties?.city ?? 'Unknown location')}, ${String(
          feature.properties?.state ?? '',
        )}`,
        summary: String(feature.properties?.remark ?? 'No report remark available.'),
        detailLines: [
          `Reported: ${formatCompactTimestamp(String(feature.properties?.valid ?? ''))}`,
          `Source: ${String(feature.properties?.source ?? 'Unknown')}`,
          ...(feature.properties?.magnitude &&
          String(feature.properties?.magnitude) !== 'None'
            ? [
                `Magnitude: ${String(feature.properties?.magnitude)}${
                  feature.properties?.qualifier
                    ? ` (${String(feature.properties.qualifier)})`
                    : ''
                }`,
              ]
            : []),
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
    const popup = alertPopupRef.current

    if (!map || !popup) {
      return
    }

    const handleCameraClick = (event: maplibregl.MapMouseEvent) => {
      if (
        activeLayerRef.current !== 'Radar' ||
        !showCameras ||
        !hasLayerSafe(map, cameraFeedsLayerId)
      ) {
        return
      }

      const feature = map.queryRenderedFeatures(event.point, {
        layers: [cameraFeedsLayerId],
      })[0]

      if (!feature) {
        return
      }

      popup
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>${feature.properties?.name ?? 'Camera'}</strong><div>${feature.properties?.provider ?? 'Unknown provider'}</div><div>${feature.properties?.description ?? ''}</div>`,
        )
        .addTo(map)

      onCameraSelectRef.current({
        title: String(feature.properties?.name ?? 'Camera'),
        provider: String(feature.properties?.provider ?? 'Unknown'),
        summary: String(
          feature.properties?.description ?? 'Live camera feed available.',
        ),
        pageUrl: String(feature.properties?.pageUrl ?? '') || undefined,
        imageUrl: String(feature.properties?.imageUrl ?? '') || undefined,
        embedUrl: String(feature.properties?.embedUrl ?? '') || undefined,
      })
    }

    map.on('click', handleCameraClick)

    return () => {
      map.off('click', handleCameraClick)
    }
  }, [showCameras])

  useEffect(() => {
    const map = mapRef.current
    const popup = spcPopupRef.current

    if (!map || !popup) {
      return
    }

    const handleSpcClick = (event: maplibregl.MapMouseEvent) => {
      if (!(activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk')) {
        return
      }

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

      if (!feature) {
        popup.remove()
        return
      }

      popup
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>SPC Day ${selectedSpcDay} ${feature.properties?.category ?? 'Outlook'}</strong><div>Valid: ${formatCompactTimestamp(feature.properties?.valid)}</div><div>Expires: ${formatCompactTimestamp(feature.properties?.expire)}</div>`,
        )
        .addTo(map)

      onHazardSelectRef.current({
        source: 'spc',
        title: `SPC Day ${selectedSpcDay} ${String(feature.properties?.category ?? 'Outlook')}`,
        subtitle: 'Storm Prediction Center categorical outlook',
        summary: 'This polygon shows the current SPC severe-weather risk area for the selected day.',
        detailLines: [
          `Valid: ${formatCompactTimestamp(feature.properties?.valid)}`,
          `Expires: ${formatCompactTimestamp(feature.properties?.expire)}`,
        ],
      })
    }

    map.on('click', handleSpcClick)

    return () => {
      map.off('click', handleSpcClick)
      popup.remove()
    }
  }, [activeForecastOverlay, activeLayer, selectedSpcDay])

  useEffect(() => {
    const map = mapRef.current
    const popup = spcPopupRef.current

    if (!map || !popup) {
      return
    }

    const handleWinterClick = (event: maplibregl.MapMouseEvent) => {
      if (!(activeLayer === 'Forecast' && activeForecastOverlay === 'Winter')) {
        return
      }

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

      if (!feature) {
        popup.remove()
        return
      }

      popup
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>WPC Day ${selectedWinterDay} ${selectedWinterProduct === 'snowfall' ? 'Snowfall' : 'Freezing Rain'}</strong><div>${feature.properties?.outlook ?? 'Winter outlook'}</div><div>${feature.properties?.snippet ?? ''}</div>`,
        )
        .addTo(map)

      onHazardSelectRef.current({
        source: 'winter',
        title: `WPC Day ${selectedWinterDay} ${selectedWinterProduct === 'snowfall' ? 'Snowfall' : 'Freezing Rain'}`,
        subtitle: String(feature.properties?.outlook ?? 'Winter outlook'),
        summary: String(
          feature.properties?.snippet ??
            'Probability of exceeding local winter storm warning criteria.',
        ),
        detailLines: [
          `Valid: ${String(feature.properties?.validTime ?? 'Unavailable')}`,
          `Issued: ${String(feature.properties?.issueTime ?? 'Unavailable')}`,
        ],
      })
    }

    map.on('click', handleWinterClick)

    return () => {
      map.off('click', handleWinterClick)
      popup.remove()
    }
  }, [activeForecastOverlay, activeLayer, selectedWinterDay, selectedWinterProduct])

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
        clearStormTrackLabelMarkers(stormTrackLabelMarkersRef.current)
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
      syncStormTrackLabelMarkers(
        map,
        stormTrackLabelMarkersRef.current,
        stormTrackOrigin,
        currentMarkers,
      )
    }

    if (map.isStyleLoaded()) {
      runSync()
    } else {
      map.once('load', runSync)
    }
  }, [
    stormTrackEnd,
    stormTrackOrigin,
    stormTrackResetKey,
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
    clearStormTrackLabelMarkers(stormTrackLabelMarkersRef.current)
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
    syncStormTrackLabelMarkers(
      map,
      stormTrackLabelMarkersRef.current,
      stormTrackOrigin,
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
    clearStormTrackLabelMarkers(stormTrackLabelMarkersRef.current)
  }, [stormTrackResetKey])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const syncProjectedLabels = () => {
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

    syncProjectedLabels()
    map.on('move', syncProjectedLabels)
    map.on('zoom', syncProjectedLabels)
    map.on('resize', syncProjectedLabels)

    return () => {
      map.off('move', syncProjectedLabels)
      map.off('zoom', syncProjectedLabels)
      map.off('resize', syncProjectedLabels)
    }
  }, [])

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

  const regionalRadarOverlayUrl =
    mapViewport && activeLayer === 'Radar' && radarView === 'regional'
      ? buildRegionalRadarImageUrl(
          radarProduct === 'composite' ? 'composite' : 'base',
          {
            west: mapViewport.mercatorWest,
            south: mapViewport.mercatorSouth,
            east: mapViewport.mercatorEast,
            north: mapViewport.mercatorNorth,
            width: mapViewport.width,
            height: mapViewport.height,
            time: selectedRegionalRadarTime,
          },
        )
      : null
  const localRadarOverlayUrl =
    mapViewport &&
    activeLayer === 'Radar' &&
    radarView === 'local' &&
    nearestRadarSite &&
    localRadarDefinition
      ? buildLocalRadarImageUrl({
          nearestRadarSite,
          localRadarDefinition,
          selectedLocalRadarTime,
          west: mapViewport.mercatorWest,
          south: mapViewport.mercatorSouth,
          east: mapViewport.mercatorEast,
          north: mapViewport.mercatorNorth,
          width: mapViewport.width,
          height: mapViewport.height,
        })
      : null
  const satelliteOverlayUrl =
    mapViewport && activeLayer === 'Satellite'
      ? buildSatelliteImageUrl(satelliteLayer, {
          west: mapViewport.west,
          south: mapViewport.south,
          east: mapViewport.east,
          north: mapViewport.north,
          width: mapViewport.width,
          height: mapViewport.height,
          time: selectedSatelliteTime,
        })
      : null
  const projectedSpcFeatures =
    mapRef.current && mapViewport && activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk'
      ? projectPolygonFeatures(mapRef.current, spcFeatures)
      : []
  const projectedWinterFeatures =
    mapRef.current && mapViewport && activeLayer === 'Forecast' && activeForecastOverlay === 'Winter'
      ? projectPolygonFeatures(mapRef.current, winterFeatures)
      : []
  const projectedLocalStormReports =
    mapRef.current && mapViewport && activeLayer === 'Radar' && showSpotterReports
      ? projectPointFeatures(mapRef.current, localStormReports, (feature) => feature.coordinates)
      : []
  const projectedCameraFeeds =
    mapRef.current && mapViewport && activeLayer === 'Radar' && showCameras
      ? projectPointFeatures(mapRef.current, cameraFeeds, (feed) => feed.coordinates)
      : []
  const projectedSpotterNetworkFeatures =
    mapRef.current && mapViewport && activeLayer === 'Radar' && showChasers
      ? projectPointFeatures(
          mapRef.current,
          spotterNetworkFeatures,
          (feature) => feature.coordinates,
        )
      : []

  return (
    <div className="map-surface">
      <div ref={containerRef} className="map-canvas" />
      <div className="map-raster-stack" aria-hidden="true">
        {satelliteOverlayUrl ? (
          <img
            key={satelliteOverlayUrl}
            className="map-raster-image"
            src={satelliteOverlayUrl}
            alt=""
            style={{ opacity: satelliteOpacity }}
          />
        ) : null}
        {regionalRadarOverlayUrl ? (
          <img
            key={regionalRadarOverlayUrl}
            className="map-raster-image"
            src={regionalRadarOverlayUrl}
            alt=""
            style={{ opacity: radarOpacity }}
          />
        ) : null}
        {localRadarOverlayUrl ? (
          <img
            key={localRadarOverlayUrl}
            className="map-raster-image"
            src={localRadarOverlayUrl}
            alt=""
            style={{ opacity: radarOpacity }}
          />
        ) : null}
      </div>
      {projectedSpcFeatures.length > 0 ? (
        <svg className="map-vector-overlay" viewBox={`0 0 ${mapViewport?.width ?? 0} ${mapViewport?.height ?? 0}`}>
          {projectedSpcFeatures.map(({ feature, path }) => (
            <path
              key={feature.id}
              d={path}
              fill={feature.fillColor}
              fillOpacity={polygonOpacity}
              stroke={feature.lineColor}
              strokeWidth={2}
              strokeOpacity={0.95}
              fillRule="evenodd"
              onClick={(event) => {
                const map = mapRef.current

                if (map) {
                  const svgBounds =
                    event.currentTarget.ownerSVGElement?.getBoundingClientRect()

                  if (svgBounds) {
                    const point: [number, number] = [
                      event.clientX - svgBounds.left,
                      event.clientY - svgBounds.top,
                    ]
                    const alertLayers = getExistingLayerIds(map, [
                      alertPolygonsFillLayerId,
                      alertPolygonsLineLayerId,
                    ])
                    const alertFeature =
                      alertLayers.length > 0
                        ? prioritizeAlertFeature(
                            map.queryRenderedFeatures(point, {
                              layers: alertLayers,
                            }),
                          )
                        : undefined

                    if (alertFeature) {
                      onHazardSelectRef.current(buildAlertSelectionFromMapFeature(alertFeature))
                      return
                    }
                  }
                }

                onHazardSelectRef.current({
                  source: 'spc',
                  title: `SPC Day ${selectedSpcDay} ${feature.category}`,
                  subtitle: `${feature.category} risk area`,
                  summary:
                    'This polygon shows the current SPC severe-weather risk area for the selected day.',
                  detailLines: [
                    `Category: ${feature.category}`,
                    `Valid: ${formatCompactTimestamp(feature.valid)}`,
                    `Expires: ${formatCompactTimestamp(feature.expire)}`,
                  ],
                })
              }}
            />
          ))}
        </svg>
      ) : null}
      {projectedWinterFeatures.length > 0 ? (
        <svg className="map-vector-overlay" viewBox={`0 0 ${mapViewport?.width ?? 0} ${mapViewport?.height ?? 0}`}>
          {projectedWinterFeatures.map(({ feature, path }) => (
            <path
              key={feature.id}
              d={path}
              fill={feature.fillColor}
              fillOpacity={polygonOpacity}
              stroke={feature.lineColor}
              strokeWidth={2}
              strokeOpacity={0.92}
              fillRule="evenodd"
              onClick={() =>
                onHazardSelectRef.current({
                  source: 'winter',
                  title: `WPC Day ${selectedWinterDay} ${
                    selectedWinterProduct === 'snowfall' ? 'Snowfall' : 'Freezing Rain'
                  }`,
                  subtitle: feature.outlook,
                  summary:
                    feature.snippet ||
                    'Probability of exceeding local winter storm warning criteria.',
                  detailLines: [
                    `Valid: ${feature.validTime || 'Unavailable'}`,
                    `Issued: ${feature.issueTime || 'Unavailable'}`,
                  ],
                })
              }
            />
          ))}
        </svg>
      ) : null}
      {projectedLocalStormReports.length > 0 ? (
        <div className="map-point-overlay">
          {projectedLocalStormReports.map(({ feature, point }) => (
            <button
              key={feature.id}
              type="button"
              className="map-point-marker report"
              style={{
                left: `${point.x}px`,
                top: `${point.y}px`,
                backgroundColor: feature.fillColor,
                borderColor: feature.strokeColor,
                width:
                  feature.reportCategory === 'tornado'
                    ? '16px'
                    : feature.reportCategory === 'hail' || feature.reportCategory === 'wind'
                      ? '14px'
                      : '12px',
                height:
                  feature.reportCategory === 'tornado'
                    ? '16px'
                    : feature.reportCategory === 'hail' || feature.reportCategory === 'wind'
                      ? '14px'
                      : '12px',
              }}
              onClick={() => onHazardSelectRef.current(buildLocalStormReportSelection(feature))}
              title={`${feature.eventType} - ${feature.city}, ${feature.state}`}
              aria-label={`${feature.eventType} report near ${feature.city}, ${feature.state}`}
            />
          ))}
        </div>
      ) : null}
      {projectedCameraFeeds.length > 0 ? (
        <div className="map-point-overlay">
          {projectedCameraFeeds.map(({ feature, point }) => (
            <button
              key={feature.id}
              type="button"
              className="map-point-marker camera"
              style={{
                left: `${point.x}px`,
                top: `${point.y}px`,
              }}
              onClick={() =>
                onCameraSelectRef.current({
                  title: feature.name,
                  provider: feature.provider,
                  summary: feature.description || 'Live camera feed available.',
                  pageUrl: feature.pageUrl,
                  imageUrl: feature.imageUrl,
                  embedUrl: feature.embedUrl,
                })
              }
              title={feature.name}
              aria-label={`Camera: ${feature.name}`}
            />
          ))}
        </div>
      ) : null}
      {projectedSpotterNetworkFeatures.length > 0 ? (
        <div className="map-point-overlay">
          {projectedSpotterNetworkFeatures.map(({ feature, point }) => (
            <button
              key={feature.id}
              type="button"
              className="map-point-marker chaser"
              style={{
                left: `${point.x}px`,
                top: `${point.y}px`,
              }}
              onClick={() =>
                onHazardSelectRef.current(buildSpotterNetworkSelection(feature))
              }
              title={`${feature.label} - ${feature.heading}`}
              aria-label={`Chaser: ${feature.label}`}
            />
          ))}
        </div>
      ) : null}
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
}

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

function buildAlertNarrative(description: string, instruction: string) {
  const parts = [description.trim(), instruction.trim()].filter(Boolean)
  return parts.join('\n\n')
}

function buildAlertSelectionFromMapFeature(
  feature: maplibregl.MapGeoJSONFeature,
): HazardSelection {
  return {
    source: 'alerts',
    title: String(feature.properties?.event ?? 'Active alert'),
    subtitle: String(feature.properties?.headline ?? 'NWS active alert'),
    summary: String(
      feature.properties?.areaDescription ?? 'Area description unavailable.',
    ),
    body: buildAlertNarrative(
      String(feature.properties?.description ?? ''),
      String(feature.properties?.instruction ?? ''),
    ),
    detailLines: [
      `Severity: ${String(feature.properties?.severity ?? 'Unknown')}`,
      `Urgency: ${String(feature.properties?.urgency ?? 'Unknown')}`,
      ...(feature.properties?.effective
        ? [`Effective: ${formatIsoTimestamp(String(feature.properties.effective))}`]
        : []),
      ...(feature.properties?.expires
        ? [`Expires: ${formatIsoTimestamp(String(feature.properties.expires))}`]
        : []),
    ],
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
      `Reported: ${formatCompactTimestamp(report.valid)}`,
      ...(report.ageMinutes !== null ? [`Age: ${formatReportAge(report.ageMinutes)}`] : []),
      `Source: ${report.source || 'Unknown'}`,
      ...(report.magnitude && report.magnitude !== 'None'
        ? [
            `Magnitude: ${report.magnitude}${
              report.qualifier ? ` (${report.qualifier})` : ''
            }`,
          ]
        : []),
      `County: ${report.county || 'Unknown'}`,
    ],
  }
}

function buildSpotterNetworkSelection(
  feature: SpotterNetworkFeature,
): HazardSelection {
  return {
    source: 'spotter',
    title: feature.label,
    subtitle: `Spotter Network • ${feature.platform}`,
    summary: feature.note || 'Affiliated live streamer location.',
    detailLines: [
      `Updated: ${feature.timestamp}`,
      `Motion: ${feature.heading}`,
      `Position: ${feature.coordinates[1].toFixed(3)}, ${feature.coordinates[0].toFixed(3)}`,
    ],
    pageUrl: feature.pageUrl,
    embedUrl: feature.embedUrl,
  }
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
  context.strokeStyle = '#184f6b'
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

function buildRegionalRadarImageUrl(
  radarProduct: 'base' | 'composite',
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
  const refreshBucket = Math.floor(Date.now() / 120000)
  const layerName =
    radarProduct === 'composite' ? 'conus_cref_qcd' : 'conus_bref_qcd'
  const timeParam = time ? `&time=${encodeURIComponent(time)}` : ''
  const cacheKey = time ? time : String(refreshBucket)

  return `https://opengeo.ncep.noaa.gov/geoserver/conus/${layerName}/wms?service=WMS&version=1.1.1&request=GetMap&layers=${layerName}&styles=radar_reflectivity&format=image/png&transparent=true&srs=EPSG:3857&bbox=${west},${south},${east},${north}&width=${width}&height=${height}${timeParam}&frame=${encodeURIComponent(cacheKey)}`
}

function buildLocalRadarImageUrl({
  nearestRadarSite,
  localRadarDefinition,
  selectedLocalRadarTime,
  west,
  south,
  east,
  north,
  width,
  height,
}: {
  nearestRadarSite: RadarSite
  localRadarDefinition: RadarProductDefinition | null
  selectedLocalRadarTime: string | null
  west: number
  south: number
  east: number
  north: number
  width: number
  height: number
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

  return `https://opengeo.ncep.noaa.gov/geoserver/${siteWorkspace}/ows?service=WMS&version=1.1.1&request=GetMap&layers=${layerName}&styles=${styleName}&format=image/png&transparent=true&srs=EPSG:3857&bbox=${west},${south},${east},${north}&width=${width}&height=${height}${timeParam}&refresh=${refreshBucket}`
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
        'line-color': '#19b4ff',
        'line-width': 3,
        'line-dasharray': [2, 1.5],
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
          6,
          'end',
          5,
          4,
        ],
        'circle-color': [
          'match',
          ['get', 'kind'],
          'origin',
          '#19b4ff',
          'end',
          '#7fe0ff',
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
  const totalDistanceMiles = distanceBetweenCoordinatesMiles(
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

function clearStormTrackLabelMarkers(markers: maplibregl.Marker[]) {
  markers.forEach((marker) => marker.remove())
  markers.length = 0
}

function syncStormTrackLabelMarkers(
  _map: maplibregl.Map,
  _markersRef: maplibregl.Marker[],
  _stormTrackOrigin: [number, number],
  _stormTrackMarkers: Array<{
    coordinates: [number, number]
    label: string
  }>,
) {
  return
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
  const labels: Array<{
    left: number
    top: number
    label: string
    kind: 'origin' | 'eta'
  }> = [
    {
      left: originPoint.x + 8,
      top: originPoint.y - 26,
      label: 'Storm',
      kind: 'origin' as const,
    },
  ]

  stormTrackMarkers.forEach((marker) => {
    const point = map.project(marker.coordinates)
    labels.push({
      left: point.x,
      top: point.y - 24,
      label: marker.label,
      kind: 'eta' as const,
    })
  })

  return labels
}

function projectPolygonFeatures<T extends { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }>(
  map: maplibregl.Map,
  features: T[],
) {
  return features
    .map((feature) => ({
      feature,
      path: buildProjectedGeometryPath(map, feature.geometry),
    }))
    .filter((item) => item.path.length > 0)
}

function buildProjectedGeometryPath(
  map: maplibregl.Map,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
) {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring) => projectRingPath(map, ring)).join(' ')
  }

  return geometry.coordinates
    .map((polygon) => polygon.map((ring) => projectRingPath(map, ring)).join(' '))
    .join(' ')
}

function projectRingPath(
  map: maplibregl.Map,
  ring: number[][],
) {
  if (ring.length === 0) {
    return ''
  }

  return ring
    .map(([lon, lat], index) => {
      const point = map.project([lon, lat])
      return `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
    })
    .join(' ') + ' Z'
}

function projectPointFeatures<T>(
  map: maplibregl.Map,
  features: T[],
  getCoordinates: (feature: T) => [number, number],
) {
  const container = map.getContainer()
  const width = container.clientWidth
  const height = container.clientHeight
  const buffer = 32

  return features
    .map((feature) => ({
      feature,
      point: map.project(getCoordinates(feature)),
    }))
    .filter(
      ({ point }) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= -buffer &&
        point.x <= width + buffer &&
        point.y >= -buffer &&
        point.y <= height + buffer,
    )
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

function removeLayerSafe(map: maplibregl.Map, layerId: string) {
  if (!hasLayerSafe(map, layerId)) {
    return
  }

  try {
    map.removeLayer(layerId)
  } catch {
    return
  }
}

function removeLayerAndSourceSafe(
  map: maplibregl.Map,
  layerId: string,
  sourceId: string,
) {
  removeLayerSafe(map, layerId)

  if (!hasSourceSafe(map, sourceId)) {
    return
  }

  try {
    map.removeSource(sourceId)
  } catch {
    return
  }
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

function nudgeMapRender(map: maplibregl.Map) {
  try {
    const center = map.getCenter()
    map.jumpTo({
      center,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    })
    window.requestAnimationFrame(() => {
      try {
        const nextCenter = map.getCenter()
        map.jumpTo({
          center: nextCenter,
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        })
      } catch {
        return
      }
    })
  } catch {
    return
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

function lngLatToWebMercator(lon: number, lat: number): [number, number] {
  const earthRadius = 6378137
  const clampedLat = Math.max(Math.min(lat, 85.05112878), -85.05112878)
  const x = earthRadius * ((lon * Math.PI) / 180)
  const y =
    earthRadius *
    Math.log(Math.tan(Math.PI / 4 + ((clampedLat * Math.PI) / 180) / 2))

  return [x, y]
}

function distanceBetweenCoordinatesMiles(
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

function formatEtaDuration(totalMinutes: number) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return 'now'
  }

  const roundedMinutes = Math.max(1, Math.round(totalMinutes))
  const hours = Math.floor(roundedMinutes / 60)
  const minutes = roundedMinutes % 60

  if (hours === 0) {
    return `${minutes}m`
  }

  return `${hours}:${String(minutes).padStart(2, '0')}`
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
  const alertType = String(feature.properties?.alertType ?? '')

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
