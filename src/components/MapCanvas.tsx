import { useEffect, useRef } from 'react'
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
import type {
  AlertFeature,
  HazardSelection,
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
  polygonOpacity: number
  selectedRegionalRadarTime: string | null
  selectedSatelliteTime: string | null
  radarSites: RadarSite[]
  nearestRadarSite: RadarSite | null
  localRadarDefinition: RadarProductDefinition | null
  selectedRadarSiteId: string | null
  selectedLocalRadarTime: string | null
  alertFeatures: AlertFeature[]
  spcFeatures: SpcOutlookFeature[]
  winterFeatures: WinterOutlookFeature[]
  activeForecastOverlay: 'None' | 'SPC Storm Risk' | 'Winter'
  selectedSpcDay: 1 | 2 | 3
  selectedWinterDay: 1 | 2 | 3 | 4
  selectedWinterProduct: 'snowfall' | 'freezingRain'
  onMapClick: (coordinates: [number, number]) => void
  onRadarSiteSelect: (siteId: string) => void
  onHazardSelect: (selection: HazardSelection) => void
}

const regionalRadarSourceId = 'nws-radar-source'
const regionalRadarLayerId = 'nws-radar-layer'
const lightBasemapSourceId = 'light-basemap'
const lightBasemapLayerId = 'light-basemap-layer'
const darkBasemapSourceId = 'dark-basemap'
const darkBasemapLayerId = 'dark-basemap-layer'
const satelliteSourceId = 'goes-satellite-source'
const satelliteLayerId = 'goes-satellite-layer'
const localRadarSourceId = 'nws-local-radar-source'
const localRadarLayerId = 'nws-local-radar-layer'
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
  polygonOpacity,
  selectedRegionalRadarTime,
  selectedSatelliteTime,
  radarSites,
  nearestRadarSite,
  localRadarDefinition,
  selectedRadarSiteId,
  selectedLocalRadarTime,
  alertFeatures,
  spcFeatures,
  winterFeatures = [],
  activeForecastOverlay,
  selectedSpcDay,
  selectedWinterDay,
  selectedWinterProduct,
  onMapClick,
  onRadarSiteSelect,
  onHazardSelect,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const radarPopupRef = useRef<maplibregl.Popup | null>(null)
  const alertPopupRef = useRef<maplibregl.Popup | null>(null)
  const spcPopupRef = useRef<maplibregl.Popup | null>(null)
  const pointerDownPointRef = useRef<{ x: number; y: number } | null>(null)
  const onMapClickRef = useRef(onMapClick)
  const onRadarSiteSelectRef = useRef(onRadarSiteSelect)
  const onHazardSelectRef = useRef(onHazardSelect)
  const regionalRadarUrlRef = useRef('')
  const activeLayerRef = useRef(activeLayer)
  const activeForecastOverlayRef = useRef(activeForecastOverlay)

  onMapClickRef.current = onMapClick
  onRadarSiteSelectRef.current = onRadarSiteSelect
  onHazardSelectRef.current = onHazardSelect
  activeLayerRef.current = activeLayer
  activeForecastOverlayRef.current = activeForecastOverlay

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

      const hazardLayers = [
        alertPolygonsFillLayerId,
        alertPolygonsLineLayerId,
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

    mapRef.current = map

    return () => {
      radarPopupRef.current?.remove()
      radarPopupRef.current = null
      alertPopupRef.current?.remove()
      alertPopupRef.current = null
      spcPopupRef.current?.remove()
      spcPopupRef.current = null
      markerRef.current?.remove()
      markerRef.current = null
      map.remove()
      mapRef.current = null
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

      const radarSiteFeature = map.queryRenderedFeatures(event.point, {
        layers: [radarSitesLayerId, selectedRadarSiteLayerId],
      })[0]

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

      if (!map.getSource(radarSitesSourceId)) {
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
        const source = map.getSource(radarSitesSourceId) as maplibregl.GeoJSONSource
        source.setData(collection)
      }

      map.setFilter(selectedRadarSiteLayerId, [
        '==',
        ['get', 'id'],
        selectedRadarSiteId ?? '',
      ])

      const visibility =
        activeLayer === 'Radar' && radarView === 'local' ? 'visible' : 'none'
      map.setLayoutProperty(radarSitesLayerId, 'visibility', visibility)
      map.setLayoutProperty(selectedRadarSiteLayerId, 'visibility', visibility)
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
      if (!map.getSource(alertPolygonsSourceId)) {
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
            'fill-opacity': polygonOpacity,
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
        const source = map.getSource(alertPolygonsSourceId) as maplibregl.GeoJSONSource
        source.setData(collection)
      }

      const visibility = 'visible'
      map.setLayoutProperty(alertPolygonsFillLayerId, 'visibility', visibility)
      map.setLayoutProperty(alertPolygonsLineLayerId, 'visibility', visibility)
    }

    if (map.isStyleLoaded()) {
      applyAlertPolygons()
    } else {
      map.once('load', applyAlertPolygons)
    }
  }, [alertFeatures])

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
      if (!map.getSource(spcPolygonsSourceId)) {
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
        const source = map.getSource(spcPolygonsSourceId) as maplibregl.GeoJSONSource
        source.setData(collection)
      }

      const visibility =
        activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk'
          ? 'visible'
          : 'none'
      map.setLayoutProperty(spcPolygonsFillLayerId, 'visibility', visibility)
      map.setLayoutProperty(spcPolygonsLineLayerId, 'visibility', visibility)
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
      if (!map.getSource(winterPolygonsSourceId)) {
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
        const source = map.getSource(winterPolygonsSourceId) as maplibregl.GeoJSONSource
        source.setData(collection)
      }

      const visibility =
        activeLayer === 'Forecast' && activeForecastOverlay === 'Winter'
          ? 'visible'
          : 'none'
      map.setLayoutProperty(winterPolygonsFillLayerId, 'visibility', visibility)
      map.setLayoutProperty(winterPolygonsLineLayerId, 'visibility', visibility)
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

    if (map.getLayer(alertPolygonsFillLayerId)) {
      map.setPaintProperty(alertPolygonsFillLayerId, 'fill-opacity', polygonOpacity)
    }

    if (map.getLayer(spcPolygonsFillLayerId)) {
      map.setPaintProperty(spcPolygonsFillLayerId, 'fill-opacity', polygonOpacity)
    }

    if (map.getLayer(winterPolygonsFillLayerId)) {
      map.setPaintProperty(winterPolygonsFillLayerId, 'fill-opacity', polygonOpacity)
    }
  }, [polygonOpacity])

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

      const feature = map.queryRenderedFeatures(event.point, {
        layers: [radarSitesLayerId, selectedRadarSiteLayerId],
      })[0]

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
    map.on('mouseleave', radarSitesLayerId, handleLeave)
    map.on('mouseleave', selectedRadarSiteLayerId, handleLeave)

    return () => {
      map.off('mousemove', handleMove)
      map.off('mouseleave', radarSitesLayerId, handleLeave)
      map.off('mouseleave', selectedRadarSiteLayerId, handleLeave)
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
        regionalRadarLayerId,
        activeLayer === 'Radar' && radarView === 'regional',
      )
      setLayerVisibility(
        map,
        satelliteLayerId,
        activeLayer === 'Satellite',
      )
      setLayerVisibility(
        map,
        localRadarLayerId,
        activeLayer === 'Radar' && radarView === 'local',
      )
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
    }

    if (map.isStyleLoaded()) {
      syncLayerVisibility()
    } else {
      map.once('load', syncLayerVisibility)
    }
  }, [activeForecastOverlay, activeLayer, radarView])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const handleHazardHover = (event: maplibregl.MapMouseEvent) => {
      const layers = [
        alertPolygonsFillLayerId,
        alertPolygonsLineLayerId,
        ...(activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk'
          ? [spcPolygonsFillLayerId, spcPolygonsLineLayerId]
          : []),
        ...(activeLayer === 'Forecast' && activeForecastOverlay === 'Winter'
          ? [winterPolygonsFillLayerId, winterPolygonsLineLayerId]
          : []),
      ]

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
  }, [activeForecastOverlay, activeLayer])

  useEffect(() => {
    const map = mapRef.current
    const popup = alertPopupRef.current

    if (!map || !popup) {
      return
    }

    const handleAlertClick = (event: maplibregl.MapMouseEvent) => {
      const feature = map.queryRenderedFeatures(event.point, {
        layers: [alertPolygonsFillLayerId, alertPolygonsLineLayerId],
      })[0]

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
    const popup = spcPopupRef.current

    if (!map || !popup) {
      return
    }

    const handleSpcClick = (event: maplibregl.MapMouseEvent) => {
      if (!(activeLayer === 'Forecast' && activeForecastOverlay === 'SPC Storm Risk')) {
        return
      }

      const feature = map.queryRenderedFeatures(event.point, {
        layers: [spcPolygonsFillLayerId, spcPolygonsLineLayerId],
      })[0]

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

      const feature = map.queryRenderedFeatures(event.point, {
        layers: [winterPolygonsFillLayerId, winterPolygonsLineLayerId],
      })[0]

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

    const syncRegionalRadar = () => {
      if (!(activeLayer === 'Radar' && radarView === 'regional')) {
        removeLayerAndSource(map, regionalRadarLayerId, regionalRadarSourceId)
        regionalRadarUrlRef.current = ''
        return
      }

      const bounds = map.getBounds()
      const container = map.getContainer()
      const width = Math.max(Math.round(container.clientWidth), 256)
      const height = Math.max(Math.round(container.clientHeight), 256)
      const nextRadarUrl = buildRegionalRadarImageUrl(
        radarProduct === 'composite' ? 'composite' : 'base',
        {
          west: bounds.getWest(),
          south: bounds.getSouth(),
            east: bounds.getEast(),
            north: bounds.getNorth(),
            width,
            height,
            time: selectedRegionalRadarTime,
          },
      )
      const coordinates: maplibregl.Coordinates = [
        [bounds.getWest(), bounds.getNorth()],
        [bounds.getEast(), bounds.getNorth()],
        [bounds.getEast(), bounds.getSouth()],
        [bounds.getWest(), bounds.getSouth()],
      ]

      if (
        !map.getSource(regionalRadarSourceId) ||
        regionalRadarUrlRef.current !== nextRadarUrl
      ) {
        removeLayerAndSource(map, regionalRadarLayerId, regionalRadarSourceId)

        map.addSource(regionalRadarSourceId, {
          type: 'image',
          url: nextRadarUrl,
          coordinates,
        })

        map.addLayer({
          id: regionalRadarLayerId,
          type: 'raster',
          source: regionalRadarSourceId,
          paint: {
            'raster-opacity': radarOpacity,
            'raster-fade-duration': 160,
            'raster-resampling': 'linear',
          },
        })

        regionalRadarUrlRef.current = nextRadarUrl
      } else {
        const source = map.getSource(regionalRadarSourceId) as maplibregl.ImageSource
        source.updateImage({
          url: nextRadarUrl,
          coordinates,
        })
      }
    }

    if (map.isStyleLoaded()) {
      syncRegionalRadar()
    } else {
      map.once('load', syncRegionalRadar)
    }

    const rerenderRegionalRadar = () => {
      if (map.isStyleLoaded()) {
        syncRegionalRadar()
      }
    }

    map.on('moveend', rerenderRegionalRadar)

    const interval = window.setInterval(rerenderRegionalRadar, 120000)

    return () => {
      map.off('moveend', rerenderRegionalRadar)
      window.clearInterval(interval)
    }
  }, [activeLayer, radarOpacity, radarProduct, radarView, selectedRegionalRadarTime])

  useEffect(() => {
    const map = mapRef.current

    if (!map || !map.getLayer(regionalRadarLayerId)) {
      return
    }

    map.setPaintProperty(regionalRadarLayerId, 'raster-opacity', radarOpacity)
  }, [radarOpacity])

  useEffect(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const syncSatellite = () => {
      const bounds = map.getBounds()
      const container = map.getContainer()
      const width = Math.max(Math.round(container.clientWidth), 256)
      const height = Math.max(Math.round(container.clientHeight), 256)
      const url = buildSatelliteImageUrl(satelliteLayer, {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
        width,
        height,
        time: selectedSatelliteTime,
      })
      const coordinates: maplibregl.Coordinates = [
        [bounds.getWest(), bounds.getNorth()],
        [bounds.getEast(), bounds.getNorth()],
        [bounds.getEast(), bounds.getSouth()],
        [bounds.getWest(), bounds.getSouth()],
      ]

      if (!map.getSource(satelliteSourceId)) {
        map.addSource(satelliteSourceId, {
          type: 'image',
          url,
          coordinates,
        })

        map.addLayer({
          id: satelliteLayerId,
          type: 'raster',
          source: satelliteSourceId,
          paint: {
            'raster-opacity': satelliteOpacity,
            'raster-fade-duration': 160,
            'raster-resampling': 'linear',
          },
        })
      } else {
        const source = map.getSource(satelliteSourceId) as maplibregl.ImageSource
        source.updateImage({
          url,
          coordinates,
        })
      }

      setLayerVisibility(map, satelliteLayerId, activeLayer === 'Satellite')
    }

    if (map.isStyleLoaded()) {
      syncSatellite()
    } else {
      map.once('load', syncSatellite)
    }

    map.on('moveend', syncSatellite)
    const interval = window.setInterval(syncSatellite, 300000)

    return () => {
      map.off('moveend', syncSatellite)
      window.clearInterval(interval)
    }
  }, [activeLayer, satelliteLayer, satelliteOpacity, selectedSatelliteTime])

  useEffect(() => {
    const map = mapRef.current

    if (!map || !map.getLayer(satelliteLayerId)) {
      return
    }

    map.setPaintProperty(satelliteLayerId, 'raster-opacity', satelliteOpacity)
  }, [satelliteOpacity])

  useEffect(() => {
    const map = mapRef.current

    if (!map || radarView !== 'local') {
      if (map) {
        removeLayerAndSource(map, localRadarLayerId, localRadarSourceId)
      }
      return
    }

    const syncLocalRadar = () => {
      if (!nearestRadarSite) {
        removeLayerAndSource(map, localRadarLayerId, localRadarSourceId)
        return
      }

      const bounds = map.getBounds()
      const container = map.getContainer()
      const width = Math.max(Math.round(container.clientWidth), 256)
      const height = Math.max(Math.round(container.clientHeight), 256)
      const url = buildLocalRadarImageUrl({
        nearestRadarSite,
        localRadarDefinition,
        selectedLocalRadarTime,
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
        width,
        height,
      })

      if (!url) {
        removeLayerAndSource(map, localRadarLayerId, localRadarSourceId)
        return
      }

      const coordinates: maplibregl.Coordinates = [
        [bounds.getWest(), bounds.getNorth()],
        [bounds.getEast(), bounds.getNorth()],
        [bounds.getEast(), bounds.getSouth()],
        [bounds.getWest(), bounds.getSouth()],
      ]

      if (!map.getSource(localRadarSourceId)) {
        map.addSource(localRadarSourceId, {
          type: 'image',
          url,
          coordinates,
        })

        map.addLayer({
          id: localRadarLayerId,
          type: 'raster',
          source: localRadarSourceId,
          paint: {
            'raster-opacity': radarOpacity,
            'raster-fade-duration': 160,
            'raster-resampling': 'linear',
          },
        })
      } else {
        const source = map.getSource(localRadarSourceId) as maplibregl.ImageSource
        source.updateImage({
          url,
          coordinates,
        })
      }
    }

    const syncLocalVisibility = () => {
      if (!map.getLayer(localRadarLayerId)) {
        return
      }

      map.setLayoutProperty(
        localRadarLayerId,
        'visibility',
        activeLayer === 'Radar' && radarView === 'local' ? 'visible' : 'none',
      )
    }

    const runSync = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      syncLocalRadar()
      syncLocalVisibility()
    }

    if (map.isStyleLoaded()) {
      runSync()
    } else {
      map.once('load', runSync)
    }

    map.on('moveend', runSync)

    return () => {
      map.off('moveend', runSync)
    }
  }, [
    activeLayer,
    localRadarDefinition,
    nearestRadarSite,
    radarOpacity,
    radarView,
    selectedLocalRadarTime,
  ])

  useEffect(() => {
    const map = mapRef.current

    if (!map || !map.getLayer(localRadarLayerId)) {
      return
    }

    map.setPaintProperty(localRadarLayerId, 'raster-opacity', radarOpacity)
  }, [radarOpacity])

  return (
    <div className="map-surface">
      <div ref={containerRef} className="map-canvas" />
      <div className="map-overlay">
        <strong>Left click for forecast. Right click picks a local radar site.</strong>
        {radarView === 'local' && nearestRadarSite ? (
          <div className="map-selection-badge">
            <span className="card-label">Radar Site</span>
            <strong>{nearestRadarSite.id}</strong>
            <span>{nearestRadarSite.name}</span>
          </div>
        ) : null}
      </div>
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

function buildAlertNarrative(description: string, instruction: string) {
  const parts = [description.trim(), instruction.trim()].filter(Boolean)
  return parts.join('\n\n')
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

  return `https://opengeo.ncep.noaa.gov/geoserver/conus/${layerName}/wms?service=WMS&version=1.1.1&request=GetMap&layers=${layerName}&styles=radar_reflectivity&format=image/png&transparent=true&srs=EPSG:4326&bbox=${west},${south},${east},${north}&width=${width}&height=${height}${timeParam}&frame=${encodeURIComponent(cacheKey)}`
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

  return `https://opengeo.ncep.noaa.gov/geoserver/${siteWorkspace}/ows?service=WMS&version=1.1.1&request=GetMap&layers=${layerName}&styles=${styleName}&format=image/png&transparent=true&srs=EPSG:4326&bbox=${west},${south},${east},${north}&width=${width}&height=${height}${timeParam}&refresh=${refreshBucket}`
}

function removeLayerAndSource(
  map: maplibregl.Map,
  layerId: string,
  sourceId: string,
) {
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId)
  }

  if (map.getSource(sourceId)) {
    map.removeSource(sourceId)
  }
}

function setLayerVisibility(
  map: maplibregl.Map,
  layerId: string,
  isVisible: boolean,
) {
  if (!map.getLayer(layerId)) {
    return
  }

  map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none')
}
