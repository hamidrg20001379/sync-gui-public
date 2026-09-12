# Sync GUI

**ENGLISH** | [فارسی](README.fa.md)

Sync GUI is a local desktop/web interface for managing file/folder sync between projects and remote targets via SSH or local copy.

## Architecture

Three-tier model stored in a single JSON file (`sync-config.json`):

Set `settings.restrictToChangedFiles` to `true` (or use the **Changed files only** toggle) to copy only source files newer than the destination. Newer and target-only destination files are preserved.

- **Remotes** — SSH or Local connections
- **Projects** — group name linked to a remote
- **Sync Items** — flat list of source→destination pairs, each assigned to a project

Direction (↑ upload / ↓ download) is chosen at sync time, not stored per item.

## Features

- Manage Remotes (SSH/Local), Projects, and Sync Items from one UI
- Flat item list with search, project filter, and pagination (30/page)
- Sync per item (↑/↓) or Sync All (both directions)
- Dry-run toggle, no-delete toggle (saved in localStorage)
- Upload safety pre-flight with SHA-256 comparison against the last trusted sync baseline
- Live progress bar + console output during sync
- In-memory job history (last 100 runs)
- Runtime dependency check (bash, rsync, sshpass, ssh)
- Project-local `.syncignore` files for excluding generated or dependency folders
- Cross-platform: Linux, Windows (via MSYS2), macOS
- Setup scripts automatically install dependencies

## Quick Start

```bash
npm install
cp sync-config.example.json sync-config.json
npm run dev
```

Keep `sync-config.json` local. The repo only tracks `sync-config.example.json`.

Before a real upload, Sync GUI checks the selected target against the last successful sync. Uploads are blocked when the target has changed independently or when local and target changes conflict. A first-time target with existing files must be explicitly trusted from the pre-flight result; the baseline is stored locally in `.sync-state.json`.

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

The regular offline Windows `.exe` installer includes its own portable MSYS2 runtime: Bash,
rsync, OpenSSH, sshpass, runtime DLLs, certificates, and shell support files.
It also includes Electron and the Node.js runtime, so end users do not need to
install Node.js, npm, Git, MSYS2, or any other dependency to run the packaged
application. `setup-win.ps1` is only for running the unpackaged source directly
on a developer machine.

## Build

```bash
npm run build       # Next.js build
npm run dist        # desktop package for current OS
npm run installer:win     # Windows installer (Inno Setup)
npm run installer:mac     # macOS .dmg
npm run installer:linux   # Linux .AppImage
```

For a Windows build, the build machine needs MSYS2 with the sync tools. The
release workflow installs these automatically with `msys2/setup-msys2`; the
resulting installer copies a sanitized portable MSYS2 tree into the app. For a
local build, install `rsync`, `openssh`, and `sshpass` in MSYS2, then run:

```powershell
npm run build
npm run dist
npm run installer:win
```

For a smaller online Windows installer that requests administrator permission and downloads MSYS2 during installation:

```powershell
npm run dist:web
npm run installer:win:web
```

The online installer downloads a pinned MSYS2 base archive, verifies its SHA-256 checksum, extracts it privately into the Sync GUI installation directory, and installs `rsync`, `openssh`, and `sshpass`. It requires internet access during installation. The regular Windows commands remain the offline installer path.

You can point the packager at another MSYS2 installation with
`SYNC_GUI_WIN_TOOLS_ROOT`. The source tree must contain `usr\bin\bash.exe`,
`rsync.exe`, `ssh.exe`, and `sshpass.exe` below that directory.

## PM2

For a long-running production web process, build once and start the checked-in
ecosystem file:

```bash
npm install
npm run build
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

The app listens on port `49173`. The PM2 process keeps the `/api/run` endpoint
available for optional post-commit sync hooks.

## Tests

```bash
node --experimental-detect-module --test tests/api-test.mjs
```

## Configuration

`sync-config.example.json` shows the schema:

- `remotes[]` — SSH (`host`, `port`, `username`, and either `password` or `authMethod: "key"` with `privateKeyPath` and optional `keyPassphrase`) or Local (`type: "local"`)
- `projects[]` — `name` + `remoteId`
- `items[]` — `name`, `source`, `type` (file|folder), `projectId`, and `targets[]`
- `targets[]` — `name`, `dest`, and `remoteIds[]`; legacy single `remoteId` still works
- local item targets can capture path segments with ordinary tokens like `{project}` or `{name}` on the source side and reuse them on the destination side, for example `/usr/local/directadmin/data/users/{project}/nginx.conf` to `./{SERVER_NAME}/{project}_nginx.conf`. `{SERVER_NAME}` is always available and resolves to the selected remote/server name.

## Ignoring Files

Add a `.syncignore` file at the root of a synced folder. Put one pattern on each
line; blank lines and lines beginning with `#` are ignored. Names match at any
depth, while paths are relative to the synced folder. `*`, `**`, and `?` globs
are supported.

```gitignore
node_modules/
.git/
dist/
*.log
```

The `.syncignore` belongs to that sync item's local folder and is not copied.
Its rules apply in both directions: uploads skip matching paths, while downloads
do not overwrite or delete them.
