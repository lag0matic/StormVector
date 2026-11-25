import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Droplets, RefreshCw, Thermometer, TriangleAlert, Wind } from 'lucide-react'
import { WeatherIcon } from './WeatherIcon'
import { ForecastTemperature } from './ForecastTemperature'
import { WeatherSourceLink } from './WeatherSourceLink'
import { briefingRanges, clockLabel, conditionFor, dateAt, dayName, loadForecastBriefing, models, seasonLabel, summarizeHours, type Briefing, type BriefingRange, type Conditions, type OfficialPeriod, type Phase, type SeasonalSignal } from '../services/forecastBriefing'
import '../App.css'
import './WeatherDeskWindow.css'

export function WeatherDeskWindow() {
  const params = new URLSearchParams(window.location.search)
  const [coordinates,setCoordinates] = useState<[number, number]>([
    Number(params.get('lon') ?? -86.1581), Number(params.get('lat') ?? 39.7684),
  ])
  const [range, setRange] = useState<BriefingRange>('hourly')
  useEffect(()=>{
    let disposed=false
    let unlisten:(()=>void)|undefined
    listen<{longitude:number;latitude:number;theme:string}>('forecast-location',({payload})=>{
      setCoordinates([payload.longitude,payload.latitude])
      document.documentElement.dataset.theme=payload.theme==='dark'?'dark':'light'
    }).then((stop)=>{if(disposed)stop();else unlisten=stop}).catch(() => {})
    return ()=>{disposed=true;unlisten?.()}
  },[])
  return <main className="weather-desk-window forecast-briefing">
    <div className="briefing-shell">
      <div className="briefing-masthead">
        <h1>Forecast Briefing</h1>
        <nav aria-label="Forecast range" className="briefing-ranges">
          {briefingRanges.map(([id, label]) => <button type="button" key={id} aria-pressed={range === id} onClick={() => setRange(id)}>{label}</button>)}
        </nav>
      </div>
      <ForecastContent key={`${coordinates.join(',')}:${range}`} coordinates={coordinates} range={range} />
    </div>
  </main>
}

const phaseLabel: Record<Phase, string> = { dry: 'Dry', rain: 'Rain', snow: 'Snow', mix: 'Rain + snow', 'freezing-rain': 'Freezing rain', sleet: 'Sleet' }

function ForecastContent({ coordinates, range }: { coordinates: [number, number]; range: BriefingRange }) {
  const [data, setData] = useState<Briefing | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    loadForecastBriefing(coordinates, range, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result)
    }).catch(() => {
      if (!controller.signal.aborted) setError(true)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [coordinates, range, attempt])
  return <div className="briefing-content" aria-busy={loading}>
    <div className="briefing-place">
      <h2>{data?.place ?? `${coordinates[1].toFixed(3)}, ${coordinates[0].toFixed(3)}`}</h2>
      <button type="button" className="briefing-refresh" title="Refresh forecast" aria-label="Refresh forecast" disabled={loading} onClick={() => {
        setError(false); setLoading(true); setAttempt(value => value + 1)
      }}><RefreshCw size={17} aria-hidden="true" /></button>
    </div>
    {loading && !data && <p className="briefing-empty" role="status">Loading forecast...</p>}
    {error && <p className="briefing-empty" role="alert">Could not refresh forecast.</p>}
    {data && <>
      {!!data.alerts.length && <section aria-label="Active NWS alerts" className="briefing-alerts">
        {data.alerts.map(alert => <div className="briefing-alert" data-level={alert.level} key={alert.id}>
          <TriangleAlert size={19} aria-hidden="true" /> <strong>{alert.event}</strong><small>Until {new Intl.DateTimeFormat('en-US', { timeZone: data.zone, weekday: 'short', hour: 'numeric', minute: 'numeric', timeZoneName: 'short' }).format(new Date(alert.ends))}</small>
        </div>)}
      </section>}
      {data.range === 'hourly' && <HourlyBriefing data={data} />}
      {(data.range === 'early' || data.range === 'week') && <DailyBriefing periods={data.periods} zone={data.zone} />}
      {data.range === 'extended' && <ExtendedBriefing data={data} />}
      {data.range === 'seasonal' && <SeasonalBriefing data={data} />}
      <footer className="briefing-sources">
        {data.range !== 'seasonal' && data.range !== 'extended' && <WeatherSourceLink href="https://www.weather.gov/documentation/services-web-api">National Weather Service</WeatherSourceLink>}
        {(data.range === 'hourly' || data.range === 'extended') && <WeatherSourceLink href="https://open-meteo.com/en/docs">Open-Meteo model data</WeatherSourceLink>}
        {data.range === 'seasonal' && <WeatherSourceLink href="https://www.cpc.ncep.noaa.gov/products/GIS/GIS_DATA/us_tempprcpfcst/seasonal.php">NOAA Climate Prediction Center</WeatherSourceLink>}
      </footer>
    </>}
  </div>
}

