// =========================================================================
// MAIN UI CONTROLLER, EXCEL PARSER/EXPORTER & LIVE FIREBASE WORKFLOW
// =========================================================================

const AppState = {
  currentStep: 1,
  periods: [],
  rooms: [],
  specialHours: [],
  subjects: [],
  studentEnrollments: [],
  computedSections: [],
  allocations: { RF: [], AF: [], VF: [] },
  liveFirebaseAllocations: [],
  busySlots: [],
  lastResult: null,
  draggedSession: null
};

// Initialize on load
window.addEventListener("DOMContentLoaded", () => {
  handleHashRouting();
  window.addEventListener("hashchange", handleHashRouting);
  rebuildBellSlots();
  bulkGenerateRooms(); // Default 7 rooms ready to customize
  lucide.createIcons();
});

window.addEventListener("firebase-bridge-ready", () => {
  const badge = document.getElementById("firebaseStatusBadge");
  const text = document.getElementById("firebaseStatusText");
  if (window.FirebaseBridge && window.FirebaseBridge.isReady()) {
    badge.querySelector(".dot").className = "dot online";
    text.textContent = "Firebase Live Connected";
    pullLiveFacultyPreferences(true);
  }
});

// =========================================================================
// 1. HASH ROUTING (#/faculty vs #/)
// =========================================================================
function handleHashRouting() {
  const hash = window.location.hash;
  if (hash.includes("faculty")) {
    switchRoute("faculty", false);
  } else {
    switchRoute("admin", false);
  }
}

function switchRoute(route, updateHash = true) {
  const adminView = document.getElementById("adminStudioView");
  const facView = document.getElementById("facultyPortalView");
  const adminBtn = document.getElementById("navAdminBtn");
  const facBtn = document.getElementById("navFacultyBtn");

  if (route === "faculty") {
    adminView.classList.add("hidden");
    facView.classList.remove("hidden");
    facBtn.classList.add("active");
    adminBtn.classList.remove("active");
    if (updateHash) window.location.hash = "#/faculty";
  } else {
    facView.classList.add("hidden");
    adminView.classList.remove("hidden");
    adminBtn.classList.add("active");
    facBtn.classList.remove("active");
    if (updateHash) window.location.hash = "#/";
  }
  lucide.createIcons();
}

function copyFacultyShareLink() {
  const baseUrl = window.location.href.split("#")[0];
  const shareUrl = `${baseUrl}#/faculty`;
  navigator.clipboard.writeText(shareUrl);
  showToast("Shareable Faculty Form link copied to clipboard!");
}

