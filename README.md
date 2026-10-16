# AfyaTrack PHO: Web App (MVP)

Ward level work management for Public Health Officers.
Combined MVP: **planner and reminders + core registers and field records + weekly and monthly reports**, built from the *AfyaTrack PHO Product Requirements v1.1* (9 October 2026).

> Synthetic demo data only. Do not load real resident, patient or enforcement records until the privacy and governance checkpoint (spec section 10.1) is cleared.

---

## 1. What is included

| Area | Screens (spec ref) |
|---|---|
| Sign in | Sign in page, forgot password, reset password, change password (S01). No public sign up. |
| Home dashboard | Today, overdue, upcoming, follow ups due, weekly progress against targets, register alerts (S02) |
| Planner | List and week calendar, create/edit/assign, start, complete, postpone (needs new date + reason), cancel (needs reason), full history (S03, S04) |
| Activity log | Completed work records; the single source for report counts (S05) |
| Registers | Food premises, food handlers, households, water sources, healthcare facilities, with search and filters, profiles, duplicate warning, deactivation (S06 to S10, S19) |
| Inspections | Configurable checklists, findings, corrective actions, deadlines, automatic follow ups and revisit task; each inspection is an immutable dated record (S11, S19) |
| Follow up queue | Overdue, due in 7 days, open, completed; revisit outcome compliant / partial / non compliant (S12) |
| Notice drafts | Approved templates, edit while draft, ward lead approval, issue and service recorded separately, print/PDF and Word export (S13) |
| Reports | Weekly and monthly, target vs achievement (N/A rule), tasks and follow ups shown separately, officer and location breakdown, all register summaries, click through to source records, Excel/CSV and print/PDF export (S14) |
| Team | Ward lead workload view and facilities with overdue sanitation actions (S15) |
| Settings | Targets, users and roles, locations, categories, notice templates, checklist versions, audit history (S16 to S18) |
| Reminders | In app reminders generated every minute (task reminder time, overdue, follow up due) |

The five excluded areas (Innovation and Best Practices, Support Supervision, HIF Collection, Annual Performance Review, Port Health Services) are not present anywhere. Offline capture is not included (internet required, spec AC-18).

### Android app (phase 2)

The Flutter Android app is in [`mobile/`](mobile/README.md). It uses this same backend and permissions. Quick start:

```bash
cd mobile
flutter pub get
dart run tool/setup_android.dart
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000
```

`codemagic.yaml` builds a release APK in Codemagic.

## 2. Tech stack

* **Backend:** Node.js + Express, **Cloud Firestore** through the Firebase Admin SDK, JWT sessions (httpOnly cookie for web, Bearer token for the Android app), bcrypt password hashing, helmet, rate limited login.
* **Database access:** only the server talks to Firestore (service account). `firestore.rules` denies all direct client access, so roles and ward scoping stay enforced in one place.
* **Frontend:** React 18 + Vite + Tailwind CSS + React Router, responsive (bottom navigation on phones).
* **One backend, one data model:** every permission is enforced server side and scoped to the user's ward, so the Android app can reuse the same API.

## 3. Requirements

* Node.js **18.18 or newer** (20 LTS or 22 LTS recommended). Check with `node -v`.
* npm (comes with Node).
* Windows, macOS or Linux.
* A **Firebase project** with Cloud Firestore enabled (free Spark plan is enough for a pilot), or the local Firestore emulator. For a quick look without Firebase use the in memory mode (`npm run dev:memory`).

## 4. Firebase setup (one time)

1. Go to https://console.firebase.google.com, **Add project** (for example `afyatrack-pho`). Google Analytics is not needed.
2. **Build → Firestore Database → Create database.** Choose **Production mode** and a location close to Kenya (for example `europe-west1` or `me-central1`). The location cannot be changed later.
3. **Project settings → Service accounts → Generate new private key.** Save the file in the project folder as `firebase-service-account.json`. It is already in `.gitignore`; never commit or share it.
4. Copy `.env.example` to `.env` and set:
   ```
   FIREBASE_PROJECT_ID=afyatrack-pho
   FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json
   ```
   On hosts where you cannot upload files (Render, Railway), put the whole JSON on one line in `FIREBASE_SERVICE_ACCOUNT_JSON` instead.
