import { invoke } from '@tauri-apps/api/core'

export type StormDeskHour = {
  snowfallInches?: number | null
  snowProbabilityPercent?: number | null
  snowOver2Percent?: number | null
  snowOver4Percent?: number | null
  snowP10Inches?: number | null
  snowP50Inches?: number | null
  snowP90Inches?: number | null
  precipProbabilityPercent?: number | null
  precipP10Inches?: number | null
  precipP50Inches?: number | null
  precipP90Inches?: number | null
  highF?: number | null
  lowF?: number | null
  intervalStartTime?: string | null
  sourceForecastHours?: number[]
  validTime: string
  forecastHour: number
  temperatureF: number | null
  dewpointF: number | null
  windSpeedMph: number | null
  windDirectionDegrees: number | null
  gustMph: number | null
  precipitationInches: number | null
  capeJkg: number | null
  cloudCoverPercent: number | null
}

export type StormDeskRun = {
  model: 'HRRR' | 'GFS' | 'NBM' | 'NBM-SNOW' | 'AIFS'
  runTime: string
  hours: StormDeskHour[]
}

export type StormDeskEvidence = {
  snow?: StormDeskRun | null
  nbm?: StormDeskRun | null
  probabilityError?: string
  latitude: number
  longitude: number
  latest: StormDeskRun
  previous: StormDeskRun
}

type StormDeskFileRequest = {
  sourceUrl: string
  validTime: string
  forecastHour: number
}

type StormDeskRunRequest = {
  daily?: boolean
  model: 'HRRR' | 'GFS' | 'NBM' | 'NBM-SNOW'
  runTime: string
  files: StormDeskFileRequest[]
}

const hrrrHost = 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com'
const availabilityLagHours = 3
const availabilityLookbackHours = 8
const forecastHorizons = [1, 3, 6] as const
export type StormDeskRange = 'short' | 'week' | 'extended'
const horizons: Record<StormDeskRange, readonly number[]> = {
  short: forecastHorizons,
  week: [24, 48, 72, 96, 120, 144, 168],
  extended: [192, 216, 240, 264, 288, 312, 336, 360],
}

export function loadSavedStormDesk(coordinates: [number, number], range: StormDeskRange) {
  return invoke<StormDeskEvidence>('load_saved_storm_desk', {
    longitude: coordinates[0], latitude: coordinates[1],
    model: range === 'short' ? 'HRRR' : 'GFS', count: horizons[range].length,
  })
}

export function listStormDeskHistory(coordinates: [number, number], range: StormDeskRange) {
  return invoke<StormDeskEvidence[]>('list_storm_desk_history', {
    longitude: coordinates[0], latitude: coordinates[1],
    model: range === 'short' ? 'HRRR' : 'GFS', count: horizons[range].length,
  })
}

export function stormDeskSourceUrl(run: StormDeskRun, hour: StormDeskHour) {
  if (run.model === 'AIFS') {
    const cycle = new Date(run.runTime).toISOString().slice(0, 13).replace(/[-T]/g, '')
    return `https://data.ecmwf.int/forecasts/${cycle.slice(0, 8)}/${cycle.slice(8)}z/aifs-single/0p25/oper/${cycle}0000-${hour.forecastHour}h-oper-fc.grib2`
  }
  if (run.model === 'NBM-SNOW') return buildNbmUrl(new Date(run.runTime), hour.forecastHour).replaceAll('/qmd/', '/core/').replace('.qmd.', '.core.')
  if (run.model === 'NBM') return buildNbmUrl(new Date(run.runTime), hour.forecastHour)
  return buildSourceUrl(new Date(run.runTime), hour.forecastHour, run.model)
}