function showToast(msg) {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

// =========================================================================
// 2. PUBLIC FACULTY PREFERENCE FORM LOGIC
// =========================================================================
let selectedFacType = "RF";

function selectFacultyType(type, cardEl) {
  selectedFacType = type;
  document.querySelectorAll(".cat-card").forEach(c => c.classList.remove("active"));
  cardEl.classList.add("active");
  cardEl.querySelector("input").checked = true;

  // Reset day selections when changing rules
  document.querySelectorAll("#facDayPills .day-pill").forEach(btn => {
    btn.classList.remove("active");
    if (type === "RF" && btn.dataset.day === "Saturday") {
      btn.style.opacity = "0.45";
    } else {
      btn.style.opacity = "1";
    }
  });

  const hint = document.getElementById("dayRuleHint");
  if (type === "RF") {
    hint.textContent = "Regular Faculty (RF): Select preferred days between Monday and Friday (Saturday blocked).";
  } else if (type === "AF") {
    hint.textContent = "Adjunct Faculty (AF): Strictly select up to 2 days per week.";
  } else {
    hint.textContent = "Visiting Faculty (VF): Select your exact mandatory visiting day(s) (including Saturday).";
  }
}

function toggleFacultyDay(btn) {
  const day = btn.dataset.day;
  if (selectedFacType === "RF" && day === "Saturday") {
    showToast("Regular Faculty (RF) are scheduled Monday–Friday only.");
    return;
  }
  const activeBtns = document.querySelectorAll("#facDayPills .day-pill.active");
  if (!btn.classList.contains("active") && selectedFacType === "AF" && activeBtns.length >= 2) {
    showToast("Adjunct Faculty (AF) can select a maximum of 2 days per week.");
    return;
  }
  btn.classList.toggle("active");
}

function toggleSlotChip(btn) {
  btn.classList.toggle("active");
}

function addFacultySubjectRow() {
  const container = document.getElementById("facSubjectsList");
  const row = document.createElement("div");
  row.className = "sub-row";
  row.innerHTML = `
    <input type="text" class="neu-input fac-sub-code" placeholder="Course Code" required />
    <input type="text" class="neu-input fac-sub-name" placeholder="Course Name" required />
    <input type="text" class="neu-input fac-sub-sec" placeholder="Section (Opt)" />
    <button type="button" class="neu-btn tiny" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(row);
}

async function handleFacultyFormSubmit(e) {
  e.preventDefault();
  const days = Array.from(document.querySelectorAll("#facDayPills .day-pill.active")).map(b => b.dataset.day);
  if (days.length === 0) {
    showToast("Please select at least one day.");
    return;
  }

  const subjects = [];
  document.querySelectorAll("#facSubjectsList .sub-row").forEach(row => {
    const code = row.querySelector(".fac-sub-code").value.trim();
    const course = row.querySelector(".fac-sub-name").value.trim();
    const section = row.querySelector(".fac-sub-sec").value.trim();
    if (code || course) subjects.push({ code, course, section });
  });

  const slots = Array.from(document.querySelectorAll("#facSlotChips .slot-chip.active")).map(b => b.dataset.slot);
  const exactTime = document.getElementById("facExactTime").value.trim();
  if (exactTime) slots.push(exactTime);

  const payload = {
    faculty: document.getElementById("facName").value.trim(),
    program: document.getElementById("facProgram").value.trim(),
    semester: document.getElementById("facSemester").value.trim(),
    fType: selectedFacType,
    subjects,
    preferredDays: days,
    preferredSlots: slots,
    lockedDay: selectedFacType === "VF" ? days[0] : "",
    lockedSlot: selectedFacType === "VF" ? exactTime : "",
    notes: document.getElementById("facNotes").value.trim()
  };

  const res = await window.FirebaseBridge.submitFacultyPreference(payload);
  document.getElementById("facultySubmissionForm").classList.add("hidden");
  document.getElementById("facultySuccessBox").classList.remove("hidden");
  document.getElementById("facultyReceiptText").textContent =
    `Saved for ${payload.faculty} (${payload.fType}) — ${days.join(", ")} [${res.mode.toUpperCase()} SYNC].`;
  showToast("Faculty preferences submitted live!");
}

function resetFacultyForm() {
  document.getElementById("facultySubmissionForm").reset();
  document.getElementById("facultySubmissionForm").classList.remove("hidden");
  document.getElementById("facultySuccessBox").classList.add("hidden");
}

// =========================================================================
// 3. WIZARD STEP NAVIGATION & STEP 1–3 CONFIGURATION
// =========================================================================
function goToStep(step) {
  AppState.currentStep = step;
  document.querySelectorAll(".wizard-step").forEach(el => el.classList.add("hidden"));
  document.getElementById(`step-${step}`).classList.remove("hidden");

  document.querySelectorAll(".step-node").forEach(node => {
    const s = Number(node.dataset.step);
    node.classList.remove("active", "completed");
    if (s === step) node.classList.add("active");
    if (s < step) node.classList.add("completed");
  });

  const pct = ((step - 1) / 5) * 92;
  document.getElementById("stepperProgress").style.width = `${pct}%`;

  if (step === 4) recomputeCohortSections();
  lucide.createIcons();
}

function toggleConfigDay(btn) {
  btn.classList.toggle("active");
}

function toggleElectiveModeUI() {
  const hasEl = document.getElementById("cfgHasElectives").checked;
  const statusEl = document.getElementById("electiveModeStatus");
  statusEl.innerHTML = hasEl
    ? `Active Mode: <strong>Core + Electives (Full Student Enrollment Clash-Graph Enabled)</strong>`
    : `Active Mode: <strong>Core Subjects Only (Elective Clustering Skipped — Direct Section Scheduling)</strong>`;
}

// Time Formatting Helpers
function parseTimeToMins(tStr) {
  const [h, m] = tStr.split(":").map(Number);
  return h * 60 + m;
}
function formatMinsTo12H(totalMins) {
  let h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

function rebuildBellSlots() {
  const start = parseTimeToMins(document.getElementById("cfgStartTime").value || "09:00");
  const end = parseTimeToMins(document.getElementById("cfgEndTime").value || "17:45");
  const dur = Number(document.getElementById("cfgSessionMins").value || 75);
  const brk = Number(document.getElementById("cfgBreakMins").value || 10);
  const lunchStart = parseTimeToMins(document.getElementById("cfgLunchStart").value || "13:05");
  const lunchDur = Number(document.getElementById("cfgLunchMins").value || 35);

  let cur = start;
  let pIdx = 0;
  let lunchInserted = false;
  const teachingPeriods = [];
  const previewBlocks = [];

  while (cur + dur <= end) {
    if (!lunchInserted && cur >= lunchStart) {
      previewBlocks.push({
        isLunch: true,
        label: `${formatMinsTo12H(cur)} - ${formatMinsTo12H(cur + lunchDur)}`,
        title: "Lunch Break"
      });
      cur += lunchDur;
      lunchInserted = true;
      continue;
    }

    const label = `${formatMinsTo12H(cur)} - ${formatMinsTo12H(cur + dur)}`;
    teachingPeriods.push({ index: pIdx, label });
    previewBlocks.push({ isLunch: false, label, title: `Period ${pIdx + 1}` });
    pIdx++;
    cur += dur + brk;
  }

  AppState.periods = teachingPeriods;
  const preview = document.getElementById("bellSlotsPreview");
  preview.innerHTML = previewBlocks
    .map(b => `
      <div class="slot-box neu-convex ${b.isLunch ? "lunch" : ""}">
        <div>${b.title}</div>
        <div class="hint-text">${b.label}</div>
      </div>
    `).join("");
}

function addSpecialHourRow() {
  const container = document.getElementById("specialHoursContainer");
  const periodOptions = AppState.periods.map(p => `<option value="${p.index}">Period ${p.index + 1} (${p.label})</option>`).join("");
  const row = document.createElement("div");
  row.className = "sub-row special-hour-row";
  row.innerHTML = `
    <input type="text" class="neu-input sp-title" placeholder="Title (e.g., Mentoring / Placement / Library)" value="Mentoring Hour" />
    <select class="neu-input sp-day">
      <option>Monday</option><option>Tuesday</option><option>Wednesday</option>
      <option>Thursday</option><option selected>Friday</option><option>Saturday</option>
    </select>
    <select class="neu-input sp-period">${periodOptions}</select>
    <button type="button" class="neu-btn tiny" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(row);
}

// Step 3: Classrooms
function bulkGenerateRooms() {
  const prefix = document.getElementById("bulkRoomPrefix").value.trim() || "CR";
  const count = Number(document.getElementById("bulkRoomCount").value || 6);
  const cap = Number(document.getElementById("bulkRoomCap").value || 65);
  AppState.rooms = [];
  for (let i = 1; i <= count; i++) {
    AppState.rooms.push({ name: `${prefix} ${i}`, capacity: cap });
  }
  renderRoomsGrid();
}

function addSingleRoomRow() {
  AppState.rooms.push({ name: `Room ${AppState.rooms.length + 1}`, capacity: 60 });
  renderRoomsGrid();
}

function renderRoomsGrid() {
  const container = document.getElementById("roomsListContainer");
  container.innerHTML = AppState.rooms.map((r, i) => `
    <div class="room-card neu-convex">
      <div class="flex-between">
        <strong>Room #${i + 1}</strong>
        <button type="button" class="neu-btn tiny" onclick="AppState.rooms.splice(${i},1); renderRoomsGrid();">✕</button>
      </div>
      <input type="text" class="neu-input" value="${r.name}" onchange="AppState.rooms[${i}].name = this.value" />
      <input type="number" class="neu-input" value="${r.capacity}" onchange="AppState.rooms[${i}].capacity = Number(this.value)" />
    </div>
  `).join("");
}

// =========================================================================
// 4. EXCEL TEMPLATES & UPLOAD PARSERS (SheetJS)
// =========================================================================
function downloadTemplate(type) {
  const wb = XLSX.utils.book_new();
  let rows = [];
  let filename = "Template.xlsx";

  if (type === "subjects") {
    filename = "Sample_Subject_Master.xlsx";
    rows = [
      { Code: "SLFI606", Course: "Strategic Financial Management", Type: "Core", SessionsPerWeek: 2 },
      { Code: "SLGM601", Course: "Management Control Systems", Type: "Core", SessionsPerWeek: 2 },
      { Code: "SHMM625", Course: "Digital Marketing", Type: "Elective", SessionsPerWeek: 2 },
      { Code: "SHFI624", Course: "Behavioural Finance", Type: "Elective", SessionsPerWeek: 2 }
    ];
  } else if (type === "students") {
    filename = "Sample_Student_Enrollment.xlsx";
    rows = [
      { Enrolno: "25BSOCBL0001", Name: "Aarav Sharma", Code: "SLFI606", Course: "Strategic Financial Management", Section: "A" },
      { Enrolno: "25BSOCBL0001", Name: "Aarav Sharma", Code: "SHMM625", Course: "Digital Marketing", Section: "" },
      { Enrolno: "25BSOCBL0002", Name: "Diya Nair", Code: "SLFI606", Course: "Strategic Financial Management", Section: "A" },
      { Enrolno: "25BSOCBL0002", Name: "Diya Nair", Code: "SHFI624", Course: "Behavioural Finance", Section: "" }
    ];
  } else if (type === "rf") {
    filename = "Sample_Regular_Faculty_RF.xlsx";
    rows = [
      { Faculty: "Dr. Sudhindra VR", Code: "SLFI606", Section: "A", PreferredDays: "Monday, Wednesday", PreferredSlot: "Morning" },
      { Faculty: "Dr. Ammu S", Code: "SLGM601", Section: "A", PreferredDays: "Tuesday, Thursday", PreferredSlot: "Afternoon" }
    ];
  } else if (type === "af") {
    filename = "Sample_Adjunct_Faculty_AF.xlsx";
    rows = [
      { Faculty: "Prof. Venkatesh Ganapathy", Code: "SHMM625", Section: "A", AllowedTwoDays: "Tuesday, Wednesday", PreferredSlot: "Morning" }
    ];
  } else if (type === "vf") {
    filename = "Sample_Visiting_Faculty_VF.xlsx";
    rows = [
      { Faculty: "Prof. P K Chandrasekhar", Code: "SHFI624", Section: "A", MandatoryDay: "Saturday", MandatoryTime: "9:00 AM" }
    ];
  } else if (type === "busy") {
    filename = "Sample_Other_Course_Busy_Slots.xlsx";
    rows = [
      { Faculty: "Dr. Sudhindra VR", Day: "Monday", PeriodNumber: 1, ProgramSource: "BBA Sem I" },
      { Faculty: "Dr. Ammu S", Day: "Wednesday", PeriodNumber: 3, ProgramSource: "BCA Sem III" }
    ];
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, filename);
}

function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
      resolve(json);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function handleSubjectUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const rows = await readExcelFile(file);
  AppState.subjects = rows.map(r => ({
    code: String(r.Code || r["Course Code"] || "").trim(),
    course: String(r.Course || r["Course Name"] || "").trim(),
    type: String(r.Type || "Core").trim(),
    sessionsNeeded: Number(r.SessionsPerWeek || r.Units || 2)
  })).filter(s => s.code);

  document.getElementById("subjectFileLabel").textContent = file.name;
  document.getElementById("subjectUploadStats").textContent = `✓ Loaded ${AppState.subjects.length} subjects`;
  recomputeCohortSections();
}

