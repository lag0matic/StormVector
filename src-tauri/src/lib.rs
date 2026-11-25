use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use std::{env, fs};

use futures_util::future::try_join_all;
use reqwest::header::RANGE;
use rodio::source::SineWave;
use rodio::{OutputStream, Sink, Source};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const NEXRAD_LEVEL3_HOST: &str = "https://unidata-nexrad-level3.s3.amazonaws.com/";
const HRRR_S3_HOST: &str = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com/";
const GFS_S3_HOST: &str = "https://noaa-gfs-bdp-pds.s3.amazonaws.com/";
const NBM_S3_HOST: &str = "https://noaa-nbm-grib2-pds.s3.amazonaws.com/";
const LIGHTNING_DENSITY_URL: &str =
    "https://ftp.opc.ncep.noaa.gov/grids/operational/lightning_density/ltng_15/latest.15.grb2";
const LIGHTNING_GRID_WIDTH: usize = 3476;
const LIGHTNING_GRID_HEIGHT: usize = 1460;
const LIGHTNING_LAT_START: f64 = -25.0;
const LIGHTNING_LAT_END: f64 = 80.0;
const LIGHTNING_LON_START: f64 = 110.0;
const LIGHTNING_LON_END: f64 = 360.0;
const LIGHTNING_CELL_AREA_M2: f64 = 64_000_000.0;
const LIGHTNING_WINDOW_SECONDS: f64 = 15.0 * 60.0;
const MAX_LIGHTNING_POINTS: usize = 450;
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(target_os = "linux")]
const WEBVIEW_ZOOM_LEVEL: f64 = 1.0;

static DECODER_LOCK: Mutex<()> = Mutex::new(());

fn allowed_weather_source(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    parsed.scheme() == "https"
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.port().is_none()
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && matches!(
            parsed.host_str(),
            Some(
                "noaa-hrrr-bdp-pds.s3.amazonaws.com"
                    | "noaa-gfs-bdp-pds.s3.amazonaws.com"
                    | "noaa-nbm-grib2-pds.s3.amazonaws.com"
            )
        )
        && parsed.path().ends_with(".idx")
}

