const key = import.meta.env.VITE_CARTO_BASEMAP_KEY?.trim()

export const lightBasemapTileUrl = key
  ? `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`
  : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const darkBasemapTileUrl = key
  ? `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`
  : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const basemapAttribution = key
  ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
  : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
