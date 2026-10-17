# ai-memory — how to use this folder

Canonical project memory for AyaIlmu, synced via OneDrive and committed to git. Read in this order, stop as soon as you have what the task needs:

1. `PROJECT_OVERVIEW.md` — what we are building, hard constraints, decisions, milestones, open questions. (≤ 12 KB)
2. `CODE_RULES.md` — numbered rules `CR-<AREA>-<n>`; read only the sections the task touches. (≤ 40 KB)
3. `FILE_MAP.md` — where every file is and its stamp; the only place that records locations. (≤ 25 KB)
4. `MONETIZATION_SCHEME.md` — products, prices, free tier, obligations. (≤ 20 KB)
5. `ART_DIRECTION.md` — the hand-made visual standard and acceptance checklist. (≤ 15 KB)
6. `SESSION_LEARNINGS.md` — newest-first session log; grep by feature or date, never read whole. (≤ 60 KB active; older entries in `archive/`)

Rules of the folder
- Status stamps, always one of: PLANNED · IN SOURCE (not compiled) · COMPILED · DEVICE-TESTED · RELEASED vX · DROPPED (plus DECIDED/OPEN for decisions).
- One fact lives in one file. Elsewhere, link to it ("see CR-BIL-2"). Never paste the same paragraph twice.
- A learning that turns out to be durable becomes a rule or a file-map row and is deleted from SESSION_LEARNINGS.
- End of every session: update SESSION_LEARNINGS (≤ 12 lines), FILE_MAP for new/moved files, then run `python check_budget.py` from this folder. Over budget → compact before ending.
- Never store secrets, keystore passwords, API keys or personal data of testers here.
