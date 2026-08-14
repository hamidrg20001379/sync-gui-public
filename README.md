# Sync GUI

[![Tauri v2](https://img.shields.io/badge/Tauri-v2-blue?style=flat-square&logo=tauri)](https://tauri.app)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![Rust](https://img.shields.io/badge/Rust-Backend-orange?style=flat-square&logo=rust)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

**ENGLISH** | [فارسی](README.fa.md)

**Sync GUI** is a modern, ultra-fast, cross-platform desktop application built with **Tauri v2**, **Rust**, and **Next.js**. It provides an intuitive graphical interface for managing and executing file/folder synchronization between local projects and remote targets via SSH or local copy using `rsync`.

---

## 📸 What is Sync GUI?

If you manage multiple web projects, web servers, microservices, or DirectAdmin/cPanel configurations across different environments (`Production`, `Staging`, `Development`), manually transferring files or remembering complex `rsync` / `scp` command-line flags can be error-prone and tedious.

**Sync GUI** solves this by offering:
- **Hierarchical Management**: Organize your workflow into **Remotes**, **Projects**, **Categories**, and **Sync Items**.
- **Bidirectional Syncing**: Seamlessly **Upload** (Local → Remote) or **Download** (Remote → Local) with a single click.
- **Dynamic Path Tokens**: Automate destination pathing using variables like `{SERVER_NAME}`, `{project}`, or `{name}`.
- **Safe Execution**: Built-in **Dry-Run** mode to preview changes before touching files, and **No-Delete** safety toggle to prevent accidental data loss.
- **Real-Time Terminal Output**: View live `rsync` logs, process IDs, and job history inside the built-in console.
- **Integrated SSH Terminal**: Connect directly to your remote servers with a built-in terminal tab without opening an external terminal app.

---

## 🏗 System Architecture

Sync GUI was migrated from Electron to **Tauri v2 + Rust** to deliver minimal memory usage (~30MB RAM vs ~250MB+ in Electron), lightning-fast startup times, and enhanced security.

```
┌─────────────────────────────────────────────────────────────┐
│                    Sync GUI Desktop App                     │
├──────────────────────────────┬──────────────────────────────┤
│    Next.js + React Frontend  │     Tauri v2 Rust Backend    │
│    (Tailwind/Phosphor Icons) │   (Rsync, SSH, Config CRUD)  │
└──────────────┬───────────────┴──────────────┬───────────────┘
               │                              │
               ▼                              ▼
     localStorage UI State           sync-config.json
```

Data is stored locally in `sync-config.json` adhering to a clean 4-tier model:
1. **Remotes**: Connection profiles (SSH details like host, port, username, password OR Local paths).
2. **Projects**: Logical groupings linked to specific remotes.
3. **Categories**: Multi-level organizational folders within a project.
4. **Sync Items & Targets**: Mapping pairs defining source paths, destination paths, ignore rules, and target servers.

---

## ⚡ Key Features

- **Blazing Fast Native Core**: Powered by Rust and webview native components.
- **Zero-Setup Windows Runtime**: The Windows installer comes bundled with embedded `rsync`, `bash`, `ssh`, and `sshpass` binaries—no extra installation required!
- **Linux Dependency Inspector**: Automatic detection and installation helper for system packages (`rsync`, `sshpass`, `openssh-client`).
- **Granular Execution**: Run sync jobs per item, per target, per category, or execute a batch sync for an entire project.
- **Smart `.syncignore` Support**: Place `.syncignore` in your sync source directory to ignore files (`node_modules/`, `.git/`, `.env`, build logs) during both uploads and downloads.
- **Path Migration Assistance**: Renaming a Remote server automatically prompts and migrates path tokens across your configuration.
- **Job Cancellation & History**: Instantly interrupt running sync processes; maintain job logs across app sessions.

---

## 💻 Installation & Usage Guide

### 🐧 Linux (Ubuntu / Debian / Arch / Fedora)

#### Option 1: Direct DEB Installer (Recommended for Ubuntu/Debian)
1. Download the latest `.deb` package from the [Releases](https://github.com/ali70heidari/sync-gui/releases) page.
2. Install via terminal:
   ```bash
   sudo apt update
   sudo apt install ./sync-gui_1.0.0_amd64.deb
   ```
3. Launch **Sync GUI** from your desktop applications menu.

#### Option 2: AppImage (Portable for all Linux distros)
1. Download `sync-gui.AppImage` from [Releases](https://github.com/ali70heidari/sync-gui/releases).
2. Run our automated setup script to verify FUSE, `rsync`, and `sshpass`:
   ```bash
   bash scripts/setup-linux.sh ./sync-gui.AppImage
   ```
   *(Or make it executable and run directly: `chmod +x sync-gui.AppImage && ./sync-gui.AppImage`)*

---

### 🪟 Windows (Windows 10 / 11)

#### Option 1: Executable Installer (Recommended)
1. Download `Sync-GUI-Setup.exe` or `sync-gui_1.0.0_x64-setup.exe` from [Releases](https://github.com/ali70heidari/sync-gui/releases).
2. Double-click the installer and follow the wizard instructions.
3. Launch **Sync GUI** from your Start Menu.
> ℹ️ **Note for Windows Users**: The packaged Windows installer includes bundled unix utilities (`rsync`, `sshpass`, `bash`). You do **NOT** need to install MSYS2 or Cygwin manually!

#### Option 2: Portable / Running from Unpackaged Source
If you are running from source on Windows, execute the pre-configuration script in PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-win.ps1
```

---

### 🍎 macOS (Intel / Apple Silicon)

1. Download the `.dmg` installer from [Releases](https://github.com/ali70heidari/sync-gui/releases).
2. Open the `.dmg` file and drag **Sync GUI** into your `/Applications` folder.
3. Ensure `rsync` and `openssh` are available (built-in on macOS). If using password authentication for SSH, install `sshpass` via Homebrew:
   ```bash
   brew install hudochenkov/sshpass/sshpass
   ```

---

## 🚀 Quick Start for Developers

Want to run or build Sync GUI from source? Follow these instructions.

### 📋 Prerequisites
- **Node.js**: v18+ and `npm`
- **Rust**: Latest stable toolchain ([install rustup](https://rustup.rs/))
- **System Tools**: `rsync`, `ssh`, `sshpass`

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/ali70heidari/sync-gui.git
cd sync-gui
npm install
```

### 2. Prepare Configuration File

Copy the sample configuration template to create your local active configuration file:

```bash
# On Linux / macOS
cp sync-config.example.json sync-config.json
cp .env.example .env

# On Windows (PowerShell)
Copy-Item sync-config.example.json sync-config.json
Copy-Item .env.example .env
```

> 🔒 **Security Notice**: `sync-config.json` and `.env` contain local server credentials and local paths. They are ignored by Git (`.gitignore`). **Never commit your actual credentials.**

### 3. Run Development Server

Launch the Next.js frontend with live-reloading inside the native Tauri window:

```bash
npm run dev
```

*(To test the Next.js web frontend separately in a browser, run `npm run next:dev` and open `http://localhost:49173`)*

---

## 🛠 Building for Production

To package Sync GUI into native installers for your current platform:

```bash
# Build desktop app for current OS (Linux .deb, Windows .exe, macOS .dmg)
npm run build

# Platform-specific build helpers
npm run build:linux
npm run build:win
```

Output binaries will be saved in `src-tauri/target/release/bundle/`.

---

## ⚙️ Configuration Schema

Your local settings are saved in `sync-config.json`. Below is an explanation of the core structure:

```json
{
  "remotes": [
    {
      "id": "remote-prod-1",
      "name": "Production Server",
      "kind": "ssh",
      "host": "192.168.1.100",
      "port": 22,
      "username": "root",
      "password": "your_password"
    }
  ],
  "projects": [
    {
      "id": "proj-website",
      "name": "Corporate Website",
      "remoteId": "remote-prod-1"
    }
  ],
  "categories": [],
  "items": [
    {
      "id": "item-nginx",
      "name": "Nginx Configuration",
      "source": "/etc/nginx/sites-available/{project}.conf",
      "type": "file",
      "projectId": "proj-website",
      "targets": [
        {
          "name": "Default Target",
          "dest": "./configs/{SERVER_NAME}/{project}_nginx.conf",
          "remoteIds": ["remote-prod-1"]
        }
      ]
    }
  ]
}
```

### 🔤 Dynamic Path Variables
You can use variables in source and destination paths:
- `{SERVER_NAME}`: Evaluates to the target remote name (e.g., `Production Server`).
- `{project}`: Evaluates to the project name.
- `{name}`: Evaluates to the sync item name.

---

## 🙈 Excluding Files (`.syncignore`)

To ignore generated files, temporary builds, or node dependencies, create a `.syncignore` file in the root directory of your sync item.

Example `.syncignore`:
```gitignore
# Dependencies & Build artifacts
node_modules/
dist/
.next/
*.log

# Git & Sensitive Files
.git/
.env
```

Sync GUI automatically appends `.syncignore` rules into `--exclude` parameters for `rsync` operations in both Upload and Download directions.

---

## 🧪 Testing

Run API and core command unit tests:

```bash
node --experimental-detect-module --test tests/api-test.mjs
```

---

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for full details.

---

<p center align="center">
  Crafted with ❤️ using <strong>Tauri v2</strong> & <strong>Rust</strong>.
</p>
