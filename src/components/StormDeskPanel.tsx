import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { StormDeskImagery } from './StormDeskImagery'
import { SnowfallOutlook } from './SnowfallOutlook'
import { WeatherSourceLink } from './WeatherSourceLink'
import {
  fetchStormDeskEvidence,
  loadSavedStormDesk,
  listStormDeskHistory,
  stormDeskSourceUrl,
  type StormDeskEvidence,
  type StormDeskHour,
  type StormDeskRange,
} from '../services/stormDesk'

type StormDeskPanelProps = {
  coordinates: [number, number]
}

export function StormDeskPanel({ coordinates }: StormDeskPanelProps) {
  const [evidence, setEvidence] = useState<StormDeskEvidence | null>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<StormDeskEvidence[]>([])
  const [range, setRange] = useState<StormDeskRange>('short')
  const [loadedRange, setLoadedRange] = useState<StormDeskRange>('short')
  const [error, setError] = useState<string | null>(null)
  const [loadedCoordinates, setLoadedCoordinates] = useState<[number, number] | null>(null)
  const locationChanged =
    loadedCoordinates !== null &&
    (loadedRange !== range || loadedCoordinates[0] !== coordinates[0] || loadedCoordinates[1] !== coordinates[1])
  const changes = useMemo(() => summarizeChanges(evidence), [evidence])

  useEffect(() => {
    setError(null)
  }, [coordinates])

  useEffect(() => {
    let active = true
    listStormDeskHistory(coordinates, range).then((items) => {
      if (active) setHistory(items)
    }).catch(() => { if (active) setHistory([]) })
    return () => { active = false }
  }, [coordinates, range])

  async function loadEvidence(saved = false) {
    setLoading(true)
    setError(null)

    try {
      const result = await (saved ? loadSavedStormDesk(coordinates, range) : fetchStormDeskEvidence(coordinates, range))
      setEvidence(result)
      setLoadedRange(range)
      setLoadedCoordinates([...coordinates])
      listStormDeskHistory(coordinates, range).then(setHistory).catch(() => {})
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  const rangeControl = <div className="desk-toolbar"><label>Forecast range{' '}
    <select value={range} disabled={loading} onChange={(event) => setRange(event.target.value as StormDeskRange)}>
      <option value="short">6 hours - HRRR</option>
      <option value="week">7 days - GFS</option>
      <option value="extended">Days 8-15 - GFS trends</option>
    </select></label>
    <label>Saved runs
      <select disabled={loading || history.length === 0} value="" onChange={(event) => {
        const saved = history[Number(event.target.value)]
        if (!saved) return
        setEvidence(saved)
        setLoadedCoordinates([saved.longitude, saved.latitude])
        setLoadedRange(range)
        setError(null)
      }}>
        <option value="">{history.length ? `${history.length} saved runs` : 'No saved runs for this point'}</option>
        {history.map((item, index) => <option key={item.latest.runTime} value={index}>{formatRunTime(item.latest.runTime)}</option>)}
      </select>
    </label>
    <div className="desk-toolbar-actions">
      <button type="button" disabled={loading} onClick={() => loadEvidence(true)}>Load saved</button>
      <button type="button" className="desk-primary" disabled={loading} onClick={() => loadEvidence()}>{loading ? 'Loading...' : evidence ? 'Update forecast' : 'Load forecast'}</button>
    </div>
  </div>

  if (!evidence) {
    return (
      <div className="storm-desk-empty">
        {rangeControl}
        <div>
            <p className="eyebrow">Model guidance</p>
          <h3>Compare model runs</h3>
          <p className="compact-copy">
            Choose a forecast range to view conditions and changes from the previous run.
          </p>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="stack storm-desk">
      {rangeControl}
      <p className="source-note">Forecast period: {formatValidTime(evidence.latest.hours[0].intervalStartTime ?? evidence.latest.hours[0].validTime)} – {formatValidTime(evidence.latest.hours.at(-1)!.validTime)}</p>
      {loadedRange === 'extended' ? <p className="source-note">Extended-range trend guidance. Local timing and amounts are highly uncertain; this is one model, not an ensemble confidence estimate.</p> : null}
      <section className="storm-desk-summary desk-changes">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">What changed?</p>
            <h3>Latest run vs previous run</h3>
          </div>
        </div>
        {locationChanged ? (
          <p className="source-note">The selected point or range changed. Refresh to load it.</p>
        ) : null}
        <ul className="storm-desk-change-list">
          {changes.map((change) => <li key={change}>{change}</li>)}
        </ul>
        {error ? <p className="error-text">{error}</p> : null}
      </section>
      <StormDeskImagery key={`imagery-${JSON.stringify(evidence)}`} evidence={evidence} />

      <section className="desk-guidance">
        <p className="source-note">Briefing point: {evidence.latitude.toFixed(3)}, {evidence.longitude.toFixed(3)}. Model run {formatRunTime(evidence.latest.runTime)}.</p>
        <div className="panel-heading storm-desk-run-heading">
          <div>
            <p className="eyebrow">{evidence.latest.model} point guidance</p>
            <h3>Run {formatRunTime(evidence.latest.runTime)}</h3>
          </div>
          <span className="badge">Previous {formatRunTime(evidence.previous.runTime)}</span>
        </div>
        <div className="storm-desk-hours">
          {evidence.latest.hours.map((hour) => {
            const previous = evidence.previous.hours.find(
              (candidate) => candidate.validTime === hour.validTime,
            )
            const probability = evidence.nbm?.hours.find((item) => item.validTime === hour.validTime && item.intervalStartTime === hour.intervalStartTime)
            return <div key={hour.validTime}><StormDeskHourCard hour={hour} previous={previous} probability={probability} />
              {hour.intervalStartTime ? <p className="source-note">{formatValidTime(hour.intervalStartTime)} – {formatValidTime(hour.validTime)} (00–00 UTC)</p> : null}
              <details className="storm-desk-sources"><summary>Sources</summary>
              {(hour.sourceForecastHours?.length ? hour.sourceForecastHours : [hour.forecastHour]).map((forecastHour, i) => <p className="source-note" key={forecastHour}><WeatherSourceLink href={`${stormDeskSourceUrl(evidence.latest, {...hour, forecastHour})}.idx`}>{evidence.latest.model} period {i + 1}</WeatherSourceLink></p>)}
              <p className="source-note"><WeatherSourceLink href={`${stormDeskSourceUrl(evidence.latest, hour)}.idx`}>NOAA source inventory</WeatherSourceLink>
              {previous ? <> / <WeatherSourceLink href={`${stormDeskSourceUrl(evidence.previous, previous)}.idx`}>Prior run inventory</WeatherSourceLink></> : null}</p>
              {probability && evidence.nbm ? <p className="source-note">NBM run {formatRunTime(evidence.nbm.runTime)} · <WeatherSourceLink href={`${stormDeskSourceUrl(evidence.nbm, probability)}.idx`}>Probability and amount inventory</WeatherSourceLink></p> : null}
              </details>
            </div>
          })}
        </div>
      </section>

      {evidence.latest.model === 'GFS' ? <SnowfallOutlook key={`${evidence.latest.runTime}-${evidence.longitude}-${evidence.latitude}-${loadedRange}`} evidence={evidence} disabled={loading || locationChanged} onLoaded={(snow)=>{
        setEvidence((current)=> current === evidence ? {...current,snow} : current)
        void invoke('save_storm_desk_enriched',{evidence:{...evidence,snow}}).catch((cause)=>setError(String(cause)))
      }} /> : null}

      {evidence.probabilityError ? <p className="source-note">Probability guidance: {evidence.probabilityError}</p> : null}

      <p className="source-note">
        NOAA {evidence.latest.model}. {evidence.latest.model === 'GFS' ? 'Daily high / low and liquid-equivalent precipitation, midnight–midnight UTC. Local window shown on each day.' : 'Rainfall shown for each sampled hour.'}
      </p>
    </div>
  )
}

function StormDeskHourCard({ hour, previous, probability }: { hour: StormDeskHour; previous?: StormDeskHour; probability?: StormDeskHour }) {
  return (
    <article className="storm-desk-hour">
      <div className="storm-desk-hour-title">
        <div>
          <p className="card-label">{hour.intervalStartTime ? 'Daily forecast' : 'Valid'}</p>
          <strong>{hour.intervalStartTime ? new Intl.DateTimeFormat(undefined, {weekday:'short', month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(hour.intervalStartTime)) : formatValidTime(hour.validTime)}</strong>
        </div>
        <span className="badge calm">vs prior run</span>
      </div>
      {hour.intervalStartTime ? <>
        <ModelValue label="High" value={formatNumber(hour.highF ?? null, ' F')} change={delta(hour.highF ?? null, previous?.highF, ' F')} />
        <ModelValue label="Low" value={formatNumber(hour.lowF ?? null, ' F')} change={delta(hour.lowF ?? null, previous?.lowF, ' F')} />
        <ModelValue label="Precip total" value={formatNumber(hour.precipitationInches, ' in', 2)} change={delta(hour.precipitationInches, previous?.precipitationInches, ' in', 2)} />
        {probability ? <div className="daily-probabilities">
          <p className="eyebrow" title="Precipitation amounts are water equivalent, not snowfall depth">NBM precipitation</p>
          <div><span>Chance of &gt;0.01 in</span><strong>{formatNumber(probability.precipProbabilityPercent ?? null, '%')}</strong></div>
          <div><span>Median amount</span><strong>{formatNumber(probability.precipP50Inches ?? null, ' in', 2)}</strong></div>
          <div><span title="10th–90th percentile: the middle 80% of modeled outcomes, including dry outcomes">Amount range (80%)</span><strong>{probability.precipP10Inches != null && probability.precipP90Inches != null && probability.precipP10Inches <= probability.precipP90Inches ? `${probability.precipP10Inches.toFixed(2)}–${probability.precipP90Inches.toFixed(2)} in` : 'Unavailable'}</strong></div>
        </div> : <p className="source-note">NBM probability guidance not available for this day.</p>}
      </> : <>
      <ModelValue label="Temperature" value={formatNumber(hour.temperatureF, 'F')} change={delta(hour.temperatureF, previous?.temperatureF, 'F')} />
      <ModelValue label="Dewpoint" value={formatNumber(hour.dewpointF, 'F')} change={delta(hour.dewpointF, previous?.dewpointF, 'F')} />
      <ModelValue label="Wind" value={formatWind(hour)} change={delta(hour.windSpeedMph, previous?.windSpeedMph, ' mph')} />
      <ModelValue label="Gust" value={formatNumber(hour.gustMph, ' mph')} change={delta(hour.gustMph, previous?.gustMph, ' mph')} />
      <ModelValue label="Hourly precip" value={formatNumber(hour.precipitationInches, ' in', 2)} change={delta(hour.precipitationInches, previous?.precipitationInches, ' in', 2)} />
      <ModelValue label="Surface CAPE" value={formatNumber(hour.capeJkg, ' J/kg')} change={delta(hour.capeJkg, previous?.capeJkg, ' J/kg')} />
      <ModelValue label="Cloud cover" value={formatNumber(hour.cloudCoverPercent, '%')} change={delta(hour.cloudCoverPercent, previous?.cloudCoverPercent, '%')} />
      </>}
    </article>
  )
}

function ModelValue({ label, value, change }: { label: string; value: string; change: string }) {
  return (
    <div className="storm-desk-value">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{change}</small>
    </div>
  )
}

function summarizeChanges(evidence: StormDeskEvidence | null) {
  if (!evidence) return []
  const pairs = evidence.latest.hours.map((hour) => ({
    hour,
    previous: evidence.previous.hours.find((item) => item.validTime === hour.validTime),
  }))
  const messages: string[] = []
  if (!pairs.some(({hour, previous}) => previous &&
    (['temperatureF', 'highF', 'lowF', 'gustMph', 'capeJkg', 'precipitationInches'] as const)
      .some((field) => hour[field] != null && previous[field] != null))) {
    return ['Insufficient matching model values to summarize changes.']
  }
  const completePrecip = pairs.every(({hour, previous}) => hour.precipitationInches !== null && previous?.precipitationInches != null)
  const precipDelta = completePrecip ? sum(pairs.map(({ hour }) => hour.precipitationInches)) -
    sum(pairs.map(({ previous }) => previous?.precipitationInches ?? null)) : 0
  const gustDelta = maxDelta(pairs, 'gustMph')
  const capeDelta = maxDelta(pairs, 'capeJkg')
  const temperatureDelta = maxAbsoluteDelta(pairs, 'temperatureF')
  const highDelta = maxAbsoluteDelta(pairs, 'highF')
  const lowDelta = maxAbsoluteDelta(pairs, 'lowF')
  if (highDelta !== null && Math.abs(highDelta) >= 2) messages.push(`The largest daily high adjustment is ${signed(highDelta, 0)} F.`)
  if (lowDelta !== null && Math.abs(lowDelta) >= 2) messages.push(`The largest daily low adjustment is ${signed(lowDelta, 0)} F.`)

  if (Math.abs(precipDelta) >= 0.03) {
    messages.push(`The latest run is ${precipDelta > 0 ? 'wetter' : 'drier'} by ${Math.abs(precipDelta).toFixed(2)} in across these forecast ${evidence.latest.hours[0]?.intervalStartTime ? 'days' : 'hours'}.`)
  }
  if (gustDelta !== null && Math.abs(gustDelta) >= 3) {
    messages.push(`Peak gust guidance moved ${gustDelta > 0 ? 'up' : 'down'} ${Math.abs(gustDelta).toFixed(0)} mph.`)
  }
  if (capeDelta !== null && Math.abs(capeDelta) >= 250) {
    messages.push(`Peak surface instability moved ${capeDelta > 0 ? 'up' : 'down'} ${Math.abs(capeDelta).toFixed(0)} J/kg.`)
  }
  if (temperatureDelta !== null && Math.abs(temperatureDelta) >= 2) {
    messages.push(`The largest temperature adjustment is ${signed(temperatureDelta, 0)} F.`)
  }
  if (messages.length === 0) {
    messages.push(`No large changes in the available sampled ${evidence.latest.model} fields. Unavailable fields are excluded.`)
  }
  return messages
}

type NumericField = 'temperatureF' | 'highF' | 'lowF' | 'gustMph' | 'capeJkg'
type Pair = { hour: StormDeskHour; previous?: StormDeskHour }

function maxDelta(pairs: Pair[], field: NumericField) {
  pairs = pairs.filter(({hour, previous}) => hour[field] !== null && previous?.[field] != null)
  const current = Math.max(...pairs.map(({ hour }) => hour[field] ?? Number.NEGATIVE_INFINITY))
  const previous = Math.max(...pairs.map((pair) => pair.previous?.[field] ?? Number.NEGATIVE_INFINITY))
  return Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null
}

function maxAbsoluteDelta(pairs: Pair[], field: NumericField) {
  const deltas = pairs.flatMap(({ hour, previous }) => {
    const current = hour[field]
    const prior = previous?.[field]
    return current === null || current === undefined || prior === null || prior === undefined
      ? []
      : [current - prior]
  })
  return deltas.length ? deltas.reduce((largest, value) => Math.abs(value) > Math.abs(largest) ? value : largest) : null
}

function sum(values: Array<number | null>) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

function formatWind(hour: StormDeskHour) {
  if (hour.windSpeedMph === null) return 'Unavailable'
  const direction = hour.windDirectionDegrees === null ? '' : `${cardinal(hour.windDirectionDegrees)} `
  return `${direction}${hour.windSpeedMph.toFixed(0)} mph`
}

function cardinal(degrees: number) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return directions[Math.round(degrees / 45) % directions.length]
}

function formatNumber(value: number | null, suffix: string, digits = 0) {
  return value === null ? 'Unavailable' : `${value.toFixed(digits)}${suffix}`
}

function delta(current: number | null, previous: number | null | undefined, suffix: string, digits = 0) {
  if (current === null || previous === null || previous === undefined) return 'Prior unavailable'
  const difference = current - previous
  const roundedDifference = Number(difference.toFixed(digits))
  return roundedDifference === 0 ? 'No change' : `${signed(roundedDifference, digits)}${suffix}`
}

function signed(value: number, digits: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
}

function formatRunTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', timeZoneName: 'short' }).format(new Date(value))
}

function formatValidTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' }).format(new Date(value))
}
