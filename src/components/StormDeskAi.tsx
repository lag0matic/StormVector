import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { StormDeskEvidence, StormDeskRun } from '../services/stormDesk'
import { spcCategoryLabel, type SpcBriefingOutlook } from '../services/spcBriefing'
import { cachedBriefing, loadBriefingBundle } from '../services/briefingBundle'
import { loadBriefingAlerts } from '../services/briefingAlerts'

type Briefing = { claims: { text: string; sources: string[] }[]; limitation: string }

export function StormDeskAi({ coordinates }: { coordinates: [number, number] }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [sources, setSources] = useState<StormDeskEvidence[] | null>(null)
  const [spc, setSpc] = useState<{ outlooks: SpcBriefingOutlook[]; incomplete: boolean } | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [loadingGuidance, setLoadingGuidance] = useState(false)
  const [official, setOfficial] = useState<Awaited<ReturnType<typeof loadBriefingAlerts>> | null>(null)
  const cached = cachedBriefing(coordinates)

  async function narrate() {
    setBusy(true)
    setError(null)
    setBriefing(null)
    setOfficial(null)
    try {
      setLoadingGuidance(!cached)
      const bundle = await loadBriefingBundle(coordinates)
      setLoadingGuidance(false)
      const currentAlerts = await loadBriefingAlerts(coordinates)
      setOfficial(currentAlerts)
      const loaded = bundle.models
      const [data, ...extra] = loaded
      if (!data) throw new Error(`No guidance was saved. Next refresh after ${formatLocalTime(new Date(bundle.attemptedAt + 3600000).toISOString())}.`)
      const supplemental = extra.find(item => item.latest.model === 'AIFS')
      const shortTerm = extra.find(item => item.latest.model === 'HRRR')
      const runs = [data.latest, data.previous, data.nbm, data.snow, supplemental?.latest, shortTerm?.latest]
      const localTimes = runs.flatMap(run => run?.hours.map(formatWindow) ?? [])
      const now = new Date()
      const nextSpc = {
        outlooks: bundle.spc?.outlooks.filter(outlook => Date.parse(outlook.validUntil) > now.getTime()) ?? [],
        incomplete: bundle.spc?.incomplete ?? false,
      }
      const result = await invoke<Briefing>('narrate_storm_desk', {
        evidence: data, supplemental, shortTerm, localTimes, briefingTime: formatLocalTime(now.toISOString()),
        nwsAlerts: currentAlerts.alerts.slice(0, 12).map(alert => ({
          ...alert, localStart: alert.startsAt ? formatLocalTime(alert.startsAt) : null,
          localEnd: formatLocalTime(alert.endsAt),
        })),
        spcOutlooks: nextSpc.outlooks.map(outlook => ({
          ...outlook, localValidTime: `${formatLocalTime(outlook.validFrom)} to ${formatLocalTime(outlook.validUntil)}`,
        })),
      })
      setSpc(nextSpc)
      setSources(loaded)
      setMissing(bundle.missing)
      setBriefing(result)
    } catch (cause) { setError(String(cause)) }
    finally { setLoadingGuidance(false); setBusy(false) }
  }

  const aifs = sources?.find(item => item.latest.model === 'AIFS')?.latest
  return <section className="storm-desk-summary desk-briefing">
    <div className="panel-heading"><div><h3>Luna forecast</h3>
      <p className="source-note">{cached?.models.length ? `Guidance checked ${formatLocalTime(new Date(cached.attemptedAt).toISOString())}` : 'HRRR, GFS, AIFS and NOAA outlooks'}</p></div>
      <button type="button" className="desk-primary" disabled={busy} onClick={narrate}>{loadingGuidance ? 'Gathering guidance...' : busy ? 'Writing...' : briefing ? 'Regenerate' : 'Generate briefing'}</button>
    </div>
    {error ? <p className="error-text" role="alert">{error}</p> : null}
    {official && (official.unavailable || official.alerts.length > 0) && <section className="desk-settings" aria-label="National Weather Service alerts">
      <p className="eyebrow">Official NWS alerts</p>
      {official.unavailable ? <p className="source-note">Could not check active NWS alerts.</p> :
        <ul>{official.alerts.map((alert, index) => <li key={index}>
          <strong>{alert.event}</strong>{alert.startsAt && ` · Starts ${formatLocalTime(alert.startsAt)}`}
          {' · '}{alert.endLabel} {formatLocalTime(alert.endsAt)}
        </li>)}</ul>}
    </section>}
    {aifs && <details className="storm-desk-sources">
      <summary>AIFS model values</summary>
      <p className="source-note">ECMWF AIFS Single run {formatLocalTime(aifs.runTime)} · temperature and sustained wind are valid at the end of each interval</p>
      <ul>{aifs.hours.map(hour => <li key={hour.validTime}>
        {formatWindow(hour)}: {hour.precipitationInches == null ? 'precipitation unavailable' : `${hour.precipitationInches.toFixed(2)} in liquid equivalent`}
        {' · '}{hour.temperatureF == null ? 'temperature unavailable' : `${Math.round(hour.temperatureF)} °F`}
        {' · '}{hour.windSpeedMph == null ? 'wind unavailable' : `${Math.round(hour.windSpeedMph)} mph sustained`}
      </li>)}</ul>
    </details>}
    {briefing && sources ? <>
      {missing.length > 0 && <p className="source-note">Unavailable for this briefing: {missing.join(', ')}.</p>}
      {spc && spc.outlooks.length > 0 && <div className="desk-settings">
        <p className="eyebrow">Official NOAA SPC outlook</p>
        {spc.outlooks.map(outlook => <p className="source-note" key={outlook.day}>
          Day {outlook.day}: {spcCategoryLabel[outlook.category]} · {formatLocalTime(outlook.validFrom)} to {formatLocalTime(outlook.validUntil)}
        </p>)}
      </div>}
      <p className="eyebrow">AI-generated</p>
      <div className="storm-desk-narrative">
        {briefing.claims.map((claim, index) => <p key={index}>{claim.text}</p>)}
      </div>
      <details className="storm-desk-sources"><summary>Forecast sources and verification</summary>
        {spc?.incomplete && <p className="source-note">Some SPC outlooks could not be checked.</p>}
        {briefing.claims.map((claim, index) => <div key={index}>
        <strong>Paragraph {index + 1}</strong>
        <ul>{claim.sources.map((id) => {
          const [which, number] = id.split('-')
          if (which === 'alert') {
            const alert = official?.alerts[Number(number) - 1]
            return <li key={id}>{alert ? `NWS: ${alert.event}; ${alert.endLabel.toLowerCase()} ${formatLocalTime(alert.endsAt)}` : id}</li>
          }
          if (which === 'spc') {
            const outlook = spc?.outlooks.find(item => item.day === Number(number))
            return <li key={id}>{outlook ? `NOAA SPC Day ${outlook.day}: ${spcCategoryLabel[outlook.category]}; issued ${formatLocalTime(outlook.issuedAt)}; valid ${formatLocalTime(outlook.validFrom)} to ${formatLocalTime(outlook.validUntil)}` : id}</li>
          }
          const sourceRuns: Record<string, StormDeskRun | null | undefined> = {
            latest: sources[0].latest, previous: sources[0].previous, nbm: sources[0].nbm,
            snow: sources[0].snow, aifs: sources.slice(1).find(item => item.latest.model === 'AIFS')?.latest,
            hrrr: sources.slice(1).find(item => item.latest.model === 'HRRR')?.latest,
          }
          const run = sourceRuns[which]
          if (!run) return <li key={id}>{id}</li>
          const hour = run.hours[Number(number) - 1]
          return <li key={id}>{hour ? `${run.model} run ${formatLocalTime(run.runTime)}; forecast for ${formatWindow(hour)}` : id}</li>
        })}</ul>
      </div>)}
      </details>
    </> : null}
  </section>
}

function formatWindow(hour: { intervalStartTime?: string | null; validTime: string }) {
  const end = formatLocalTime(hour.validTime)
  return hour.intervalStartTime ? `${formatLocalTime(hour.intervalStartTime)} to ${end}` : end
}

function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric',
    minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(value))
}
