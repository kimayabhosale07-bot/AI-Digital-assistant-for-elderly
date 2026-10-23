# CareWise Backend

The CareWise backend uses Node.js, Express, Firebase Admin, and Firestore for account profiles, medicine schedules, appointments, and health logs. A `node-cron` scheduler maintains overdue medicine statuses and resets recurring schedules daily.

## Setup

Use Node.js 20 or newer. From this directory, install dependencies:

```sh
npm install
```

Copy `.env.example` to `.env` and configure `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` with a Firebase service account. Set `PORT` as needed. `MEDICINE_GRACE_PERIOD_MIN` controls when pending medicine schedules change to `missed` (default: 30 minutes). For natural-language chat, `ASSISTANT_PROVIDER=auto` uses Gemini, then Groq, then OpenAI when configured, trying each at most once; set it to `gemini`, `groq`, or `openai` to select one provider. Store all provider keys only in this backend `.env`. Groq text defaults to `openai/gpt-oss-20b`; multilingual transcription defaults to `whisper-large-v3-turbo`. Groq’s audio route accepts raw browser recordings up to 10 MB (`webm`, `ogg`, `mp4`, `mpeg/mp3`, `wav`, or `flac`). `GEMINI_REQUEST_TIMEOUT_MS` is the total chat deadline (default: 30000 ms, maximum: 60000 ms); `GROQ_REQUEST_TIMEOUT_MS` bounds transcription and also defaults to 30000 ms. Provider limits depend on account and model; no free or unlimited quota is assumed. Browser speech synthesis remains the response voice, including for Hindi and Marathi; Groq documents TTS voices for English and Saudi Arabic only. Without a configured provider key, the assistant returns a clear unavailable message and does not propose record actions.

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
| POST | `/health-log` | Record a validated blood pressure, heart rate, blood sugar, body temperature, or SpO₂ measurement. Legacy dashboard heart-rate/steps submissions remain supported. |
| GET | `/health-log/:userId` | List health-log records for the specified existing profile, newest first. |
| POST | `/assistant/chat` | Return a conversational response or a medicine/appointment draft from recent chat and dashboard record context. The model key is backend-only; this endpoint does not save records. |
| POST | `/assistant/transcribe` | Transcribe a browser audio recording with Groq Whisper; accepts validated raw audio up to 10 MB. |

## Firestore data

The backend uses `users`, `medicines`, `medicine_doses`, `appointments`, and `healthLogs`. Health measurement documents include `logId`, `userId`, `type`, `unit`, `timestamp`, and `createdAt`; blood pressure uses `systolic` and `diastolic`, scalar types use `value`, blood sugar may include its required `context`, and any record may include `notes`. Existing legacy health documents are read without migration. Saved contact records remain available in user profiles for caregiver/contact functionality. Existing Firestore documents are not deleted by this change.

The scheduled medicine task marks overdue pending schedules as missed and logs due schedules to the backend console. The daily task resets recurring medicine statuses to pending. Neither task sends messages or writes delivery-history records.

## Environment

`FIRESTORE_NO_PROXY_HOSTS` and `GOOGLE_API_NO_PROXY_HOSTS` may be configured when the local network requires specific Google API proxy bypasses. Keep service-account credentials in the untracked `.env` file; do not commit them.

The dashboard's existing Profile ID/phone session is local-only and is not verified by the backend as a signed identity. The assistant receives only the record context already loaded by the dashboard; saving still uses the existing medicine and appointment APIs after explicit confirmation. Those legacy APIs are not strong authorization boundaries.
