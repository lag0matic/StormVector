use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;
use std::{env, fs};

use rodio::source::SineWave;
use rodio::{OutputStream, Sink, Source};
use serde::Serialize;
#[cfg(target_os = "linux")]
use tauri::Manager;

const NEXRAD_LEVEL3_HOST: &str = "https://unidata-nexrad-level3.s3.amazonaws.com/";
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
#[cfg(target_os = "linux")]
const WEBVIEW_ZOOM_LEVEL: f64 = 1.0;

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
async fn fetch_lightning_activity() -> Result<LightningActivityResponse, String> {
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

    let wgrib_path = find_wgrib2()
        .ok_or_else(|| "wgrib2 decoder was not found locally or on PATH.".to_string())?;
    let output = Command::new(&wgrib_path)
        .arg(&grib_path)
        .arg("-no_header")
        .arg("-order")
        .arg("we:sn")
        .arg("-bin")
        .arg(&bin_path)
        .env("OMP_NUM_THREADS", "2")
        .env("OMP_WAIT_POLICY", "PASSIVE")
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

fn find_wgrib2() -> Option<PathBuf> {
    if let Ok(path) = env::var("STORMVECTOR_WGRIB2_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let executable_name = if cfg!(target_os = "windows") {
        "wgrib2.exe"
    } else {
        "wgrib2"
    };
    let relative_tool_path = Path::new(".tools")
        .join("wgrib2")
        .join("windows-v3.1.3")
        .join(executable_name);

    let mut candidates = Vec::new();

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir.join(&relative_tool_path));
        candidates.push(current_dir.join("..").join(&relative_tool_path));
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
        .find(|candidate| candidate.exists())
        .or_else(|| {
            env::var_os("PATH").and_then(|paths| {
                env::split_paths(&paths)
                    .map(|path| path.join(executable_name))
                    .find(|candidate| candidate.exists())
            })
        })
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
