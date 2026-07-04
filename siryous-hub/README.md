# Siryous Hub

The landing page / directory for all Siryous projects. It owns the **`siryous.app`** apex
domain and simply links out to each project by URL — so projects can live anywhere
(Vercel, Netlify, GitHub Pages, a VPS, etc.). The hub does not care where a project is hosted.

## Structure
- `index.html` — the directory page. Each project is a `<a class="card">` block.

## Adding a project
Copy an existing `<a class="card">...</a>` block in `index.html` and update the title,
description, and `href`. The `href` can point to any URL.

## Run locally
```bash
npm install
npm run dev
```
Then open http://localhost:3000.

## Deploy (Vercel)
1. Push this folder to its own GitHub repo.
2. Import it as a new Vercel project.
3. Assign the `siryous.app` (and `www.siryous.app`) domain to this project.
   - The apex now serves this hub directly — no redirect config is needed.