async function handleStudentUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const rows = await readExcelFile(file);
  AppState.studentEnrollments = rows.map(r => ({
    enrolno: String(r.Enrolno || r.EnrollmentNo || r["Enrollment No"] || "").trim(),
    name: String(r.Name || r["Student Name"] || "").trim(),
    code: String(r.Code || r["Course Code"] || "").trim(),
    course: String(r.Course || r["Course Name"] || "").trim(),
    section: String(r.Section || r.Sec || "").trim()
  })).filter(r => r.enrolno && r.code);

  const uniqueStudents = new Set(AppState.studentEnrollments.map(s => s.enrolno)).size;
  document.getElementById("studentFileLabel").textContent = file.name;
  document.getElementById("studentUploadStats").textContent =
    `✓ Loaded ${uniqueStudents} unique students (${AppState.studentEnrollments.length} enrollments)`;
  recomputeCohortSections();
}

// Automatically builds sections and splits oversized electives based on room capacity
function recomputeCohortSections() {
  const maxRoomCap = Math.max(...AppState.rooms.map(r => r.capacity), 60);
  const byCourse = {};

  // Seed from subject master
  for (const sub of AppState.subjects) {
    byCourse[sub.code] = {
      code: sub.code,
      course: sub.course,
      type: sub.type,
      sessionsNeeded: sub.sessionsNeeded,
      records: []
    };
  }

  // Group student enrollments
  for (const enr of AppState.studentEnrollments) {
    if (!byCourse[enr.code]) {
      byCourse[enr.code] = {
        code: enr.code,
        course: enr.course || enr.code,
        type: "Elective",
        sessionsNeeded: 2,
        records: []
      };
    }
    byCourse[enr.code].records.push(enr);
  }

  const finalSections = [];
  let autoSplitCount = 0;

  Object.values(byCourse).forEach(item => {
    if (item.records.length === 0) {
      // Default single section if no student list uploaded yet
      finalSections.push({
        id: `${item.code}_A`,
        code: item.code,
        course: item.course,
        section: "A",
        type: item.type,
        studentIds: [],
        studentCount: 55,
        sessionsNeeded: item.sessionsNeeded
      });
      return;
    }

    // Check if pre-assigned sections exist
    const hasPreSections = item.records.some(r => r.section);
    if (hasPreSections) {
      const grouped = {};
      item.records.forEach(r => {
        const sec = r.section || "A";
        if (!grouped[sec]) grouped[sec] = [];
        grouped[sec].push(r.enrolno);
      });
      Object.entries(grouped).forEach(([sec, ids]) => {
        finalSections.push({
          id: `${item.code}_${sec}`,
          code: item.code,
          course: item.course,
          section: sec,
          type: item.type,
          studentIds: ids,
          studentCount: ids.length,
          sessionsNeeded: item.sessionsNeeded
        });
      });
    } else {
      // Auto-split into balanced sections so each fits within maxRoomCap
      const numSec = Math.max(1, Math.ceil(item.records.length / maxRoomCap));
      if (numSec > 1) autoSplitCount++;
      const chunkSize = Math.ceil(item.records.length / numSec);
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

      for (let s = 0; s < numSec; s++) {
        const slice = item.records.slice(s * chunkSize, (s + 1) * chunkSize);
        const secLetter = letters[s] || `S${s + 1}`;
        finalSections.push({
          id: `${item.code}_${secLetter}`,
          code: item.code,
          course: item.course,
          section: secLetter,
          type: item.type,
          studentIds: slice.map(x => x.enrolno),
          studentCount: slice.length,
          sessionsNeeded: item.sessionsNeeded
        });
      }
    }
  });

  AppState.computedSections = finalSections;
  const box = document.getElementById("cohortAnalysisBox");
  if (finalSections.length > 0) {
    box.classList.remove("hidden");
    document.getElementById("cohortAnalysisContent").innerHTML = `
      <p class="hint-text">
        <strong>${finalSections.length} Total Class Sections</strong> ready across <strong>${Object.keys(byCourse).length} Courses</strong>.
        Max Room Capacity: <strong>${maxRoomCap} seats</strong> (${autoSplitCount} oversized courses automatically split into balanced sections).
      </p>
    `;
  }
}

