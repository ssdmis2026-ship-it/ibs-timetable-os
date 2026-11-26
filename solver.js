// =========================================================================
// ZERO-CLASH CONSTRAINT SATISFACTION & CONFLICT GRAPH TIMETABLE ENGINE
// Enforces:
// 1. Zero Student Enrollment overlap across simultaneous sections
// 2. VF (Visiting Faculty): Hard-locked day + exact slot (Mon-Sat)
// 3. AF (Adjunct Faculty): Strictly max 2 days/week + preferred slots
// 4. RF (Regular Faculty): Mon-Fri only (no Saturday) + NO 4-in-a-row
// 5. Cross-program busy slots (BBA/BCA/Other MBA Semesters) respected
// 6. Room capacity >= section size & zero room double-booking
// =========================================================================

class TimetableConstraintEngine {
  constructor(config) {
    this.program = config.program;
    this.batch = config.batch;
    this.semester = config.semester;
    this.workingDays = config.workingDays; // e.g., ["Monday", ..., "Saturday"]
    this.periods = config.periods;         // Teaching period objects [{index, label}]
    this.pairedMode = config.pairedMode;   // true = 2 back-to-back periods per block
    this.hasElectives = config.hasElectives;
    this.rooms = config.rooms;             // [{name, capacity}]
    this.sections = config.sections;       // [{id, code, course, section, type, studentIds, studentCount, sessionsNeeded}]
    this.allocations = config.allocations; // [{faculty, fType, code, section, preferredDays, preferredSlots, lockedDay, lockedSlot}]
    this.busySlots = config.busySlots;     // [{faculty, day, periodIdx, source}]
    this.specialHours = config.specialHours; // [{title, day, periodIdx, target}]
  }

