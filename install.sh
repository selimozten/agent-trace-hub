#!/bin/sh
set -eu

repository=${ATH_REPOSITORY:-selimozten/agent-trace-hub}
version=${ATH_VERSION:-latest}
install_dir=${ATH_INSTALL_DIR:-"$HOME/.local/bin"}

case "$(uname -s)" in
  Darwin) platform=darwin ;;
  Linux) platform=linux ;;
  *)
    printf 'Agent Trace Hub does not provide a binary for %s.\n' "$(uname -s)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64|aarch64) architecture=arm64 ;;
  x86_64|amd64) architecture=x64 ;;
  *)
    printf 'Agent Trace Hub does not provide a binary for %s.\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

asset="agent-trace-hub-${platform}-${architecture}.tar.gz"
case "$version" in
  latest) release_path=latest/download ;;
  v*) release_path="download/$version" ;;
  *) release_path="download/v$version" ;;
esac

base_url=${ATH_DOWNLOAD_BASE_URL:-"https://github.com/${repository}/releases/${release_path}"}
temporary_dir=$(mktemp -d 2>/dev/null || mktemp -d -t agent-trace-hub)

cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup 0 1 2 3 15

download() {
  source_url=$1
  destination=$2
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --silent --show-error --retry 3 --output "$destination" "$source_url"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet --tries=3 --output-document="$destination" "$source_url"
  else
    printf 'Install curl or wget and run the installer again.\n' >&2
    exit 1
  fi
}

archive="$temporary_dir/$asset"
checksums="$temporary_dir/checksums.txt"
download "$base_url/$asset" "$archive"
download "$base_url/checksums.txt" "$checksums"

checksum_line=$(grep "  $asset\$" "$checksums" || true)
if [ -z "$checksum_line" ]; then
  printf 'No checksum was published for %s.\n' "$asset" >&2
  exit 1
fi
expected_checksum=${checksum_line%% *}

if command -v sha256sum >/dev/null 2>&1; then
  checksum_output=$(sha256sum "$archive")
elif command -v shasum >/dev/null 2>&1; then
  checksum_output=$(shasum -a 256 "$archive")
else
  printf 'Install sha256sum or shasum and run the installer again.\n' >&2
  exit 1
fi
actual_checksum=${checksum_output%% *}

if [ "$actual_checksum" != "$expected_checksum" ]; then
  printf 'Checksum verification failed for %s.\n' "$asset" >&2
  exit 1
fi

extract_dir="$temporary_dir/extract"
mkdir -p "$extract_dir" "$install_dir"
tar -xzf "$archive" -C "$extract_dir"

if command -v install >/dev/null 2>&1; then
  install -m 0755 "$extract_dir/ath" "$install_dir/ath"
else
  cp "$extract_dir/ath" "$install_dir/ath"
  chmod 0755 "$install_dir/ath"
fi
ln -sf ath "$install_dir/agent-trace-hub"

printf 'Installed Agent Trace Hub to %s/ath\n' "$install_dir"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *)
    printf 'Add %s to PATH, then run: ath --version\n' "$install_dir"
    ;;
esac
