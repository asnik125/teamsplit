# TeamSplit MVP

Secure multi-user web app for TeamSplit: authentication, calendar/RSVP, staff team builder, and published teams. Sport-agnostic product branding (not soccer-specific).

**Local development and acceptance testing use a real Firebase project** (same backend path you will later connect to Vercel / `soccer.vanaku.com`). There is no Firebase Emulator support in this project.

## Prerequisites

- Node.js 20+ (22 recommended)
- npm 10+
- A Firebase project you create (Auth Email/Password + Firestore)
- Optional: Firebase CLI (`npm i -g firebase-tools`) only if you want to deploy rules/indexes from this repo

## Install

```bash
cd /Users/nick.asinovsky/Desktop/soccer
npm install
cp .env.example .env.local
```

Fill `.env.local` with your **real** Firebase Web App config (see below). Do not leave placeholders empty.

## Required environment variables

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Console → Project settings → Your apps → Web app |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | same |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | same |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | same |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | same |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | same |
| `NEXT_PUBLIC_APP_URL` | App base URL for email links (`http://localhost:3000` locally) |
| `RESEND_API_KEY` | Resend dashboard (server-only — never `NEXT_PUBLIC_*`) |
| `EMAIL_FROM` | Verified sender, e.g. `TeamSplit <notifications@teamsplit.vanaku.com>` |
| `CRON_SECRET` | Random secret; Vercel Cron sends it as `Authorization: Bearer …` |

Optional (player import / Admin SDK):

| Variable | Purpose |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | Absolute path to a Firebase/Google service account JSON |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Inline service account JSON (Vercel) |
| `CONFIRM_FIRESTORE_SEED` | Must be `true` to allow `npm run seed` to write to Firestore |
| `ALLOW_NOTIFICATION_SIMULATE` | When `true`, Admin can force-send scheduled types without waiting for the clock |

Missing client env vars cause a clear startup/runtime error — the app will not initialize Firebase with fake keys.

## Firebase Console setup (you perform)

1. Create a **new** Firebase project (do not reuse another Vanaku app DB unless you choose to).
2. Enable **Authentication → Sign-in method → Email/Password**.
3. Create a **Cloud Firestore** database.
4. Register a **Web app** in Project settings; copy the config values into `.env.local`.
5. Deploy security rules and indexes from this repo (from the project root, after `firebase use` / updating `.firebaserc`):
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   Or paste `firestore.rules` / `firestore.indexes.json` via the Console.
6. Create real users under **Authentication → Users** (no in-app Sign Up).
7. For each Auth user, create `users/{uid}` in Firestore:
   ```json
   {
     "uid": "<auth-uid>",
     "playerId": "<players doc id or null>",
     "displayName": "Name",
     "email": "user@example.com",
     "role": "admin",
     "emailNotifications": true,
     "active": true,
     "createdAt": "<ISO timestamp>",
     "updatedAt": "<ISO timestamp>"
   }
   ```
   Assign `role: "admin"` to your first account. Allowed roles: `admin` | `player`.
   Admins can promote other linked players to Admin (and demote them back) from Players.

   **Email notifications default:** new user docs should use `emailNotifications: true`.
   The sender requires an **explicit** `true` (existing users left at `false` from earlier
   README templates stay opted out until they enable the Profile toggle).
8. Optionally set `players/{playerId}.linkedUid` and `email` when linking a roster player to that Auth user.

## Import the 11 existing players / evaluations

Does **not** create Auth accounts.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json
export NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
export CONFIRM_FIRESTORE_SEED=true
npm run seed
```

This upserts `players` + `playerEvaluations` from `soccer_players_backup.json` (preserves existing `linkedUid` / `email` on re-run).

## Run locally

With `.env.local` filled and Firestore rules deployed:

```bash
npm run dev
```

Open http://localhost:3000

Sign in with a real Auth user you created. The app talks only to your real Firebase project.

## Roles

| Role | MVP permissions |
| --- | --- |
| `admin` | Full staff (games, evaluations, publish, promote/demote); also a Player |
| `player` | Calendar, RSVP, published teams only — never evaluations |

Sign In is email + password only (no Sign Up / invite / MFA UI).

## Data model

- `users/{uid}` — role, `playerId`, profile, `emailNotifications`
- `players/{playerId}` — roster (no ratings)
- `playerEvaluations/{playerId}` — **staff-only** ratings
- `games/{gameId}` — schedule (`seasonId`, date, time, location, status)
- `attendance/{gameId}_{playerId}` — RSVP
- `gameTeams/{gameId}` — published/draft teams (no ratings)
- `settings/app` — min players / attendance edit permission
- `settings/notifications` — email notification schedules (America/Vancouver)
- `notificationSends/{gameId}_{type}_{userId}` — per-recipient idempotency (Admin SDK only)
- `notificationDispatches/{gameId}_{type}` — per game+type completion marker
- `notificationRuns/{id}` — Admin-visible send history

Firebase is the single source of truth. No Google Sheets integration.

## Email notifications (MVP)

Uses **Resend** + **Vercel Cron** (no Firebase Functions).

| Rule | Default | Recipients |
| --- | --- | --- |
| Game reminder | 1 day before 7:00 PM Vancouver | Everyone (active + email + opt-in) |
| Maybe reminder | Game day 4:00 PM | Maybe only |
| Final status | Game day 6:00 PM | Everyone — Game ON if ≥6 Playing, else OFF |

Configure under **Admin → Notifications**. Cron: `GET/POST /api/cron/notifications` (requires `CRON_SECRET`).

### Local testing

1. Set `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL` in `.env.local`.
2. **Send Test Email** on Notifications → only the logged-in Admin.
3. Dev **Simulate** buttons force each of the 3 types for a selected game (no clock wait).
4. Or: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/notifications`

### Production still required (not done in this task)

1. Resend + verify domain DNS (SPF, DKIM) for `teamsplit.vanaku.com`.
2. `EMAIL_FROM=TeamSplit <notifications@teamsplit.vanaku.com>`
3. Vercel env: Resend, Cron secret, app URL, Firebase Admin credentials.
4. Deploy `vercel.json` cron (`*/5 * * * *`).
5. Redeploy Firestore rules.

## Security rules

Production rules live in `firestore.rules`. Deploy them before acceptance testing.

## Automated tests

```bash
npm test
```

Covers balancer, calendar, roles, notifications (timezone/recipients/final status), smoke.

## Build

```bash
npm run build
npm start
```

## Later deployment (you perform)

1. Push to GitHub when ready.
2. Create a Vercel project; set Firebase + Resend + Cron env vars.
3. Point domains when ready.

## Known limitations

- No public registration / invite / MFA / forgot-password UI
- First `admin` and all Auth users are created manually in Firebase Console
- Advanced season UI deferred (`seasonId` is on games)
- Browser Playwright suite not included
- Existing users with `emailNotifications: false` stay opted out until Profile enable

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Local app against real Firebase |
| `npm run seed` | Import 11 players + evaluations (requires service account + confirm flag) |
| `npm test` | Vitest unit/smoke tests |
| `npm run build` | Production build |

## Reference files (historical only)

- `soccer_player_evaluation_team_balancer.html`
- `soccer_players_backup.json`
- `SOCCER_MVP_REQUIREMENTS_v1.0.docx`
