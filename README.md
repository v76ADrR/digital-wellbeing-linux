# Digital Wellbeing for Linux

GNOME Shell extension that shows how long this machine has been on in the top bar, and which apps you used today.

**UUID:** `digital-wellbeing@local`  
**Shell:** 50

## What it does

- Live uptime in the panel (from `/proc/uptime`)
- Click the indicator to open Screen Time
- Weekly bar graph of active computer time from GNOME (same source as Settings → Wellbeing)
- Tap a weekday bar to see focused apps from that day, as a donut and a list
- Format: Compact (`4h 1m`), Clock (`4:01`), or Verbose (`4 hours 1 minute`)
- Show or hide the indicator from the Display page

## How screen time is measured

GNOME Settings → Wellbeing does **not** track apps. It tracks session-level screen time.

1. **GNOME Shell** (`TimeLimitsManager`, not the Settings UI) watches **logind**. Active means at least one session in State `active`, `IdleHint` is false, and the machine is not preparing for sleep (lock counts as idle). That matches `sd_uid_get_state()`-style “active”.
2. On every logind property change and prepare-for-sleep, Shell compares previous vs new state. A flip appends an edge `{oldState, newState, wallTimeSecs}` (`0` inactive, `1` active) to `~/.local/share/gnome-shell/session-active-history.json`. Edges only, not a timesheet. Shell keeps about 14 weeks.
3. **Settings** only reads/writes `org.gnome.desktop.screen-time-limits` and **displays** the sum. This extension does the same sum: ACTIVE intervals, and if still ACTIVE, `now − last ACTIVE start`. “Today” follows Shell’s wellbeing day, which starts at **03:00 local** (DST-safe), not midnight.
4. Break reminders (`BreakManager`, Mutter idle monitor, D-Bus `org.gnome.Shell.ScreenTime`) are separate. Parental `malcontent-timerd` is also separate; when those limits are off, the graph is still logind + the JSON file.

The donut is focused-app time **this extension** records (`UsageTracker` + `usage.json`), so days before install have no per-app breakdown. The panel still shows machine uptime from `/proc/uptime`.

App usage: `~/.local/share/digital-wellbeing@local/usage.json`.  
Week graph: `~/.local/share/gnome-shell/session-active-history.json`.

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

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
