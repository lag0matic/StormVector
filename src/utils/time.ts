export function formatEtaDuration(totalMinutes: number) {
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
