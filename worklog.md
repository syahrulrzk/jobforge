---
Task ID: 1
Agent: Super Z (main)
Task: Fix dashboard Activity Console — user complained it didn't show full logs

Work Log:
- Diagnosed: /api/dashboard hard-coded take:12 for recentActivity (806 total logs in DB), no full log view existed
- Upgraded /api/activity → full log endpoint: limit (max 1000), offset, action/status/source/search (q) filters, total count, byAction facets, distinct source list
- Created src/components/jobforge/activity.tsx → full terminal-style Activity Console view (newest at bottom, auto-follow + jump-to-latest, "load older" pagination, Export .log, status dots, full timestamps)
- Wired nav: ViewKey "activity" in store, sidebar Monitoring group item w/ TerminalSquare icon, header title/sub, shell renders ActivityView
- Dashboard: recentActivity take 12→30, "full log →" button in console card header + click-through to activity view

Stage Summary:
- Full logs now accessible via sidebar "Activity Console" (Monitoring group)
- API verified: default 200/806 logs, action=error 13, q=scrape 97, status=failed 15 — all filters OK
- tsc clean for changed files (remaining errors are pre-existing in examples/, skills/, engine.ts:460)
