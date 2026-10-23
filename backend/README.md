# CareWise Backend

The CareWise backend uses Node.js, Express, Firebase Admin, and Firestore for account profiles, medicine schedules, appointments, and health logs. A `node-cron` scheduler maintains overdue medicine statuses and resets recurring schedules daily.

## Setup

Use Node.js 20 or newer. From this directory, install dependencies:

```sh
npm install
```

Copy `.env.example` to `.env` and configure `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` with a Firebase service account. Set `PORT` as needed. `MEDICINE_GRACE_PERIOD_MIN` controls when pending medicine schedules change to `missed` (default: 30 minutes).

Start the backend with `npm run dev` or `npm start`. Run the offline unit tests with `npm test`; the tests use in-memory stubs and do not access Firebase or send external messages. `npm run diagnose:firestore` performs a read-only connectivity check.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/register` | Create or update a user profile, including the profile's saved family and caregiver contacts. |
| GET | `/user/by-phone/:phone` | Look up a profile by phone number. |
| GET | `/user/:userId` | Retrieve a user profile. |
| POST | `/medicine` | Add a recurring medicine schedule. |
| GET | `/medicine/:userId` | List a user's medicine schedules and optional daily dose status. |
| PUT | `/medicine/:medId/status` | Update a recurring medicine status. |
| POST | `/medicine/:medId/dose` | Update an individual day's dose status. |
| POST | `/appointment` | Add an appointment. |
| GET | `/appointment/:userId` | List a user's appointments. |
| POST | `/health-log` | Record heart rate and steps; readings outside 60–100 bpm are flagged for review. |

## Firestore data

The backend uses `users`, `medicines`, `medicine_doses`, `appointments`, and `healthLogs`. Saved contact records remain available in user profiles for caregiver/contact functionality. Existing Firestore documents are not deleted or migrated by this change.

The scheduled medicine task marks overdue pending schedules as missed and logs due schedules to the backend console. The daily task resets recurring medicine statuses to pending. Neither task sends messages or writes delivery-history records.

## Environment

`FIRESTORE_NO_PROXY_HOSTS` and `GOOGLE_API_NO_PROXY_HOSTS` may be configured when the local network requires specific Google API proxy bypasses. Keep service-account credentials in the untracked `.env` file; do not commit them.