#[tauri::command]
fn open_weather_source(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !allowed_weather_source(&url) {
        return Err("Source link is not an allowed NOAA inventory.".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Could not open source in your browser.".into())
}

#[tauri::command]
fn open_weather_chart(app: tauri::AppHandle, chart: String) -> Result<(), String> {
    let url = match chart.as_str() {
        "noaa" => "https://mag.ncep.noaa.gov/",
        "ecmwf" => "https://www.ecmwf.int/en/forecasts/charts",
        _ => return Err("Unknown weather chart.".into()),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("Could not open the chart in your browser: {error}"))
}

#[tauri::command]
async fn open_storm_desk(
    app: tauri::AppHandle,
    longitude: f64,
    latitude: f64,
    theme: String,
) -> Result<(), String> {
    if !longitude.is_finite() || !latitude.is_finite() {
        return Err("Invalid location".into());
    }
    if let Some(window) = app.get_webview_window("storm-desk") {
        window
            .emit(
                "forecast-location",
                serde_json::json!({"longitude":longitude,"latitude":latitude,"theme":theme}),
            )
            .map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let theme = if theme == "dark" { "dark" } else { "light" };
    let url = format!("index.html?desk=1&lon={longitude}&lat={latitude}&theme={theme}");
    tauri::WebviewWindowBuilder::new(&app, "storm-desk", tauri::WebviewUrl::App(url.into()))
        .title("StormVector - Forecast Briefing")
        .inner_size(1200.0, 850.0)
        .min_inner_size(700.0, 500.0)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LightningActivityResponse {
    observed_at: String,
    features: Vec<LightningActivityFeature>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LightningActivityFeature {
    id: String,
    observed_at: String,
    coordinates: [f64; 2],
    intensity: u8,
    approx_strikes: f64,
}

#[derive(Clone)]
struct LightningBucket {
    lat: f64,
    lon: f64,
    approx_strikes: f64,
}

struct DecoderRuntime {
    executable: PathBuf,
    library_dir: Option<PathBuf>,
    terminfo_dir: Option<PathBuf>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FutureRadarRenderRequest {
    render_url: String,
    source_url: String,
    band: u32,
    west: f64,
    south: f64,
    east: f64,
    north: f64,
    width: u32,
    height: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StormDeskEvidenceRequest {
    longitude: f64,
    latitude: f64,
    latest: StormDeskRunRequest,
    previous: StormDeskRunRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StormDeskRunRequest {
    #[serde(default)]
    daily: bool,
    model: String,
    run_time: String,
    files: Vec<StormDeskFileRequest>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StormDeskFileRequest {
    source_url: String,
    valid_time: String,
    forecast_hour: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StormDeskEvidenceResponse {
    #[serde(default)]
    snow: Option<StormDeskRunResponse>,
    #[serde(default)]
    nbm: Option<StormDeskRunResponse>,
    latitude: f64,
    longitude: f64,
    latest: StormDeskRunResponse,
    previous: StormDeskRunResponse,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StormDeskRunResponse {
    model: String,
    run_time: String,
    hours: Vec<StormDeskHourResponse>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StormDeskHourResponse {
    #[serde(default)]
    snowfall_inches: Option<f64>,
    #[serde(default)]
    snow_probability_percent: Option<f64>,
    #[serde(default)]
    snow_over2_percent: Option<f64>,
    #[serde(default)]
    snow_over4_percent: Option<f64>,
    #[serde(default)]
    snow_p10_inches: Option<f64>,
    #[serde(default)]
    snow_p50_inches: Option<f64>,
    #[serde(default)]
    snow_p90_inches: Option<f64>,
    #[serde(default)]
    precip_probability_percent: Option<f64>,
    #[serde(default)]
    precip_p10_inches: Option<f64>,
    #[serde(default)]
    precip_p50_inches: Option<f64>,
    #[serde(default)]
    precip_p90_inches: Option<f64>,
    #[serde(default)]
    high_f: Option<f64>,
    #[serde(default)]
    low_f: Option<f64>,
    #[serde(default)]
    interval_start_time: Option<String>,
    #[serde(default)]
    source_forecast_hours: Vec<u32>,
    valid_time: String,
    forecast_hour: u32,
    temperature_f: Option<f64>,
    dewpoint_f: Option<f64>,
    wind_speed_mph: Option<f64>,
    wind_direction_degrees: Option<f64>,
    gust_mph: Option<f64>,
    precipitation_inches: Option<f64>,
    cape_jkg: Option<f64>,
    cloud_cover_percent: Option<f64>,
}

struct StormDeskHourBuilder {
    response: StormDeskHourResponse,
    wind_u_ms: Option<f64>,
    wind_v_ms: Option<f64>,
}

#[derive(Clone, Copy)]
enum StormDeskField {
    SnowAmount,
    SnowProbability,
    SnowOver2,
    SnowOver4,
    SnowP10,
    SnowP50,
    SnowP90,
    Probability,
    P10,
    P50,
    P90,
    High,
    Low,
    Temperature,
    Dewpoint,
    WindU,
    WindV,
    Gust,
    Precipitation,
    Cape,
    CloudCover,
}

const STORM_DESK_FIELDS: [(StormDeskField, &str); 21] = [
    (StormDeskField::SnowAmount, ":ASNOW:surface:"),
    (StormDeskField::SnowProbability, ":ASNOW:surface:"),
    (StormDeskField::SnowOver2, ":ASNOW:surface:"),
    (StormDeskField::SnowOver4, ":ASNOW:surface:"),
    (StormDeskField::SnowP10, ":ASNOW:surface:"),
    (StormDeskField::SnowP50, ":ASNOW:surface:"),
    (StormDeskField::SnowP90, ":ASNOW:surface:"),
    (StormDeskField::Probability, ":APCP:surface:"),
    (StormDeskField::P10, ":APCP:surface:"),
    (StormDeskField::P50, ":APCP:surface:"),
    (StormDeskField::P90, ":APCP:surface:"),
    (StormDeskField::High, ":TMAX:2 m above ground:"),
    (StormDeskField::Low, ":TMIN:2 m above ground:"),
    (StormDeskField::Temperature, ":TMP:2 m above ground:"),
    (StormDeskField::Dewpoint, ":DPT:2 m above ground:"),
    (StormDeskField::WindU, ":UGRD:10 m above ground:"),
    (StormDeskField::WindV, ":VGRD:10 m above ground:"),
    (StormDeskField::Gust, ":GUST:surface:"),
    (StormDeskField::Precipitation, ":APCP:surface:"),
    (StormDeskField::Cape, ":CAPE:surface:"),
    (StormDeskField::CloudCover, ":TCDC:entire atmosphere:"),
];

#[tauri::command]
async fn fetch_storm_desk_evidence(
    app: tauri::AppHandle,
    request: StormDeskEvidenceRequest,
) -> Result<StormDeskEvidenceResponse, String> {
    if !request.longitude.is_finite()
        || !request.latitude.is_finite()
        || !(-135.0..=-60.0).contains(&request.longitude)
        || !(20.0..=55.0).contains(&request.latitude)
    {
        return Err(
            "Storm Desk currently supports selected points in the HRRR CONUS domain.".to_string(),
        );
    }

    validate_storm_desk_run(&request.latest)?;
    validate_storm_desk_run(&request.previous)?;

    let latest =
        fetch_storm_desk_run(&app, request.latest, request.longitude, request.latitude).await?;
    let previous =
        fetch_storm_desk_run(&app, request.previous, request.longitude, request.latitude).await?;

    let evidence = StormDeskEvidenceResponse {
        snow: None,
        nbm: None,
        latitude: request.latitude,
        longitude: request.longitude,
        latest,
        previous,
    };
    save_storm_desk_snapshot(&app, &evidence)?;
    Ok(evidence)
}

fn save_storm_desk_snapshot(
    app: &tauri::AppHandle,
    evidence: &StormDeskEvidenceResponse,
) -> Result<(), String> {
    let path = storm_desk_saved_path(
        &app,
        evidence.longitude,
        evidence.latitude,
        &evidence.latest.model,
        evidence.latest.hours.len(),
    )?;
    fs::write(
        &path,
        serde_json::to_vec(&evidence).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Could not save briefing: {error}"))?;
    let history_dir = path
        .parent()
        .ok_or("Saved briefing directory missing")?
        .join("history");
    fs::create_dir_all(&history_dir).map_err(|error| error.to_string())?;
    let history_key = format!("{}:{}", path.display(), evidence.latest.run_time);
    fs::write(
        history_dir.join(format!("{}.json", hash_cache_key(&history_key))),
        serde_json::to_vec(&evidence).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Could not save briefing history: {error}"))?;
    Ok(())
}

#[tauri::command]
fn save_storm_desk_enriched(
    app: tauri::AppHandle,
    evidence: StormDeskEvidenceResponse,
) -> Result<(), String> {
    if !evidence.longitude.is_finite()
        || !evidence.latitude.is_finite()
        || evidence.latest.hours.len() > 8
        || evidence.previous.hours.len() > 8
        || evidence
            .snow
            .as_ref()
            .is_some_and(|run| run.model != "NBM-SNOW" || run.hours.len() > 8)
        || evidence
            .nbm
            .as_ref()
            .is_some_and(|run| run.model != "NBM" || run.hours.len() > 8)
    {
        return Err("Invalid briefing snapshot.".into());
    }
    save_storm_desk_snapshot(&app, &evidence)
}

#[tauri::command]
fn list_storm_desk_history(
    app: tauri::AppHandle,
    longitude: f64,
    latitude: f64,
    model: String,
    count: usize,
) -> Result<Vec<StormDeskEvidenceResponse>, String> {
    let path = storm_desk_saved_path(&app, longitude, latitude, &model, count)?;
    let dir = path
        .parent()
        .ok_or("Saved briefing directory missing")?
        .join("history");
    let mut history = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Ok(bytes) = fs::read(entry.path()) {
                if let Ok(evidence) = serde_json::from_slice::<StormDeskEvidenceResponse>(&bytes) {
                    if evidence.longitude == longitude
                        && evidence.latitude == latitude
                        && evidence.latest.model == model
                        && evidence.latest.hours.len() == count
                        && (model != "GFS"
                            || evidence
                                .latest
                                .hours
                                .iter()
                                .all(|hour| hour.source_forecast_hours.len() == 4))
                    {
                        history.push(evidence);
                    }
                }
            }
        }
    }
    history.sort_by(|a, b| b.latest.run_time.cmp(&a.latest.run_time));
    history.truncate(100);
    Ok(history)
}

fn storm_desk_saved_path(
    app: &tauri::AppHandle,
    longitude: f64,
    latitude: f64,
    model: &str,
    count: usize,
) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("saved-briefings-v1");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(format!(
        "{}.json",
        hash_cache_key(&if model == "GFS" {
            format!("{longitude}:{latitude}:{model}:{count}:daily-v2")
        } else {
            format!("{longitude}:{latitude}:{model}:{count}")
        })
    )))
}

#[tauri::command]
fn load_saved_storm_desk(
    app: tauri::AppHandle,
    longitude: f64,
    latitude: f64,
    model: String,
    count: usize,
) -> Result<StormDeskEvidenceResponse, String> {
    let bytes = fs::read(storm_desk_saved_path(
        &app, longitude, latitude, &model, count,
    )?)
    .map_err(|_| "No saved briefing for this point and range yet.".to_string())?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Saved briefing could not be read: {error}"))
}

fn validate_storm_desk_run(request: &StormDeskRunRequest) -> Result<(), String> {
    if request.files.is_empty() || request.files.len() > (if request.daily { 32 } else { 8 }) {
        return Err("Storm Desk requested an invalid number of forecast hours.".to_string());
    }

    if request.files.iter().any(|file| {
        !(match request.model.as_str() {
            "HRRR" => file.source_url.starts_with(HRRR_S3_HOST),
            "GFS" => file.source_url.starts_with(GFS_S3_HOST),
            "NBM" | "NBM-SNOW" => file.source_url.starts_with(NBM_S3_HOST),
            _ => false,
        })
    }) {
        return Err("Storm Desk model source host is not allowed.".to_string());
    }

    Ok(())
}

#[tauri::command]
async fn fetch_storm_desk_probabilities(
    app: tauri::AppHandle,
    request: StormDeskRunRequest,
    longitude: f64,
    latitude: f64,
) -> Result<StormDeskRunResponse, String> {
    if !matches!(request.model.as_str(), "NBM" | "NBM-SNOW")
        || request.daily
        || !longitude.is_finite()
        || !latitude.is_finite()
        || !(-135.0..=-60.0).contains(&longitude)
        || !(20.0..=55.0).contains(&latitude)
    {
        return Err("Invalid NBM point request.".into());
    }
    validate_storm_desk_run(&request)?;
    fetch_storm_desk_samples(&app, request, longitude, latitude).await
}

fn idx_interval_hours(line: &str) -> Option<(u32, u32)> {
    let interval = line.split(':').nth(5)?;
    let mut words = interval.split_whitespace();
    let (start, end) = words.next()?.split_once('-')?;
    let multiplier = match words.next()? {
        "hour" => 1,
        "day" => 24,
        _ => return None,
    };
    Some((
        start.parse::<u32>().ok()? * multiplier,
        end.parse::<u32>().ok()? * multiplier,
    ))
}

async fn fetch_storm_desk_run(
    app: &tauri::AppHandle,
    request: StormDeskRunRequest,
    longitude: f64,
    latitude: f64,
) -> Result<StormDeskRunResponse, String> {
    if !request.daily {
        return fetch_storm_desk_samples(app, request, longitude, latitude).await;
    }
    if request.model != "GFS" || request.files.len() % 4 != 0 {
        return Err("Daily forecasts require complete groups of four GFS periods.".into());
    }
    let mut hours = Vec::new();
    for files in request.files.chunks(4) {
        let samples = fetch_storm_desk_samples(
            app,
            StormDeskRunRequest {
                daily: true,
                model: request.model.clone(),
                run_time: request.run_time.clone(),
                files: files.to_vec(),
            },
            longitude,
            latitude,
        )
        .await?;
        hours.push(aggregate_gfs_day(samples.hours)?);
    }
    Ok(StormDeskRunResponse {
        model: request.model,
        run_time: request.run_time,
        hours,
    })
}

fn aggregate_gfs_day(
    mut hours: Vec<StormDeskHourResponse>,
) -> Result<StormDeskHourResponse, String> {
    if hours.len() != 4
        || hours
            .windows(2)
            .any(|pair| pair[1].forecast_hour != pair[0].forecast_hour + 6)
    {
        return Err("Daily forecast contains missing or overlapping periods.".into());
    }
    let high = hours
        .iter()
        .map(|hour| hour.high_f)
        .collect::<Option<Vec<_>>>()
        .map(|values| values.into_iter().fold(f64::NEG_INFINITY, f64::max));
    let low = hours
        .iter()
        .map(|hour| hour.low_f)
        .collect::<Option<Vec<_>>>()
        .map(|values| values.into_iter().fold(f64::INFINITY, f64::min));
    let precipitation = hours
        .iter()
        .map(|hour| hour.precipitation_inches)
        .collect::<Option<Vec<_>>>()
        .map(|values| values.into_iter().sum());
    let start = hours[0].interval_start_time.clone();
    let source_hours = hours.iter().map(|hour| hour.forecast_hour).collect();
    let mut day = hours.pop().ok_or("Missing daily endpoint")?;
    day.high_f = high;
    day.low_f = low;
    day.precipitation_inches = precipitation;
    day.interval_start_time = start;
    day.source_forecast_hours = source_hours;
    day.temperature_f = None;
    day.dewpoint_f = None;
    day.wind_speed_mph = None;
    day.wind_direction_degrees = None;
    day.gust_mph = None;
    day.cape_jkg = None;
    day.cloud_cover_percent = None;
    Ok(day)
}

async fn fetch_storm_desk_samples(
    app: &tauri::AppHandle,
    request: StormDeskRunRequest,
    longitude: f64,
    latitude: f64,
) -> Result<StormDeskRunResponse, String> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Storm Desk data directory failed: {error}"))?
        .join("model-runs-v1");
    let decoder = find_wgrib2(app).ok_or("wgrib2 decoder was not found locally or on PATH.")?;
    fetch_storm_desk_samples_with_runtime(decoder, cache_dir, request, longitude, latitude).await
}

async fn fetch_storm_desk_samples_with_runtime(
    decoder: DecoderRuntime,
    cache_dir: PathBuf,
    request: StormDeskRunRequest,
    longitude: f64,
    latitude: f64,
) -> Result<StormDeskRunResponse, String> {
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    let cache_key = serde_json::to_string(&serde_json::json!({
        "schema": 2, "daily": request.daily, "model": request.model, "run": request.run_time,
        "longitude": longitude, "latitude": latitude,
        "files": request.files.iter().map(|file| (&file.source_url, &file.valid_time, file.forecast_hour)).collect::<Vec<_>>()
    })).map_err(|error| error.to_string())?;
    let cache_path = cache_dir.join(format!("{}.json", hash_cache_key(&cache_key)));
    if let Ok(bytes) = fs::read(&cache_path) {
        if let Ok(snapshot) = serde_json::from_slice::<StormDeskRunResponse>(&bytes) {
            return Ok(snapshot);
        }
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| error.to_string())?;
    let mut grib_bytes = Vec::new();
    let mut records: Vec<(usize, StormDeskField)> = Vec::new();
    let mut hours: Vec<StormDeskHourBuilder> = request
        .files
        .iter()
        .map(|file| StormDeskHourBuilder {
            response: StormDeskHourResponse {
                snowfall_inches: None,
                snow_probability_percent: None,
                snow_over2_percent: None,
                snow_over4_percent: None,
                snow_p10_inches: None,
                snow_p50_inches: None,
                snow_p90_inches: None,
                precip_probability_percent: None,
                precip_p10_inches: None,
                precip_p50_inches: None,
                precip_p90_inches: None,
                high_f: None,
                low_f: None,
                interval_start_time: None,
                source_forecast_hours: vec![],
                valid_time: file.valid_time.clone(),
                forecast_hour: file.forecast_hour,
                temperature_f: None,
                dewpoint_f: None,
                wind_speed_mph: None,
                wind_direction_degrees: None,
                gust_mph: None,
                precipitation_inches: None,
                cape_jkg: None,
                cloud_cover_percent: None,
            },
            wind_u_ms: None,
            wind_v_ms: None,
        })
        .collect();

    for (hour_index, file) in request.files.iter().enumerate() {
        let idx_url = format!("{}.idx", file.source_url);
        let idx_response = client
            .get(&idx_url)
            .send()
            .await
            .map_err(|error| format!("Storm Desk HRRR index request failed: {error}"))?;

        if !idx_response.status().is_success() {
            return Err(format!(
                "Storm Desk HRRR index request failed: {}",
                idx_response.status()
            ));
        }

        let idx_text = idx_response
            .text()
            .await
            .map_err(|error| format!("Storm Desk HRRR index read failed: {error}"))?;
        let lines: Vec<&str> = idx_text.lines().collect();
        let mut ranges = Vec::new();

        for (field, pattern) in STORM_DESK_FIELDS {
            let snow_field = matches!(
                field,
                StormDeskField::SnowAmount
                    | StormDeskField::SnowProbability
                    | StormDeskField::SnowOver2
                    | StormDeskField::SnowOver4
                    | StormDeskField::SnowP10
                    | StormDeskField::SnowP50
                    | StormDeskField::SnowP90
            );
            if request.model == "NBM-SNOW" {
                if !snow_field {
                    continue;
                }
                if let Some(index) = lines
                    .iter()
                    .position(|line| snow_field_matches(line, field, file.forecast_hour))
                {
                    let start = parse_idx_offset(lines[index])?;
                    let end = lines
                        .get(index + 1)
                        .map(|line| parse_idx_offset(line).map(|offset| offset.saturating_sub(1)))
                        .transpose()?;
                    ranges.push((field, start, end));
                }
                continue;
            }
            if snow_field {
                continue;
            }
            let probability_field = matches!(
                field,
                StormDeskField::Probability
                    | StormDeskField::P10
                    | StormDeskField::P50
                    | StormDeskField::P90
            );
            if (request.model == "NBM") != probability_field {
                continue;
            }
            if request.daily
                && !matches!(
                    field,
                    StormDeskField::High | StormDeskField::Low | StormDeskField::Precipitation
                )
            {
                continue;
            }
            if request.model == "NBM" {
                let statistic = match field {
                    StormDeskField::Probability => ":prob >0.254:",
                    StormDeskField::P10 => ":10% level",
                    StormDeskField::P50 => ":50% level",
                    StormDeskField::P90 => ":90% level",
                    _ => unreachable!(),
                };
                if let Some(index) = lines.iter().position(|line| {
                    line.contains(pattern)
                        && line.contains(statistic)
                        && idx_interval_hours(line)
                            == Some((file.forecast_hour.saturating_sub(24), file.forecast_hour))
                }) {
                    let start = parse_idx_offset(lines[index])?;
                    let end = lines
                        .get(index + 1)
                        .map(|line| parse_idx_offset(line).map(|offset| offset.saturating_sub(1)))
                        .transpose()?;
                    ranges.push((field, start, end));
                }
                continue;
            }
            if request.model == "GFS"
                && !request.daily
                && matches!(
                    field,
                    StormDeskField::Precipitation | StormDeskField::High | StormDeskField::Low
                )
            {
                continue;
            }
            let expected_interval = format!(
                "{}-{} hour",
                file.forecast_hour.saturating_sub(6),
                file.forecast_hour
            );
            if let Some(line_index) = lines.iter().position(|line| {
                line.contains(pattern)
                    && (!request.daily
                        || !matches!(
                            field,
                            StormDeskField::Precipitation
                                | StormDeskField::High
                                | StormDeskField::Low
                        )
                        || line.contains(&format!(":{expected_interval} ")))
            }) {
                let start = parse_idx_offset(lines[line_index])?;
                let end = lines
                    .get(line_index + 1)
                    .map(|line| parse_idx_offset(line).map(|offset| offset.saturating_sub(1)))
                    .transpose()?;
                ranges.push((field, start, end));
            }
        }

        let downloads = ranges
            .iter()
            .map(|(_, start, end)| fetch_hrrr_range(&client, &file.source_url, *start, *end));
        let messages = try_join_all(downloads).await.map_err(|error| {
            format!(
                "{} forecast +{}h: {error}",
                request.model, file.forecast_hour
            )
        })?;

        for ((field, _, _), message) in ranges.into_iter().zip(messages) {
            records.push((hour_index, field));
            grib_bytes.extend_from_slice(&message);
        }
    }

    if grib_bytes.is_empty() {
        return Err("Storm Desk did not find any requested HRRR fields.".to_string());
    }

    let work_dir = env::temp_dir().join("stormvector-storm-desk").join(format!(
        "{}-{}",
        hash_cache_key(&cache_key),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos()
    ));
    fs::create_dir_all(&work_dir)
        .map_err(|error| format!("Storm Desk work directory failed: {error}"))?;
    let grib_path = work_dir.join("point-fields.grib2");
    fs::write(&grib_path, grib_bytes)
        .map_err(|error| format!("Storm Desk GRIB write failed: {error}"))?;

    let _decoder_lock = DECODER_LOCK
        .lock()
        .map_err(|error| format!("Storm Desk decoder lock failed: {error}"))?;
    let mut command = Command::new(&decoder.executable);
    hide_decoder_window(&mut command);
    let decoder_longitude = if longitude < 0.0 {
        longitude + 360.0
    } else {
        longitude
    };
    command
        .arg(&grib_path)
        .arg("-s")
        .arg("-lon")
        .arg(decoder_longitude.to_string())
        .arg(latitude.to_string())
        .env("OMP_NUM_THREADS", "2")
        .env("OMP_WAIT_POLICY", "PASSIVE");

    if let Some(library_dir) = decoder.library_dir.as_ref() {
        add_decoder_library_path(&mut command, library_dir);
    }
    if let Some(terminfo_dir) = decoder.terminfo_dir.as_ref() {
        command.env("TERMINFO", terminfo_dir);
    }

    let output = command
        .output()
        .map_err(|error| format!("Storm Desk decoder failed to start: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "Storm Desk decoder failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let values: Vec<Option<f64>> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| line.contains("val="))
        .map(parse_wgrib2_point_value)
        .collect();
    let _ = fs::remove_dir_all(&work_dir);

    if values.len() != records.len() {
        return Err(format!(
            "Storm Desk decoded {} values for {} requested fields.",
            values.len(),
            records.len()
        ));
    }

    for ((hour_index, field), value) in records.into_iter().zip(values) {
        apply_storm_desk_value(&mut hours[hour_index], field, value);
    }

    if request.daily || matches!(request.model.as_str(), "NBM" | "NBM-SNOW") {
        for (hour, file) in hours.iter_mut().zip(&request.files) {
            let end = chrono::DateTime::parse_from_rfc3339(&file.valid_time)
                .map_err(|_| "Invalid daily valid time")?;
            hour.response.interval_start_time = Some(
                (end - chrono::Duration::hours(if request.model == "NBM" { 24 } else { 6 }))
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            );
        }
    }

    for hour in &mut hours {
        if matches!(request.model.as_str(), "NBM" | "NBM-SNOW") {
            normalize_probability_amounts(&mut hour.response);
        }
        if let (Some(u), Some(v)) = (hour.wind_u_ms, hour.wind_v_ms) {
            hour.response.wind_speed_mph = Some((u * u + v * v).sqrt() * 2.236_936_292_1);
            hour.response.wind_direction_degrees =
                Some((-u).atan2(-v).to_degrees().rem_euclid(360.0));
        }
    }

    let snapshot = StormDeskRunResponse {
        model: request.model,
        run_time: request.run_time,
        hours: hours.into_iter().map(|hour| hour.response).collect(),
    };
    let bytes = serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?;
    fs::write(&cache_path, bytes)
        .map_err(|error| format!("Could not save model snapshot: {error}"))?;
    Ok(snapshot)
}

async fn fetch_hrrr_range(
    client: &reqwest::Client,
    source_url: &str,
    start: u64,
    end: Option<u64>,
) -> Result<Vec<u8>, String> {
    let range = end
        .map(|end| format!("bytes={start}-{end}"))
        .unwrap_or_else(|| format!("bytes={start}-"));
    let response = client
        .get(source_url)
        .header(RANGE, range)
        .send()
        .await
        .map_err(|error| format!("Storm Desk HRRR field request failed: {error}"))?;

    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!(
            "Storm Desk HRRR field request failed: {}",
            response.status()
        ));
    }

    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|error| format!("Storm Desk HRRR field read failed: {error}"))
}

fn parse_wgrib2_point_value(line: &str) -> Option<f64> {
    let value = line
        .split("val=")
        .nth(1)?
        .split_whitespace()
        .next()?
        .trim_end_matches(':')
        .parse::<f64>()
        .ok()?;

    (value.is_finite() && value.abs() < 1.0e10).then_some(value)
}

fn apply_storm_desk_value(
    hour: &mut StormDeskHourBuilder,
    field: StormDeskField,
    value: Option<f64>,
) {
    match field {
        StormDeskField::SnowAmount => {
            hour.response.snowfall_inches =
                value.filter(|item| *item >= 0.0).map(|item| item / 0.0254)
        }
        StormDeskField::SnowProbability => {
            hour.response.snow_probability_percent =
                value.filter(|item| (0.0..=100.0).contains(item))
        }
        StormDeskField::SnowOver2 => {
            hour.response.snow_over2_percent = value.filter(|item| (0.0..=100.0).contains(item))
        }
        StormDeskField::SnowOver4 => {
            hour.response.snow_over4_percent = value.filter(|item| (0.0..=100.0).contains(item))
        }
        StormDeskField::SnowP10 => {
            hour.response.snow_p10_inches =
                value.filter(|item| *item >= 0.0).map(|item| item / 0.0254)
        }
        StormDeskField::SnowP50 => {
            hour.response.snow_p50_inches =
                value.filter(|item| *item >= 0.0).map(|item| item / 0.0254)
        }
        StormDeskField::SnowP90 => {
            hour.response.snow_p90_inches =
                value.filter(|item| *item >= 0.0).map(|item| item / 0.0254)
        }
        StormDeskField::Probability => {
            hour.response.precip_probability_percent =
                value.filter(|item| (0.0..=100.0).contains(item))
        }
        StormDeskField::P10 => {
            hour.response.precip_p10_inches =
                value.filter(|item| *item >= 0.0).map(|item| item / 25.4)
        }
        StormDeskField::P50 => {
            hour.response.precip_p50_inches =
                value.filter(|item| *item >= 0.0).map(|item| item / 25.4)
        }
        StormDeskField::P90 => {
            hour.response.precip_p90_inches =
                value.filter(|item| *item >= 0.0).map(|item| item / 25.4)
        }
        StormDeskField::High => hour.response.high_f = value.map(kelvin_to_fahrenheit),
        StormDeskField::Low => hour.response.low_f = value.map(kelvin_to_fahrenheit),
        StormDeskField::Temperature => {
            hour.response.temperature_f = value.map(kelvin_to_fahrenheit)
        }
        StormDeskField::Dewpoint => hour.response.dewpoint_f = value.map(kelvin_to_fahrenheit),
        StormDeskField::WindU => hour.wind_u_ms = value,
        StormDeskField::WindV => hour.wind_v_ms = value,
        StormDeskField::Gust => hour.response.gust_mph = value.map(|item| item * 2.236_936_292_1),
        StormDeskField::Precipitation => {
            hour.response.precipitation_inches = value.map(|item| item.max(0.0) / 25.4)
        }
        StormDeskField::Cape => hour.response.cape_jkg = value.map(|item| item.max(0.0)),
        StormDeskField::CloudCover => {
            hour.response.cloud_cover_percent = value.map(|item| item.clamp(0.0, 100.0))
        }
    }
}

fn kelvin_to_fahrenheit(value: f64) -> f64 {
    (value - 273.15) * 9.0 / 5.0 + 32.0
}

fn normalize_probability_amounts(hour: &mut StormDeskHourResponse) {
    if let (Some(low), Some(median), Some(high)) = (
        hour.snow_p10_inches,
        hour.snow_p50_inches,
        hour.snow_p90_inches,
    ) {
        if low > median || median > high {
            hour.snow_p10_inches = None;
            hour.snow_p50_inches = None;
            hour.snow_p90_inches = None;
        }
    }
    if let (Some(low), Some(median), Some(high)) = (
        hour.precip_p10_inches,
        hour.precip_p50_inches,
        hour.precip_p90_inches,
    ) {
        if low > median || median > high {
            hour.precip_p10_inches = None;
            hour.precip_p50_inches = None;
            hour.precip_p90_inches = None;
        }
    }
}

fn snow_field_matches(line: &str, field: StormDeskField, forecast_hour: u32) -> bool {
    if !line.contains(":ASNOW:surface:")
        || idx_interval_hours(line) != Some((forecast_hour.saturating_sub(6), forecast_hour))
    {
        return false;
    }
    match field {
        StormDeskField::SnowAmount => !line.contains("% level") && !line.contains(":prob "),
        StormDeskField::SnowProbability => line.contains(":prob >0.00254:"),
        StormDeskField::SnowOver2 => line.contains(":prob >0.0508:"),
        StormDeskField::SnowOver4 => line.contains(":prob >0.1016:"),
        StormDeskField::SnowP10 => line.contains(":10% level"),
        StormDeskField::SnowP50 => line.contains(":50% level"),
        StormDeskField::SnowP90 => line.contains(":90% level"),
        _ => false,
    }
}

#[cfg(test)]
mod storm_desk_tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "Live NOAA network/decoder test; isolated temp cache and no AI calls"]
    fn live_daily_gfs_and_nbm_window() {
        tauri::async_runtime::block_on(async {
            let cache = env::temp_dir().join(format!(
                "stormvector-daily-live-test-{}",
                std::process::id()
            ));
            let decoder = || DecoderRuntime {
                executable: Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("resources/wgrib2/windows-x64/wgrib2.exe"),
                library_dir: None,
                terminfo_dir: None,
            };
            let run = chrono::DateTime::parse_from_rfc3339("2026-11-16T18:00:00Z").unwrap();
            let files = [12, 18, 24, 30]
                .into_iter()
                .map(|hour| StormDeskFileRequest {
                    source_url: format!(
                        "{GFS_S3_HOST}gfs.20261116/18/atmos/gfs.t18z.pgrb2.0p25.f{hour:03}"
                    ),
                    valid_time: (run + chrono::Duration::hours(hour as i64))
                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    forecast_hour: hour,
                })
                .collect();
            let gfs = fetch_storm_desk_samples_with_runtime(
                decoder(),
                cache.clone(),
                StormDeskRunRequest {
                    daily: true,
                    model: "GFS".into(),
                    run_time: run.to_rfc3339(),
                    files,
                },
                -86.1581,
                39.7684,
            )
            .await
            .unwrap();
            let day = aggregate_gfs_day(gfs.hours).unwrap();
            assert!(day.high_f.unwrap() >= day.low_f.unwrap());
            assert!(day.precipitation_inches.unwrap() >= 0.0);
            assert_eq!(
                day.interval_start_time.as_deref(),
                Some("2026-11-17T00:00:00.000Z")
            );
            assert_eq!(day.valid_time, "2026-11-18T00:00:00.000Z");
            let nbm = fetch_storm_desk_samples_with_runtime(
                decoder(),
                cache.clone(),
                StormDeskRunRequest {
                    daily: false,
                    model: "NBM".into(),
                    run_time: "2026-11-16T12:00:00.000Z".into(),
                    files: vec![StormDeskFileRequest {
                        source_url: format!(
                            "{NBM_S3_HOST}blend.20261116/12/qmd/blend.t12z.qmd.f036.co.grib2"
                        ),
                        valid_time: day.valid_time.clone(),
                        forecast_hour: 36,
                    }],
                },
                -86.1581,
                39.7684,
            )
            .await
            .unwrap();
            let probability = &nbm.hours[0];
            assert_eq!(probability.interval_start_time, day.interval_start_time);
            assert!((0.0..=100.0).contains(&probability.precip_probability_percent.unwrap()));
            assert!(
                probability.precip_p10_inches.unwrap() <= probability.precip_p50_inches.unwrap()
            );
            assert!(
                probability.precip_p50_inches.unwrap() <= probability.precip_p90_inches.unwrap()
            );
            println!("Daily GFS: high {:.1} F, low {:.1} F, precip {:.3} in; NBM probability {:.1}%, P10-P90 {:.3}-{:.3} in",day.high_f.unwrap(),day.low_f.unwrap(),day.precipitation_inches.unwrap(),probability.precip_probability_percent.unwrap(),probability.precip_p10_inches.unwrap(),probability.precip_p90_inches.unwrap());
            let snow_run = chrono::DateTime::parse_from_rfc3339("2026-11-16T12:00:00Z").unwrap();
            let snow_files = [18, 24, 30, 36]
                .into_iter()
                .map(|hour| StormDeskFileRequest {
                    source_url: format!(
                        "{NBM_S3_HOST}blend.20261116/12/core/blend.t12z.core.f{hour:03}.co.grib2"
                    ),
                    valid_time: (snow_run + chrono::Duration::hours(hour as i64))
                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    forecast_hour: hour,
                })
                .collect();
            let snow = fetch_storm_desk_samples_with_runtime(
                decoder(),
                cache.clone(),
                StormDeskRunRequest {
                    daily: false,
                    model: "NBM-SNOW".into(),
                    run_time: snow_run.to_rfc3339(),
                    files: snow_files,
                },
                -86.1581,
                39.7684,
            )
            .await
            .unwrap();
            assert_eq!(snow.hours.len(), 4);
            assert_eq!(snow.hours[0].interval_start_time, day.interval_start_time);
            assert_eq!(snow.hours[3].valid_time, day.valid_time);
            for period in &snow.hours {
                assert!(period.snowfall_inches.unwrap() >= 0.0);
                assert!((0.0..=100.0).contains(&period.snow_probability_percent.unwrap()));
                assert!(period.snow_p10_inches.unwrap() <= period.snow_p50_inches.unwrap());
                assert!(period.snow_p50_inches.unwrap() <= period.snow_p90_inches.unwrap());
            }
            println!("NBM snowfall: four native six-hour windows matched the day, with amounts, threshold probabilities and ordered quantiles decoded.");
            assert!(cache.starts_with(env::temp_dir()));
            let _ = fs::remove_dir_all(cache);
        });
    }

    fn period(hour: u32, high: f64, low: f64, rain: Option<f64>) -> StormDeskHourResponse {
        serde_json::from_value(serde_json::json!({ "validTime": "2026-11-18T00:00:00.000Z", "forecastHour": hour,
            "intervalStartTime":"2026-11-17T00:00:00.000Z", "highF":high,"lowF":low,"precipitationInches":rain })).unwrap()
    }

    #[test]
    fn daily_aggregation_uses_extrema_and_non_overlapping_totals() {
        let day = aggregate_gfs_day(vec![
            period(6, 50.0, 30.0, Some(0.1)),
            period(12, 60.0, 40.0, Some(0.2)),
            period(18, 55.0, 35.0, Some(0.0)),
            period(24, 45.0, 25.0, Some(0.3)),
        ])
        .unwrap();
        assert_eq!(day.high_f, Some(60.0));
        assert_eq!(day.low_f, Some(25.0));
        assert!((day.precipitation_inches.unwrap() - 0.6).abs() < 0.0001);
        assert_eq!(day.source_forecast_hours, vec![6, 12, 18, 24]);
        assert_eq!(day.temperature_f, None);
    }

    #[test]
    fn missing_daily_rain_does_not_become_zero() {
        let day = aggregate_gfs_day(vec![
            period(6, 50.0, 30.0, Some(0.1)),
            period(12, 60.0, 40.0, None),
            period(18, 55.0, 35.0, Some(0.0)),
            period(24, 45.0, 25.0, Some(0.3)),
        ])
        .unwrap();
        assert_eq!(day.precipitation_inches, None);
        assert!(aggregate_gfs_day(vec![
            period(6, 50.0, 30.0, None),
            period(6, 50.0, 30.0, None),
            period(18, 50.0, 30.0, None),
            period(24, 50.0, 30.0, None)
        ])
        .is_err());
    }

    #[test]
    fn grib_intervals_normalize_days_without_confusing_probability_thresholds() {
        assert_eq!(
            idx_interval_hours("147:1:d=2026111612:APCP:surface:6-7 day acc fcst:prob >0.254:"),
            Some((144, 168))
        );
        assert_eq!(
            idx_interval_hours("1:0:d=x:APCP:surface:6-30 hour acc fcst:10% level"),
            Some((6, 30))
        );
        assert_eq!(
            idx_interval_hours("1:0:d=x:APCP:surface:30 hour fcst:"),
            None
        );
    }

    #[test]
    fn nbm_probability_units_and_percentiles_are_separate() {
        let mut builder = StormDeskHourBuilder {
            response: period(24, 50.0, 30.0, None),
            wind_u_ms: None,
            wind_v_ms: None,
        };
        apply_storm_desk_value(&mut builder, StormDeskField::Probability, Some(33.995));
        apply_storm_desk_value(&mut builder, StormDeskField::P10, Some(0.0));
        apply_storm_desk_value(&mut builder, StormDeskField::P50, Some(0.0));
        apply_storm_desk_value(&mut builder, StormDeskField::P90, Some(25.4));
        assert_eq!(builder.response.precip_probability_percent, Some(33.995));
        assert_eq!(builder.response.precip_p90_inches, Some(1.0));
        builder.response.precip_p10_inches = Some(2.0);
        normalize_probability_amounts(&mut builder.response);
        assert_eq!(builder.response.precip_p10_inches, None);
        assert_eq!(builder.response.precip_probability_percent, Some(33.995));
    }

    #[test]
    fn snow_uses_meters_not_precipitation_millimeters() {
        let mut hour = StormDeskHourBuilder {
            response: period(24, 50.0, 30.0, None),
            wind_u_ms: None,
            wind_v_ms: None,
        };
        apply_storm_desk_value(&mut hour, StormDeskField::SnowAmount, Some(0.0508));
        apply_storm_desk_value(&mut hour, StormDeskField::SnowProbability, Some(40.0));
        apply_storm_desk_value(&mut hour, StormDeskField::SnowOver2, Some(25.0));
        assert_eq!(hour.response.snowfall_inches, Some(2.0));
        assert_eq!(hour.response.snow_probability_percent, Some(40.0));
        assert_eq!(hour.response.snow_over2_percent, Some(25.0));
        assert_eq!(hour.response.precipitation_inches, None);
    }

    #[test]
    fn snow_selection_rejects_hourly_and_wrong_threshold_records() {
        let six = "159:1:d=x:ASNOW:surface:18-24 hour acc fcst:prob >0.00254:prob fcst 255/255";
        let hourly = "135:1:d=x:ASNOW:surface:23-24 hour acc fcst:prob >0.00254:prob fcst 255/255";
        assert!(snow_field_matches(six, StormDeskField::SnowProbability, 24));
        assert!(!snow_field_matches(
            hourly,
            StormDeskField::SnowProbability,
            24
        ));
        assert!(!snow_field_matches(six, StormDeskField::SnowOver2, 24));
        assert!(!snow_field_matches(six, StormDeskField::SnowAmount, 24));
        assert!(snow_field_matches(
            "145:1:d=x:ASNOW:surface:18-24 hour acc@(fcst,dt=6 hour),missing=0:10% level",
            StormDeskField::SnowP10,
            24
        ));
    }

    #[test]
    fn point_values_reject_missing_and_invalid_data() {
        assert_eq!(
            parse_wgrib2_point_value("1:lon=274 lat=40 val=273.15"),
            Some(273.15)
        );
        assert_eq!(parse_wgrib2_point_value("1:val=9.999e20"), None);
        assert_eq!(parse_wgrib2_point_value("1:val=NaN"), None);
        assert!((kelvin_to_fahrenheit(273.15) - 32.0).abs() < 0.0001);
    }

    #[test]
    fn inventory_links_only_allow_noaa_https_indexes() {
        assert!(allowed_weather_source(
            "https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.20261116/12/core/file.grib2.idx"
        ));
        assert!(!allowed_weather_source(
            "https://noaa-nbm-grib2-pds.s3.amazonaws.com.evil.example/file.idx"
        ));
        assert!(!allowed_weather_source("file:///C:/test.idx"));
        assert!(!allowed_weather_source("https://example.com/file.idx"));
        assert!(!allowed_weather_source(
            "https://noaa-nbm-grib2-pds.s3.amazonaws.com/file.idx?secret=x"
        ));
    }

    #[test]
    fn snapshot_round_trip_preserves_missing_fields_and_model() {
        let snapshot = StormDeskRunResponse {
            model: "GFS".into(),
            run_time: "2026-11-16T18:00:00Z".into(),
            hours: vec![],
        };
        let bytes = serde_json::to_vec(&snapshot).unwrap();
        let saved: StormDeskRunResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(saved.model, "GFS");
        assert_eq!(saved.run_time, snapshot.run_time);
    }
}

#[tauri::command]
fn play_alert_tone(tone: String) -> Result<(), String> {
    thread::spawn(move || {
        let notes: &[(f32, u64, u64)] = match tone.as_str() {
            "warning" => &[
                (932.0, 120, 20),
                (1244.0, 120, 20),
                (932.0, 120, 20),
                (1244.0, 200, 0),
            ],
            "watch" => &[(660.0, 140, 40), (784.0, 180, 0)],
            _ => return,
        };

        let Ok((stream, stream_handle)) = OutputStream::try_default() else {
            return;
        };

        for (frequency, duration_ms, gap_ms) in notes {
            let Ok(sink) = Sink::try_new(&stream_handle) else {
                return;
            };

            sink.append(
                SineWave::new(*frequency)
                    .take_duration(Duration::from_millis(*duration_ms))
                    .amplify(0.15),
            );
            sink.sleep_until_end();

            if *gap_ms > 0 {
                thread::sleep(Duration::from_millis(*gap_ms));
            }
        }

        drop(stream);
    });

    Ok(())
}

#[tauri::command]
async fn fetch_nexrad_level3(url: String) -> Result<Vec<u8>, String> {
    if !url.starts_with(NEXRAD_LEVEL3_HOST) {
        return Err("NEXRAD request host is not allowed.".to_string());
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|error| format!("NEXRAD request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("NEXRAD request failed: {}", response.status()));
    }

    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|error| format!("NEXRAD response read failed: {error}"))
}

#[tauri::command]
async fn check_hrrr_source_available(url: String) -> Result<bool, String> {
    if !url.starts_with(HRRR_S3_HOST)
        && !url.starts_with(GFS_S3_HOST)
        && !url.starts_with(NBM_S3_HOST)
    {
        return Err("HRRR request host is not allowed.".to_string());
    }

    let response = reqwest::Client::new()
        .get(&url)
        .header(RANGE, "bytes=0-15")
        .send()
        .await
        .map_err(|error| format!("HRRR availability request failed: {error}"))?;

    Ok(response.status().is_success())
}

#[tauri::command]
async fn fetch_future_radar_render(
    app: tauri::AppHandle,
    request: FutureRadarRenderRequest,
) -> Result<Vec<u8>, String> {
    if !request
        .render_url
        .starts_with("https://raster.eoapi.dev/external/bbox/")
        || !request.source_url.starts_with(HRRR_S3_HOST)
    {
        return Err("Future radar render host is not allowed.".to_string());
    }

    let cache_dir = env::temp_dir().join("stormvector-future-radar-cache");
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Future radar cache directory failed: {error}"))?;

    let cache_path = cache_dir.join(format!("{}.png", hash_cache_key(&request.render_url)));

    if cache_path.exists() {
        let started_at = Instant::now();
        let bytes = fs::read(&cache_path)
            .map_err(|error| format!("Future radar cache read failed: {error}"))?;
        log::info!(
            "Future radar cache hit: band {} {}x{} in {} ms",
            request.band,
            request.width,
            request.height,
            started_at.elapsed().as_millis()
        );

        return Ok(bytes);
    }

    let started_at = Instant::now();
    let bytes = match render_future_radar_locally(&app, &request).await {
        Ok(bytes) => {
            log::info!(
                "Future radar local render: band {} {}x{} in {} ms",
                request.band,
                request.width,
                request.height,
                started_at.elapsed().as_millis()
            );
            bytes
        }
        Err(local_error) => {
            log::warn!("Future radar local render failed: {local_error}");
            let bytes = fetch_future_radar_render_remote(&request.render_url).await?;
            log::info!(
                "Future radar remote render: band {} {}x{} in {} ms",
                request.band,
                request.width,
                request.height,
                started_at.elapsed().as_millis()
            );
            bytes
        }
    };

    fs::write(&cache_path, &bytes)
        .map_err(|error| format!("Future radar cache write failed: {error}"))?;

    trim_future_radar_cache(&cache_dir);

    Ok(bytes)
}

async fn fetch_future_radar_render_remote(url: &str) -> Result<Vec<u8>, String> {
    let response = reqwest::get(url)
        .await
        .map_err(|error| format!("Future radar render request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Future radar render request failed: {}",
            response.status()
        ));
    }

    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|error| format!("Future radar render response read failed: {error}"))
}

async fn render_future_radar_locally(
    app: &tauri::AppHandle,
    request: &FutureRadarRenderRequest,
) -> Result<Vec<u8>, String> {
    let width = request.width.clamp(256, 1800);
    let height = request.height.clamp(256, 1400);
    let dlon = (request.east - request.west) / (width.saturating_sub(1)) as f64;
    let dlat = (request.north - request.south) / (height.saturating_sub(1)) as f64;

    if !dlon.is_finite() || !dlat.is_finite() || dlon <= 0.0 || dlat <= 0.0 {
        return Err("Future radar viewport is invalid.".to_string());
    }

    let message_bytes = fetch_hrrr_message(&request.source_url, request.band).await?;
    let work_dir = env::temp_dir()
        .join("stormvector-future-radar-work")
        .join(hash_cache_key(&request.render_url));
    fs::create_dir_all(&work_dir)
        .map_err(|error| format!("Future radar work directory failed: {error}"))?;

    let source_path = work_dir.join("source.grib2");
    let regrid_path = work_dir.join("regrid.grib2");
    let bin_path = work_dir.join("values.f32");

    fs::write(&source_path, message_bytes)
        .map_err(|error| format!("Future radar source write failed: {error}"))?;

    let decoder = find_wgrib2(app)
        .ok_or_else(|| "wgrib2 decoder was not found locally or on PATH.".to_string())?;
    let _decoder_lock = DECODER_LOCK
        .lock()
        .map_err(|error| format!("Future radar decoder lock failed: {error}"))?;
    let mut regrid_command = Command::new(&decoder.executable);
    hide_decoder_window(&mut regrid_command);
    regrid_command
        .arg(&source_path)
        .arg("-new_grid_winds")
        .arg("earth")
        .arg("-new_grid_interpolation")
        .arg("bilinear")
        .arg("-new_grid")
        .arg("latlon")
        .arg(format!("{}:{}:{}", request.west, width, dlon))
        .arg(format!("{}:{}:{}", request.south, height, dlat))
        .arg(&regrid_path)
        .env("OMP_NUM_THREADS", "2")
        .env("OMP_WAIT_POLICY", "PASSIVE");

    if let Some(library_dir) = decoder.library_dir.as_ref() {
        add_decoder_library_path(&mut regrid_command, library_dir);
    }
    if let Some(terminfo_dir) = decoder.terminfo_dir.as_ref() {
        regrid_command.env("TERMINFO", terminfo_dir);
    }

    let output = regrid_command
        .output()
        .map_err(|error| format!("Future radar regrid failed to start: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "Future radar regrid failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let mut bin_command = Command::new(&decoder.executable);
    hide_decoder_window(&mut bin_command);
    bin_command
        .arg(&regrid_path)
        .arg("-no_header")
        .arg("-order")
        .arg("we:sn")
        .arg("-bin")
        .arg(&bin_path)
        .env("OMP_NUM_THREADS", "2")
        .env("OMP_WAIT_POLICY", "PASSIVE");

    if let Some(library_dir) = decoder.library_dir.as_ref() {
        add_decoder_library_path(&mut bin_command, library_dir);
    }
    if let Some(terminfo_dir) = decoder.terminfo_dir.as_ref() {
        bin_command.env("TERMINFO", terminfo_dir);
    }

    let output = bin_command
        .output()
        .map_err(|error| format!("Future radar decode failed to start: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "Future radar decode failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let decoded = fs::read(&bin_path)
        .map_err(|error| format!("Future radar decoded grid read failed: {error}"))?;
    let _ = fs::remove_dir_all(&work_dir);

    encode_reflectivity_png(&decoded, width, height)
}

async fn fetch_hrrr_message(source_url: &str, band: u32) -> Result<Vec<u8>, String> {
    let idx_url = format!("{source_url}.idx");
    let idx_response = reqwest::get(&idx_url)
        .await
        .map_err(|error| format!("HRRR index request failed: {error}"))?;

    if !idx_response.status().is_success() {
        return Err(format!(
            "HRRR index request failed: {}",
            idx_response.status()
        ));
    }

    let idx_text = idx_response
        .text()
        .await
        .map_err(|error| format!("HRRR index read failed: {error}"))?;
    let lines: Vec<&str> = idx_text.lines().collect();
    let line_index = lines
        .iter()
        .position(|line| line.starts_with(&format!("{band}:")))
        .ok_or_else(|| format!("HRRR band {band} was not found in index."))?;
    let start = parse_idx_offset(lines[line_index])?;
    let end = lines
        .get(line_index + 1)
        .map(|line| parse_idx_offset(line).map(|offset| offset.saturating_sub(1)))
        .transpose()?;
    let range = match end {
        Some(end) => format!("bytes={start}-{end}"),
        None => format!("bytes={start}-"),
    };
    let response = reqwest::Client::new()
        .get(source_url)
        .header(RANGE, range)
        .send()
        .await
        .map_err(|error| format!("HRRR message request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "HRRR message request failed: {}",
            response.status()
        ));
    }

    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|error| format!("HRRR message read failed: {error}"))
}

fn parse_idx_offset(line: &str) -> Result<u64, String> {
    line.split(':')
        .nth(1)
        .ok_or_else(|| "HRRR index line was malformed.".to_string())?
        .parse::<u64>()
        .map_err(|error| format!("HRRR index offset was invalid: {error}"))
}

fn encode_reflectivity_png(decoded: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let expected_len = width as usize * height as usize * 4;

    if decoded.len() < expected_len {
        return Err("Future radar decoded grid was shorter than expected.".to_string());
    }

    let mut rgba = vec![0_u8; width as usize * height as usize * 4];
    let width_usize = width as usize;
    let height_usize = height as usize;

    for row in 0..height_usize {
        let target_row = height_usize - 1 - row;

        for col in 0..width_usize {
            let source_index = (row * width_usize + col) * 4;
            let target_index = (target_row * width_usize + col) * 4;
            let value = f32::from_le_bytes([
                decoded[source_index],
                decoded[source_index + 1],
                decoded[source_index + 2],
                decoded[source_index + 3],
            ]);
            let color = reflectivity_color(value);

            rgba[target_index..target_index + 4].copy_from_slice(&color);
        }
    }

    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|error| format!("Future radar PNG header failed: {error}"))?;
    writer
        .write_image_data(&rgba)
        .map_err(|error| format!("Future radar PNG encode failed: {error}"))?;
    drop(writer);

    Ok(bytes)
}

fn reflectivity_color(value: f32) -> [u8; 4] {
    if !value.is_finite() || value < 5.0 || value > 200.0 {
        return [0, 0, 0, 0];
    }

    match value {
        value if value < 10.0 => [0, 236, 236, 255],
        value if value < 15.0 => [1, 160, 246, 255],
        value if value < 20.0 => [0, 0, 246, 255],
        value if value < 25.0 => [0, 255, 0, 255],
        value if value < 30.0 => [0, 200, 0, 255],
        value if value < 35.0 => [0, 144, 0, 255],
        value if value < 40.0 => [255, 255, 0, 255],
        value if value < 45.0 => [231, 192, 0, 255],
        value if value < 50.0 => [255, 144, 0, 255],
        value if value < 55.0 => [255, 0, 0, 255],
        value if value < 60.0 => [214, 0, 0, 255],
        value if value < 65.0 => [192, 0, 0, 255],
        value if value < 70.0 => [255, 0, 255, 255],
        _ => [153, 85, 201, 255],
    }
}

fn hash_cache_key(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn trim_future_radar_cache(cache_dir: &Path) {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return;
    };
    let mut entries: Vec<_> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let metadata = entry.metadata().ok()?;
            let modified = metadata.modified().ok()?;
            Some((entry.path(), modified))
        })
        .collect();

    if entries.len() <= 240 {
        return;
    }

    entries.sort_by_key(|(_, modified)| *modified);

    for (path, _) in entries.into_iter().take(40) {
        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
async fn fetch_lightning_activity(
    app: tauri::AppHandle,
) -> Result<LightningActivityResponse, String> {
    let response = reqwest::get(LIGHTNING_DENSITY_URL)
        .await
        .map_err(|error| format!("Lightning request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Lightning request failed: {}", response.status()));
    }

    let grib_bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Lightning response read failed: {error}"))?;
    let observed_at =
        parse_grib_observed_at(&grib_bytes).unwrap_or_else(|| "time unavailable".to_string());
    let temp_dir = env::temp_dir().join("stormvector-lightning");
    fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Lightning temp directory failed: {error}"))?;

    let grib_path = temp_dir.join("latest.15.grb2");
    let bin_path = temp_dir.join("latest.15.f32");
    fs::write(&grib_path, &grib_bytes)
        .map_err(|error| format!("Lightning GRIB write failed: {error}"))?;

    let decoder = find_wgrib2(&app)
        .ok_or_else(|| "wgrib2 decoder was not found locally or on PATH.".to_string())?;
    let _decoder_lock = DECODER_LOCK
        .lock()
        .map_err(|error| format!("Lightning decoder lock failed: {error}"))?;
    let mut command = Command::new(&decoder.executable);
    hide_decoder_window(&mut command);
    command
        .arg(&grib_path)
        .arg("-no_header")
        .arg("-order")
        .arg("we:sn")
        .arg("-bin")
        .arg(&bin_path)
        .env("OMP_NUM_THREADS", "2")
        .env("OMP_WAIT_POLICY", "PASSIVE");

    if let Some(library_dir) = decoder.library_dir {
        add_decoder_library_path(&mut command, &library_dir);
    }
    if let Some(terminfo_dir) = decoder.terminfo_dir {
        command.env("TERMINFO", terminfo_dir);
    }

    let output = command
        .output()
        .map_err(|error| format!("Lightning decoder failed to start: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Lightning decoder failed: {stderr}"));
    }

    let decoded = fs::read(&bin_path)
        .map_err(|error| format!("Lightning decoded grid read failed: {error}"))?;
    let features = build_lightning_features(&decoded, observed_at.as_str());

    Ok(LightningActivityResponse {
        observed_at,
        features,
    })
}

fn find_wgrib2(app: &tauri::AppHandle) -> Option<DecoderRuntime> {
    if let Ok(path) = env::var("STORMVECTOR_WGRIB2_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Some(DecoderRuntime {
                executable: candidate,
                library_dir: None,
                terminfo_dir: None,
            });
        }
    }

    let executable_name = if cfg!(target_os = "windows") {
        "wgrib2.exe"
    } else {
        "wgrib2"
    };
    let platform_dir = if cfg!(target_os = "windows") {
        "windows-x64"
    } else {
        "linux-x64"
    };
    let packaged_executable = if cfg!(target_os = "windows") {
        Path::new("wgrib2").join(platform_dir).join(executable_name)
    } else {
        Path::new("wgrib2")
            .join(platform_dir)
            .join("bin")
            .join(executable_name)
    };
    let packaged_library_dir = if cfg!(target_os = "linux") {
        Some(Path::new("wgrib2").join(platform_dir).join("lib"))
    } else {
        None
    };
    let packaged_terminfo_dir = if cfg!(target_os = "linux") {
        Some(
            Path::new("wgrib2")
                .join(platform_dir)
                .join("share")
                .join("terminfo"),
        )
    } else {
        None
    };

    if let Ok(resource_dir) = app.path().resource_dir() {
        for resource_root in [resource_dir.clone(), resource_dir.join("resources")] {
            let candidate = resource_root.join(&packaged_executable);
            if candidate.exists() {
                return Some(DecoderRuntime {
                    executable: candidate,
                    library_dir: packaged_library_dir
                        .as_ref()
                        .map(|library_dir| resource_root.join(library_dir))
                        .filter(|library_dir| library_dir.exists()),
                    terminfo_dir: packaged_terminfo_dir
                        .as_ref()
                        .map(|terminfo_dir| resource_root.join(terminfo_dir))
                        .filter(|terminfo_dir| terminfo_dir.exists()),
                });
            }
        }
    }

    let relative_tool_path = Path::new(".tools")
        .join("wgrib2")
        .join("windows-v3.1.3")
        .join(executable_name);
    let relative_resource_path = Path::new("src-tauri")
        .join("resources")
        .join(&packaged_executable);

    let mut candidates = Vec::new();

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir.join(&relative_tool_path));
        candidates.push(current_dir.join("..").join(&relative_tool_path));
        candidates.push(current_dir.join(&relative_resource_path));
        candidates.push(current_dir.join("..").join(&relative_resource_path));
    }

    if let Ok(current_exe) = env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(&relative_tool_path));
            candidates.push(
                exe_dir
                    .join("..")
                    .join("..")
                    .join("..")
                    .join(&relative_tool_path),
            );
        }
    }

    candidates
        .into_iter()
        .find_map(decoder_runtime_from_candidate)
        .or_else(|| {
            env::var_os("PATH").and_then(|paths| {
                env::split_paths(&paths)
                    .map(|path| path.join(executable_name))
                    .find_map(decoder_runtime_from_candidate)
            })
        })
}

