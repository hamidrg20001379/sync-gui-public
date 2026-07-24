# Sync GUI

**ENGLISH** | [فارسی](README.fa.md)

Sync GUI is a local desktop/web interface for managing file/folder sync between projects and remote targets via SSH or local copy.

## Architecture

Three-tier model stored in a single JSON file (`sync-config.json`):

- **Remotes** — SSH or Local connections
- **Projects** — group name linked to a remote
- **Sync Items** — flat list of source→destination pairs, each assigned to a project

Direction (↑ upload / ↓ download) is chosen at sync time, not stored per item.

## Features

- Manage Remotes (SSH/Local), Projects, and Sync Items from one UI
- Flat item list with search, project filter, and pagination (30/page)
- Sync per item (↑/↓) or Sync All (both directions)
- Dry-run toggle, no-delete toggle (saved in localStorage)
- Live progress bar + console output during sync
- In-memory job history (last 100 runs)
- Runtime dependency check (bash, rsync, sshpass, ssh)
- Cross-platform: Linux, Windows (via MSYS2), macOS
- Setup scripts automatically install dependencies

## Quick Start

```bash
npm install
cp sync-config.example.json sync-config.json
npm run dev
```

Open the local Next.js URL shown in the terminal. For the Electron app:

```bash
npm run electron
```

## Setup Scripts

One-command dependency install + app launch:

| Platform | Script |
|----------|--------|
| Linux | `bash scripts/setup-linux.sh` |
| Windows | `powershell -File scripts/setup-win.ps1` |

## Build

```bash
npm run build       # Next.js build
npm run dist        # desktop package for current OS
npm run installer:win     # Windows installer (Inno Setup)
npm run installer:mac     # macOS .dmg
npm run installer:linux   # Linux .AppImage
```

## Tests

```bash
node --experimental-detect-module --test tests/api-test.mjs
```

## Configuration

`sync-config.example.json` shows the schema:

- `remotes[]` — SSH (`host`, `port`, `username`, `password`) or Local (`type: "local"`)
- `projects[]` — `name` + `remoteId`
- `items[]` — `name`, `source`, `dest`, `type` (file|folder), `projectId`
