# Electron EXE Build Steps

## Current setup

- Windows packaging is configured in `package.json`.
- The Windows installer/exe icon is taken from `public/secretchat.ico`.
- Packaged output is written to `release/`.
- The Electron app currently opens the hosted app URL from `desktop-chat-app/next-app-url.cjs`, so the packaged `.exe` still needs internet access.
- The build is pinned to the modern Electron Builder Windows toolset to avoid the legacy `winCodeSign` symlink extraction failure on Windows.

## Icon source

No extra icon conversion step is needed.

`package.json` is configured to use:

- `build.directories.buildResources = "public"`
- `build.win.icon = "secretchat.ico"`
- `build.toolsets.winCodeSign = "1.1.0"`

That means Electron Builder will use:

- `public/secretchat.ico`

## Build steps

Run all commands from:

```powershell
C:\Coding\sec-chat\chat-app
```

### 1. Install project dependencies

```powershell
cmd /c npm install
```

This picks up the added `dotenv` dependency used by the Electron entry.

### 2. Install Electron Builder

```powershell
cmd /c npm install -D electron-builder
```

### 3. Build the Windows installer

```powershell
cmd /c npm run dist:win
```

Expected output:

- `release\SecretChat Setup 0.1.0.exe`

### 4. Build a portable EXE

```powershell
cmd /c npm run dist:portable
```

Expected output:

- `release\SecretChat 0.1.0.exe`

### 5. Optional: build an unpacked folder first

```powershell
cmd /c npm run dist:dir
```

This creates an unpacked app folder for quick local verification before generating the installer.

## Output location

After packaging, check:

```powershell
C:\Coding\sec-chat\chat-app\release
```

## Notes

- If Windows shows a SmartScreen warning, that is expected for an unsigned app.
- The previous failure with `winCodeSign-2.6.0.7z` and symbolic-link extraction should be avoided by using the modern `1.1.0` Windows toolset.
- If you still see the same legacy `winCodeSign` archive path in the next run, clear `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign` once and rerun.
- Electron Builder docs:
  - https://www.electron.build/
  - https://www.electron.build/icons
