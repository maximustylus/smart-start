# SMART START: build statistics, 27 October to 4 November 2026

Counted from the git history and the source tree on 4 November 2026.

| Measure | Value | How measured |
|---|---|---|
| Build window | 27 October to 4 November 2026, 9 calendar days | first and last commit touching `SmartStart/` or `functions/` |
| Sittings | 21 | runs of commits with no gap over 90 minutes |
| Hours logged | about 40 | first to last commit of each sitting (thinking and testing before a sitting's first commit are not counted, so the true figure is higher) |
| Commits to the app | 121 (193 in the repository) | `git log` on `SmartStart/`, `functions/`, rules |
| Releases | 73 (2.0.0 to 2.25.0; earlier versions predate this history) | distinct `APP_VERSION` values in the history |
| Code | 5,472 lines: app 2,912, Stuart 1,045, Cloud Functions 1,331, guardrail tests 184 | `wc -l` |
| Cloud Functions | 14 | `exports.` in `functions/index.js` |
| Guardrail tests | 19, run before every functions deploy | `npm test` |
| Simulations | sign-up 27 checks, gate 17, mail 8, busy 6, plus Stuart load and injection runs on the emulators | test records kept privately |
| Guide and preview images | 52 (36 guide, 16 preview, light and dark sets) and one 60-second film in four cuts | `SmartStart/guide`, `SmartStart/preview` |
| Written records | 143 Markdown files (test reports, roadmap, data model, legal notes) | kept privately |
| People | one developer and one AI pair (Claude, in Claude Code) | |

Tools: Claude Code with Claude as the pair programmer; Firebase (Hosting, Authentication, Firestore, Cloud Storage, Cloud Functions, App Check, Secret Manager; Singapore region); the Claude API for Stuart (Sonnet 5.5 for quick work, Opus 5.5 for deep reads); Apple iCloud Mail for the app's emails; headless Chrome and Puppeteer for the simulations; the Firebase emulators; ffmpeg for the film; an AI voice for the narration; Python and shell for the tooling; the Smart Start brand guidelines v1.0 for the design.

Not counted: planning sessions before 27 October, and the earlier prototype that became version 1.
