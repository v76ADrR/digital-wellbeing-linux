# Digital Wellbeing for Linux

GNOME Shell extension that shows how long this machine has been on in the top bar, and which apps you used today.

**UUID:** `digital-wellbeing@local`  
**Shell:** 50

## What it does

- Live uptime in the panel (from `/proc/uptime`)
- Click the indicator to open Screen Time
- Weekly bar graph of active computer time from GNOME (same source as Settings → Wellbeing)
- Tap the graph to see focused apps from today, as a donut and a list
- Format: Compact (`4h 1m`), Clock (`4:01`), or Verbose (`4 hours 1 minute`)
- Show or hide the indicator from the Display page

The graph is GNOME’s session screen time (logged in, not idle, not locked, not asleep), including days before this extension was installed. The donut is focused-app time we record ourselves. The panel still shows machine uptime.

App usage is stored at `~/.local/share/digital-wellbeing@local/usage.json`. The week graph reads `~/.local/share/gnome-shell/session-active-history.json`.

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
