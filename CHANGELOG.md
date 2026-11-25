# Release Notes

## Unreleased

- Removed in-app AI features, including generated forecasts, Ask Luna, AI-model maps, and OpenAI key settings. Standard forecasts, alerts, and saved NOAA guidance remain.

## 1.5.2

- Replaced the desktop icon and browser favicon with the teal Frontal mark.

## 1.5.1

- Added ECMWF AIFS precipitation, temperature, and sustained-wind maps, with playback through day 15.
- Consolidated Luna into one briefing that gathers available model guidance for the selected point and reuses it for an hour across app restarts.
- Added location- and time-matched SPC outlooks, plus a fresh check for active NWS alerts when generating a briefing.
- Tuned Luna to lead with active alerts and their time zones, make a concise forecast call, and keep model names in the sources unless a meaningful disagreement affects the forecast.

## 1.5.0

- Added a separate Forecast Briefing window with location-aware model comparisons, saved run history, and on-demand AI interpretation.
- Added GFS daily highs/lows and liquid-equivalent precipitation totals for the first week and days 8-15.
- Added matching NBM precipitation probabilities and accumulation percentiles, plus native six-hour snowfall guidance where available.
- Added a basemap beneath forecast radar imagery and working external NOAA/ECMWF chart and source links.
- Moved the AI key to Preferences with native secure storage on Windows and Linux; environment keys remain supported if the system keyring is unavailable.
- Hardened source-link validation, imagery retry/clearing, and briefing-window shutdown with the main app.

Snowfall conversion, probability selection, interval aggregation, and missing-data behavior are covered by fixtures. Live snowy-weather behavior still needs field testing. Linux packages are built by GitHub Actions; Linux secure storage requires an unlocked Secret Service keyring.
