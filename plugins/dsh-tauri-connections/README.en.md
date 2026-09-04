# DSH Connections

The `dsh-tauri-connections` DSH plugin provides concurrent connection groups, connection context menus, and the unified connection list in Desktop Settings → Application.

## Usage

The matching Desktop installer from this fork bundles and installs the plugin at startup. Saved endpoints remain in the existing Desktop configuration, so upgrades preserve them.

Add an HTTP(S) endpoint under Settings → Application → DSH connections, then enable “Show in workspaces” for each connection. Connections stay mounted concurrently; selecting a session changes only the visible content. The existing tree contains connection → workspace → session, without another sidebar. Right-click a connection to rename or copy its URL; external connections also support editing, disconnecting and deleting. URL edits are probed before saving; failures preserve the previous endpoint. Renaming works offline. Deletion removes only the Desktop record, never remote data.

Install the standalone package into the DSH profile used by the matching Desktop:

```sh
dsh plugin --profile web add /absolute/path/dsh-tauri-connections-0.1.0.tgz
```

This package is not a general browser multi-server client. Ordinary browser visits are unchanged. Older Desktop versions need an upgrade to supply configuration and the multi-frame host; do not combine their old workspace injection with this plugin.

Without the plugin on an external DSH, the compatibility companion reads its lists and matches unique visible session titles. For duplicate titles or collapsed/unrendered sessions, install this plugin in that external DSH's web profile too. Its client uses the session API to open exact IDs without Desktop privileges.

## Components and lifecycle

- `./client`: standard DSH client entry. `ctx.effect` owns tree groups and restores original workspace nodes, menus, observers and listeners on disposal.
- `./desktop`: build-time Desktop entry providing management, editing, shared status and concurrent iframes. Desktop retains native storage, probing and managed-process adapters.
- `dist/external.js`: an unprivileged companion generated from the same package. Desktop injects it dormant; the plugin handshake activates same-origin DSH API reads. It exposes no Tauri calls.

Changing the visible connection does not recreate other frames. Disconnecting, deleting or editing an endpoint destroys its frame and cancels its requests. Unloading the client plugin removes its UI and closes external frames without deleting saved endpoints or stopping external services. Desktop repairs bundled plugin installation at its next startup.

The managed local DSH hosts the shared tree. Stopping or restarting it recreates embedded pages with the host; external processes and their running tasks remain untouched. Authentication, TLS certificates, CSP and embedding restrictions may prevent external pages from loading. A successful URL probe is not a connected page: status comes from the frame handshake and API response. Remote HTTP sends data unencrypted; use trusted HTTPS endpoints.

## Development

Run `pnpm install` at the repository root, then `pnpm --dir plugins/dsh-tauri-connections build`. Generated `dist` serves both the standalone package and Desktop resources; do not edit Rust injection strings. `pnpm build` rebuilds and collects this workspace plugin. Set `DSH_LOCAL_PLUGIN_BUILD=1` to reuse existing caches for other bundled plugins during local builds.

Run `pnpm exec vitest run test/connections-plugin.test.ts test/connections-desktop.test.tsx` for disposal, message-source, failed-edit and concurrent-frame coverage. Run `pnpm pack` in this directory to produce the plugin package.
