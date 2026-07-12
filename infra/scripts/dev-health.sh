#!/usr/bin/env bash
# dev-health.sh — live health dashboard after `make up` / `make sync`.
set -uo pipefail

# --- Configuration Flags ---
REFRESH="${REFRESH:-60}"
KEY_TIMEOUT="0.05"
WARNINGS_TAIL_MAX=100

GREEN="${GREEN:-\033[0;32m}"
YELLOW="${YELLOW:-\033[0;33m}"
CYAN="${CYAN:-\033[1;36m}"
BOLD="${BOLD:-\033[1m}"
REVERSE="${REVERSE:-\033[7m}"
NC="${NC:-\033[0m}"

[[ -f "$(dirname "${BASH_SOURCE[0]}")/_lib.sh" ]] && source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "\033[0;31m[ERROR]${NC} $*"; exit 1; }
step() { echo -e "${CYAN}==> $*${NC}"; }

kubectl get ns infra > /dev/null 2>&1 || error "Cluster not found — run: make up"

ONCE=0
[[ "${1:-}" == "--once" ]] && ONCE=1
[[ -t 1 ]] || ONCE=1

FAIL=0
STATUS_NODE="unknown"
STATUS_ARGO="unknown"
STATUS_PODS="unknown"
STATUS_ES="unknown"
declare -a WARNINGS_LIST=()
LAST_UPDATE=0