function temperature(period: OfficialPeriod) {
  return <ForecastTemperature value={period.temperature} unit={period.temperatureUnit} />
}

function HourlyBriefing({ data }: { data: Extract<Briefing, { range: 'hourly' }> }) {
  const current = data.hours.find(hour => hour.official)?.official
  const zoneLabel = new Intl.DateTimeFormat('en-US', { timeZone: data.zone, timeZoneName: 'short' }).formatToParts(data.hours[0].start).find(part => part.type === 'timeZoneName')?.value
  return <>
    <section className="briefing-overview" aria-label="Next 24 hours">
      <div className="briefing-now">{current && <><WeatherIcon condition={conditionFor(current.shortForecast, current.isDaytime)} night={!current.isDaytime} size={36} />
        <strong>{temperature(current)}</strong><span>{current.shortForecast}</span>
        {current.windSpeed && <small><Wind size={17} aria-hidden="true" />{current.windSpeed}</small>}</>}</div>
      <p>{summarizeHours(data.hours, data.zone)}</p>
    </section>
    {(data.nwsAvailable || data.modelsAvailable) && <section className="briefing-band" aria-labelledby="hourly-heading">
      <div className="briefing-band-heading"><h3 id="hourly-heading">Hour by hour</h3><span>{zoneLabel}</span></div>
      <div className="briefing-table-wrap" tabIndex={0} aria-label="Hourly forecast table">
        <table className="briefing-table briefing-hourly-table" aria-label="Hourly forecast and precipitation by model">
          <thead><tr><th scope="col">Hour starting</th><th scope="col">NWS forecast</th><th scope="col" className="briefing-desktop-temp">Temp.</th>{data.modelsAvailable && models.map(([id, label]) => <th scope="col" key={id}>{label}</th>)}</tr></thead>
          <tbody>{data.hours.map((hour, i) => {
            const date = dateAt(hour.start, data.zone)
            const newDate = i === 0 || date !== dateAt(data.hours[i - 1].start, data.zone)
            return <tr key={hour.start} data-new-day={newDate}>
              <th scope="row">{newDate && <small>{dayName(date)}</small>}{clockLabel(hour.start, data.zone)}</th>
              <td>{hour.official ? <><span className="briefing-condition"><WeatherIcon condition={conditionFor(hour.official.shortForecast, hour.official.isDaytime)} night={!hour.official.isDaytime} />{hour.official.shortForecast}</span><strong className="briefing-mobile-temp">{temperature(hour.official)}</strong></> : '—'}</td>
              <td className="briefing-desktop-temp">{hour.official ? temperature(hour.official) : '—'}</td>
              {data.modelsAvailable && hour.modeled.map((phase, index) => <td key={models[index][0]}>{phase ? <span className="briefing-condition" data-phase={phase}><WeatherIcon condition={phase} size={16} />{phaseLabel[phase]}</span> : <span aria-label="Unavailable">—</span>}</td>)}
            </tr>
          })}</tbody>
        </table>
      </div>
    </section>}
  </>
}

const wetConditions = new Set<Conditions>(['rain', 'snow', 'mix', 'freezing-rain', 'sleet', 'storm'])