5. Lock down direct access with the included rules (all access goes through the API). Either paste `firestore.rules` into **Firestore → Rules → Publish**, or with the Firebase CLI:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add          # pick your project (updates .firebaserc)
   npm run deploy:rules
   ```
6. Load the demo data: `npm run seed`. No indexes need to be created: the API only uses equality filters, which Firestore serves from its automatic indexes.

### How the data is stored

Each former SQL table is a top level Firestore collection with the same field names (`users`, `memberships`, `wards`, `locations`, `categories`, `tasks`, `task_history`, `activity_records`, `follow_ups`, `food_premises`, `food_handlers`, `households`, `water_sources`, `water_samples`, `healthcare_facilities`, `checklists`, `inspections`, `inspection_findings`, `notice_templates`, `notice_drafts`, `targets`, `report_runs`, `reminders`, `audit_events`, `password_resets`, `organisations`). Documents keep numeric ids (document id = the number as text) from counters in `_counters`, so the website and Android app API did not change. `_unique` holds one time keys that guarantee an inspection or task is counted once in reports and a reminder is sent once.

### Moving existing SQLite data

If you already have records in the old `data/afyatrack.db`, copy them once into an empty Firestore:

```bash
npm i better-sqlite3
npm run migrate:sqlite -- data/afyatrack.db
```

## 5. Run it locally (development)

```bash
cd afyatrack-pho
npm install            # install dependencies
cp .env.example .env   # Windows: copy .env.example .env, then fill in the Firebase settings (section 4)
npm run seed           # load synthetic demo data into Firestore
npm run dev            # starts API on :4000 and web app on :5173
```

Open **http://localhost:5173** and sign in.

**Without a Firebase project:** `npm run dev:memory` runs the API on an in memory database preloaded with the demo data (lost when you stop it). Good for demos and UI work.

**With the Firestore emulator** (needs Java 11+ and `firebase-tools`): run `npm run emulator` in one terminal, set `FIRESTORE_EMULATOR_HOST=localhost:8080` in `.env`, then `npm run seed` and `npm run dev`. The emulator UI is at http://localhost:4001.

`npm run dev:api` and `npm run dev:web` start the two halves separately if you prefer two terminals.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Ward PHO (ward lead) | lead@afyatrack.test | Lead@2026 |
| PHO / Officer | officer@afyatrack.test | Officer@2026 |
| PHO / Officer | officer2@afyatrack.test | Officer@2026 |
| Officer in another ward (scope test) | ukunda@afyatrack.test | Officer@2026 |
| Read only reviewer | reviewer@afyatrack.test | Reviewer@2026 |
| System Administrator | admin@afyatrack.test | Admin@2026 |
| Deactivated (sign in must fail) | inactive@afyatrack.test | Officer@2026 |

In development the sign in page shows one tap demo buttons. They are hidden in production builds unless `VITE_SHOW_DEMO_ACCOUNTS=true` is set at build time.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | API (auto restart) + web app with hot reload |
| `npm run dev:memory` | Same, on an in memory database with demo data (no Firebase needed) |
| `npm run dev:api` / `npm run dev:web` | Start only the API or only the web app |
| `npm run seed` | Load demo data into Firestore (skips if users exist) |
| `npm run reset-db` | Delete all AfyaTrack collections and reseed (refused in production without `--force`) |
| `npm run emulator` | Start the local Firestore emulator |
| `npm run deploy:rules` | Publish `firestore.rules` to your Firebase project |
| `npm run migrate:sqlite -- <file>` | One time copy of an old SQLite database into Firestore |
| `npm test` | Automated tests: calculations, permissions and key workflows (20 tests, run on the in memory Firestore stand in) |
| `npm run build` | Build the web app into `dist/` |
| `npm start` | Production server (serves API and built web app on one port) |
| `npm run backup` | JSON export of all AfyaTrack collections to `data/backups/` |
| `npm run restore -- <file>` | Replace the database with a backup (stop the server first) |

## 6. Production deployment

1. Copy the project to the server (or clone your repository) and run `npm ci`.
2. Create `.env` from `.env.example` and set at least:
   * `JWT_SECRET` to a long random value (the server refuses to start in production without it):
     `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   * `COOKIE_SECURE=true` (you must serve over HTTPS)
   * `APP_URL=https://your-domain`
   * `PORT=4000`
   * `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT` (upload the key file to the server with `scp`, permissions `chmod 600`) or `FIREBASE_SERVICE_ACCOUNT_JSON`
