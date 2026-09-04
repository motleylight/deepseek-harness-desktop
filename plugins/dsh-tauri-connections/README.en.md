# DSH Connections

Connection rows use the DSH workspace presentation: 14px text, 34px directory rows, 32px session rows, and folder icons that reveal disclosure arrows on hover. Addresses remain available in hover titles and settings. Local workspaces and sessions stay directly below the local connection and above external connections, including asynchronous insertions. Only plugin-owned groups are repositioned; native workspace nodes are not remounted. The desktop connection providers also wrap the imperative settings overlay renderer, sharing the same state with the workspace and connection editors.

The `dsh-tauri-connections` DSH plugin provides concurrent connection groups, connection context menus, and the unified connection list in Desktop Settings → Application.

## Usage

Install only the matching Desktop installer from this fork. It bundles the plugin and installs and mounts it at startup; no separate plugin download is needed. Saved endpoints remain in the existing Desktop configuration, so upgrades preserve them.

Add an HTTP(S) endpoint under Settings → Application → DSH connections, then enable “Show in workspaces” for each connection. Connections stay mounted concurrently; selecting a session changes only the visible content. The existing tree contains connection → workspace → session, without another sidebar. Right-click a connection to rename or copy its URL; external connections also support editing, disconnecting and deleting. URL edits are probed before saving; failures preserve the previous endpoint. Renaming works offline. Deletion removes only the Desktop record, never remote data.

This package is not a general browser multi-server client. Ordinary browser visits are unchanged. Older Desktop versions need an upgrade to supply configuration and the multi-frame host; do not combine their old workspace injection with this plugin.

External DSH servers do not need a plugin installation. Before an embedded page boots, Desktop registers its bundled client in the page's Cordis startup. The session API opens exact IDs, including duplicate titles and unrendered sessions, without writing remote profiles or installation directories. This integration uses DSH's `__ModuleLoader__.create()` and client plugin list. Incompatible loaders or service APIs report an error instead of guessing by title or falling back to the local connection.

## Components and lifecycle

Native toolbar styling is preserved. New session invokes the current DSH's native action: it uses the current session's workspace, then the recent workspace, or the native empty view when no workspace exists. There is no connection or workspace selection dialog. Workspace rows offer New session on hover and in their context menu; connection rows offer New workspace with only a directory to enter or browse. Rename, workspace deletion, session fork and archive remain scoped by connection and id.

Flat view merges all connected sessions without connection or workspace groups. Each row has connection and workspace badges offering New workspace and New session respectively. Sorting applies to the whole list. Running sessions show a small spinner; completed but unread sessions show a dot until opened, including the current session in a hidden connection. Indicators use runtime status and observed running-to-idle transitions, not timestamps. Search spans all connections and retains title matches when content indexing is unavailable. Clicking a session opens its connection without a header click first.

Local restart and shutdown controls, DSH version, Node runtime, data directory and port belong to the managed connection card. Desktop version and preferences are separate. SSH installation versions come from that host's check; HTTP service-reported versions are not installation versions. Missing remote information is never filled from local runtime data.

Creation, search and directory browsing execute through the target page's public client services. Requests are pinned to a frame and URL; timeout, disconnect and address changes never fall back to local or automatically retry writes. Only the managed connection may open the local native folder picker. External instances use their own browser directory capability or accept a manually entered host path.

- `./client`: standard DSH client entry. `ctx.effect` owns tree groups and restores original workspace nodes, menus, observers and listeners on disposal.
- `./desktop`: build-time Desktop entry providing management, editing, shared status and concurrent iframes. Desktop retains native storage, probing and managed-process adapters.
- `dist/external.js`: an unprivileged companion generated from the same package. Document-start injection registers the client; only a trusted Desktop parent handshake activates same-origin DSH API reads. It exposes no Tauri calls and does not duplicate an already installed client plugin.

Changing the visible connection does not recreate other frames. Disconnecting, deleting or editing an endpoint destroys its frame and cancels its requests. Unloading the client plugin removes its UI and closes external frames without deleting saved endpoints or stopping external services. Desktop repairs bundled plugin installation at its next startup.

The managed local DSH hosts the shared tree. Stopping or restarting it recreates embedded pages with the host; external processes and their running tasks remain untouched. Authentication, TLS certificates, CSP and embedding restrictions may prevent external pages from loading. A successful URL probe is not a connected page: status comes from the frame handshake and API response. Remote HTTP sends data unencrypted; use trusted HTTPS endpoints.

## Development

Run `pnpm install` at the repository root, then `pnpm --dir plugins/dsh-tauri-connections build`. Generated `dist` serves both the standalone package and Desktop resources; do not edit Rust injection strings. `pnpm build` rebuilds and collects this workspace plugin. Set `DSH_LOCAL_PLUGIN_BUILD=1` to reuse existing caches for other bundled plugins during local builds.

Run `pnpm exec vitest run test/connections-plugin.test.ts test/connections-desktop.test.tsx test/external-client-entry.test.ts` for boot registration, disposal, message-source, failed-edit and concurrent-frame coverage. See `test/manual/README.md` for real DSH browser acceptance. Developers can run `pnpm pack` here to inspect the standard package; users need only the Desktop installer.
