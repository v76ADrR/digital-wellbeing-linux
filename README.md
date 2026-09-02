# Digital Wellbeing for Linux

GNOME Shell extension that shows how long this machine has been on in the top bar.

**UUID:** `digital-wellbeing@local`  
**Shell:** 50

## What it does

- Live uptime in the panel (from `/proc/uptime`)
- Click the indicator to open Preferences
- Format: Compact (`4h 1m`), Clock (`4:01`), or Verbose (`4 hours 1 minute`)
- Show or hide the indicator from Preferences

This is not Android Digital Wellbeing and not per-app screen time. v1 is machine uptime only.

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

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