3. Build and create the first data:
   ```bash
   npm run build
   npm run seed        # for a pilot, then sign in as admin and change all passwords
   ```
   For live use, start from an empty database instead: run `npm run seed`, sign in as admin, invite the real users, deactivate the demo accounts and remove demo records, or ask the developer for a clean "admin only" seed.
4. Start it with a process manager:
   ```bash
   npm i -g pm2
   pm2 start "npm start" --name afyatrack
   pm2 save && pm2 startup
   ```
5. Put Nginx (or Caddy) in front for HTTPS:
   ```nginx
   server {
     server_name pho.example.go.ke;
     location / { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host;
                  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                  proxy_set_header X-Forwarded-Proto $scheme; }
   }
   ```
   Then `sudo certbot --nginx -d pho.example.go.ke`.

Works on any VPS (DigitalOcean, Linode, a county server) and on platforms with temporary disks (Render, Railway, Cloud Run), because the data now lives in Firestore, not on the server. Run only ONE instance of the reminder job per environment if you scale out (duplicates are prevented anyway by `_unique` keys).

## 7. Backups and restore (AC-16)

* **Backup:** `npm run backup` exports every AfyaTrack collection to one JSON file while the app is running. The newest `BACKUP_KEEP` files are kept (default 30).
* **Firestore managed protection (recommended for live data):** on the Blaze plan enable **Point in time recovery** (7 days) and scheduled **managed exports** to a Cloud Storage bucket (Firestore → Disaster recovery). Keep the JSON backup as well; it is easy to inspect and restore.
* **Schedule daily** (Linux cron, 01:30 Nairobi time):
  ```
  30 1 * * * cd /srv/afyatrack-pho && /usr/bin/npm run backup >> data/backup.log 2>&1
  ```
  Copy `data/backups/` off the server too (object storage or another machine).
* **Restore:** stop the app (`pm2 stop afyatrack`), run `npm run restore -- data/backups/afyatrack-YYYYMMDD-HHMMSS.json`, start the app. The restore first saves the current data to `data/backups/before-restore-<time>.json`, then replaces all AfyaTrack collections with the backup.
* **Test it** before pilot handover: back up, add a test record, restore, confirm the record is gone and key records are intact.

## 8. Password reset

There is no public sign up. The System Administrator invites users in **Settings → Users and roles**; a temporary password is shown once.

* **Forgot password** on the sign in page creates a one hour reset link. No email provider is connected in this MVP, so the link is written to the server log (`pm2 logs afyatrack`) for the administrator to send. Connecting email (or SMS as a costed option) is a later step.
* Admins can also generate a new temporary password from the users list.

## 9. Roles and permissions (enforced server side)

| Action | Officer | Ward PHO | Admin | Reviewer |
|---|:-:|:-:|:-:|:-:|
| See own tasks, create tasks for self | ✓ | ✓ | ✓ | view |
| Assign tasks to others, delete tasks | | ✓ | ✓ | |
| Create/update registers, inspections, follow ups, samples | ✓ | ✓ | ✓ | |
| Deactivate register entries | | ✓ | ✓ | |
| Draft notices | ✓ | ✓ | ✓ | |
| Approve notices | | ✓ | ✓ | |
| Own reports | ✓ | ✓ | ✓ | |
| Team reports, team view, targets, locations | | ✓ | ✓ | reports only |
| Users, categories, templates, checklists | | | ✓ | |
| Audit history (read only) | | ward | all | ward |

Restricted personal fields (premises owner contact, handler identifiers) are masked for reviewers.

