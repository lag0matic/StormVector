use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use std::{env, fs};

use reqwest::header::RANGE;
use rodio::source::SineWave;
use rodio::{OutputStream, Sink, Source};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const NEXRAD_LEVEL3_HOST: &str = "https://unidata-nexrad-level3.s3.amazonaws.com/";
const HRRR_S3_HOST: &str = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com/";
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
    if !url.starts_with(HRRR_S3_HOST) {
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
        .invoke_handler(tauri::generate_handler![
            fetch_nexrad_level3,
            check_hrrr_source_available,
            fetch_future_radar_render,
            fetch_lightning_activity,
            play_alert_tone,
        ])
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
