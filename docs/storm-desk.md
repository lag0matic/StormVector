# Forecast Briefing Implementation Map

## AIFS Maps

Open Forecast Briefing > AIFS maps > Load latest run. The view renders ECMWF
AIFS Single 2 m temperature, 10 m sustained wind speed, and precipitation over
North America, with 6- and 24-hour liquid-equivalent
totals and a forecast-hour picker/playback through +360 hours. Days 8-15 are
trend guidance. This is a precipitation map, not radar, snowfall depth, or a
precipitation probability.

The app checks the +360h index to find a complete recent run, downloads only
the indexed `tp` GRIB messages, and subtracts the earlier accumulation from
the later one. It decodes with bundled wgrib2 and keeps rendered frames in
memory for the current range and period. Playback waits for a decoded next frame.
The source is [ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data),
CC BY 4.0. No key or paid inference request is needed for the maps.

To rerun the live smoke test, set `STORMVECTOR_TEST_WGRIB2` to the bundled
decoder executable and run `cargo test --lib live_precipitation_at_day_one_and_day_fifteen -- --ignored`
from `src-tauri`. The map controls are independent of Luna's automatic
point forecast. The source panel shows local intervals, liquid totals, and
end-of-window temperature and wind snapshots.

## Combined Briefing

The single Generate briefing action checks HRRR, week-range GFS with available
NBM probabilities, near-term AIFS, and relevant SPC outlooks. Point bundles
and refresh timestamps persist in the briefing webview's local storage for
the 40 most recent exact points. Each point can refresh once per hour on
request, without background polling. Unchanged GFS/HRRR cycles reuse saved
values; unchanged AIFS reuses saved values when they still cover the selected
near-term sample. SPC outlooks expire at their official end time even during
the cooldown. Map imagery, extended GFS, and date-specific NBM snow remain
separate views. Run `node scripts/check-briefing-cache.mjs` to test the cooldown
and cycle reuse without network or AI calls.

Active National Weather Service alerts are checked at the selected point
on each Generate or Regenerate, outside the model cooldown. They appear
separately from the model forecast and are sent as cited official alert
records, not interpretations. The point filter does not include a marine
alert merely because it covers waters near a land selection.

## SPC Outlook Context

On Generate briefing, query NOAA SPC Day 1-3 categorical outlooks for the
selected point. Use official issuance and validity timestamps and only pass
outlooks that overlap upcoming portions of the latest model guidance. When
more than one category covers the point in the latest issuance, keep the
highest. Forecast source citations show the official category and validity
separately from model guidance. Empty or failed lookups do not mean no storm
risk. No probabilities or alerts are inferred from the categories.

Run `node scripts/check-spc-briefing.mjs` to check location requests, time
matching, overlapping categories, and partial service outages without paying
for a Luna request.

## Product Goal

Storm Desk explains model guidance for the selected map point without pretending
to be a weather model. Every statement must be backed by visible model values,
run times, and valid times.

## OpenAI Briefing Setup

Forecast Briefing uses `gpt-6-luna` via the Responses API. Enter the key under
the main window's Prefs > Forecast Briefing and choose Save key. Replace and
remove actions are available there. The briefing window has no key form.
The key persists in Windows Credential Manager or the Linux Secret Service
keyring (for example GNOME Keyring or KWallet with Secret Service enabled).
Linux requires a running user D-Bus session and an unlocked Secret Service
provider. Storage errors are visible; there is no plain-text fallback.
The secret is never returned by the status command, logged, or included in
saved forecasts. The service is `com.lag0matic.stormvector`, entry
`openai-api-key`. An explicitly set backend `OPENAI_API_KEY` remains a fallback
when no saved entry exists or the keyring cannot be read. A saved key takes
precedence. Removing a saved key does not unset that variable.
Never use a `VITE_` variable for this key.

