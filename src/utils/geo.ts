export type Coordinates = [number, number]

const earthRadiusMiles = 3958.8

export function distanceBetweenMiles(
  [lonA, latA]: Coordinates,
  [lonB, latB]: Coordinates,
) {
  const deltaLat = toRadians(latB - latA)
  const deltaLon = toRadians(lonB - lonA)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(latA)) *
      Math.cos(toRadians(latB)) *
      Math.sin(deltaLon / 2) ** 2

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}
