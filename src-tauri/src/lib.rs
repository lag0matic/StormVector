use std::thread;
use std::time::Duration;

use rodio::source::SineWave;
use rodio::{OutputStream, Sink, Source};

const NEXRAD_LEVEL3_HOST: &str = "https://unidata-nexrad-level3.s3.amazonaws.com/";

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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
