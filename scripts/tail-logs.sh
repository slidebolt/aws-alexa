#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
SINCE="${SINCE:-30m}"
FOLLOW="${FOLLOW:-0}"
FUNCTIONS=()

usage() {
  cat <<'EOF'
Usage: scripts/tail-logs.sh [--follow] [--since 30m] [--region us-east-1] [FUNCTION...]

Reads CloudWatch logs for SlideBolt Alexa Lambda functions.

Default functions:
  SldBltSmartHome SldBltRelay SldBltReporter SldBltAdmin

Examples:
  scripts/tail-logs.sh --since 10m
  scripts/tail-logs.sh --follow SldBltSmartHome SldBltRelay

Env:
  AWS_REGION / AWS_DEFAULT_REGION
  SINCE=30m
  FOLLOW=0
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --follow)
      FOLLOW=1
      shift
      ;;
    --since)
      SINCE="${2:-}"
      shift 2
      ;;
    --region)
      AWS_REGION="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      FUNCTIONS+=("$1")
      shift
      ;;
  esac
done

if [[ ${#FUNCTIONS[@]} -eq 0 ]]; then
  FUNCTIONS=(SldBltSmartHome SldBltRelay SldBltReporter SldBltAdmin)
fi

groups=()
for fn in "${FUNCTIONS[@]}"; do
  groups+=("/aws/lambda/$fn")
done

args=(logs tail --region "$AWS_REGION" --since "$SINCE" --format short)
if [[ "$FOLLOW" == "1" ]]; then
  args+=(--follow)
fi

for group in "${groups[@]}"; do
  echo "== $group =="
  aws "${args[@]}" "$group"
done
