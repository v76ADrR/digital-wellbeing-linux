# Digital Wellbeing for Linux

GNOME Shell extension that shows how long this machine has been on in the top bar, and which apps you used today.

**UUID:** `digital-wellbeing@local`  
**Shell:** 50

## What it does

- Live uptime in the panel (from `/proc/uptime`)
- Click the indicator to open Screen Time
- Weekly bar graph of active computer time from GNOME (same source as Settings → Wellbeing)
- Tap a weekday bar to see focused apps from that day, as a donut and a list
- Configure GNOME’s eyesight and movement break reminders from the Break Reminders page
- Format: Compact (`4h 1m`), Clock (`4:01`), or Verbose (`4 hours 1 minute`)
- Show or hide the indicator from the Display page

## How screen time is measured

GNOME Settings → Wellbeing does **not** track apps. It tracks session-level screen time.

1. **GNOME Shell** (`TimeLimitsManager`, not the Settings UI) watches **logind**. Active means at least one session in State `active`, `IdleHint` is false, and the machine is not preparing for sleep (lock counts as idle). That matches `sd_uid_get_state()`-style “active”.
2. On every logind property change and prepare-for-sleep, Shell compares previous vs new state. A flip appends an edge `{oldState, newState, wallTimeSecs}` (`0` inactive, `1` active) to `~/.local/share/gnome-shell/session-active-history.json`. Edges only, not a timesheet. Shell keeps about 14 weeks.
3. **Settings** only reads/writes `org.gnome.desktop.screen-time-limits` and **displays** the sum. This extension does the same sum: ACTIVE intervals, and if still ACTIVE, `now − last ACTIVE start`. “Today” follows Shell’s wellbeing day, which starts at **03:00 local** (DST-safe), not midnight.
4. Break reminders (`BreakManager`, Mutter idle monitor, D-Bus `org.gnome.Shell.ScreenTime`) are separate. Parental `malcontent-timerd` is also separate; when those limits are off, the graph is still logind + the JSON file.

The donut is focused-app time **this extension** records (`UsageTracker` + local files), so days before install have no per-app breakdown. The panel still shows machine uptime from `/proc/uptime`.

Each login (boot) is saved as its own JSON file. Example: you use the machine 20 minutes from 11:00, shut down, and come back two hours later — that morning session stays on disk, a new session file starts, and **today’s donut is the sum of both**.

App usage (day totals): `~/.local/share/digital-wellbeing@local/usage.json`  
Per-login sessions: `~/.local/share/digital-wellbeing@local/sessions/session-<unix>-<boot>.json`  
Week graph: `~/.local/share/gnome-shell/session-active-history.json`.

## Break reminders

The Break Reminders page controls the same native GNOME settings as Settings → Wellbeing. Enable eyesight and movement reminders, choose a movement schedule, and toggle completion sounds. Changes in either application appear in the other; opening this page preserves your current settings.

Movement schedules include 1 minute every 20 minutes, 2 minutes every 20 minutes, 3 minutes every 30 minutes, and 5 minutes every 30 minutes. Advanced controls for each reminder let you customize the break duration, interval, and delay, plus screen dimming, optional locking, sounds, and upcoming, due, overdue, and countdown notifications.

GNOME’s defaults are a 20-second eyesight break every 20 minutes and a 5-minute movement break every 30 minutes. GNOME Shell schedules the reminders and recognizes natural breaks when you step away. The extension uses `org.gnome.desktop.break-reminders` and its per-break settings; it does not run another set of timers. Disabling the extension leaves native break reminders running according to your settings.

## Install

```bash
git clone https://github.com/v76ADrR/digital-wellbeing-linux.git \
  ~/.local/share/gnome-shell/extensions/digital-wellbeing@local
```

On Wayland, log out and log back in (`Alt+F2` then `r` does not work). Then:

```bash
gnome-extensions enable digital-wellbeing@local
```

If settings do not load after a source-only copy:

```bash
glib-compile-schemas ~/.local/share/gnome-shell/extensions/digital-wellbeing@local/schemas
```

## Tests

Run from the project directory:

```bash
gjs -m tests/run.js
GSETTINGS_BACKEND=memory gjs -m tests/breakSettings.js
GSETTINGS_BACKEND=memory GTK_A11Y=none GDK_BACKEND=x11 GSK_RENDERER=gl \
  xvfb-run -a gjs -m tests/breakPreferences.js
```

The break-reminder tests use an in-memory backend to avoid changing your desktop preferences. The last command also exercises the GTK page and renders it in a temporary virtual display.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
