#!/usr/bin/env bash
# dev-health.sh — one-shot health probe after `make up` / `make sync`.
# Read-only: never mutates the cluster. Exits non-zero if anything is unhealthy,
# so it doubles as a scriptable gate. Run: make health
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

kubectl get ns infra > /dev/null 2>&1 || error "Cluster not found — run: make up"

FAIL=0

step "Cluster"
NODE_STATUS=$(kubectl get nodes --no-headers 2>/dev/null | awk '{print $2}')
if [ "$NODE_STATUS" = "Ready" ]; then
  info "node Ready"
else
  warn "node not Ready (status: ${NODE_STATUS:-unknown})"; FAIL=1
fi

step "ArgoCD Applications"
# HEALTH should be Healthy and SYNC should be Synced for every app.
APPS=$(kubectl get applications -n infra --no-headers \
  -o custom-columns='NAME:.metadata.name,HEALTH:.status.health.status,SYNC:.status.sync.status' 2>/dev/null)
if [ -z "$APPS" ]; then
  warn "no Applications found (root-app not reconciled yet?)"; FAIL=1
else
  BAD_APPS=$(echo "$APPS" | awk '$2!="Healthy" || $3!="Synced"')
  TOTAL=$(echo "$APPS" | wc -l | tr -d ' ')
  if [ -z "$BAD_APPS" ]; then
    info "all $TOTAL apps Healthy & Synced"
  else
    echo "$BAD_APPS" | while read -r name health sync; do
      warn "$name → health=$health sync=$sync"
    done
    FAIL=1
  fi
fi

step "Pods"
# READY is "n/m"; a pod is unhealthy if n<m (and not Completed) or STATUS is not
# Running/Completed (catches CrashLoopBackOff, ImagePullBackOff, Pending, Error).
PODS=$(kubectl get pods -A --no-headers 2>/dev/null)
BAD_PODS=$(echo "$PODS" | awk '
  { split($3, r, "/"); status=$4 }
  status=="Completed" || status=="Succeeded" { next }
  r[1]!=r[2] || (status!="Running") { print "  "$1"/"$2"  "$3"  "status"  restarts="$5 }
')
TOTAL_PODS=$(echo "$PODS" | grep -c . || true)
if [ -z "$BAD_PODS" ]; then
  info "all $TOTAL_PODS pods ready"
else
  warn "pods not ready:"
  echo "$BAD_PODS"
  FAIL=1
fi

step "ExternalSecrets"
# The bit that most often lags on a fresh bootstrap.
ES=$(kubectl get externalsecrets -A --no-headers \
  -o custom-columns='NS:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[0].reason' 2>/dev/null)
if [ -z "$ES" ]; then
  warn "no ExternalSecrets found"; FAIL=1
else
  BAD_ES=$(echo "$ES" | awk '$3!="SecretSynced" {print "  "$1"/"$2"  reason="$3}')
  TOTAL_ES=$(echo "$ES" | wc -l | tr -d ' ')
  if [ -z "$BAD_ES" ]; then
    info "all $TOTAL_ES ExternalSecrets synced"
  else
    warn "ExternalSecrets not synced:"
    echo "$BAD_ES"
    FAIL=1
  fi
fi

step "Recent warnings"
# Last handful of Warning events cluster-wide — surfaces flapping the checks above
# may have already recovered from (backoff, probe failures, evictions).
WARNINGS=$(kubectl get events -A --field-selector type=Warning \
  --sort-by=.lastTimestamp --no-headers 2>/dev/null | tail -n 10)
if [ -z "$WARNINGS" ]; then
  info "no Warning events"
else
  echo "$WARNINGS" | awk '{ns=$1; reason=$5; $1=$2=$3=$4=$5=""; sub(/^ +/,""); print "  ["ns"] "reason": "$0}'
fi

step "Summary"
if [ "$FAIL" -eq 0 ]; then
  info "everything healthy ✔"
else
  warn "some checks failed — see sections above"
fi
exit "$FAIL"
