use std::thread;
use std::time::Duration;

use rodio::source::SineWave;
use rodio::{OutputStream, Sink, Source};
use tauri::Manager;

const NEXRAD_LEVEL3_HOST: &str = "https://unidata-nexrad-level3.s3.amazonaws.com/";
const WEBVIEW_ZOOM_LEVEL: f64 = 1.0;

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