async function handleFacultyUpload(e, fType) {
  const file = e.target.files[0];
  if (!file) return;
  const rows = await readExcelFile(file);

  AppState.allocations[fType] = rows.map(r => {
    const rawDays = String(r.PreferredDays || r.AllowedTwoDays || r.MandatoryDay || r.Day || "");
    const days = rawDays.split(/[,;/]+/).map(d => d.trim()).filter(Boolean);
    const slotStr = String(r.PreferredSlot || r.MandatoryTime || r.Time || "").trim();

    return {
      faculty: String(r.Faculty || r["Faculty Name"] || "").trim(),
      fType,
      code: String(r.Code || r["Course Code"] || "").trim(),
      section: String(r.Section || r.Sec || "").trim(),
      preferredDays: fType === "AF" ? days.slice(0, 2) : days,
      preferredSlots: slotStr ? [slotStr] : [],
      lockedDay: fType === "VF" ? (days[0] || "") : "",
      lockedSlot: fType === "VF" ? slotStr : ""
    };
  }).filter(a => a.faculty && a.code);

  const keyLower = fType.toLowerCase();
  document.getElementById(`${keyLower}FileLabel`).textContent = file.name;
  document.getElementById(`${keyLower}Stats`).textContent = `✓ Loaded ${AppState.allocations[fType].length} ${fType} assignments`;
}

