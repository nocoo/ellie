# Ellie brand assets

A mineral-gray elephant raises its trunk toward one small folded paper airplane. Broad ear and cheek planes carry the identity; the real neck base continues below the viewfinder.

## Use by surface

| Surface | Asset | Treatment |
| --- | --- | --- |
| README header / large gallery | `assets/brand/icon-rounded.png` | Selected rounded presentation, shown at 128 px in README |
| Admin sidebar, both states | `apps/admin/public/logo-24.png` | Transparent foreground with no additional mask. |
| Other small admin marks | `apps/admin/public/logo-80.png` | Transparent foreground. |
| Admin login | `apps/admin/public/logo-192.png` | Transparent UI mark shown at 96 px; the old circular wrapper is removed. This is not a PWA icon. |
| Admin browser | `apps/admin/src/app/icon.png`, `favicon.ico` | Transparent 32 px PNG and complete 16/32 px ICO through Next.js file metadata. |
| Admin Apple touch | `apps/admin/src/app/apple-icon.png` | Opaque square presentation at 180 px. |
| Admin social | `apps/admin/src/app/opengraph-image.png` | Rounded presentation on the existing 1200 × 630 dark canvas. |
| Independent forum site identity | `ForumLogo`, `general.site.logo_light`, `general.site.logo_dark`, and `apps/web/src/app/favicon.ico` | The deployed forum has its own configured wordmark/favicon. These are not the elephant application identity and are preserved. |

Root `logo.png` is the canonical 2048 × 2048 transparent foreground. `assets/brand/icon.png` and `icon-rounded.png` are separate square and rounded presentation masters. Small application and browser marks use the transparent foreground without a baked-in background, glow, color filter, or extra circular mask. Larger README, native-install, and social surfaces may use the designed background according to their platform contract.

## Rebuild and provenance

```sh
uv run --with pillow python scripts/resize-logos.py
```

One native image request. Azure Foundry `gpt-image-2`, native 2048 × 2048; selected study `2026-09-07-01`, finishing `01`. The owner delegated intermediate acceptance for this named five-project batch. The recorded agent inspection is not a claim that the owner reviewed the returned image bytes.

The smallest protected-feature clearance is **148.5 px** against the actual 23% rounded outline. Intentional lower neck/shoulder intersections are recorded separately; no expressive feature or accessory is clipped. The selected extraction preserves every fully opaque native RGB pixel. All artwork, background, grain, and shadow layers remain separate in the Hexly study.

The presentation uses **Mineral listening folds**, with base `#537b93`, light `#a9c5cf`, shade `#2c4c65`, and motif `#19374f`. Product UI colors remain independent. [source.json](source.json) records exact master hashes and the prior source identity.

- [Individual before/after page](https://hexly.ai/logos/ellie)
- [Complete generation and finishing archive](https://github.com/nocoo/hexly.ai/tree/main/artwork/logo-family/ellie/2026-09-07-01)
- [Local static review](https://index.dev.hexly.ai/artwork/logo-family/ellie/2026-09-07-01/review.html)
- [Shared usage SOP](https://github.com/nocoo/hexly.ai/blob/main/docs/07-logo-usage-sop.md)
