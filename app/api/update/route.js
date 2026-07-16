import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const packagePath = path.join(process.cwd(), 'package.json');

export async function GET() {
  try {
    const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    const currentVersion = normalizeVersion(pkg.version || '0.0.0');
    const repo = repositorySlug(pkg);
    if (!repo) throw new Error('package.json repository must point to a GitHub repo.');

    const release = await latestRelease(repo);
    const latestVersion = normalizeVersion(release.tag_name || release.name || '');
    const asset = pickAsset(release.assets || [], os.platform(), os.arch());

    return NextResponse.json({
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      releaseUrl: release.html_url,
      assetName: asset?.name || '',
      downloadUrl: asset?.browser_download_url || release.html_url
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function latestRelease(repo) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'sync-gui-update-check'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Could not check GitHub releases (${response.status}).`);
  }

  return response.json();
}

function repositorySlug(pkg) {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const match = String(raw || '').match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?/i);
  return match?.[1] || '';
}

function pickAsset(assets, platform, arch) {
  const names = assetPreferences(platform, arch);
  return names
    .map((pattern) => assets.find((asset) => pattern.test(asset.name)))
    .find(Boolean);
}

function assetPreferences(platform, arch) {
  if (platform === 'win32') return [/Setup-win32-x64\.exe$/i, /win32-x64\.zip$/i];
  if (platform === 'darwin' && arch === 'arm64') return [/darwin-arm64\.dmg$/i, /darwin-arm64\.tar\.gz$/i];
  if (platform === 'darwin') return [/darwin-x64\.dmg$/i, /darwin-x64\.tar\.gz$/i];
  if (platform === 'linux') return [/linux-x64\.AppImage$/i, /linux-x64\.tar\.gz$/i];
  return [];
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function versionParts(value) {
  return normalizeVersion(value).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
}