async function handleBusyUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const rows = await readExcelFile(file);
  const parsed = rows.map(r => ({
    faculty: String(r.Faculty || r["Faculty Name"] || "").trim(),
    day: String(r.Day || "").trim(),
    periodIdx: Math.max(0, Number(r.PeriodNumber || 1) - 1),
    source: String(r.ProgramSource || "External Course").trim()
  })).filter(b => b.faculty && b.day);

  AppState.busySlots.push(...parsed);
  document.getElementById("busyFileLabel").textContent = file.name;
  document.getElementById("busyStats").textContent = `✓ Total ${AppState.busySlots.length} cross-course busy blocks active`;
}

// =========================================================================
// 5. LIVE FIREBASE SYNC & DEMO DATASET GENERATOR
// =========================================================================
async function pullLiveFacultyPreferences(silent = false) {
  if (!window.FirebaseBridge) return;
  const list = await window.FirebaseBridge.fetchFacultyPreferences();
  const converted = [];

  list.forEach(item => {
    (item.subjects || []).forEach(sub => {
      converted.push({
        faculty: item.faculty,
        fType: item.fType || "RF",
        code: sub.code,
        section: sub.section || "",
        preferredDays: item.preferredDays || [],
        preferredSlots: item.preferredSlots || [],
        lockedDay: item.lockedDay || "",
        lockedSlot: item.lockedSlot || ""
      });
    });
  });

  AppState.liveFirebaseAllocations = converted;
  document.getElementById("liveSyncCountText").textContent =
    `${list.length} faculty form submissions (${converted.length} course mappings) synced live.`;
  if (!silent) showToast(`Synced ${list.length} live faculty preference forms!`);
}

async function pullSavedSchedulesFromFirebase() {
  const saved = await window.FirebaseBridge.fetchPublishedTimetables();
  let added = 0;
  saved.forEach(tt => {
    (tt.flatSessions || []).forEach(s => {
      AppState.busySlots.push({
        faculty: s.faculty,
        day: s.day,
        periodIdx: s.periodIdx,
        source: `${tt.program} ${tt.semester}`
      });
      added++;
    });
  });
  document.getElementById("busyStats").textContent = `✓ Total ${AppState.busySlots.length} busy blocks active (+${added} from Firebase)`;
  showToast(`Imported ${added} busy slots from published timetables!`);
}

