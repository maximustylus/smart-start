# SMART START

SMART START is a job-search tracker and coach, with Stuart, an artificial intelligence (AI) assistant built on Claude. It is live at https://smartstart-careers.web.app and is built by one developer working with Claude in Claude Code.

This repository shows the code behind the app. It holds no user data: each user's records stay in their own account.

## What is here

| Path | What it is |
|---|---|
| `SmartStart/` | The progressive web app: `index.html`, `stuart.js`, service worker, privacy notice, terms, icons, guide and preview media |
| `functions/` | Cloud Functions for Stuart (`index.js`) and the guardrail tests (`test/`) |
| `firestore.rules`, `storage.rules` | Rules that let each user read and write only their own data |
| `firebase.json`, `.firebaserc` | Firebase configuration |
| `docs/Build_Stats.md` | How the first version was built, in numbers, as counted on 4 November 2026 |

The people, organisations and figures in the guide and preview images are sample content.

## How it works

- **Tracker:** applications with stage history, documents and dates, kept under `users/{uid}/` in Firestore and Cloud Storage in Singapore.
- **Fit check:** Stuart reads a job advertisement and the user's CV, then gives hard screens, keywords and a likelihood band with reasons. It gives no hiring probabilities.
- **Coaching and documents:** Stuart asks about the gaps, then drafts a tailored CV, resume and cover letter from the user's own CV and answers.
- **Inspection:** a second, separate check reads the built Word files as screening software would, and traces each figure and claim back to the CV.
- **The user decides:** Stuart drafts and the user sends. Nothing goes to an employer from the app.

## Guardrails

- **Containing the model:** code checks the model's output. It drops unknown roles, flags figures not found in the user's own text, and applies the user's rules.
- **Untrusted text:** advertisements and uploaded files are wrapped as data, never treated as instructions.
- **Keys:** the AI service key and the mail credentials live in Secret Manager, never in this repository or the app.
- **Limits:** each account has a monthly cost cap, enforced in the function as a hard stop.
- **Tests:** `npm test` in `functions/` runs before every functions deploy. The AI model is replaced by a stand-in that returns hostile output, so a change that weakens a guardrail stops the deploy.

The Firebase web configuration in `SmartStart/firebase-config.js` is public by design. Access is controlled by the sign-in and the rules above.

## Run the tests

```bash
cd functions && npm install && npm test
```

## Copyright

© 2026 Muhammad Alif. All rights reserved. This code is published to be read. It is not open source, and no licence to reuse it is granted.
