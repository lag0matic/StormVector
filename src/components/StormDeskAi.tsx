import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { StormDeskEvidence } from '../services/stormDesk'

type Briefing = { claims: { text: string; sources: string[] }[]; limitation: string }

export function StormDeskAi({ evidence, disabled }: { evidence: StormDeskEvidence; disabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [briefing, setBriefing] = useState<Briefing | null>(null)

  async function narrate() {
    setBusy(true)
    setError(null)
    try {
      const localTimes = [evidence.latest, evidence.previous, ...(evidence.nbm ? [evidence.nbm] : []), ...(evidence.snow ? [evidence.snow] : [])].flatMap((run) =>
        run.hours.map((hour) => hour.intervalStartTime ? `${formatLocalTime(hour.intervalStartTime)} to ${formatLocalTime(hour.validTime)}` : formatLocalTime(hour.validTime)))
      setBriefing(await invoke<Briefing>('narrate_storm_desk', {
        evidence, localTimes, briefingTime: formatLocalTime(new Date().toISOString()),
      }))
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }

  return <section className="storm-desk-summary desk-briefing">
    <div className="panel-heading"><h3>Weather briefing</h3>
      <button type="button" className="desk-primary" disabled={disabled || busy} onClick={narrate}>{busy ? 'Writing...' : briefing ? 'Regenerate' : 'Generate briefing'}</button>
    </div>
    {error ? <p className="error-text" role="alert">{error}</p> : null}
    {briefing ? <>
      <p className="eyebrow">AI-generated</p>
      <div className="storm-desk-narrative">
        {briefing.claims.map((claim, index) => <p key={index}>{claim.text}</p>)}
      </div>
      <details className="storm-desk-sources"><summary>Model sources and verification</summary>
        <p className="source-note">AI interpretation; check the underlying model values below.</p>
        {briefing.claims.map((claim, index) => <div key={index}>
        <strong>Paragraph {index + 1}</strong>
        <ul>{claim.sources.map((id) => {
          const [which, number] = id.split('-')
          const run = which === 'latest' ? evidence.latest : which === 'nbm' ? evidence.nbm : which === 'snow' ? evidence.snow : evidence.previous
          if (!run) return <li key={id}>{id}</li>
          const hour = run.hours[Number(number) - 1]
          return <li key={id}>{hour ? `${run.model} run ${formatLocalTime(run.runTime)}; forecast for ${formatLocalTime(hour.validTime)}` : id}</li>
        })}</ul>
      </div>)}
      </details>
    </> : null}
  </section>
}

function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric',
    minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(value))
}
