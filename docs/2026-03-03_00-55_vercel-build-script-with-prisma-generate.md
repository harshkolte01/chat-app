# Vercel-Build-Script-With-Prisma-Generate

## Context
- Updated build command so Prisma client generation runs before Next.js build.
- This matches requested deployment order for Vercel: install -> Prisma command -> build.

## Changes
- Updated `package.json` script:
  - `build` changed from `next build` to `prisma generate && next build`

## Validation
- Attempted local `npm run build`.
- Build command structure is correct, but local verification could not complete in this environment due blocked download of Prisma engine binaries from `binaries.prisma.sh`.
- On Vercel (with normal internet access), this sequence should run as intended.
