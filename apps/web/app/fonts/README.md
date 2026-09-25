# Vendored web fonts

Geist and Geist Mono, latin subset, as variable `woff2` files. `app/layout.tsx`
loads them through `next/font/local`, so the web build never talks to
`fonts.googleapis.com`.

## Why these are vendored

`next/font/google` downloads the stylesheet from Google **at build time**. When
that request misbehaves, Turbopack fails the whole build with:

```
Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
Error while looking up import map: next/font/google queries have exactly one entry
```

That is what killed the deploy of #529 (Actions run #237): steps 1–9 passed, the
build died, and the "Deploy web worker" step was skipped — so production kept
serving the previous commit and the merge looked like it had done nothing.
Reading the fonts from disk removes that failure mode: the build is offline and
byte-for-byte deterministic.

| File | Family | Subset | Weights | Size |
| --- | --- | --- | --- | --- |
| `geist-latin.woff2` | Geist | latin | 100–900 (variable) | 29 KB |
| `geist-mono-latin.woff2` | Geist Mono | latin | 100–900 (variable) | 23 KB |

Only `latin` is vendored because that is the only subset the app requested
before (`subsets: ["latin"]` in the old `next/font/google` call). Text outside
that range falls back exactly as it did. Both files are variable fonts — Google
serves the *same* latin file for weights 400, 500, 600 and 700 — which is why
one file per family is enough; `weight: "100 900"` in `layout.tsx` is the axis
those files actually carry.

## Provenance

Taken from a `next/font/google` build's own download cache
(`.next/static/media/`), i.e. the same bytes production served before the
switch. Source: Google Fonts, Geist v5 / Geist Mono v6, latin subset.

| File | sha256 |
| --- | --- |
| `geist-latin.woff2` | `9b6f5ff45b278c744b5f379a2c4ecbaf858a842b8eaf82ac8d21b699ca16c608` |
| `geist-mono-latin.woff2` | `5f3d6ad60f29d6cb708414ec6887163d63bf197377ef5417d2483ff31ace6c3b` |

Licence: Geist is released under the SIL Open Font License 1.1 (Vercel), which
permits bundling and self-hosting.

## Refreshing

Fonts only change when the upstream release does, so this is a deliberate,
rare step. Ask Google for the woff2 URLs (a browser-like `User-Agent` is
required, otherwise you get `ttf`), then take the `/* latin */` entry for each
family:

```bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
curl -s -H "User-Agent: $UA" \
  'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap'
curl -s -H "User-Agent: $UA" \
  'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&display=swap'
```

Download each latin `src` URL over the new files, confirm they still start with
the `wOF2` magic, refresh the hashes above, and re-run the build. Verify the
result renders with the build's own output rather than a dev server, since the
whole point of vendoring is to make the production build the same everywhere:

```bash
cd apps/web && npx opennextjs-cloudflare build
```

The emitted stylesheet under `.next/static/chunks/` should contain the
`@font-face` blocks with `src: url(../media/….woff2)` pointing at files copied
into `.next/static/media/`, and no reference to `fonts.googleapis.com`,
`fonts.gstatic.com`, or the `@vercel/turbopack-next/internal/font/google/font`
virtual module.
