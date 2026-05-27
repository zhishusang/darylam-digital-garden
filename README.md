# Dary Lam Digital Garden

An Astro-based personal site for essays, notes, recipes, travel stories, and the evolving "weapons" archive.

## Stack

- Astro 5
- MDX content collections
- Static output for Cloudflare Pages

## Local development

```bash
npm install
npm run dev
```

## Syncing from Obsidian

The repo already includes synced public content, so deployment does not depend on local files.

If you want to refresh `foodie` or `weapons` from a local Obsidian vault, set `OBSIDIAN_ROOT` first:

```bash
OBSIDIAN_ROOT="/path/to/your/Obsidian vault" npm run sync
```

Useful variants:

```bash
OBSIDIAN_ROOT="/path/to/your/Obsidian vault" npm run sync:foodie
OBSIDIAN_ROOT="/path/to/your/Obsidian vault" npm run sync:weapons
npm run dev:sync
npm run build:sync
```

Optional overrides:

- `WEAPONS_SOURCE_REL`
- `FOODIE_SOURCE_REL`

## Project structure

- `src/pages/` routes
- `src/content/` public content collections
- `public/` static assets
- `scripts/` local sync scripts

## Deployment

Cloudflare Pages:

- Build command: `npm run build`
- Output directory: `dist`
- Node.js version: `20`

The site URL is set in `astro.config.mjs` as `https://darylam.com`.