function DailyBriefing({ periods, zone }: { periods: OfficialPeriod[]; zone: string }) {
  if (!periods.length) return <p className="briefing-empty">NWS forecast unavailable for these dates.</p>
  const wet = periods.filter(period => wetConditions.has(conditionFor(period.shortForecast)))
  const first = wet[0]
  const highs = periods.filter(period => period.isDaytime && period.temperatureUnit === 'F').map(period => Math.round(period.temperature))
  const lowHigh = Math.min(...highs), warmHigh = Math.max(...highs)
  return <section className="briefing-band" aria-label="Daily NWS forecast">
    <div className="briefing-overview"><p>{first ? `${first.name}: ${first.shortForecast.toLowerCase()}.` : 'Dry in the daily forecast.'}
      {highs.length > 0 && (lowHigh === warmHigh ? <> High near <ForecastTemperature value={warmHigh} />.</> : <> Highs <ForecastTemperature value={lowHigh} showUnit={false} /> to <ForecastTemperature value={warmHigh} />.</>)}</p></div>
    <ul className="briefing-days">{periods.map(period => <li key={period.startTime}>
      <div className="briefing-day-label"><strong>{period.name}</strong><small>{dayName(dateAt(Date.parse(period.startTime), zone))}</small></div>
      <WeatherIcon condition={conditionFor(period.shortForecast, period.isDaytime)} night={!period.isDaytime} size={27} />
      <div className="briefing-day-weather"><strong>{period.shortForecast}</strong>{period.detailedForecast && <p>{period.detailedForecast}</p>}</div>
      <div className="briefing-day-numbers"><strong>{temperature(period)}</strong><small>{period.isDaytime ? 'High' : 'Low'}</small></div>
    </li>)}</ul>
  </section>
}

function ExtendedBriefing({ data }: { data: Extract<Briefing, { range: 'extended' }> }) {
  if (!data.days.some(day => day.values.some(Boolean))) return <p className="briefing-empty">Extended model guidance unavailable.</p>
  const threshold = 2.54
  const both = data.days.filter(day => day.values.every(value => value && value.total >= threshold)).map(day => dayName(day.date))
  const split = data.days.filter(day => day.values.every(Boolean) && day.values.some(value => value!.total >= threshold) && day.values.some(value => value!.total < threshold)).map(day => dayName(day.date))
  const heights = data.days.flatMap(day => day.values.flatMap(value => value ? [value.high] : []))
  return <section className="briefing-band" aria-label="Extended model outlook">
    <div className="briefing-overview"><h3>Days 8–15</h3><p>Modeled highs range from <ForecastTemperature value={Math.min(...heights)} showUnit={false} /> to <ForecastTemperature value={Math.max(...heights)} />.</p>
      {!!both.length && <p>Both models show at least 0.10 in on {both.join('; ')}.</p>}
      {!!split.length && <p>Models disagree on reaching 0.10 in on {split.join('; ')}.</p>}</div>
    <div className="briefing-table-wrap" tabIndex={0} aria-label="Extended forecast table"><table className="briefing-table briefing-extended-table">
      <thead><tr><th scope="col">Day</th><th scope="col">GFS</th><th scope="col">Euro IFS</th></tr></thead>
      <tbody>{data.days.map(day => <tr key={day.date}><th scope="row">{dayName(day.date)}</th>{day.values.map((value, index) => <td key={models[index][0]}>
        {value ? <><span className="briefing-condition"><WeatherIcon condition={value.snow && value.snow > 0 ? 'snow' : value.total >= threshold ? 'rain' : 'dry'} size={17} />
          <strong><ForecastTemperature value={value.high} showUnit={false} /> / <ForecastTemperature value={value.low} /></strong></span><small>{(value.total / 25.4).toFixed(2)} in precip.</small></> : '—'}</td>)}</tr>)}</tbody>
    </table></div>
  </section>
}

function seasonalText(signal: SeasonalSignal | null, metric: 'Temperature' | 'Precipitation') {
  if (!signal) return 'Unavailable'
  if (signal.category === 'EC') return 'No clear tilt'
  if (signal.category === 'Normal') return 'Leans near normal'
  if (metric === 'Temperature') return signal.category === 'Above' ? 'Leans warmer than normal' : 'Leans cooler than normal'
  return signal.category === 'Above' ? 'Leans wetter than normal' : 'Leans drier than normal'
}

function SeasonalBriefing({ data }: { data: Extract<Briefing, { range: 'seasonal' }> }) {
  if (!data.season) return <p className="briefing-empty">No NOAA seasonal outlook for this point.</p>
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium' })
  return <section className="briefing-band" aria-label="NOAA seasonal outlook">
    <div className="briefing-overview"><h3>{seasonLabel(data.season)}</h3></div>
    <dl className="briefing-season">{([['Temperature', data.temperature, Thermometer], ['Precipitation', data.precipitation, Droplets]] as const).map(([metric, signal, Icon]) => <div key={metric}>
      <dt><Icon size={22} aria-hidden="true" />{metric}</dt><dd><strong>{seasonalText(signal, metric)}</strong>
        {signal && <small>{signal.category === 'EC' ? 'Equal chances' : `${signal.probability}% outlook band`} · Issued {date.format(signal.issued)}</small>}</dd>
    </div>)}</dl>
  </section>
}
