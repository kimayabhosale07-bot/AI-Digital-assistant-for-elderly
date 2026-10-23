# CareMate — AI Digital Personal Assistant for Elderly

CareMate is a voice-first, accessible digital healthcare companion designed specifically for senior citizens. It simplifies everyday health management with medicine schedules, doctor appointments, health vitals monitoring, and family and caregiver contacts.

## Project Purpose & Vision

CareMate is designed to feel like a **calm digital companion** rather than a complex hospital-management dashboard. 
The application prioritizes:
- **Voice-First Interaction**: Primary interaction through a friendly Web Speech API voice assistant.
- **Extreme Accessibility**: Atkinson Hyperlegible typography, minimum 18px body font, 56px+ touch targets, and high contrast.
- **Dual Status Communication**: Status is never communicated using color alone — always paired with prominent icons and clear text labels.
- **Shallow Navigation**: Persistent navigation with no complex nested menus.

## Technology Stack

- **Frontend**: Plain HTML5, Vanilla CSS3 (Custom Design System with CSS Variables), Vanilla JavaScript (Modular ES6).
- **Voice Capabilities**: Web Speech API (`SpeechRecognition` for voice input, `SpeechSynthesis` for spoken output).
- **Backend**: Node.js, Express, Firebase Firestore, and node-cron for medicine schedule maintenance.

## Repository & Folder Structure

```text
/
├── README.md
├── .gitignore
├── package.json
│
└── frontend/
    ├── index.html              (Root fallback redirect to /pages/index.html)
    │
    ├── css/
    │   ├── variables.css       (Color palette, Atkinson Hyperlegible font scale, 56px+ touch targets)
    │   ├── layout.css          (Responsive sidebar/bottom nav and toast live region)
    │   └── components.css      (Cards, 64px+ buttons, mic 5 UI states)
    │
    ├── js/
    │   ├── api.js              (API abstraction layer for profiles, medicines, appointments, and health logs)
    │   ├── voice.js            (Web Speech API wrapper: idle/listening/processing/speaking/error)
    │   ├── reminders.js        (Medicine & appointment list rendering, mark taken/missed)
    │   ├── health.js           (Vitals logger, threshold check, and neutral attention flagging)
    │   └── app.js              (Shared layout initializers, navigation active state, toast feedback)
    │
    ├── pages/
    │   ├── index.html          (Onboarding & step-by-step setup flow)
    │   ├── dashboard.html      (Home screen: voice assistant mic, schedule summary, quick actions)
    │   ├── reminders.html      (Medicine list & add/edit form with status badges)
    │   ├── appointments.html   (Doctor visits list & schedule form)
    │   ├── health.html         (Health status cards, vitals logger form, & history log)
    │   └── contacts.html       (Family and caregiver contacts)
    │
    └── assets/
        └── icons/
```

## How to Run Locally

1. Clone the repository:
   ```bash
   git clone https://github.com/kimayabhosale07-bot/AI-Digital-assistant-for-elderly.git
   cd AI-Digital-assistant-for-elderly
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```
   This will start `live-server` and automatically open `http://localhost:3000/pages/index.html` in your default browser.

## Current Development Status & Backend Integration

- **Frontend Prototype**: Complete functional frontend prototype with interactive UI states, mock data, and feedback overlays.
- **Voice Assistant**: Functional Web Speech API integration with feature detection, clear spoken rate (0.88), and fallback mode.
- **Backend / API**: `api.js` connects profile, medicine, appointment, and health-log features to the Express backend.

## License

MIT
