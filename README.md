# Sync GUI

**ENGLISH** | [فارسی](README.fa.md)

Sync GUI is a local desktop/web interface for managing repeatable file sync mappings between projects and remote targets. It is useful when one project has several deployment targets, and each target needs its own independent categories and file/folder mappings.

![Sync GUI demo with mock data](docs/demo.gif)

## Features

- Manage projects, remotes, categories, and file/folder mappings from one UI.
- Keep project remotes independent while reusing shared connection details.
- Sync individual mappings, whole categories, or complete remotes.
- Supports SSH, local folders, and network share style remotes.
- Includes GitHub Actions workflows for CI and release builds.
- Release workflow can publish Windows portable zip, Windows installer, Linux archive, macOS archives, DMG files, and Linux AppImage files.
- Checks GitHub Releases for updates and asks before opening the right download.

## Privacy

This public repository intentionally does **not** include real sync configuration, credentials, server paths, IP addresses, or project data.

Use these local-only files for your own setup:

- `sync-projects.json`
- `.env`

They are ignored by git. Start from the examples:

```powershell
Copy-Item sync-projects.example.json sync-projects.json
Copy-Item .env.example .env
```

## Quick Start

```powershell
npm install
Copy-Item sync-projects.example.json sync-projects.json
Copy-Item .env.example .env
npm run dev
```

Open the local Next.js URL shown in the terminal.

For the Electron app:

```powershell
npm run electron
```

## Build

```powershell
npm run build
```

Create a portable desktop package for your current OS:

```powershell
npm run dist
```

Create a one-file installer/package after building the portable package:

```powershell
npm run installer:win
npm run installer:mac
npm run installer:linux
```

The Windows installer build requires Inno Setup. macOS creates a `.dmg`, and Linux creates an `.AppImage`.

## Updates

The app checks GitHub Releases once per session and also includes a `Check updates` button. When a newer `v*` release exists, it asks before opening the matching download for the current OS:

- Windows: installer `.exe`, then portable `.zip` as fallback.
- macOS: `.dmg`, then `.tar.gz` as fallback.
- Linux: `.AppImage`, then `.tar.gz` as fallback.

This is a prompt-to-download updater. It does not silently install updates.

## Configuration

`sync-projects.example.json` shows the public-safe shape:

- `projects[]` define local project roots.
- `remotes[]` define reusable connection details.
- each project remote can point to a reusable remote using `remoteId`.
- each project remote owns its own `categories[]`.

Credentials can be read from `.env` through fields such as:

```json
{
  "hostEnv": "SERVER_HOST",
  "usernameEnv": "SERVER_USERNAME",
  "passwordEnv": "SERVER_PASSWORD"
}
```
