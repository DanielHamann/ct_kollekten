# CT Kollekten

A macOS desktop app for managing church collection (Kollekte) data in ChurchTools.

## Features

- **Wiki Import** — reads the Kollektenplan from a ChurchTools wiki page and parses it into structured entries
- **Option Sync** — replaces the Kollektengrund dropdown in ChurchTools with the 14 most recent entries from the wiki, plus a permanent "Siehe Kollektenübersicht im Wiki" fallback option (15 total)
- **Gottesdienste** — lists church services for a chosen date range, shows the current Kollektengrund and Betrag per service, and auto-fills suggestions from the wiki
- **Auto-replace stale values** — when syncing options, any service that had a Kollektengrund no longer in the new list is automatically set to "Siehe Kollektenübersicht im Wiki"

## Installation

Download the latest release for your Mac from the [Releases page](../../releases):

- `ct_kollekten-macos-apple-silicon.zip` — Apple Silicon (M1/M2/M3)
- `ct_kollekten-macos-intel.zip` — Intel

Unzip and move `CT Kollekten.app` to your Applications folder.

> **Note:** On first launch macOS may block the app as it is not notarized. Go to **System Settings → Privacy & Security** and click **Open Anyway**.

## Setup

1. Open the app — a setup screen will appear on first run
2. Enter your ChurchTools URL (e.g. `https://meine-gemeinde.church.tools`)
3. Enter your login token (found under **Mein Profil → Sicherheit → Login-Token anzeigen**)
4. Click **Speichern & loslegen**

Your API key is stored securely in the macOS keychain.

## Usage

### Wiki Import
1. Click **Aus Wiki laden** to fetch the Kollektenplan
2. Click **Aktuellen Stand abrufen** to compare with ChurchTools
3. Click **Optionen in ChurchTools ersetzen** to update the dropdown list

### Gottesdienste
1. Select a date range (or use the quick buttons **–2M / +1M**, **Dieses Jahr**, **Q1–Q4**)
2. Click **Laden**
3. If wiki data is loaded, matching entries are auto-filled into the table
4. Adjust and click **Speichern** per row, or **Alle empfohlenen speichern**

## Development

Requirements: [Go 1.22+](https://go.dev) and [Wails v2](https://wails.io)

```bash
wails dev
```

Build for release:

```bash
wails build -platform darwin/arm64
```