Generate AI briefing is an explicit billed request. No polling, automatic
retries, tools, or fallback models are enabled. Output is capped at 900 tokens
with reasoning disabled. Only normalized samples and run times are sent, not
map coordinates. Responses use `store: false`; this does not constitute a
zero-data-retention guarantee. Citation IDs are checked for existence, not
semantic correctness. No paid live test has been made by the coding agent.

- The desk loads only when the user asks for it.
- Model data is normalized before any narrative is produced.
- Run-to-run comparisons use the same valid time.
- Missing fields remain missing; they are never inferred by an LLM.
- Alerts stay in the existing Hazards panel.
- The first release works without an AI provider or API key.

## Original Roadmap

These milestones describe the original design, not a list of shipped features.
The current implementation and remaining work are recorded below.

### 1. HRRR evidence preview

- Add a Storm Desk tab for the selected map point.
- Read a small set of HRRR surface fields with byte-range requests.
- Show +1, +3, and +6 hour guidance.
- Compare the latest run with the previous run at identical valid times.
- Produce a deterministic `What changed?` summary.

Fields: temperature, dewpoint, wind, gust, hourly precipitation, surface CAPE,
and total cloud cover.

### 2. Durable run history

- Store normalized point snapshots in SQLite.
- Keep enough history to compare more than one previous cycle.
- Record source URL, model, run time, valid time, and field availability.
- Add cache retention and recovery behavior.

### 3. Multi-model evidence

- Add NBM as the calibrated baseline.
- Add GFS for the longer forecast range.
- Add GEFS probabilities and spread for uncertainty.
- Compare models only where variables and valid times are compatible.

Planned range choices:

- `6 hours`: HRRR detail and run-to-run changes.
- `48 hours`: HRRR, with NBM probabilities alongside it.
- `7 days`: NBM and GFS, sampled less densely as lead time increases.
- `Extended`: GFS and GEFS through roughly 10 to 16 days, clearly labeled as
  lower-confidence trend guidance rather than a precise local forecast.

### 4. Optional AI briefing

- Build a compact evidence packet from already-computed facts.
- Support an explicitly configured provider rather than shipping a secret key.
- Require citations back to model, run, valid time, and field.
- Validate citation IDs and show the deterministic view if narration fails.
  Semantic verification of every generated claim remains future work.

### 5. Deeper questions

- Saved briefings and richer `What changed?` history.
- Map-aware questions using selected layers and model evidence.
- Explicit confidence language based on ensemble spread and model agreement.

## Current Implementation (1.5.0)

### Daily Forecasts And NBM Probabilities

### Native Snowfall Outlook

For a loaded GFS daily view, select a day under Snowfall outlook and load its
four native six-hour NBM core windows. This is a separate on-demand request;
regenerate the AI briefing afterward to incorporate the selected day's snow
evidence. It is included in saved/enriched briefings, tagged NBM-SNOW, with
separate source IDs (`snow-N`).

ASNOW fields contain snowfall depth in meters (divide by 0.0254 for inches),
not APCP water equivalent in millimeters. Native probabilities are for greater
than 0.00254 / 0.0508 / 0.1016 m: 0.1 / 2 / 4 inches, per six-hour window.
Snowfall P10/P50/P90 are unconditional, including zero-snow outcomes. They are
not summed to invent a daily distribution or conditional-on-snow range.

Live core inventories have both hourly and six-hour snowfall products; selection
requires the exact six-hour interval. Percentiles encode `acc@(fcst,dt=6 hour)`;
the interval parser accepts this while rejecting hourly records. Later forecast
files can contain modeled snow amounts without probabilities/percentiles; those
fields remain unavailable instead of being inferred. The live production test
passed for four matching snow windows; unit tests cover threshold selection and
the meter/inch conversion. No paid AI test was made.

GFS week/extended views now use full UTC days rather than afternoon snapshots.
Four non-overlapping six-hour periods supply TMAX, TMIN and APCP. Their maxima,
minima and summed precipitation form the daily rows. Source periods are retained;
missing values are not replaced with zero. Both runs cover identical day windows.
UTC days are labeled with their local start/end times; these are not local
midnight-to-midnight days or the NWS daytime-high/overnight-low periods.

