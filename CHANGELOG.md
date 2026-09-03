# Changelog

All notable changes to Digital Wellbeing for Linux are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version names match `metadata.json`.

## [1.3] - 2026-09-03

### Changed

- Screen Time graph (Today, This Week, day bars) now reads GNOME Shell’s session history, the same file Settings → Wellbeing uses
- App donut and details still use focused-app time for today

## [1.2] - 2026-09-03

### Fixed

- App donut and details now use today's saved log, so a reboot no longer looks like usage was wiped
- Usage is written to disk every few seconds so a hard reboot loses at most one tick

### Changed

- Graph tap target and copy talk about today, not "this session"

## [1.1] - 2026-09-03

### Added

- Screen Time page in the window opened from the top-bar indicator
- Weekly bar graph of focused-app time, with today / this week totals and averages
- Week navigation on the graph
- Tap the graph to see apps used since this boot, as a donut
- App activity details list with icons and times
- Local usage log at `~/.local/share/digital-wellbeing@local/usage.json` (28 days of daily history)
- Focused-window tracker that skips the lock screen, GNOME Shell / Overview, and suspend

### Changed

- Clicking the indicator opens Screen Time first; display settings moved to a Display page
- About text now describes both uptime (panel) and focused-app time (Screen Time)

## [1.0] - 2026-09-02

### Added

- GNOME Shell 50 extension showing machine uptime in the top bar from `/proc/uptime`
- Click the indicator to open Preferences
- Compact, clock, and verbose uptime formats
- Setting to show or hide the indicator
