export const spcMapServerUrl =
  'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer'

export const winterReferenceProducts = {
  wssi: 'https://www.wpc.ncep.noaa.gov/wwd/wssi/wssi.php',
  pwpf: 'https://www.wpc.ncep.noaa.gov/wwd/pwpf_d47/pwpf_medr.php',
}
export const winterStormOutlookMapServerUrl =
  'https://mapservices.weather.noaa.gov/experimental/rest/services/wpc_winter_storm_outlook/MapServer'

export function buildSpcLayerUrl(layerId: number) {
  return `${spcMapServerUrl}/${layerId}`
}

export function buildSpcCategoricalQueryUrl(day: 1 | 2 | 3) {
  const layerId = day === 1 ? 1 : day === 2 ? 9 : 17

  return `${buildSpcLayerUrl(layerId)}/query?where=1%3D1&outFields=dn,label,valid,expire&returnGeometry=true&f=geojson`
}

export function buildWinterStormOutlookQueryUrl(
  product: 'snowfall' | 'freezingRain',
  day: 1 | 2 | 3 | 4,
) {
  const layerId =
    product === 'snowfall'
      ? { 1: 1, 2: 2, 3: 3, 4: 4 }[day]
      : { 1: 7, 2: 8, 3: 9, 4: 10 }[day]

  return `${winterStormOutlookMapServerUrl}/${layerId}/query?where=1%3D1&outFields=id,product,outlook,valid_time,issue_time,snippet&returnGeometry=true&f=geojson`
}
