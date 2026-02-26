#!/usr/bin/env bash
set -euo pipefail

TABLE_NAME="${TABLE_NAME:-SldBltData-v1-prod}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
RAW_MODE="${RAW_MODE:-0}"

usage() {
  cat <<'EOF'
Usage: scripts/list-alexa-devices.sh [--raw] [--table TABLE] [--region REGION]

Lists device rows (sk begins with DEVICE#) from the SlideBolt single-table DynamoDB table.

Options:
  --raw            Output raw JSON from DynamoDB scan
  --table TABLE    Override table name (default: SldBltData-v1-prod)
  --region REGION  Override AWS region (default: AWS_REGION/AWS_DEFAULT_REGION/us-east-1)
  -h, --help       Show this help

Env:
  TABLE_NAME
  AWS_REGION / AWS_DEFAULT_REGION
  RAW_MODE=1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --raw)
      RAW_MODE=1
      shift
      ;;
    --table)
      TABLE_NAME="${2:-}"
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
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "${TABLE_NAME}" || -z "${AWS_REGION}" ]]; then
  echo "TABLE_NAME and AWS_REGION must be non-empty." >&2
  exit 2
fi

BASE_ARGS=(
  dynamodb scan
  --table-name "$TABLE_NAME"
  --region "$AWS_REGION"
  --filter-expression "begins_with(sk, :d)"
  --expression-attribute-values '{":d":{"S":"DEVICE#"}}'
)

if [[ "$RAW_MODE" == "1" ]]; then
  aws "${BASE_ARGS[@]}" --output json
  exit 0
fi

aws "${BASE_ARGS[@]}" \
  --query 'Items[].{client:pk.S, device:sk.S, endpointId:endpointId.S, status:status.S}' \
  --output table