update_data() {
  local current_time
  current_time=$(date +%s)
  
  if (( current_time - LAST_UPDATE >= REFRESH )) || [ ${#WARNINGS_LIST[@]} -eq 0 ]; then
    # 1. Node Status
    local node_res
    node_res=$(kubectl get nodes --no-headers 2>/dev/null | awk '{print $2}')
    if [ "$node_res" = "Ready" ]; then
      STATUS_NODE="Ready ✔"
    else
      STATUS_NODE="Not Ready (status: ${node_res:-unknown}) ⚠"; FAIL=1
    fi

    # 2. ArgoCD Status
    local apps apps_bad
    apps=$(kubectl get applications -n infra --no-headers -o custom-columns='NAME:.metadata.name,HEALTH:.status.health.status,SYNC:.status.sync.status' 2>/dev/null)
    if [ -z "$apps" ]; then
      STATUS_ARGO="No Applications found ⚠"; FAIL=1
    else
      apps_bad=$(echo "$apps" | awk '$2!="Healthy" || $3!="Synced"' | wc -l | tr -d ' ')
      if [ "$apps_bad" -eq 0 ]; then
        STATUS_ARGO="All Applications Healthy ✔"
      else
        STATUS_ARGO="$apps_bad Apps Unhealthy/Out-of-Sync ⚠"; FAIL=1
      fi
    fi

    # 3. Pods Status
    local pods bad_pods pods_bad_count
    pods=$(kubectl get pods -A --no-headers 2>/dev/null)
    bad_pods=$(echo "$pods" | awk '
      { split($3, r, "/"); status=$4 }
      status=="Completed" || status=="Succeeded" { next }
      r[1]!=r[2] || (status!="Running") { print "  "$1"/"$2"  "$3"  "status"  restarts="$5 }
    ')
    pods_bad_count=$(echo "$bad_pods" | grep -c . || true)
    if [ "$pods_bad_count" -eq 0 ]; then
      local total_pods
      total_pods=$(echo "$pods" | grep -c . || true)
      STATUS_PODS="All $total_pods pods ready ✔"
    else
      STATUS_PODS="$pods_bad_count pods failing/not ready ⚠"; FAIL=1
    fi

    # 4. External Secrets Status
    local es bad_es es_bad_count
    es=$(kubectl get externalsecrets -A --no-headers -o custom-columns='NS:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[0].reason' 2>/dev/null)
    if [ -z "$es" ]; then
      STATUS_ES="No ExternalSecrets found ⚠"; FAIL=1
    else
      bad_es=$(echo "$es" | awk '$3!="SecretSynced" {print "  "$1"/"$2"  reason="$3}')
      es_bad_count=$(echo "$bad_es" | grep -c . || true)
      if [ "$es_bad_count" -eq 0 ]; then
        local total_es
        total_es=$(echo "$es" | wc -l | tr -d ' ')
        STATUS_ES="All $total_es ExternalSecrets synced ✔"
      else
        STATUS_ES="$es_bad_count secrets failed sync ⚠"; FAIL=1
      fi
    fi

    # 5. Fetch Warnings Raw List
    local raw_warnings
    raw_warnings=$(kubectl get events -A --field-selector type=Warning --sort-by=.lastTimestamp --no-headers 2>/dev/null | tail -n "$WARNINGS_TAIL_MAX")
    
    IFS=$'\n' read -r -d '' -a WARNINGS_LIST < <(
      if [ -n "$raw_warnings" ]; then
        echo "$raw_warnings" | awk '{ns=$1; reason=$5; $1=$2=$3=$4=$5=""; sub(/^ +/,""); print "["ns"] "reason": "$0}'
      fi
      printf '\000'
    )

    LAST_UPDATE=$current_time
  fi
}

# --- Non-Interactive Single Pass Mode (Returns Everything to Stdout) ---
if [ "$ONCE" -eq 1 ]; then
  REFRESH=0
  update_data
  
  step "Cluster"
  [[ "$STATUS_NODE" == *"✔"* ]] && info "$STATUS_NODE" || warn "$STATUS_NODE"
  
  step "ArgoCD Applications"
  if [[ "$STATUS_ARGO" == *"✔"* ]]; then
    info "$STATUS_ARGO"
  else
    warn "Applications not healthy/synced:"
    kubectl get applications -n infra --no-headers 2>/dev/null | awk '$2!="Healthy" || $3!="Synced" {print "  "$1" ("$2"/"$3")"}'
  fi
  
  step "Pods"
  if [[ "$STATUS_PODS" == *"✔"* ]]; then
    info "$STATUS_PODS"
  else
    warn "Pods not ready:"
    kubectl get pods -A --no-headers 2>/dev/null | awk '{split($3, r, "/"); s=$4} s!="Completed" && s!="Succeeded" && (r[1]!=r[2] || s!="Running") {print "  "$1"/"$2" ("$3" - "s")"}'
  fi
  
  step "ExternalSecrets"
  if [[ "$STATUS_ES" == *"✔"* ]]; then
    info "$STATUS_ES"
  else
    warn "ExternalSecrets not synced:"
    kubectl get externalsecrets -A --no-headers 2>/dev/null | awk '$3!="SecretSynced" {print "  "$1"/"$2" ("$3")"}'
  fi
  
  step "Recent warnings"
  if [ ${#WARNINGS_LIST[@]} -eq 0 ]; then
    info "No Warning events"
  else
    printf '  %s\n' "${WARNINGS_LIST[@]}"
  fi
  
  step "Summary"
  [[ "$FAIL" -eq 0 ]] && info "everything healthy ✔" || warn "some checks failed — see sections above"
  exit "$FAIL"
fi

# --- Interactive TTY Mode Setup ---
TTY_IN=""
{ : < /dev/tty; } 2>/dev/null && TTY_IN=/dev/tty

cleanup() { 
  tput rmcup 2>/dev/null
  tput cnorm 2>/dev/null
  stty echo 2>/dev/null
}
trap cleanup EXIT INT TERM

tput smcup 2>/dev/null
tput civis 2>/dev/null
CEOL=$'\033[K'
SELECTED_ROW=0

stty -echo 2>/dev/null

# --- TTY Event Loop ---
while true; do
  update_data

  term_lines=$(tput lines 2>/dev/null || echo 24)
  term_cols=$(tput cols 2>/dev/null || echo 120)

  tput cup 0 0
  next_update=$(( REFRESH - ($(date +%s) - LAST_UPDATE) ))
  (( next_update < 0 )) && next_update=0
  printf "${GREEN}${BOLD}dev-health${NC} — %s (Refresh in %ss) — [r] Refresh Now — Arrow [↑/↓] Navigate — q/Esc: Exit%s\n" "$(date '+%H:%M:%S')" "$next_update" "$CEOL"

  tput cup 1 0; printf "  %-20s : %b%s" "Node Status" "$([[ "$STATUS_NODE" == *"✔"* ]] && echo "$GREEN" || echo "$YELLOW")" "$STATUS_NODE$CEOL\n"
  tput cup 2 0; printf "  %-20s : %b%s" "ArgoCD Apps" "$([[ "$STATUS_ARGO" == *"✔"* ]] && echo "$GREEN" || echo "$YELLOW")" "$STATUS_ARGO$CEOL\n"
  tput cup 3 0; printf "  %-20s : %b%s" "Pod Status"  "$([[ "$STATUS_PODS" == *"✔"* ]] && echo "$GREEN" || echo "$YELLOW")" "$STATUS_PODS$CEOL\n"
  tput cup 4 0; printf "  %-20s : %b%s" "External Secrets" "$([[ "$STATUS_ES" == *"✔"* ]] && echo "$GREEN" || echo "$YELLOW")" "$STATUS_ES$CEOL\n"

  tput cup 5 0
  printf "${CYAN}==> RECENT WARNING LOGS:${NC}%s\n" "$CEOL"

  start_body_row=6
  details_panel_height=4
  body_height=$((term_lines - start_body_row - details_panel_height - 1))
  total_warnings=${#WARNINGS_LIST[@]}

  if [ "$total_warnings" -eq 0 ]; then
    has_warnings=0
  else
    has_warnings=1
  fi

  if [ "$has_warnings" -eq 1 ]; then
    (( SELECTED_ROW < 0 )) && SELECTED_ROW=0
    (( SELECTED_ROW >= total_warnings )) && SELECTED_ROW=$((total_warnings - 1))
  else
    SELECTED_ROW=0
  fi

  scroll_offset=0
  if (( SELECTED_ROW >= body_height )); then
    scroll_offset=$(( SELECTED_ROW - body_height + 1 ))
  fi

  for ((i=0; i<body_height; i++)); do
    current_w_idx=$((scroll_offset + i))
    tput cup $((start_body_row + i)) 0
    
    if [ "$has_warnings" -eq 0 ]; then
      if [ $i -eq 0 ]; then
        printf "   ${GREEN}✔${NC} No recent Warning events found in this cluster.%s" "$CEOL"
      else
        printf "%s" "$CEOL"
      fi
      continue
    fi

    if (( current_w_idx < total_warnings )); then
      w_line="${WARNINGS_LIST[$current_w_idx]}"
      
      if (( ${#w_line} > term_cols )); then
        w_line="${w_line:0:term_cols-4}..."
      fi

      if (( current_w_idx == SELECTED_ROW )); then
        printf "${REVERSE} > %s ${NC}%s" "$w_line" "$CEOL"
      else
        printf "   %s%s" "$w_line" "$CEOL"
      fi
    else
      printf "%s" "$CEOL"
    fi
  done

  # --- Details Panel ---
  details_start_row=$((start_body_row + body_height))
  tput cup "$details_start_row" 0
  printf "${CYAN}==> INSPECTING SELECTED LOG (Full Text):${NC}%s\n" "$CEOL"

  if [ "$has_warnings" -eq 1 ]; then
    selected_full_text="${WARNINGS_LIST[$SELECTED_ROW]}"
    for ((r=1; r<details_panel_height; r++)); do
      tput cup $((details_start_row + r)) 0
      start_char=$(( (r - 1) * (term_cols - 2) ))
      chunk="${selected_full_text:$start_char:$((term_cols - 2))}"
      if [ -n "$chunk" ]; then
        printf "  %s%s" "$chunk" "$CEOL"
      else
        printf "%s" "$CEOL"
      fi
    done
  else
    for ((r=1; r<details_panel_height; r++)); do
      tput cup $((details_start_row + r)) 0; printf "%s" "$CEOL"
    done
  fi

  # --- Status Bar ---
  tput cup $((term_lines - 1)) 0
  if [ "$has_warnings" -eq 0 ]; then
    footer_msg="[Healthy Cluster] — No active warnings to inspect."
  else
    footer_msg="[Item $((SELECTED_ROW + 1)) of $total_warnings] — Use Arrow Keys to switch log — Press 'r' to refresh."
  fi
  printf "${REVERSE}%s%s${NC}" "${footer_msg:0:term_cols}" "$CEOL"

  # --- Hotkey Capture ---
  if [ -n "$TTY_IN" ]; then
    if read -rsn1 -t "$KEY_TIMEOUT" key < "$TTY_IN"; then
      case "$key" in
        q|Q) break ;;
        r|R) LAST_UPDATE=0 ;; 
        $'\x1b') 
          if read -rsn2 -t 0.01 seq < "$TTY_IN"; then
            case "$seq" in
              "[A") [ "$has_warnings" -eq 1 ] && ((SELECTED_ROW--)) ;;
              "[B") [ "$has_warnings" -eq 1 ] && ((SELECTED_ROW++)) ;;
            esac
          else
            break
          fi
          ;;
      esac
    fi
  else
    sleep "$REFRESH"
  fi
done