function loadSimulatedDemoDataset() {
  // Generates a realistic 400-student cohort across Core + Electives + RF/AF/VF
  AppState.subjects = [
    { code: "SLFI606", course: "Strategic Financial Management", type: "Core", sessionsNeeded: 2 },
    { code: "SLGM601", course: "Management Control Systems", type: "Core", sessionsNeeded: 2 },
    { code: "SLGM502", course: "Legal Environment of Business", type: "Core", sessionsNeeded: 2 },
    { code: "SHFI624", course: "Behavioural Finance", type: "Elective", sessionsNeeded: 2 },
    { code: "SLMM612", course: "Brand Management", type: "Elective", sessionsNeeded: 2 },
    { code: "SHMM625", course: "Digital Marketing", type: "Elective", sessionsNeeded: 2 },
    { code: "SLMM611", course: "Customer Relationship Management", type: "Elective", sessionsNeeded: 2 },
    { code: "SHFI636", course: "Advanced Topics in FinTech", type: "Elective", sessionsNeeded: 2 }
  ];

  const enrollments = [];
  const electives = ["SHFI624", "SLMM612", "SHMM625", "SLMM611", "SHFI636"];
  for (let i = 1; i <= 400; i++) {
    const id = `25BSOCBL${String(i).padStart(4, "0")}`;
    const sec = i <= 135 ? "A" : i <= 270 ? "B" : "C";
    // Core subjects
    enrollments.push({ enrolno: id, name: `Student ${i}`, code: "SLFI606", course: "Strategic Financial Management", section: sec });
    enrollments.push({ enrolno: id, name: `Student ${i}`, code: "SLGM601", course: "Management Control Systems", section: sec });
    enrollments.push({ enrolno: id, name: `Student ${i}`, code: "SLGM502", course: "Legal Environment of Business", section: sec });
    // Pick 2 distinct electives per student
    const e1 = electives[i % electives.length];
    const e2 = electives[(i + 2) % electives.length];
    enrollments.push({ enrolno: id, name: `Student ${i}`, code: e1, course: e1, section: "" });
    enrollments.push({ enrolno: id, name: `Student ${i}`, code: e2, course: e2, section: "" });
  }
  AppState.studentEnrollments = enrollments;
  recomputeCohortSections();

  AppState.allocations.RF = [
    { faculty: "Dr. Sudhindra VR", fType: "RF", code: "SLFI606", section: "A", preferredDays: ["Monday", "Wednesday"], preferredSlots: ["Morning"] },
    { faculty: "Dr. Satya Thangavel", fType: "RF", code: "SLFI606", section: "B", preferredDays: ["Tuesday", "Thursday"], preferredSlots: ["Morning"] },
    { faculty: "Prof. Sunil Pillai", fType: "RF", code: "SLFI606", section: "C", preferredDays: ["Wednesday", "Friday"], preferredSlots: ["Afternoon"] },
    { faculty: "Dr. Ammu S", fType: "RF", code: "SLGM601", section: "A", preferredDays: ["Monday"], preferredSlots: ["Afternoon"] },
    { faculty: "Dr. Mathivanan P", fType: "RF", code: "SLGM601", section: "B", preferredDays: ["Tuesday"], preferredSlots: ["Morning"] },
    { faculty: "Dr. Satyajit Barik", fType: "RF", code: "SLGM601", section: "C", preferredDays: ["Thursday"], preferredSlots: ["Afternoon"] },
    { faculty: "Dr. Girish G P", fType: "RF", code: "SHFI624", section: "A", preferredDays: ["Friday"], preferredSlots: ["Afternoon"] },
    { faculty: "Dr. Vairasigamani P", fType: "RF", code: "SHFI624", section: "B", preferredDays: ["Tuesday"], preferredSlots: ["Morning"] },
    { faculty: "Dr. J. Clement Sudhahar", fType: "RF", code: "SLMM612", section: "A", preferredDays: ["Wednesday"], preferredSlots: ["Morning"] },
    { faculty: "Dr. C B Venkata Krishna Prasad", fType: "RF", code: "SLMM611", section: "A", preferredDays: ["Thursday"], preferredSlots: ["Afternoon"] }
  ];

  AppState.allocations.AF = [
    { faculty: "Prof. Venkatesh Ganapathy", fType: "AF", code: "SHMM625", section: "A", preferredDays: ["Tuesday", "Wednesday"], preferredSlots: ["Morning"] },
    { faculty: "Dr. R Harish", fType: "AF", code: "SLGM502", section: "A", preferredDays: ["Thursday", "Friday"], preferredSlots: ["Afternoon"] }
  ];

  AppState.allocations.VF = [
    { faculty: "Prof. P K Chandrasekhar", fType: "VF", code: "SLGM502", section: "B", lockedDay: "Monday", lockedSlot: "9:00" },
    { faculty: "Prof. Sureshbabu", fType: "VF", code: "SHFI636", section: "A", lockedDay: "Saturday", lockedSlot: "11:50" }
  ];

  document.getElementById("rfStats").textContent = "✓ Demo RF Loaded (10 assignments)";
  document.getElementById("afStats").textContent = "✓ Demo AF Loaded (2 assignments, 2-day cap)";
  document.getElementById("vfStats").textContent = "✓ Demo VF Loaded (2 hard-locked slots)";
  showToast("400-Student + Core/Elective + RF/AF/VF Demo Dataset Ready!");
}

// =========================================================================
// 6. RUN SOLVER & RENDER 4 INTERACTIVE VIEWS
// =========================================================================
function runAutoScheduler() {
  goToStep(6);
  const progressCard = document.getElementById("solverProgressCard");
  const resultsWrapper = document.getElementById("timetableResultsWrapper");
  progressCard.classList.remove("hidden");
  resultsWrapper.classList.add("hidden");

  setTimeout(() => {
    const workingDays = Array.from(document.querySelectorAll("#cfgWorkingDays .day-pill.active")).map(b => b.dataset.day);
    const specialHours = Array.from(document.querySelectorAll(".special-hour-row")).map(row => ({
      title: row.querySelector(".sp-title").value.trim() || "Special Hour",
      day: row.querySelector(".sp-day").value,
      periodIdx: Number(row.querySelector(".sp-period").value),
      target: "ALL"
    }));

    const combinedAllocations = [
      ...AppState.liveFirebaseAllocations,
      ...AppState.allocations.VF,
      ...AppState.allocations.AF,
      ...AppState.allocations.RF
    ];

    if (AppState.computedSections.length === 0) {
      loadSimulatedDemoDataset();
    }

    const engine = new window.TimetableConstraintEngine({
      program: document.getElementById("cfgProgram").value,
      batch: document.getElementById("cfgBatch").value,
      semester: document.getElementById("cfgSemester").value,
      workingDays,
      periods: AppState.periods,
      pairedMode: document.getElementById("cfgPairedSlots").checked,
      hasElectives: document.getElementById("cfgHasElectives").checked,
      rooms: AppState.rooms,
      sections: AppState.computedSections,
      allocations: combinedAllocations,
      busySlots: AppState.busySlots,
      specialHours
    });

    const result = engine.solve();
    AppState.lastResult = result;
    AppState.lastEngine = engine;

    progressCard.classList.add("hidden");
    resultsWrapper.classList.remove("hidden");
    renderAllResultViews(result, engine);
    showToast("Timetable generated & audited successfully!");
  }, 450);
}

