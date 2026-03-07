# Electron EXE Build Steps

## Current setup

- Windows packaging is configured in `package.json`.
- The app icon is taken directly from `public/secretchat.png`.
- Packaged output is written to `release/`.
- The Electron app currently opens the hosted app URL from `desktop-chat-app/next-app-url.cjs`, so the packaged `.exe` still needs internet access.

## Icon source

No extra copy step is needed.

`package.json` is configured to use:

- `build.directories.buildResources = "public"`
- `build.win.icon = "secretchat.png"`

That means Electron Builder will use:

- `public/secretchat.png`

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

- `release\Sec Chat Setup 0.1.0.exe`

### 4. Build a portable EXE

```powershell
cmd /c npm run dist:portable
```

Expected output:

- `release\Sec Chat 0.1.0.exe`

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
- If you later want the best possible Windows shell compatibility, you can convert the same logo to `.ico` and switch `build.win.icon` to that file. For now, this setup uses `public/secretchat.png` directly as requested.
- Electron Builder docs:
  - https://www.electron.build/
  - https://www.electron.build/icons
