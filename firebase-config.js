// =========================================================================
// FIREBASE LIVE CONFIGURATION (CONNECTED TO PROJECT: ibs-timetable-os)
// =========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAGtRNeOZTTxOi_-m9WaZEKPthEa7v6agg",
  authDomain: "ibs-timetable-os.firebaseapp.com",
  projectId: "ibs-timetable-os",
  storageBucket: "ibs-timetable-os.firebasestorage.app",
  messagingSenderId: "559191189119",
  appId: "1:559191189119:web:2c56435ae4f93432bb014a"
};

let db = null;
let isFirebaseReady = false;

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  isFirebaseReady = true;
  console.log("Firebase Firestore connected successfully to ibs-timetable-os.");
} catch (err) {
  console.warn("Firebase initialization error, using local fallback:", err);
}

window.FirebaseBridge = {
  isReady: () => isFirebaseReady,

  async submitFacultyPreference(payload) {
    if (!isFirebaseReady) {
      const existing = JSON.parse(localStorage.getItem("ibs_faculty_prefs") || "[]");
      existing.push({ ...payload, id: "local_" + Date.now(), createdAt: new Date().toISOString() });
      localStorage.setItem("ibs_faculty_prefs", JSON.stringify(existing));
      return { mode: "local" };
    }
    await addDoc(collection(db, "faculty_preferences"), {
      ...payload,
      createdAt: serverTimestamp()
    });
    return { mode: "firebase" };
  },

  async fetchFacultyPreferences() {
    if (!isFirebaseReady) {
      return JSON.parse(localStorage.getItem("ibs_faculty_prefs") || "[]");
    }
    const q = query(collection(db, "faculty_preferences"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async saveGeneratedTimetable(record) {
    if (!isFirebaseReady) {
      const saved = JSON.parse(localStorage.getItem("ibs_saved_timetables") || "[]");
      saved.push({ ...record, id: "tt_" + Date.now(), savedAt: new Date().toISOString() });
      localStorage.setItem("ibs_saved_timetables", JSON.stringify(saved));
      return { mode: "local" };
    }
    await addDoc(collection(db, "published_timetables"), {
      ...record,
      savedAt: serverTimestamp()
    });
    return { mode: "firebase" };
  },

  async fetchPublishedTimetables() {
    if (!isFirebaseReady) {
      return JSON.parse(localStorage.getItem("ibs_saved_timetables") || "[]");
    }
    const snap = await getDocs(collection(db, "published_timetables"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
};

window.dispatchEvent(new Event("firebase-bridge-ready"));
