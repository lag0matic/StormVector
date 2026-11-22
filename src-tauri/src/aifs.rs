use super::{
    add_decoder_library_path, find_wgrib2, hide_decoder_window, DecoderRuntime,
    StormDeskEvidenceResponse, StormDeskHourResponse, StormDeskRunResponse, DECODER_LOCK,
};
use chrono::{DateTime, Timelike, Utc};
use reqwest::{header::RANGE, Client, StatusCode, Url};
use serde::Deserialize;
use std::{
    fs,
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

const ROOT: &str = "https://data.ecmwf.int/forecasts";
const WIDTH: usize = 600;
const HEIGHT: usize = 360;
const BOUNDS: [f64; 4] = [-135., 20., -60., 55.];
const COLORS: [[u8; 4]; 6] = [
    [0, 0, 0, 0],
    [76, 192, 151, 220],
    [33, 142, 209, 230],
    [251, 209, 74, 240],
    [247, 130, 62, 245],
    [195, 58, 102, 250],
];
static NEXT_WORK_ID: AtomicU64 = AtomicU64::new(0);

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

fn stem(run: DateTime<Utc>, hour: u16) -> String {
    format!(
        "{ROOT}/{}/{}z/aifs-single/0p25/oper/{}-{hour}h-oper-fc",
        run.format("%Y%m%d"),
        run.format("%H"),
        run.format("%Y%m%d%H%M%S")
    )
}

#[derive(Deserialize)]
struct Record {
    param: String,
    levtype: String,
    step: String,
    _offset: u64,
    _length: u64,
}

async fn index(client: &Client, run: DateTime<Utc>, hour: u16) -> Result<Vec<Record>, String> {
    let response = client
        .get(format!("{}.index", stem(run, hour)))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(vec![]);
    }
    let mut response = response.error_for_status().map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 256 * 1024 {
            return Err("ECMWF index exceeded its size limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = std::str::from_utf8(&bytes).map_err(|e| e.to_string())?;
    let mut records = Vec::new();
    let step = hour.to_string();
    for row in body.lines().filter(|line| !line.trim().is_empty()) {
        let record: Record = serde_json::from_str(row).map_err(|e| e.to_string())?;
        if record.levtype == "sfc" && record.step == step {
            records.push(record);
        }
    }
    Ok(records)
}

#[tauri::command]
pub async fn latest_aifs_run() -> Result<String, String> {
    let client = client()?;
    let now = Utc::now();
    let cycle = DateTime::from_timestamp(now.timestamp().div_euclid(21600) * 21600, 0)
        .ok_or("Invalid forecast clock.")?;
    for i in 0..5 {
        let run = cycle - chrono::Duration::hours(6 * i);
        if index(&client, run, 360)
            .await?
            .iter()
            .any(|record| record.param == "tp")
        {
            return Ok(run.to_rfc3339());
        }
    }
    Err("No complete AIFS run is currently available.".into())
}

async fn message(
    client: &Client,
    run: DateTime<Utc>,
    hour: u16,
    index: &[Record],
    param: &str,
) -> Result<Vec<u8>, String> {
    let record = index
        .iter()
        .find(|record| record.param == param)
        .ok_or_else(|| format!("AIFS field {param} is unavailable at +{hour}h."))?;
    if !(16..=2_000_000).contains(&record._length) {
        return Err("Unexpected AIFS field size.".into());
    }
    let end = record
        ._offset
        .checked_add(record._length - 1)
        .ok_or("Invalid AIFS byte range.")?;
    let url = Url::parse(&format!("{}.grib2", stem(run, hour))).map_err(|e| e.to_string())?;
    let mut response = client
        .get(url)
        .header(RANGE, format!("bytes={}-{end}", record._offset))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let expected_range = format!("bytes {}-{end}/", record._offset);
    if response.status() != StatusCode::PARTIAL_CONTENT
        || !response
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with(&expected_range))
    {
        return Err(format!(
            "ECMWF did not return the requested field ({}).",
            response.status()
        ));
    }
    let mut bytes = Vec::with_capacity(record._length as usize);
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > record._length as usize {
            return Err("ECMWF field exceeded its indexed size.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() != record._length as usize || !bytes.starts_with(b"GRIB") {
        return Err("Incomplete AIFS GRIB field.".into());
    }
    Ok(bytes)
}

async fn precipitation(client: &Client, run: DateTime<Utc>, hour: u16) -> Result<Vec<u8>, String> {
    message(client, run, hour, &index(client, run, hour).await?, "tp").await
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum Layer {
    Precipitation,
    Temperature,
    Wind,
}

#[tauri::command]
pub(super) async fn render_aifs_map(
    app: tauri::AppHandle,
    run: String,
    hour: u16,
    period: u16,
    layer: Layer,
) -> Result<tauri::ipc::Response, String> {
    let run = checked_run(&run, hour, period)?;
    let decoder = find_wgrib2(&app).ok_or("The bundled weather decoder is unavailable.")?;
    let bytes = render(&client()?, decoder, run, hour, period, layer).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn checked_run(run: &str, hour: u16, period: u16) -> Result<DateTime<Utc>, String> {
    let run = DateTime::parse_from_rfc3339(run)
        .map_err(|_| "Invalid AIFS run time.")?
        .with_timezone(&Utc);
    if !matches!(period, 6 | 24)
        || hour < period
        || hour > 360
        || hour % 6 != 0
        || run.hour() % 6 != 0
        || run.minute() != 0
        || run.second() != 0
        || run.timestamp_subsec_nanos() != 0
        || run > Utc::now()
        || run < Utc::now() - chrono::Duration::days(4)
    {
        return Err("Invalid AIFS forecast period or run.".into());
    }
    Ok(run)
}

#[tauri::command]
pub(super) async fn fetch_aifs_point_evidence(
    app: tauri::AppHandle,
    run: String,
    hour: u16,
    period: u16,
    range_start: u16,
    range_end: u16,
    longitude: f64,
    latitude: f64,
) -> Result<StormDeskEvidenceResponse, String> {
    let run = checked_run(&run, hour, period)?;
    if !matches!((range_start, range_end), (6, 72) | (78, 168) | (174, 360))
        || !(range_start..=range_end).contains(&hour)
        || !(BOUNDS[0]..=BOUNDS[2]).contains(&longitude)
        || !(BOUNDS[1]..=BOUNDS[3]).contains(&latitude)
    {
        return Err("Choose a point inside the AIFS map and an available forecast hour.".into());
    }
    let decoder = find_wgrib2(&app).ok_or("The bundled weather decoder is unavailable.")?;
    let hours = sample_windows(hour, period, range_start, range_end);
    let samples = sample_point(
        &client()?,
        decoder,
        run,
        &hours,
        period,
        grid_index(longitude, latitude),
    )
    .await?;
    Ok(StormDeskEvidenceResponse {
        snow: None,
        nbm: None,
        latitude,
        longitude,
        latest: StormDeskRunResponse {
            model: "AIFS".into(),
            run_time: run.to_rfc3339(),
            hours: hours
                .into_iter()
                .zip(samples)
                .map(|(end, sample)| {
                    let time_at = |h| (run + chrono::Duration::hours(i64::from(h))).to_rfc3339();
                    StormDeskHourResponse {
                        valid_time: time_at(end),
                        interval_start_time: Some(time_at(end - period)),
                        forecast_hour: u32::from(end),
                        precipitation_inches: sample.precipitation.map(f64::from),
                        temperature_f: sample.temperature.map(f64::from),
                        wind_speed_mph: sample.wind.map(|(mph, _)| f64::from(mph)),
                        wind_direction_degrees: sample
                            .wind
                            .and_then(|(_, direction)| direction.map(f64::from)),
                        ..Default::default()
                    }
                })
                .collect(),
        },
        previous: StormDeskRunResponse {
            model: "AIFS".into(),
            run_time: run.to_rfc3339(),
            hours: vec![],
        },
    })
}

fn sample_windows(hour: u16, period: u16, range_start: u16, range_end: u16) -> Vec<u16> {
    let before = (hour - range_start.max(period)) / period;
    let after = (range_end - hour) / period;
    let count = (before + 1 + after).min(3);
    let left = before.min(1.max((count - 1).saturating_sub(after)));
    let first = hour - left * period;
    (0..count).map(|i| first + i * period).collect()
}

struct PointSample {
    precipitation: Option<f32>,
    temperature: Option<f32>,
    wind: Option<(f32, Option<f32>)>,
}

async fn sample_point(
    client: &Client,
    decoder: DecoderRuntime,
    run: DateTime<Utc>,
    hours: &[u16],
    period: u16,
    cell: usize,
) -> Result<Vec<PointSample>, String> {
    let first = hours[0] - period;
    let initial = if first == 0 {
        None
    } else {
        Some(precipitation(client, run, first).await?)
    };
    let mut fields = Vec::new();
    for &hour in hours {
        let records = index(client, run, hour).await?;
        let field = |param| message(client, run, hour, &records, param);
        let (precip, temp, u, v) =
            futures_util::try_join!(field("tp"), field("2t"), field("10u"), field("10v"))?;
        fields.push((hour, precip, temp, u, v));
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_decode_workspace(|dir| {
            let mut previous = match initial {
                Some(bytes) => decode(&decoder, dir, &bytes, first, "tp")?[cell],
                None => 0.,
            };
            let mut samples = Vec::new();
            for (hour, precip, temp, u, v) in fields {
                let current = decode(&decoder, dir, &precip, hour, "tp")?[cell];
                samples.push(PointSample {
                    precipitation: precipitation_inches(current, previous),
                    temperature: fahrenheit(decode(&decoder, dir, &temp, hour, "2t")?[cell]),
                    wind: wind(
                        decode(&decoder, dir, &u, hour, "10u")?[cell],
                        decode(&decoder, dir, &v, hour, "10v")?[cell],
                    ),
                });
                previous = current;
            }
            Ok(samples)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn render(
    client: &Client,
    decoder: DecoderRuntime,
    run: DateTime<Utc>,
    hour: u16,
    period: u16,
    layer: Layer,
) -> Result<Vec<u8>, String> {
    let (param, extra_param, extra_hour) = match layer {
        Layer::Precipitation => ("tp", "tp", hour - period),
        Layer::Temperature => ("2t", "", hour),
        Layer::Wind => ("10u", "10v", hour),
    };
    let records = index(client, run, hour).await?;
    let (end, extra) =
        futures_util::try_join!(message(client, run, hour, &records, param), async {
            if extra_param.is_empty() || extra_hour == 0 {
                Ok(None)
            } else if extra_hour == hour {
                message(client, run, hour, &records, extra_param)
                    .await
                    .map(Some)
            } else {
                precipitation(client, run, extra_hour).await.map(Some)
            }
        })?;
    tauri::async_runtime::spawn_blocking(move || {
        with_decode_workspace(|dir| {
            let end = decode(&decoder, dir, &end, hour, param)?;
            let extra = extra
                .as_deref()
                .map(|bytes| decode(&decoder, dir, bytes, extra_hour, extra_param))
                .transpose()?;
            encode(|i| {
                let second = extra.as_ref().map_or(0., |grid| grid[i]);
                match layer {
                    Layer::Precipitation => precip_color(end[i], second),
                    Layer::Temperature => color(
                        fahrenheit(end[i]),
                        &[0., 20., 32., 50., 70., 90.],
                        &TEMP_COLORS,
                    ),
                    Layer::Wind => color(
                        wind(end[i], second).map(|(mph, _)| mph),
                        &[5., 10., 20., 30., 45.],
                        &WIND_COLORS,
                    ),
                }
            })
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn with_decode_workspace<T>(
    work: impl FnOnce(&std::path::Path) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = DECODER_LOCK
        .lock()
        .map_err(|_| "Weather decoder is unavailable.")?;
    let dir = std::env::temp_dir().join(format!(
        "stormvector-aifs-{}-{}",
        std::process::id(),
        NEXT_WORK_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let result = work(&dir);
    for file in ["field.grib2", "field.f32"] {
        let _ = fs::remove_file(dir.join(file));
    }
    let _ = fs::remove_dir(dir);
    result
}

fn decode(
    decoder: &DecoderRuntime,
    dir: &std::path::Path,
    bytes: &[u8],
    hour: u16,
    param: &str,
) -> Result<Vec<f32>, String> {
    let input = dir.join("field.grib2");
    let output = dir.join("field.f32");
    fs::write(&input, bytes).map_err(|e| e.to_string())?;
    let mut command = Command::new(&decoder.executable);
    hide_decoder_window(&mut command);
    if let Some(path) = &decoder.library_dir {
        add_decoder_library_path(&mut command, path);
    }
    if let Some(path) = &decoder.terminfo_dir {
        command.env("TERMINFO", path);
    }
    let result = command
        .arg(input)
        .args(["-s", "-grid", "-no_header", "-order", "we:sn", "-bin"])
        .arg(&output)
        .env("OMP_NUM_THREADS", "2")
        .env("OMP_WAIT_POLICY", "PASSIVE")
        .output()
        .map_err(|e| e.to_string())?;
    let inventory = String::from_utf8_lossy(&result.stdout);
    let expected = if hour % 24 == 0 {
        format!("0-{} day acc fcst", hour / 24)
    } else {
        format!("0-{hour} hour acc fcst")
    };
    if !result.status.success()
        || (param == "tp" && !inventory.contains(&expected))
        || !inventory.contains("(1440 x 721)")
        || !inventory.contains("lat 90.000000 to -90.000000 by 0.250000")
        || !inventory.contains("lon 180.000000 to 179.750000 by 0.250000")
    {
        return Err(
            "AIFS grid or precipitation interval did not match the expected format.".into(),
        );
    }
    let raw = fs::read(output).map_err(|e| e.to_string())?;
    if raw.len() != 1440 * 721 * 4 {
        return Err("Unexpected AIFS grid size.".into());
    }
    Ok(raw
        .chunks_exact(4)
        .map(|part| f32::from_ne_bytes(part.try_into().unwrap()))
        .collect())
}

fn precipitation_inches(end: f32, start: f32) -> Option<f32> {
    ((0.0..1.0e8).contains(&end) && (0.0..1.0e8).contains(&start))
        .then(|| (end - start).max(0.) / 25.4)
}

fn precip_color(end: f32, start: f32) -> [u8; 4] {
    let Some(inches) = precipitation_inches(end, start) else {
        return COLORS[0];
    };
    COLORS[[0.01, 0.10, 0.25, 0.50, 1.00]
        .iter()
        .filter(|&&min| inches >= min)
        .count()]
}

fn grid_index(lon: f64, lat: f64) -> usize {
    let row = ((lat + 90.) * 4.).round() as usize;
    row * 1440 + (((lon + 180.) * 4.).round() as usize % 1440)
}

const TEMP_COLORS: [[u8; 4]; 7] = [
    [113, 65, 162, 230],
    [76, 114, 193, 230],
    [69, 176, 211, 230],
    [124, 202, 159, 230],
    [234, 212, 87, 230],
    [242, 145, 61, 230],
    [210, 65, 84, 230],
];
const WIND_COLORS: [[u8; 4]; 6] = [
    [0, 0, 0, 0],
    [93, 186, 172, 220],
    [57, 144, 197, 230],
    [232, 201, 83, 230],
    [242, 128, 62, 240],
    [188, 66, 122, 245],
];

fn fahrenheit(kelvin: f32) -> Option<f32> {
    (150. ..=360.)
        .contains(&kelvin)
        .then(|| (kelvin - 273.15) * 1.8 + 32.)
}

fn wind(u: f32, v: f32) -> Option<(f32, Option<f32>)> {
    let speed = u.hypot(v);
    (speed <= 150.).then(|| {
        (
            speed * 2.236_937,
            (speed >= 0.5).then(|| (-u).atan2(-v).to_degrees().rem_euclid(360.)),
        )
    })
}

fn color(value: Option<f32>, thresholds: &[f32], colors: &[[u8; 4]]) -> [u8; 4] {
    value.map_or([0; 4], |v| {
        colors[thresholds.partition_point(|&min| v >= min)]
    })
}

fn encode(pixel: impl Fn(usize) -> [u8; 4]) -> Result<Vec<u8>, String> {
    let [west, south, east, north] = BOUNDS;
    let mercator_y = |lat: f64| lat.to_radians().tan().asinh();
    let mut rgba = Vec::with_capacity(WIDTH * HEIGHT * 4);
    for y in 0..HEIGHT {
        let my = mercator_y(north)
            + (mercator_y(south) - mercator_y(north)) * (y as f64 + 0.5) / HEIGHT as f64;
        let lat = my.sinh().atan().to_degrees();
        for x in 0..WIDTH {
            let lon = west + (east - west) * (x as f64 + 0.5) / WIDTH as f64;
            let i = grid_index(lon, lat);
            rgba.extend_from_slice(&pixel(i));
        }
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, WIDTH as u32, HEIGHT as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .and_then(|mut w| w.write_image_data(&rgba))
            .map_err(|e| e.to_string())?;
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn surface_units_and_wind_direction() {
        assert_eq!(fahrenheit(273.15), Some(32.));
        assert!(fahrenheit(1.0e20).is_none());
        assert_eq!(wind(0., 0.), Some((0., None)));
        let (mph, direction) = wind(10., 0.).unwrap();
        assert!((mph - 22.369).abs() < 0.001);
        assert_eq!(direction, Some(270.));
    }

    #[test]
    fn point_windows_include_selected_frame_without_overlap() {
        for (start, end) in [(6, 72), (78, 168), (174, 360)] {
            for period in [6, 24] {
                for hour in (start.max(period)..=end).step_by(6) {
                    let windows = sample_windows(hour, period, start, end);
                    assert!(windows.contains(&hour));
                    assert!((2..=3).contains(&windows.len()));
                    assert!(windows[0] >= start.max(period) && *windows.last().unwrap() <= end);
                    assert!(windows.windows(2).all(|pair| pair[1] - pair[0] == period));
                }
            }
        }
    }

    #[test]
    fn periods_subtract_water_equivalent_totals() {
        assert_eq!(precip_color(30., 20.), COLORS[3]);
        assert_eq!(precip_color(19.5, 20.), COLORS[0]);
        assert_eq!(precip_color(1.0e20, 0.), COLORS[0]);
        assert_eq!(precip_color(12., 1.0e20), COLORS[0]);
    }

    #[test]
    #[ignore = "Requires live ECMWF data and the bundled decoder"]
    fn live_precipitation_at_day_one_and_day_fifteen() {
        tauri::async_runtime::block_on(async {
            let executable =
                std::env::var_os("STORMVECTOR_TEST_WGRIB2").expect("Set STORMVECTOR_TEST_WGRIB2");
            let run = DateTime::parse_from_rfc3339(&latest_aifs_run().await.unwrap())
                .unwrap()
                .with_timezone(&Utc);
            for (hour, period) in [(6, 6), (360, 24)] {
                for layer in [Layer::Precipitation, Layer::Temperature, Layer::Wind] {
                    let decoder =
                        super::super::decoder_runtime_from_candidate(executable.clone().into())
                            .unwrap();
                    let png = render(&client().unwrap(), decoder, run, hour, period, layer)
                        .await
                        .unwrap();
                    let mut reader = png::Decoder::new(png.as_slice()).read_info().unwrap();
                    let mut rgba = vec![0; reader.output_buffer_size()];
                    reader.next_frame(&mut rgba).unwrap();
                    assert!(rgba.chunks_exact(4).any(|pixel| pixel[3] > 0));
                }
                let (start, end) = if hour == 6 { (6, 72) } else { (174, 360) };
                let windows = sample_windows(hour, period, start, end);
                let decoder =
                    super::super::decoder_runtime_from_candidate(executable.clone().into())
                        .unwrap();
                let point = sample_point(
                    &client().unwrap(),
                    decoder,
                    run,
                    &windows,
                    period,
                    grid_index(-86.25, 39.75),
                )
                .await
                .unwrap();
                assert!(point.into_iter().all(|value| value
                    .precipitation
                    .is_some_and(|inches| (0. ..50.).contains(&inches))
                    && value.temperature.is_some()
                    && value.wind.is_some()));
            }
        });
    }
}
