import { buildActiveAlertsUrl, fetchJson } from './nws'

type NwsAlert = {
  id?: string
  properties?: {
    event?: string
    status?: string
    messageType?: string
    effective?: string
    onset?: string | null
    ends?: string | null
    expires?: string
  }
}

export type BriefingAlert = {
  event: string
  startsAt: string | null
  endsAt: string
  endLabel: 'Ends' | 'Alert expires'
}

function priority(event: string) {
  if (/\bwarning\b/i.test(event)) return 0
  if (/\bwatch\b/i.test(event)) return 1
  if (/\badvisory\b/i.test(event)) return 2
  return 3
}

export function normalizeBriefingAlerts(features: NwsAlert[], now: number): BriefingAlert[] {
  const alerts = new Map<string, BriefingAlert>()
  for (const { id, properties: item } of features) {
    if (item?.status !== 'Actual' || !['Alert', 'Update'].includes(item.messageType ?? '') ||
        !item.event || item.event.length > 100) continue
    const expiry = Date.parse(item.expires ?? '')
    const end = Date.parse(item.ends ?? '')
    if (!(expiry > now) || (Number.isFinite(end) && end <= now)) continue
    const start = Date.parse(item.onset ?? item.effective ?? '')
    const endsAt = new Date(Number.isFinite(end) ? end : expiry).toISOString()
    alerts.set(id ?? `${item.event}-${endsAt}`, {
      event: item.event,
      startsAt: start > now ? new Date(start).toISOString() : null,
      endsAt,
      endLabel: Number.isFinite(end) ? 'Ends' : 'Alert expires',
    })
  }
  return [...alerts.values()].sort((a, b) => priority(a.event) - priority(b.event) ||
    Date.parse(a.endsAt) - Date.parse(b.endsAt))
}

export async function loadBriefingAlerts([longitude, latitude]: [number, number]) {
  try {
    const response = await fetchJson<{ features?: NwsAlert[] }>(
      buildActiveAlertsUrl(`${latitude.toFixed(4)},${longitude.toFixed(4)}`),
      { signal: AbortSignal.timeout(7000), cache: 'no-cache' },
    )
    if (!Array.isArray(response.features)) throw new Error('Invalid NWS alert response')
    return { alerts: normalizeBriefingAlerts(response.features, Date.now()), unavailable: false }
  } catch {
    return { alerts: [], unavailable: true }
  }
}
