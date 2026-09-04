const DESKTOP_ORIGINS = new Set([
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost',
  'http://localhost:1420',
  'http://127.0.0.1:1420',
])

/** Only the packaged Desktop origin or its fixed development server may request data. */
export function isDesktopMessage(event) {
  return event.source === window.parent && DESKTOP_ORIGINS.has(event.origin)
}