fn decoder_runtime_from_candidate(candidate: PathBuf) -> Option<DecoderRuntime> {
    if !candidate.exists() {
        return None;
    }

    let mut library_dir = None;
    let mut terminfo_dir = None;

    if cfg!(target_os = "linux") {
        if let Some(runtime_root) = candidate
            .parent()
            .filter(|parent| parent.file_name().is_some_and(|name| name == "bin"))
            .and_then(Path::parent)
        {
            let candidate_library_dir = runtime_root.join("lib");
            let candidate_terminfo_dir = runtime_root.join("share").join("terminfo");

            if candidate_library_dir.exists() {
                library_dir = Some(candidate_library_dir);
            }
            if candidate_terminfo_dir.exists() {
                terminfo_dir = Some(candidate_terminfo_dir);
            }
        }
    }

    Some(DecoderRuntime {
        executable: candidate,
        library_dir,
        terminfo_dir,
    })
}

fn add_decoder_library_path(command: &mut Command, library_dir: &Path) {
    if !cfg!(target_os = "linux") {
        return;
    }

    let next_library_path = env::var_os("LD_LIBRARY_PATH")
        .map(|current| {
            let mut paths = vec![library_dir.to_path_buf()];
            paths.extend(env::split_paths(&current));
            env::join_paths(paths).unwrap_or_else(|_| library_dir.as_os_str().to_os_string())
        })
        .unwrap_or_else(|| library_dir.as_os_str().to_os_string());

    command.env("LD_LIBRARY_PATH", next_library_path);
}

