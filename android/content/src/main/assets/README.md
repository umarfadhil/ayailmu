# Bundled content assets

Layout (CR-ENG-1, CR-CFG-1):

```
config/app_config.json           app-level config, versioned
config/rules.<track>.json        per-track learning rules (P1)
packs/<subject>/<track>/v<N>.json content packs; item ids immutable; review_status gates visibility
audio/<track>/<item>.ogg         bundled clips (Arabic entry check, ~75 files, P7)
stickers/                        hand-drawn reward art references (P4/P6)
```

Only `review_status = "approved"` items are visible in `prod`; `demo` shows everything behind a banner (CR-ENG-2).
Every learner-facing string is a `{ "id": ..., "en": ... }` object (CR-I18N-1). `validatePacks` (P1) fails the build otherwise.