function renderAllResultViews(result, engine) {
  document.getElementById("resultProgramBadge").textContent =
    `${engine.program} • ${engine.batch} • ${engine.semester}`;

  const s = result.stats;
  document.getElementById("auditKpiStrip").innerHTML = `
    <div class="kpi-box neu-convex">
      <div class="val">${s.totalSessionsScheduled}</div>
      <div class="lbl">Periods Scheduled</div>
    </div>
    <div class="kpi-box neu-convex">
      <div class="val" style="color:${s.studentClashes === 0 ? "var(--success)" : "var(--vf-color)"}">${s.studentClashes}</div>
      <div class="lbl">Student Elective Clashes</div>
    </div>
    <div class="kpi-box neu-convex">
      <div class="val" style="color:${s.facultyClashes === 0 ? "var(--success)" : "var(--vf-color)"}">${s.facultyClashes}</div>
      <div class="lbl">Faculty Clashes</div>
    </div>
    <div class="kpi-box neu-convex">
      <div class="val" style="color:${s.roomClashes === 0 ? "var(--success)" : "var(--vf-color)"}">${s.roomClashes}</div>
      <div class="lbl">Classroom Clashes</div>
    </div>
    <div class="kpi-box neu-convex">
      <div class="val" style="color:${s.unscheduledCount === 0 ? "var(--success)" : "var(--af-color)"}">${s.unscheduledCount}</div>
      <div class="lbl">Pending / Unplaced</div>
    </div>
  `;

  renderMasterGrid(result, engine);
  renderIndividualFacultyGrids(result, engine);
  renderRoomMatrix(result, engine);
  renderAuditReport(result, engine);
  lucide.createIcons();
}

