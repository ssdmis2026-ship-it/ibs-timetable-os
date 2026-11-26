# Academic Timetable OS (IBS Bengaluru)

Zero-cost, zero-backend, Neumorphic Constraint-Satisfaction Timetable Scheduler hosted on **GitHub Pages** with **Firebase Firestore** live sync.

## Files Included
- `index.html` — Admin 6-Step Timetable Wizard + Public Faculty Preference Form (`#/faculty`)
- `styles.css` — Neumorphic Soft-UI styling & smooth motion transitions
- `firebase-config.js` — Live Firebase Firestore connector (with automatic LocalStorage fallback)
- `solver.js` — Student Elective Conflict Graph + RF/AF/VF Constraint Satisfaction Engine
- `app.js` — Excel `.xlsx` parser, auto-section splitter, drag-and-drop editor, and multi-sheet `.xlsx` exporter

## Quick Deployment Steps (2 Minutes)
1. Open `firebase-config.js` and paste your Firebase `firebaseConfig` credentials.
2. Upload all 6 files directly to the root of your public GitHub repository (`ibs-timetable-os`).
3. Go to **Repository Settings -> Pages -> Deploy from branch `main` / `(root)` -> Save**.
4. Share your live links:
   - **Admin Studio:** `https://<username>.github.io/ibs-timetable-os/`
   - **Faculty Preference Link:** `https://<username>.github.io/ibs-timetable-os/#/faculty`
