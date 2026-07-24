#!/usr/bin/env bash
set -e

APP_NAME="Sync GUI"
APP_FILE="${1:-./sync-gui.AppImage}"

# ── Helpers ────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
pass() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
head() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

cleanup() { [ -n "$TMPFILE" ] && rm -f "$TMPFILE" 2>/dev/null; }
trap cleanup EXIT

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║        $APP_NAME — Pre-Install Setup        ║"
echo "╚══════════════════════════════════════════════════╝"

# ── Step 1: Internet ──────────────────────────────────
head "1/7 — Internet Connectivity"
INTERNET=false
if command -v ping &>/dev/null && ping -c 1 -W 3 8.8.8.8 &>/dev/null; then INTERNET=true; fi
if [ "$INTERNET" = false ] && command -v curl &>/dev/null && curl -s --max-time 5 https://google.com &>/dev/null; then INTERNET=true; fi
if [ "$INTERNET" = false ] && command -v wget &>/dev/null && wget -q --timeout=5 --spider https://google.com &>/dev/null; then INTERNET=true; fi
if [ "$INTERNET" = true ]; then pass "Connected"; else fail "No internet"; exit 1; fi

# ── Step 2: Sudo ──────────────────────────────────────
head "2/7 — Sudo Access"
if command -v sudo &>/dev/null; then
  if sudo -n true 2>/dev/null; then
    pass "sudo available (passwordless)"
    SUDO="sudo"
  else
    warn "sudo requires password — you may be prompted"
    SUDO="sudo"
  fi
else
  fail "sudo not found — install sudo or run as root"
  exit 1
fi

# ── Step 3: Package Manager ───────────────────────────
head "3/7 — Package Manager"
PKG=""
if command -v apt &>/dev/null; then PKG="apt"
elif command -v apt-get &>/dev/null; then PKG="apt-get"
elif command -v dnf &>/dev/null; then PKG="dnf"
elif command -v yum &>/dev/null; then PKG="yum"
fi
if [ -n "$PKG" ]; then pass "$PKG"; else fail "No package manager found (apt/dnf/yum)"; exit 1; fi

$SUDO "$PKG" update -qq 2>/dev/null || true

# ── Step 4: Basic tools often missing on minimal installs ─
head "4/7 — Basic System Tools"
BASIC="curl ca-certificates"
MISSING=""
for t in $BASIC; do
  if command -v "$t" &>/dev/null; then pass "$t"; else MISSING="$MISSING $t"; fi
done
if [ -n "$MISSING" ]; then
  warn "Installing basic tools:$MISSING"
  $SUDO "$PKG" install -y $MISSING
  for t in $MISSING; do
    command -v "$t" &>/dev/null && pass "$t installed" || fail "$t install failed"
  done
fi

# ── Step 5: Sync tools ────────────────────────────────
head "5/7 — Sync Tools"
SYNC_TOOLS="bash rsync openssh-client sshpass"
MISSING=""
for t in $SYNC_TOOLS; do
  if command -v "$t" &>/dev/null; then pass "$t"; else MISSING="$MISSING $t"; fi
done

if [ -n "$MISSING" ]; then
  warn "Installing:$MISSING"
  $SUDO "$PKG" install -y $MISSING
  for t in $SYNC_TOOLS; do
    command -v "$t" &>/dev/null && pass "$t installed" || warn "$t NOT installed — SSH sync will fail"
  done
fi

# ── Step 6: AppImage support ──────────────────────────
head "6/7 — AppImage Support"
FUSE_MISSING=""
if ! command -v fusermount &>/dev/null && ! command -v fusermount3 &>/dev/null; then FUSE_MISSING=1; fi
if [ -n "$FUSE_MISSING" ]; then
  warn "FUSE not found — AppImage needs it"
  $SUDO "$PKG" install -y fuse libfuse2 2>/dev/null || true
  if command -v fusermount &>/dev/null || command -v fusermount3 &>/dev/null; then pass "FUSE installed"; else warn "FUSE unavailable — use --no-sandbox or extract manually"; fi
fi

# ── Step 7: Final check + Install app ─────────────────
head "7/7 — Ready?"
ALL_GOOD=true
for t in bash rsync sshpass; do
  command -v "$t" &>/dev/null || { fail "$t missing — sync will not work"; ALL_GOOD=false; }
done

if [ "$ALL_GOOD" = false ]; then
  fail "Some required tools could not be installed."
  echo "  Install them manually:  $SUDO $PKG install rsync sshpass openssh-client"
  exit 1
fi

pass "All system dependencies satisfied"

# Launch app
if [ -f "$APP_FILE" ]; then
  echo ""
  echo -n "Install $APP_NAME now? [Y/n] "
  read -r confirm
  if [ "$confirm" != "n" ] && [ "$confirm" != "N" ]; then
    chmod +x "$APP_FILE"
    echo "  Running installer..."
    "$APP_FILE" --install 2>/dev/null || "$APP_FILE" --no-sandbox
  fi
else
  pass "Dependencies ready — install $APP_NAME manually from your package"
fi
