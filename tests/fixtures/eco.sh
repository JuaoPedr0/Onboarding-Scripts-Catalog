#!/usr/bin/env bash
set -euo pipefail
ECO_TEXTO="${ECO_TEXTO:-padrao}"
ECO_LISTA_CSV="${ECO_LISTA_CSV:-}"
ECO_LISTA=()
IFS=',' read -r -a ECO_LISTA <<< "$ECO_LISTA_CSV"
ECO_FLAG="${ECO_FLAG:-false}"
printf '%s|%s|%s\n' "$ECO_TEXTO" "${#ECO_LISTA[@]}" "$ECO_FLAG"