## 10. How report counting works

* Achievements come only from **activity records** dated in the period; each record counts once.
* An inspection creates exactly one activity record and completing a task can create at most one (enforced with one time `_unique` keys in Firestore), so the same event is never counted twice.
* Achievement % = achieved ÷ target × 100 when target > 0. No target or a zero target shows **N/A**.
* Tasks, follow ups, inspection visits, distinct entities and water samples are reported as separate counts.
* Every figure in the activity table opens the source records behind it.
* Generated reports are labelled **Draft, not officially approved**.

## 11. Project structure

```
afyatrack-pho/
├─ server/
│  ├─ index.js          Express app, static hosting, reminder job
│  ├─ firestore.js      Firebase Admin SDK connection (service account, emulator or in memory)
│  ├─ store.js          Data layer: collections, numeric ids, equality queries, unique keys
│  ├─ ctx.js            Per request loader that joins ward data in memory
│  ├─ memory-firestore.js  In memory Firestore stand in for tests and demos
│  ├─ auth.js           JWT sessions, ward scoping, role checks
│  ├─ registers.js      Register definitions and validation
│  ├─ reports.js        Report calculations and CSV export
│  ├─ routes/           auth, work (tasks, activities, follow ups, dashboard, team),
│  │                    records (registers, samples, inspections, notices), admin (users, targets, reports, audit)
│  ├─ seed.js           Synthetic demo dataset
│  ├─ backup.js         JSON backup and restore
│  ├─ migrate-sqlite.js One time import from the old SQLite database
│  └─ tests/            node:test suites
├─ client/              React app (pages, components, lib)
├─ mobile/              Flutter Android app (phase 2)
├─ codemagic.yaml       Android CI build
├─ firebase.json, firestore.rules, firestore.indexes.json, .firebaserc   Firebase project config
├─ .env.example
└─ package.json
```

## 12. API overview (for the Android app)

All endpoints are under `/api`, JSON in and out. Send `Authorization: Bearer <token>` (from `POST /api/auth/login`) and optionally `X-Ward-Id` to choose the ward.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/forgot`, `POST /auth/reset`, `POST /auth/change-password` |
| Lookups / home | `GET /lookups`, `GET /dashboard`, `GET /reminders`, `POST /reminders/read-all` |
| Tasks | `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id` |
| Activities | `GET/POST /activities`, `DELETE /activities/:id` |
| Follow ups | `GET/POST /follow-ups`, `PATCH /follow-ups/:id` |
| Registers | `GET/POST /registers/:type`, `GET/PATCH /registers/:type/:id` (`premises`, `handler`, `household`, `water_source`, `facility`) |
| Samples | `POST /registers/water_source/:id/samples`, `PATCH /samples/:id` |
| Inspections | `GET /checklists/:type`, `GET/POST /inspections`, `GET /inspections/:id`, `PATCH /findings/:id` |
| Notices | `GET/POST /notices`, `GET/PATCH /notices/:id`, `POST /notices/:id/approve|issue|serve|withdraw`, `GET /notices/:id/word` |
| Reports | `GET /reports`, `GET /reports/source`, `GET /reports/export.csv` |
| Admin | `/users`, `/wards`, `/locations`, `/categories`, `/targets`, `/templates`, `/checklists`, `/audit` |

## 13. Known limits of this MVP / next steps

* No email, push or SMS delivery yet (in app reminders only).
* PDF export uses the browser's Print → Save as PDF; Excel export is CSV (opens in Excel).
* Notice and checklist wording is placeholder text that must be validated with the county.
* Offline capture and later modules (surveillance, vector control, school health, health promotion, healthcare waste, preparedness) are not built yet.
* Ward level queries load the ward's records and filter in memory. This is fast for a ward pilot (thousands of records). Before county wide scale, add date range filters with composite indexes on the busiest collections (`activity_records`, `tasks`, `audit_events`).
* Sign in uses AfyaTrack's own accounts stored in Firestore. Moving to Firebase Authentication (email link, phone OTP) is a possible later step.
#   A F Y T R A C K  
 