export async function fetchSnowfallGuidance(coordinates: [number, number], day: StormDeskHour) {
  if (!day.intervalStartTime) throw new Error('Choose a daily forecast first.')
  const likely = new Date()
  likely.setUTCMinutes(0,0,0)
  likely.setUTCHours(Math.floor((likely.getUTCHours() - 3) / 6) * 6)
  for (let lookback=0; lookback<4; lookback++) {
    const run = new Date(likely.getTime() - lookback*6*3_600_000)
    const files = Array.from({length:4},(_,index) => {
      const time = new Date(day.intervalStartTime!).getTime() + (index+1)*6*3_600_000
      const forecastHour = (time-run.getTime())/3_600_000
      return {sourceUrl:buildNbmUrl(run,forecastHour).replaceAll('/qmd/','/core/').replace('.qmd.','.core.'),validTime:new Date(time).toISOString(),forecastHour}
    })
    if (files.some((file) => file.forecastHour<6 || file.forecastHour>264)) throw new Error('NBM snowfall guidance does not cover this day.')
    if (!await invoke<boolean>('check_hrrr_source_available',{url:files[3].sourceUrl})) continue
    return invoke<StormDeskRun>('fetch_storm_desk_probabilities',{request:{model:'NBM-SNOW',runTime:run.toISOString(),files},longitude:coordinates[0],latitude:coordinates[1]})
  }
  throw new Error('Snowfall guidance is not available from NOAA right now.')
}

export async function fetchStormDeskEvidence(
  coordinates: [number, number],
  range: StormDeskRange = 'short',
  cached?: StormDeskEvidence,
): Promise<StormDeskEvidence> {
  const model = range === 'short' ? 'HRRR' : 'GFS'
  const latestRun = await resolveLatestRun(model)
  const previousRun = new Date(latestRun)
  previousRun.setUTCHours(previousRun.getUTCHours() - (model === 'HRRR' ? 1 : 6))

  const dailyTimes = buildDailyTimes(latestRun, range)

  const evidence = cached && Date.parse(cached.latest.runTime) === latestRun.getTime() &&
    Date.parse(cached.previous.runTime) === previousRun.getTime() ? { ...cached, probabilityError: undefined } :
    await invoke<StormDeskEvidence>('fetch_storm_desk_evidence', {
    request: {
      longitude: coordinates[0],
      latitude: coordinates[1],
      latest: model === 'GFS' ? buildDailyRequest(latestRun, dailyTimes) : buildRunRequest(latestRun, horizons[range], model),
      previous: model === 'GFS' ? buildDailyRequest(previousRun, dailyTimes) : buildRunRequest(
        previousRun,
        horizons[range].map((hour) => hour + (model === 'HRRR' ? 1 : 6)),
        model,
      ),
    },
  })
  if (model === 'GFS') {
    try { evidence.nbm = await fetchNbmGuidance(coordinates, evidence.latest.hours) }
    catch (cause) { evidence.nbm = null; evidence.probabilityError = String(cause) }
    await invoke('save_storm_desk_enriched', { evidence })
  }
  return evidence
}

function buildNbmUrl(run: Date, hour: number) {
  const date = run.toISOString().slice(0, 10).replaceAll('-', '')
  const cycle = String(run.getUTCHours()).padStart(2, '0')
  return `https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.${date}/${cycle}/qmd/blend.t${cycle}z.qmd.f${String(hour).padStart(3, '0')}.co.grib2`
}

async function fetchNbmGuidance(coordinates: [number, number], days: StormDeskHour[]) {
  const likely = new Date()
  likely.setUTCMinutes(0, 0, 0)
  likely.setUTCHours(Math.floor((likely.getUTCHours() - 8) / 6) * 6)
  for (let lookback = 0; lookback < 4; lookback++) {
    const run = new Date(likely.getTime() - lookback * 6 * 3_600_000)
    const files = days.flatMap((day) => {
      const hour = (new Date(day.validTime).getTime() - run.getTime()) / 3_600_000
      return hour >= 24 && hour <= 264 && hour % 6 === 0
        ? [{ sourceUrl: buildNbmUrl(run, hour), validTime: day.validTime, forecastHour: hour }] : []
    })
    if (!files.length) throw new Error('NBM probability guidance does not cover this date range.')
    if (!await invoke<boolean>('check_hrrr_source_available', {url: files.at(-1)!.sourceUrl})) continue
    return invoke<StormDeskRun>('fetch_storm_desk_probabilities', {
      request: {model:'NBM', runTime:run.toISOString(), files}, longitude:coordinates[0], latitude:coordinates[1],
    })
  }
  throw new Error('NBM probability guidance is not available from NOAA right now.')
}

