#!/usr/bin/env bash
set -uo pipefail

if [[ -n "${SUNGROW_USER:-}" && -n "${SUNGROW_PASSWORD:-}" && -n "${SUNGROW_PS_ID:-}" ]]; then
  tool_dir="${HOME}/gosungrow"
  mkdir -p "$tool_dir"
  archive="$tool_dir/gosungrow.tar.gz"
  gosungrow_bin="$(find "$tool_dir" -type f -name GoSungrow -print -quit)"
  if [[ -z "$gosungrow_bin" ]] \
    && curl -fsSL "https://github.com/triamazikamno/GoSungrow/releases/download/v3.0.7/GoSungrow-linux_amd64.tar.gz" -o "$archive" \
    && tar -xzf "$archive" -C "$tool_dir"; then
    gosungrow_bin="$(find "$tool_dir" -type f -name GoSungrow -print -quit)"
  elif [[ -z "$gosungrow_bin" ]]; then
    echo "GoSungrow letöltése sikertelen; a Govee-adatok feldolgozása folytatódik." >&2
  fi
  if [[ -n "$gosungrow_bin" ]]; then
    chmod +x "$gosungrow_bin"
    export GOSUNGROW_BIN="$gosungrow_bin"
  fi
fi

node scripts/fetch-live-data.mjs
