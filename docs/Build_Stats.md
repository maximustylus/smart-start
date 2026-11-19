# SMART START: build statistics, 27 October to 17 November 2026

Counted from the git history and the source tree on 19 November 2026 (app 2.50.5). Earlier count: 4 November 2026.

| Measure | Value | How measured |
|---|---|---|
| Build window | 27 October to 17 November 2026, 22 calendar days, with commits on every one | first and last commit touching `SmartStart/` or `functions/` |
| Sittings | 61 | runs of commits with no gap over 90 minutes |
| Hours logged | about 84 | first to last commit of each sitting (thinking and testing before a sitting's first commit are not counted, so the true figure is higher) |
| Commits to the app | 222 (310 in the repository) | `git log` on `SmartStart/`, `functions/`, rules |
| Releases | 145 (2.0.0 to 2.50.5; earlier versions predate this history) | distinct release numbers in the commit subjects |
| Code | 9,288 lines: app 3,582, Stuart 1,967, Cloud Functions 2,452, tests 1,287 | `wc -l` |
| Cloud Functions | 29: 24 called by the app and five background jobs | `exports.` in `functions/index.js` |
| Automated tests | 108, all passing: 97 on the functions, run before every functions deploy, and 11 on the security rules | `npm test`, and the rules tests on the emulators |
| Simulations (as counted on 4 November) | sign-up 27 checks, gate 17, mail 8, busy 6, plus Stuart load and injection runs on the emulators | test records kept privately |
| Guide and preview images | 69 (36 guide, 33 preview, light and dark sets) and one film | `SmartStart/guide`, `SmartStart/preview` |
| Written records (as counted on 4 November) | 143 Markdown files (test reports, roadmap, data model, legal notes) | kept privately |
| People | one developer and one AI pair (Claude, in Claude Code) | |

Tools: Claude Code with Claude as the pair programmer; Firebase (Hosting, Authentication, Firestore, Cloud Storage, Cloud Functions, App Check, Secret Manager; Singapore region); the Claude API for Stuart (Sonnet 5.5 for quick work, Opus 5.5 for deep reads); Apple iCloud Mail for the app's emails; headless Chrome and Puppeteer for the simulations; the Firebase emulators; ffmpeg for the film; an AI voice for the narration; Python and shell for the tooling; the Smart Start brand guidelines v1.0 for the design.

Not counted: planning sessions before 27 October, and the earlier prototype that became version 1.
