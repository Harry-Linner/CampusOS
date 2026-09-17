// A wallpaper HWND must not share the primary Electron process: SetParent can
// reset that process's DPI awareness. This child has no database or account session.
if (process.argv.includes("--campusos-desktop-host") && process.send) {
  void import("../desktop/desktopHost");
} else {
  void import("./main");
}
