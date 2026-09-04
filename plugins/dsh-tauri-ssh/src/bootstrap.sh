set -eu
if [ "$(uname -s)" != Linux ]; then echo 'SSH_LINUX_REQUIRED' >&2; exit 1; fi
export DSH_SSH_ROOT="$HOME/.local/share/dsh-desktop"
export DSH_EXISTING_BIN="$(command -v dsh || true)"
DSH_NODE="$DSH_SSH_ROOT/node/bin/node"
if [ ! -x "$DSH_NODE" ]; then DSH_NODE="$(command -v node || true)"; fi
if [ -z "$DSH_NODE" ] || ! "$DSH_NODE" -e 'let [a,b]=process.versions.node.split(".").map(Number);process.exit(a>=24||(a===22&&b>=19)?0:1)' >/dev/null 2>&1 || { [ '__ACTION__' = install ] && ! command -v npm >/dev/null && [ ! -x "$DSH_SSH_ROOT/node/bin/npm" ]; }; then
  if [ '__ACTION__' != install ]; then
    existing=false
    if [ -e "$HOME/.dsh" ] || [ -n "$DSH_EXISTING_BIN" ]; then existing=true; fi
    printf 'DSH_SSH_RESULT:{"ok":true,"value":{"installed":false,"running":false,"runtimeMissing":true,"platform":"linux","existingData":%s}}\n' "$existing"
    exit 0
  fi
  command -v curl >/dev/null || { echo 'SSH_CURL_REQUIRED' >&2; exit 1; }
  command -v sha256sum >/dev/null || { echo 'SSH_SHA256_REQUIRED' >&2; exit 1; }
  case "$(uname -m)" in x86_64) arch=x64;; *) echo 'SSH_ARCH_UNSUPPORTED: current DSH Linux releases require x64' >&2; exit 1;; esac
  mkdir -p "$DSH_SSH_ROOT"
  staging="$(mktemp -d "$DSH_SSH_ROOT/node-stage.XXXXXX")"
  trap 'rm -rf -- "$staging"' EXIT HUP INT TERM
  archive="node-v24.15.0-linux-$arch.tar.xz"
  curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v24.15.0/$archive" -o "$staging/$archive"
  curl --fail --location --proto '=https' --tlsv1.2 'https://nodejs.org/dist/v24.15.0/SHASUMS256.txt' -o "$staging/sums"
  (cd "$staging"; awk -v file="$archive" '$2 == file {print}' sums > selected; test -s selected; sha256sum -c selected)
  mkdir "$staging/unpacked"
  tar -xJf "$staging/$archive" --strip-components=1 -C "$staging/unpacked"
  "$staging/unpacked/bin/node" --version >&2
  if [ -e "$DSH_SSH_ROOT/node" ]; then echo 'SSH_NODE_EXISTS: inspect existing private runtime' >&2; exit 1; fi
  mv "$staging/unpacked" "$DSH_SSH_ROOT/node"
  DSH_NODE="$DSH_SSH_ROOT/node/bin/node"
fi
export PATH="$(dirname "$DSH_NODE"):$PATH"
