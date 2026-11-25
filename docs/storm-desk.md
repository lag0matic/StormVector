# Forecast Briefing Implementation Map

## Model Guidance

Open Forecast Briefing from the map toolbar, choose a forecast range, and
load a current or saved run. The window shows conventional NOAA guidance
for the selected point without an account or AI provider.

### Native Snowfall Outlook

For a loaded GFS daily view, select a day under Snowfall outlook and load its
four native six-hour NBM core windows. This is a separate on-demand request.
Snowfall guidance is included in saved model evidence and tagged NBM-SNOW.

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
the meter/inch conversion.

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
GFS data.

Verification: aggregation, interval parsing, missing data and probability-unit
tests; live GRIB point decoding for GFS extrema/totals and NBM dry/nonzero
probability windows. The ignored native live test also exercised the production
Rust download/decode path for a complete GFS day and its exactly matching NBM
24-hour window. It passed (56.9 F high, 39.9 F low, 0.000 in; NBM 0% for that
specific test window). Full combined desktop workflow remains to be user-tested.

Run the focused network test on Windows with bundled decoder resources present:
`cargo test --lib live_daily_gfs_and_nbm_window -- --ignored --nocapture`.
It uses an isolated temporary cache and fixed NOAA run URLs; run availability
is an external dependency of this test.

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

Release hardening verifies allowed NOAA inventory URLs, clears stale imagery on frame changes,
and allows image-load retries. Reopening the briefing updates its selected
location. Closing the main window exits both windows. The packaged Windows
1.5.0 app launched and exited without leftover StormVector, decoder, or associated
WebView processes. The installer itself has not been installed by the agent.
