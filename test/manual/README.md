# Connections browser acceptance

Run two independent DSH web profiles on ports 3181 and 3182, each with `dsh-tauri-connections` installed. Keep their `DSH_HOME` directories separate from production. Start `pnpm dev --host 127.0.0.1 --port 1428`, then open `http://127.0.0.1:1428/test/manual/connections-acceptance.html`.

This harness renders the actual plugin desktop components and embeds the real DSH clients. Native configuration calls use an in-memory adapter: port 3182 is accepted and other ports produce a deterministic probe failure. The top test-only Application button is not part of the production titlebar. No model request is needed; skip API-key onboarding and create a test workspace/session in the external DSH.

Check the shared tree, opening an external session, renaming from both entry points, invalid-address preservation, disconnect/reconnect, and absence of duplicate sidebars. Browser acceptance does not cover native window behavior, proxy probing or installer execution; use the Rust tests and Windows build for those separate signals.