fn hide_decoder_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    command.creation_flags(WINDOWS_CREATE_NO_WINDOW);

    #[cfg(not(target_os = "windows"))]
    let _ = command;
}

fn parse_grib_observed_at(bytes: &[u8]) -> Option<String> {
    let section_one_start = bytes.windows(4).position(|window| window == b"GRIB")? + 16;
    let section_number = *bytes.get(section_one_start + 4)?;

    if section_number != 1 {
        return None;
    }

    let year = u16::from_be_bytes([
        *bytes.get(section_one_start + 12)?,
        *bytes.get(section_one_start + 13)?,
    ]);
    let month = *bytes.get(section_one_start + 14)?;
    let day = *bytes.get(section_one_start + 15)?;
    let hour = *bytes.get(section_one_start + 16)?;
    let minute = *bytes.get(section_one_start + 17)?;
    let second = *bytes.get(section_one_start + 18)?;

    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z"
    ))
}

fn build_lightning_features(decoded: &[u8], observed_at: &str) -> Vec<LightningActivityFeature> {
    use std::collections::HashMap;

    let point_count = LIGHTNING_GRID_WIDTH * LIGHTNING_GRID_HEIGHT;
    let usable_points = usize::min(point_count, decoded.len() / 4);
    let lat_step = (LIGHTNING_LAT_END - LIGHTNING_LAT_START) / (LIGHTNING_GRID_HEIGHT - 1) as f64;
    let lon_step = (LIGHTNING_LON_END - LIGHTNING_LON_START) / (LIGHTNING_GRID_WIDTH - 1) as f64;
    let bucket_degrees = 0.28;
    let mut buckets: HashMap<(i32, i32), LightningBucket> = HashMap::new();

    for index in 0..usable_points {
        let byte_index = index * 4;
        let raw_value = f32::from_le_bytes([
            decoded[byte_index],
            decoded[byte_index + 1],
            decoded[byte_index + 2],
            decoded[byte_index + 3],
        ]);

        if !raw_value.is_finite() || raw_value <= 0.0 {
            continue;
        }

        let approx_strikes = raw_value as f64 * LIGHTNING_CELL_AREA_M2 * LIGHTNING_WINDOW_SECONDS;

        if approx_strikes < 8.0 {
            continue;
        }

        let row = index / LIGHTNING_GRID_WIDTH;
        let column = index % LIGHTNING_GRID_WIDTH;
        let lat = LIGHTNING_LAT_START + row as f64 * lat_step;
        let lon_360 = LIGHTNING_LON_START + column as f64 * lon_step;
        let lon = if lon_360 > 180.0 {
            lon_360 - 360.0
        } else {
            lon_360
        };

        if !(20.0..=55.0).contains(&lat) || !(-130.0..=-60.0).contains(&lon) {
            continue;
        }

        let bucket_key = (
            (lat / bucket_degrees).floor() as i32,
            (lon / bucket_degrees).floor() as i32,
        );

        let should_replace = buckets
            .get(&bucket_key)
            .map(|bucket| approx_strikes > bucket.approx_strikes)
            .unwrap_or(true);

        if should_replace {
            buckets.insert(
                bucket_key,
                LightningBucket {
                    lat,
                    lon,
                    approx_strikes,
                },
            );
        }
    }

    let mut buckets: Vec<_> = buckets.into_values().collect();
    buckets.sort_by(|left, right| {
        right
            .approx_strikes
            .partial_cmp(&left.approx_strikes)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    buckets
        .into_iter()
        .take(MAX_LIGHTNING_POINTS)
        .enumerate()
        .map(|(index, bucket)| LightningActivityFeature {
            id: format!("lightning-{observed_at}-{index}"),
            observed_at: observed_at.to_string(),
            coordinates: [round_coordinate(bucket.lon), round_coordinate(bucket.lat)],
            intensity: classify_lightning_intensity(bucket.approx_strikes),
            approx_strikes: (bucket.approx_strikes * 10.0).round() / 10.0,
        })
        .collect()
}

fn classify_lightning_intensity(approx_strikes: f64) -> u8 {
    if approx_strikes >= 100.0 {
        4
    } else if approx_strikes >= 50.0 {
        3
    } else if approx_strikes >= 20.0 {
        2
    } else {
        1
    }
}

fn round_coordinate(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

#[cfg(target_os = "linux")]
fn lock_webview_zoom(app: &tauri::App) -> tauri::Result<()> {
    let Some(webview_window) = app.get_webview_window("main") else {
        return Ok(());
    };

    webview_window.with_webview(|webview| {
        use gdk::{EventTouchpadPinch, EventType, ModifierType, ScrollDirection};
        use gtk::prelude::*;
        use webkit2gtk::WebViewExt;

        let webview = webview.inner();
        webview.set_zoom_level(WEBVIEW_ZOOM_LEVEL);
        webview.connect_zoom_level_notify(|webview| {
            if (webview.zoom_level() - WEBVIEW_ZOOM_LEVEL).abs() > f64::EPSILON {
                webview.set_zoom_level(WEBVIEW_ZOOM_LEVEL);
            }
        });

        webview.connect_scroll_event(|webview, event| {
            if !event.state().contains(ModifierType::CONTROL_MASK) {
                return gtk::glib::Propagation::Proceed;
            }

            let (x, y) = event.position();
            let (_, smooth_delta_y) = event.delta();
            let delta_y = match event.direction() {
                ScrollDirection::Up => -1.0,
                ScrollDirection::Down => 1.0,
                ScrollDirection::Smooth if smooth_delta_y != 0.0 => smooth_delta_y,
                _ => return gtk::glib::Propagation::Stop,
            };
            let script = format!(
                "window.dispatchEvent(new CustomEvent('stormvector:native-pinch-zoom', {{ detail: {{ deltaY: {delta_y}, clientX: {x}, clientY: {y} }} }}));",
            );

            webview.evaluate_javascript(
                &script,
                None,
                None,
                None::<&webkit2gtk::gio::Cancellable>,
                |_| {},
            );
            gtk::glib::Propagation::Stop
        });
        webview.connect_event(|webview, event| {
            if event.event_type() != EventType::TouchpadPinch {
                return gtk::glib::Propagation::Proceed;
            }

            let Some(event) = event.downcast_ref::<EventTouchpadPinch>() else {
                return gtk::glib::Propagation::Stop;
            };
            let (x, y) = event.position();
            let scale = event.scale();
            let script = format!(
                "window.dispatchEvent(new CustomEvent('stormvector:native-pinch-zoom', {{ detail: {{ scale: {scale}, clientX: {x}, clientY: {y} }} }}));",
            );

            webview.evaluate_javascript(
                &script,
                None,
                None,
                None::<&webkit2gtk::gio::Cancellable>,
                |_| {},
            );
            gtk::glib::Propagation::Stop
        });
    })
}

#[cfg(not(target_os = "linux"))]
fn lock_webview_zoom(_app: &tauri::App) -> tauri::Result<()> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            fetch_nexrad_level3,
            open_storm_desk,
            open_weather_chart,
            open_weather_source,
            check_hrrr_source_available,
            fetch_future_radar_render,
            fetch_storm_desk_evidence,
            fetch_storm_desk_probabilities,
            save_storm_desk_enriched,
            load_saved_storm_desk,
            list_storm_desk_history,
            fetch_lightning_activity,
            play_alert_tone,
        ])
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                window.app_handle().exit(0);
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            lock_webview_zoom(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