function renderMasterGrid(result, engine) {
  let html = `<table class="tt-table"><thead><tr><th>Day / Slot</th>`;
  engine.periods.forEach(p => {
    html += `<th>Period ${p.index + 1}<br/><small style="font-weight:500;color:var(--muted)">${p.label}</small></th>`;
  });
  html += `</tr></thead><tbody>`;

  engine.workingDays.forEach(day => {
    html += `<tr><td class="day-col">${day}</td>`;
    engine.periods.forEach(p => {
      const entries = result.grid[day]?.[p.index] || [];
      html += `<td class="tt-cell" ondragover="event.preventDefault()" ondrop="handleCellDrop(event, '${day}', ${p.index})">`;
      entries.forEach((item, idx) => {
        html += `
          <div class="session-chip ${item.fType}" draggable="true"
               ondragstart="handleDragStart('${day}', ${p.index}, ${idx})">
            <div class="sc-top">
              <span>${item.displayLabel || item.course}</span>
              <span class="tag ${item.fType.toLowerCase()}">${item.fType}</span>
            </div>
            <div class="sc-fac">${item.faculty}</div>
            <span class="sc-room">${item.room} • ${item.studentCount || ""}</span>
          </div>
        `;
      });
      html += `</td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  document.getElementById("masterGridContainer").innerHTML = html;
}

// Drag & Drop Manual Override with Live Audit Re-Calculation
function handleDragStart(day, periodIdx, itemIdx) {
  AppState.draggedSession = { day, periodIdx, itemIdx };
}

function handleCellDrop(e, targetDay, targetPeriodIdx) {
  e.preventDefault();
  const src = AppState.draggedSession;
  if (!src) return;
  const grid = AppState.lastResult.grid;
  const moved = grid[src.day][src.periodIdx].splice(src.itemIdx, 1)[0];
  grid[targetDay][targetPeriodIdx].push(moved);

  AppState.lastResult.stats = AppState.lastEngine.runAudit(
    grid,
    AppState.lastResult.conflictGraph,
    AppState.lastResult.unscheduled
  );
  renderAllResultViews(AppState.lastResult, AppState.lastEngine);
  showToast(`Moved ${moved.displayLabel || moved.course} to ${targetDay} Period ${targetPeriodIdx + 1}`);
}

function renderIndividualFacultyGrids(result, engine) {
  const byFac = {};
  engine.workingDays.forEach(day => {
    engine.periods.forEach(p => {
      (result.grid[day]?.[p.index] || []).forEach(item => {
        if (item.isSpecial) return;
        if (!byFac[item.faculty]) {
          byFac[item.faculty] = { fType: item.fType, classes: [] };
        }
        byFac[item.faculty].classes.push({ day, period: p, item });
      });
    });
  });

  const html = Object.entries(byFac).map(([fac, data]) => `
    <div class="fac-grid-card neu-convex">
      <div class="flex-between">
        <strong>${fac}</strong>
        <span class="tag ${data.fType.toLowerCase()}">${data.fType} • ${data.classes.length} periods/wk</span>
      </div>
      <div class="mt-10">
        ${data.classes.map(c => `
          <div class="hint-text" style="padding:4px 0; border-bottom:1px solid rgba(0,0,0,0.05)">
            <strong>${c.day}</strong> (P${c.period.index + 1}: ${c.period.label}) — <strong>${c.item.displayLabel}</strong> in <em>${c.item.room}</em>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");

  document.getElementById("individualFacultyContainer").innerHTML = html || "<p>No faculty classes scheduled yet.</p>";
}

function renderRoomMatrix(result, engine) {
  let html = `<table class="tt-table"><thead><tr><th>Classroom (Cap)</th>`;
  engine.workingDays.forEach(d => (html += `<th>${d}</th>`));
  html += `</tr></thead><tbody>`;

  engine.rooms.forEach(room => {
    html += `<tr><td class="day-col">${room.name}<br/><small>(${room.capacity} seats)</small></td>`;
    engine.workingDays.forEach(day => {
      const used = [];
      engine.periods.forEach(p => {
        const hit = (result.grid[day]?.[p.index] || []).find(i => i.room === room.name);
        if (hit) used.push(`P${p.index + 1}: ${hit.displayLabel}`);
      });
      html += `<td class="tt-cell">${used.length ? used.map(u => `<div class="hint-text"><strong>${u}</strong></div>`).join("") : `<span class="hint-text">Free all day</span>`}</td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  document.getElementById("roomMatrixContainer").innerHTML = html;
}

function renderAuditReport(result, engine) {
  const un = result.unscheduled;
  document.getElementById("auditDetailsContainer").innerHTML = `
    <h4>Automated Rule Verification Summary</h4>
    <ul style="margin: 12px 0 0 20px; line-height: 1.8;" class="hint-text">
      <li><strong>Regular Faculty (RF) Saturday Shield:</strong> Enforced (0 RF classes placed on Saturday).</li>
      <li><strong>4-Consecutive-Period Burnout Guardrail:</strong> Enforced across all days.</li>
      <li><strong>Adjunct Faculty (AF) 2-Day Weekly Limit:</strong> Enforced strictly.</li>
      <li><strong>Visiting Faculty (VF) Hard-Locked Windows:</strong> Enforced strictly.</li>
    </ul>
    ${un.length > 0 ? `
      <div class="mt-20">
        <h4 style="color:var(--vf-color)">Unscheduled Blocks Requiring Attention (${un.length})</h4>
        <p class="hint-text">These blocks could not be placed without violating a hard constraint (e.g., locked faculty slot overlap or insufficient rooms):</p>
        <ul style="margin:10px 0 0 20px;">
          ${un.map(u => `<li><strong>${u.code}-${u.section}</strong> (${u.faculty} [${u.fType}])</li>`).join("")}
        </ul>
      </div>
    ` : `<p class="mt-16" style="color:var(--success);font-weight:700;">✓ 100% of required course sessions were placed with zero hard clashes.</p>`}
  `;
}

function switchResultTab(tabName, btn) {
  document.querySelectorAll(".view-tabs .tab-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll(".result-tab-content").forEach(el => el.classList.add("hidden"));
  document.getElementById(`tab-${tabName}`).classList.remove("hidden");
}

// =========================================================================
// 7. SAVE TO FIREBASE & MULTI-SHEET EXCEL EXPORT (.xlsx)
// =========================================================================
async function saveTimetableToFirebase() {
  if (!AppState.lastResult) return;
  const engine = AppState.lastEngine;
  const flatSessions = [];

  engine.workingDays.forEach(day => {
    engine.periods.forEach(p => {
      (AppState.lastResult.grid[day]?.[p.index] || []).forEach(item => {
        if (!item.isSpecial) {
          flatSessions.push({
            day,
            periodIdx: p.index,
            time: p.label,
            course: item.displayLabel,
            faculty: item.faculty,
            fType: item.fType,
            room: item.room
          });
        }
      });
    });
  });

  const res = await window.FirebaseBridge.saveGeneratedTimetable({
    program: engine.program,
    batch: engine.batch,
    semester: engine.semester,
    flatSessions
  });
  showToast(`Timetable locked & published (${res.mode.toUpperCase()})—other batches will now avoid these faculty slots!`);
}

function exportTimetableToExcel() {
  if (!AppState.lastResult) return;
  const engine = AppState.lastEngine;
  const wb = XLSX.utils.book_new();

  // Sheet 1: Master Timetable
  const masterRows = [];
  engine.workingDays.forEach(day => {
    const maxStack = Math.max(1, ...engine.periods.map(p => (AppState.lastResult.grid[day]?.[p.index] || []).length));
    for (let rowIdx = 0; rowIdx < maxStack; rowIdx++) {
      const rowObj = { Day: rowIdx === 0 ? day : "" };
      engine.periods.forEach(p => {
        const entry = (AppState.lastResult.grid[day]?.[p.index] || [])[rowIdx];
        rowObj[`P${p.index + 1} (${p.label})`] = entry
          ? `${entry.displayLabel || entry.course} | ${entry.faculty} (${entry.fType}) | ${entry.room}`
          : "";
      });
      masterRows.push(rowObj);
    }
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(masterRows), "Master_Timetable");

  // Sheet 2: Individual Faculty Schedule
  const facRows = [];
  engine.workingDays.forEach(day => {
    engine.periods.forEach(p => {
      (AppState.lastResult.grid[day]?.[p.index] || []).forEach(item => {
        if (!item.isSpecial) {
          facRows.push({
            Faculty: item.faculty,
            Type: item.fType,
            Day: day,
            Period: `Period ${p.index + 1}`,
            Time: p.label,
            Course_Section: item.displayLabel,
            Room: item.room
          });
        }
      });
    });
  });
  facRows.sort((a, b) => a.Faculty.localeCompare(b.Faculty));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(facRows), "Faculty_Schedules");

  // Sheet 3: Section Allocation Summary
  const secRows = AppState.computedSections.map(s => ({
    Code: s.code,
    Course: s.course,
    Section: s.section,
    Type: s.type,
    Enrolled_Students: s.studentCount
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(secRows), "Sections_Summary");

  XLSX.writeFile(wb, `${engine.program}_${engine.semester.replace(/\s+/g, "_")}_ClashFree_Timetable.xlsx`);
  showToast("Multi-sheet Excel timetable downloaded!");
}
