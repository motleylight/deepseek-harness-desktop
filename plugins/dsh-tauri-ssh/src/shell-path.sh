# Recover command lookup without exposing shell initialization output to the protocol.
if ! command -v timeout >/dev/null 2>&1 || ! command -v setsid >/dev/null 2>&1; then
  echo 'CLI_SCAN_FAILED: timeout and setsid are required for bounded shell initialization' >&2
  exit 1
fi
dsh_user_shell="${SHELL:-/bin/sh}"
case "$dsh_user_shell" in /*) ;; *) echo 'CLI_SCAN_FAILED: SHELL must be an absolute path' >&2; exit 1;; esac
dsh_initial_path="$PATH"
for dsh_shell_mode in -ic -lc; do
  dsh_shell_output="$(setsid --wait timeout -k 1s 10s "$dsh_user_shell" "$dsh_shell_mode" 'printf "\nDSH_SHELL_PATH_BEGIN\n%s\nDSH_SHELL_PATH_END\n" "$PATH"' </dev/null 2>/dev/null | head -c 65537)"
  dsh_shell_path="$(printf '%s\n' "$dsh_shell_output" | sed -n '/^DSH_SHELL_PATH_BEGIN$/{n;p;}')"
  if [ "${#dsh_shell_output}" -gt 65536 ] || ! printf '%s\n' "$dsh_shell_output" | grep -q '^DSH_SHELL_PATH_END$' || [ -z "$dsh_shell_path" ]; then
    echo 'CLI_SCAN_FAILED: user shell initialization failed, timed out, or exceeded its output limit' >&2
    exit 1
  fi
  PATH="$dsh_shell_path:$dsh_initial_path"
  export PATH
  if command -v dsh >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then break; fi
  dsh_initial_path="$PATH"
done
unset dsh_shell_output dsh_shell_path dsh_initial_path dsh_shell_mode dsh_user_shell
