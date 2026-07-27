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

Keep `sync-config.json` local. The repo only tracks `sync-config.example.json`.

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

## Bundled Windows Tools

To ship a self-contained Windows installer, place the required Unix tools under `vendor/win-tools/usr/bin` before running `npm run dist` or `npm run installer:win`.

Required files:

- `bash.exe`
- `rsync.exe`
- `ssh.exe`
- `sshpass.exe`
- the DLLs those binaries depend on

The packaged app now prefers these bundled tools automatically on Windows and falls back to `C:\msys64\usr\bin\bash.exe` only when the bundle is absent.

## Tests

```bash
node --experimental-detect-module --test tests/api-test.mjs
```

## Configuration

`sync-config.example.json` shows the schema:

- `remotes[]` — SSH (`host`, `port`, `username`, `password`) or Local (`type: "local"`)
- `projects[]` — `name` + `remoteId`
- `items[]` — `name`, `source`, `type` (file|folder), `projectId`, and `targets[]`
- `targets[]` — `name`, `dest`, and `remoteIds[]`; legacy single `remoteId` still works
- local item targets can capture path segments with ordinary tokens like `{project}` or `{name}` on the source side and reuse them on the destination side, for example `/usr/local/directadmin/data/users/{project}/nginx.conf` to `./{SERVER_NAME}/{project}_nginx.conf`. `{SERVER_NAME}` is always available and resolves to the selected remote/server name.
