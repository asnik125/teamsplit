# Changelog — TeamSplit MVP

## Latest

- Simplified roles to **`admin` | `player`** only (removed Owner).
- Calendar shows a clear **Create Game** action for Admins (links to Manage Games create form).
- Admins can promote/demote linked player accounts from the player detail page.
- Removed **all Firebase Emulator support** (client connections, env vars, scripts, emulator seed accounts, emulator rules tests, emulator README).
- Local `npm run dev` uses **real Firebase** via `.env.local` Web App config; missing env fails clearly.
- Seed imports **players + evaluations only** into real Firestore (no Auth user creation; requires service account + `CONFIRM_FIRESTORE_SEED=true`).
- Security rules file retained for deploy to the real project.

## Built (MVP)

- Next.js 15 + TypeScript + Tailwind
- Firebase Auth (email/password Sign In only) + Firestore
- Roles: `admin` | `player`
- Calendar: single + weekly series; independent games; `seasonId`
- RSVP, attendance, Team Builder (preserved snake draft), publish
- Email-ready notification boundary (noop)
- Vitest unit/smoke tests (balancer, calendar, roles)

## Out of scope / not performed by the agent

- Creating Firebase / Vercel / GitHub / DNS / email resources
- Git commits unless requested