NBM QMD supplies trailing 24-hour APCP probability above 0.254 mm (0.01 inch),
and the P10/P50/P90 amounts, for exactly matching windows. Probability grids
decode to percent; amount grids are mm and converted to inches. The percentile
range is unconditional and includes dry outcomes. These are water-equivalent
precipitation products, not rain/snow type probabilities or snowfall inches.
No percentages are derived from deterministic GFS totals, and probabilities
and percentiles are never summed. NBM is requested only within its supported
264-hour horizon; later GFS days retain no probability estimate.

NBM snapshots and enriched briefings are saved. Its failure does not discard
GFS data. Luna receives separately cited NBM records and explicit daily interval
semantics. No paid AI calls were made for verification.

Verification: aggregation, interval parsing, missing data and probability-unit
tests; live GRIB point decoding for GFS extrema/totals and NBM dry/nonzero
probability windows. The ignored native live test also exercised the production
Rust download/decode path for a complete GFS day and its exactly matching NBM
24-hour window. It passed (56.9 F high, 39.9 F low, 0.000 in; NBM 0% for that
specific test window). Full combined desktop workflow remains to be user-tested.

Run the focused network test on Windows with bundled decoder resources present:
`cargo test --lib live_daily_gfs_and_nbm_window -- --ignored --nocapture`.
It uses an isolated temporary cache, fixed NOAA run URLs, and no AI requests;
run availability is therefore an external dependency of this test.

Sources:
- https://registry.opendata.aws/noaa-nbm/
- https://blend.mdl.nws.noaa.gov/nbm-documentation
- https://www.nco.ncep.noaa.gov/pmb/products/gfs/

Forecast Briefing now opens from the primary layer toolbar in a separate native
window. The window uses the app theme, shared basemap settings, a compact
forecast toolbar, a two-column briefing/imagery layout and full-width data rows.
HRRR simulated reflectivity is an image source over a pannable MapLibre basemap,
with the selected point marked. GFS and ECMWF imagery currently use external
chart links; ECMWF point-run ingestion is not implemented. ECMWF public charts
include medium-range and weekly sub-seasonal outlooks; these are not equivalent
to precise local forecasts.

Verified live in the app: HRRR map overlay and GFS days 8-15 (eight current/prior
samples). The original reported GFS failure was not reproduced; source-cycle
checks now verify both runs and field download errors identify forecast hour.
AI editorial instructions now emphasize the takeaway and supported implications,
not row-by-row numerical recitation. No additional paid AI test was performed.

Implemented follow-up: persistent JSON run snapshots in the application's data
directory (`model-runs-v1`), plus offline briefing retrieval (`saved-briefings-v1`).
These are compact normalized point values, not full GRIB archives. Repeated
requests reuse the same run/location/hour selection. SQLite migration remains
future work; no retention deletion runs yet.

Update: the Saved runs selector now exposes up to 100 archived briefings for the
exact point and range, newest first. Each new successful run is retained in the
briefing history directory. Older latest-only briefings can still be opened
with Load saved. NOAA inventory links are shown for each current/prior sample.

Available ranges: HRRR 6 hours, GFS 7 days (complete daily intervals), and GFS
days 8-15 (complete daily intervals). NBM precipitation and snowfall guidance
are implemented where native data is available. GEFS and ECMWF point ingestion,
48-hour HRRR guidance, cache retention, and SQLite migration remain future work.

The implementation reuses StormVector's bundled `wgrib2` decoder and NOAA S3
byte-range downloads, so it does not require a new server or full GRIB downloads.

Release hardening verifies allowed NOAA inventory URLs, supports environment
keys when native storage is unavailable, clears stale imagery on frame changes,
and allows image-load retries. Reopening the briefing updates its selected
location. Closing the main window exits both windows. The packaged Windows
1.5.0 app launched and exited without leftover StormVector, decoder, or associated
WebView processes. The installer itself has not been installed by the agent.
