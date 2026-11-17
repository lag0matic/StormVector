import { useEffect, useRef } from 'react'
import maplibregl, { type ImageSource } from 'maplibre-gl'
import { getFutureRadarImageCoordinates } from '../services/futureRadar'
import { lightBasemapTileUrl, darkBasemapTileUrl, basemapAttribution } from '../services/basemap'

export function StormDeskMap({ image, coordinates }: { image: string | null; coordinates: [number, number] }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  useEffect(() => {
    if (!container.current) return
    const map = new maplibregl.Map({
      container: container.current, center: coordinates, zoom: 3.5,
      style: { version: 8, sources: { basemap: { type: 'raster',
        tiles: [document.documentElement.dataset.theme === 'dark' ? darkBasemapTileUrl : lightBasemapTileUrl],
        tileSize: 256, attribution: basemapAttribution } },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }] },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    new maplibregl.Marker({ color: '#00b894' }).setLngLat(coordinates).addTo(map)
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container.current)
    return () => { observer.disconnect(); mapRef.current = null; map.remove() }
  }, [coordinates])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const update = () => {
      if (!image) {
        if (map.getLayer('forecast')) map.removeLayer('forecast')
        if (map.getSource('forecast')) map.removeSource('forecast')
        return
      }
      const source = map.getSource('forecast') as ImageSource | undefined
      if (source) source.updateImage({ url: image })
      else {
        map.addSource('forecast', { type: 'image', url: image, coordinates: getFutureRadarImageCoordinates() })
        map.addLayer({ id: 'forecast', type: 'raster', source: 'forecast', paint: { 'raster-opacity': 0.8, 'raster-fade-duration': 0 } })
      }
    }
    if (map.isStyleLoaded()) update()
    else map.once('load', update)
    return () => { map.off('load', update) }
  }, [image, coordinates])

  return <div ref={container} className="desk-image-map" aria-label="Forecast map" />
}