  normalize(str) {
    return String(str || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // Build Student Conflict Matrix: conflictMap[secA][secB] = sharedStudentCount
  buildStudentConflictGraph() {
    const conflictMap = {};
    this.sections.forEach(s => (conflictMap[s.id] = {}));

    if (!this.hasElectives) {
      // In core-only mode, sections with the same section letter (e.g., Sec A) cannot overlap
      for (let i = 0; i < this.sections.length; i++) {
        for (let j = i + 1; j < this.sections.length; j++) {
          const a = this.sections[i];
          const b = this.sections[j];
          if (a.section && b.section && a.section === b.section) {
            conflictMap[a.id][b.id] = 999;
            conflictMap[b.id][a.id] = 999;
          }
        }
      }
      return conflictMap;
    }

    for (let i = 0; i < this.sections.length; i++) {
      const setA = new Set(this.sections[i].studentIds || []);
      for (let j = i + 1; j < this.sections.length; j++) {
        const b = this.sections[j];
        let overlap = 0;
        if (setA.size > 0 && (b.studentIds || []).length > 0) {
          for (const id of b.studentIds) {
            if (setA.has(id)) overlap++;
          }
        } else if (this.sections[i].type === "Core" || b.type === "Core") {
          // Core courses conflict with all sections of the same cohort if enrollment IDs aren't mapped
          overlap = 1;
        }
        if (overlap > 0) {
          conflictMap[this.sections[i].id][b.id] = overlap;
          conflictMap[b.id][this.sections[i].id] = overlap;
        }
      }
    }
    return conflictMap;
  }

  // Match each section to its assigned faculty & rule metadata
  buildTaskUnits() {
    const tasks = [];
    for (const sec of this.sections) {
      const match = this.allocations.find(a =>
        this.normalize(a.code) === this.normalize(sec.code) &&
        (!a.section || this.normalize(a.section) === this.normalize(sec.section))
      ) || this.allocations.find(a => this.normalize(a.code) === this.normalize(sec.code));

      const faculty = match ? match.faculty : "TBA Faculty";
      const fType = match ? (match.fType || "RF").toUpperCase() : "RF";
      const blocksNeeded = this.pairedMode
        ? Math.max(1, Math.ceil((sec.sessionsNeeded || 2) / 2))
        : (sec.sessionsNeeded || 2);

      for (let b = 0; b < blocksNeeded; b++) {
        tasks.push({
          taskId: `${sec.id}_B${b + 1}`,
          sectionId: sec.id,
          code: sec.code,
          course: sec.course,
          section: sec.section,
          courseType: sec.type,
          studentCount: sec.studentCount || 50,
          faculty,
          fType,
          preferredDays: match?.preferredDays || [],
          preferredSlots: match?.preferredSlots || [],
          lockedDay: match?.lockedDay || "",
          lockedSlot: match?.lockedSlot || "",
          span: this.pairedMode ? 2 : 1
        });
      }
    }

    // Sort by most constrained first: VF (hard-locked) -> AF (2-day cap) -> RF (most student conflicts)
    const priority = { VF: 1, AF: 2, RF: 3 };
    return tasks.sort((a, b) => (priority[a.fType] || 3) - (priority[b.fType] || 3));
  }

  solve() {
    const conflictGraph = this.buildStudentConflictGraph();
    const tasks = this.buildTaskUnits();

    // State trackers
    // grid[day][periodIdx] = Array of scheduled entries
    const grid = {};
    this.workingDays.forEach(d => {
      grid[d] = {};
      this.periods.forEach(p => {
        grid[d][p.index] = [];
      });
    });

    // Inject Special Institutional Hours first (Mentoring, Placement, Library)
    for (const sp of this.specialHours) {
      if (grid[sp.day] && grid[sp.day][sp.periodIdx] !== undefined) {
        grid[sp.day][sp.periodIdx].push({
          taskId: `SP_${Date.now()}_${Math.random()}`,
          code: "SPECIAL",
          course: sp.title,
          section: sp.target || "ALL",
          faculty: "Institutional Hour",
          fType: "SP",
          room: "Campus / Auditorium",
          isSpecial: true,
          blocksAllStudents: (sp.target || "ALL").toUpperCase() === "ALL"
        });
      }
    }

    // Pre-populate cross-program busy slots lookup: busyLookup["facultyNorm|day|periodIdx"] = source
    const busyLookup = {};
    for (const b of this.busySlots) {
      const key = `${this.normalize(b.faculty)}|${b.day}|${b.periodIdx}`;
      busyLookup[key] = b.source || "Other Program";
    }

    // Helper: check if faculty has 4 consecutive periods on a given day if we add candidateIndices
    const violatesFourInARow = (facNorm, day, candidateIndices) => {
      const occupied = new Set(candidateIndices);
      for (const p of this.periods) {
        const entries = grid[day][p.index] || [];
        if (entries.some(e => this.normalize(e.faculty) === facNorm)) {
          occupied.add(p.index);
        }
      }
      const sorted = Array.from(occupied).sort((a, b) => a - b);
      let streak = 1;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === sorted[i - 1] + 1) {
          streak++;
          if (streak >= 4) return true;
        } else {
          streak = 1;
        }
      }
      return false;
    };

    // Helper: get distinct days currently used by a faculty member
    const getFacultyUsedDays = (facNorm) => {
      const days = new Set();
      for (const d of this.workingDays) {
        for (const p of this.periods) {
          if ((grid[d][p.index] || []).some(e => this.normalize(e.faculty) === facNorm)) {
            days.add(d);
          }
        }
      }
      return days;
    };

    const unscheduled = [];

    for (const task of tasks) {
      const facNorm = this.normalize(task.faculty);
      let bestPlacement = null;
      let bestScore = -99999;

      for (const day of this.workingDays) {
        // RULE: Regular Faculty (RF) cannot be scheduled on Saturday
        if (task.fType === "RF" && day.toLowerCase().startsWith("sat")) continue;

        // RULE: Visiting Faculty (VF) locked day check
        if (task.fType === "VF" && task.lockedDay && !day.toLowerCase().startsWith(task.lockedDay.toLowerCase().slice(0, 3))) {
          continue;
        }

        // RULE: Adjunct Faculty (AF) strictly max 2 days/week + preferred days
        if (task.fType === "AF") {
          if (task.preferredDays.length > 0 && !task.preferredDays.some(pd => day.toLowerCase().startsWith(pd.toLowerCase().slice(0, 3)))) {
            continue;
          }
          const usedDays = getFacultyUsedDays(facNorm);
          if (!usedDays.has(day) && usedDays.size >= 2) {
            continue; // Enforce strict 2-day cap
          }
        }

        // Iterate candidate starting periods
        const maxStart = this.periods.length - task.span;
        for (let idx = 0; idx <= maxStart; idx++) {
          const slotIndices = [];
          for (let s = 0; s < task.span; s++) {
            slotIndices.push(this.periods[idx + s].index);
          }

          // RULE: VF exact slot match if provided
          if (task.fType === "VF" && task.lockedSlot) {
            const labelCombo = slotIndices.map(i => this.periods.find(p => p.index === i)?.label || "").join(" ");
            if (!labelCombo.toLowerCase().includes(task.lockedSlot.toLowerCase().slice(0, 5))) {
              continue;
            }
          }

          // Check hard clashes across every period in the span
          let hardClash = false;
          for (const pIdx of slotIndices) {
            // 1. Cross-program busy clash (BBA/BCA/Other Sem)
            if (busyLookup[`${facNorm}|${day}|${pIdx}`]) {
              hardClash = true; break;
            }

            const existing = grid[day][pIdx] || [];
            for (const item of existing) {
              // 2. Special institutional hour blocking all students
              if (item.blocksAllStudents) {
                hardClash = true; break;
              }
              // 3. Same faculty already teaching another section in this period
              if (this.normalize(item.faculty) === facNorm) {
                hardClash = true; break;
              }
              // 4. Same section scheduled twice in same period
              if (item.sectionId === task.sectionId) {
                hardClash = true; break;
              }
              // 5. Student enrollment overlap (Conflict Graph)
              if (item.sectionId && conflictGraph[task.sectionId]?.[item.sectionId] > 0) {
                hardClash = true; break;
              }
            }
            if (hardClash) break;
          }
          if (hardClash) continue;

          // RULE: No 4 consecutive periods in a row for any faculty (especially RF)
          if (violatesFourInARow(facNorm, day, slotIndices)) continue;

          // Find an available classroom with capacity >= task.studentCount across all span periods
          const validRooms = this.rooms
            .filter(r => r.capacity >= task.studentCount)
            .sort((a, b) => a.capacity - b.capacity); // Best-fit room capacity first

          let chosenRoom = null;
          for (const room of validRooms) {
            const roomFree = slotIndices.every(pIdx =>
              !(grid[day][pIdx] || []).some(item => item.room === room.name)
            );
            if (roomFree) {
              chosenRoom = room;
              break;
            }
          }
          if (!chosenRoom) continue;

          // Soft Scoring for optimal timetable quality
          let score = 100;
          // Prefer faculty's requested days
          if (task.preferredDays.some(pd => day.toLowerCase().startsWith(pd.toLowerCase().slice(0, 3)))) {
            score += 40;
          }
          // Prefer faculty's requested time window
          if (task.preferredSlots.length > 0) {
            const periodLabel = this.periods[idx].label.toLowerCase();
            if (task.preferredSlots.some(ps => periodLabel.includes(ps.toLowerCase().slice(0, 5)) ||
                (ps.toLowerCase().includes("morning") && idx <= 1) ||
                (ps.toLowerCase().includes("afternoon") && idx >= 2))) {
              score += 35;
            }
          }
          // Spread same subject across different days rather than doubling on one day
          const sameCourseOnDay = this.periods.some(p =>
            (grid[day][p.index] || []).some(e => e.sectionId === task.sectionId)
          );
          if (sameCourseOnDay) score -= 60;

          // Balance load across weekdays
          const dayLoad = this.periods.reduce((acc, p) => acc + (grid[day][p.index]?.length || 0), 0);
          score -= dayLoad * 2;

          if (score > bestScore) {
            bestScore = score;
            bestPlacement = { day, slotIndices, room: chosenRoom.name };
          }
        }
      }

      if (bestPlacement) {
        for (const pIdx of bestPlacement.slotIndices) {
          grid[bestPlacement.day][pIdx].push({
            taskId: task.taskId,
            sectionId: task.sectionId,
            code: task.code,
            course: task.course,
            section: task.section,
            displayLabel: `${task.code}-${task.section}`,
            faculty: task.faculty,
            fType: task.fType,
            room: bestPlacement.room,
            studentCount: task.studentCount
          });
        }
      } else {
        unscheduled.push(task);
      }
    }

    return {
      grid,
      unscheduled,
      conflictGraph,
      stats: this.runAudit(grid, conflictGraph, unscheduled)
    };
  }

  runAudit(grid, conflictGraph, unscheduled) {
    let studentClashes = 0;
    let facultyClashes = 0;
    let roomClashes = 0;
    let totalSessionsScheduled = 0;

    for (const day of this.workingDays) {
      for (const p of this.periods) {
        const items = grid[day]?.[p.index] || [];
        totalSessionsScheduled += items.length;

        const seenFac = new Set();
        const seenRoom = new Set();

        for (let i = 0; i < items.length; i++) {
          const a = items[i];
          if (!a.isSpecial) {
            const fn = this.normalize(a.faculty);
            if (seenFac.has(fn)) facultyClashes++;
            seenFac.add(fn);

            if (seenRoom.has(a.room)) roomClashes++;
            seenRoom.add(a.room);
          }

          for (let j = i + 1; j < items.length; j++) {
            const b = items[j];
            if (a.sectionId && b.sectionId && conflictGraph[a.sectionId]?.[b.sectionId] > 0) {
              studentClashes++;
            }
          }
        }
      }
    }

    return {
      totalSessionsScheduled,
      studentClashes,
      facultyClashes,
      roomClashes,
      unscheduledCount: unscheduled.length
    };
  }
}

window.TimetableConstraintEngine = TimetableConstraintEngine;
