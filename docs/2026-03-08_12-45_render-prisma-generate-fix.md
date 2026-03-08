# 2026-03-08 12:45 - Render Prisma Generate Fix

## Context

- Render build for the standalone realtime server failed in a clean environment.
- Error symptoms:
  - `Module '"@prisma/client"' has no exported member 'PrismaClient'`
  - downstream TypeScript errors in files using Prisma query results

## Root cause

- The standalone realtime build script ran `tsc` directly.
- In a clean Render install, Prisma Client had not been generated yet for that build step.

## Fix

- Updated `package.json`
  - `realtime:build` now runs:
    - `prisma generate && tsc -p realtime-server/tsconfig.json`

## Result

- Render can keep using the same build command:
  - `npm ci && npm run realtime:build`
- Prisma Client is generated before the standalone realtime TypeScript compilation starts.