function buildDailyTimes(run: Date, range: StormDeskRange) {
  const start = Date.UTC(run.getUTCFullYear(), run.getUTCMonth(), run.getUTCDate() + (run.getUTCHours() === 0 ? 0 : 1))
  const days = range === 'extended' ? 8 : 7
  const offset = range === 'extended' ? 7 : 0
  return Array.from({ length: days * 4 }, (_, index) =>
    start + (offset * 24 + (index + 1) * 6) * 3_600_000)
}

function buildDailyRequest(run: Date, times: number[]): StormDeskRunRequest {
  return { model: 'GFS', daily: true, runTime: run.toISOString(), files: times.map((time) => {
    const forecastHour = (time - run.getTime()) / 3_600_000
    return { sourceUrl: buildSourceUrl(run, forecastHour, 'GFS'), validTime: new Date(time).toISOString(), forecastHour }
  }) }
}

async function resolveLatestRun(model: 'HRRR' | 'GFS') {
  const likelyRun = new Date()
  likelyRun.setUTCMinutes(0, 0, 0)
  likelyRun.setUTCHours(likelyRun.getUTCHours() - availabilityLagHours)
  if (model === 'GFS') likelyRun.setUTCHours(Math.floor(likelyRun.getUTCHours() / 6) * 6)

  for (let offset = 0; offset <= availabilityLookbackHours; offset += 1) {
    const candidate = new Date(likelyRun)
    candidate.setUTCHours(candidate.getUTCHours() - offset * (model === 'HRRR' ? 1 : 6))
    const previous = new Date(candidate)
    previous.setUTCHours(previous.getUTCHours() - (model === 'HRRR' ? 1 : 6))
    const url = buildSourceUrl(candidate, model === 'HRRR' ? 7 : 360, model)

    try {
      if (await invoke<boolean>('check_hrrr_source_available', { url }) &&
        await invoke<boolean>('check_hrrr_source_available', { url: buildSourceUrl(previous, model === 'HRRR' ? 7 : 366, model) })) {
        return candidate
      }
    } catch {
      // Try the next known cycle. The final error comes from the evidence request.
    }
  }

  throw new Error(`No recent ${model} run is available from NOAA.`)
}

function buildRunRequest(
  runTime: Date,
  forecastHours: readonly number[],
  model: 'HRRR' | 'GFS',
): StormDeskRunRequest {
  return {
    model,
    runTime: runTime.toISOString(),
    files: forecastHours.map((forecastHour) => ({
      sourceUrl: buildSourceUrl(runTime, forecastHour, model),
      validTime: new Date(
        runTime.getTime() + forecastHour * 60 * 60_000,
      ).toISOString(),
      forecastHour,
    })),
  }
}

function buildSourceUrl(runTime: Date, forecastHour: number, model: 'HRRR' | 'GFS' | 'NBM') {
  const runDate = [
    runTime.getUTCFullYear(),
    String(runTime.getUTCMonth() + 1).padStart(2, '0'),
    String(runTime.getUTCDate()).padStart(2, '0'),
  ].join('')
  const runHour = String(runTime.getUTCHours()).padStart(2, '0')
  const forecast = String(forecastHour).padStart(2, '0')

  return model === 'HRRR'
    ? `${hrrrHost}/hrrr.${runDate}/conus/hrrr.t${runHour}z.wrfsfcf${forecast}.grib2`
    : `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${runDate}/${runHour}/atmos/gfs.t${runHour}z.pgrb2.0p25.f${String(forecastHour).padStart(3, '0')}`
}
