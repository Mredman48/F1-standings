// updateAllRaces.js
import fs from "node:fs/promises";
import ical from "node-ical";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

/* -------------------- HELPERS -------------------- */

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/formula 1/g, "")
    .replace(/grand prix/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function getSessionType(summary) {
  const s = (summary || "").toLowerCase();

  if (s.includes("practice 1") || s.includes("fp1")) return "FP1";
  if (s.includes("practice 2") || s.includes("fp2")) return "FP2";
  if (s.includes("practice 3") || s.includes("fp3")) return "FP3";
  if (s.includes("sprint qualifying") || s.includes("shootout")) return "Sprint Qualifying";
  if (s.includes("sprint") && !s.includes("qualifying")) return "Sprint";
  if (s.includes("qualifying") && !s.includes("sprint")) return "Qualifying";
  if (s.includes("race") || s.includes("grand prix")) return "Race";

  return null;
}

function shortDate(date) {
  return date.toLocaleDateString(LOCALE, {
    timeZone: USER_TZ,
    weekday: "short",
    month: "short",
    day: "2-digit",
  });
}

function shortTime(date) {
  return date.toLocaleTimeString(LOCALE, {
    timeZone: USER_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/* -------------------- MAIN -------------------- */

async function updateAllRaces() {
  console.log("🚀 Fetching ICS...");

  // 🔥 RELIABLE FETCH
  const res = await fetch(ICS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch ICS: ${res.status}`);
  }

  const icsText = await res.text();

  console.log("📦 Parsing ICS...");
  const data = ical.parseICS(icsText);

  const events = Object.values(data).filter(e => e.type === "VEVENT");

  console.log("📊 Total raw events:", events.length);

  // STEP 1: Extract sessions
  const sessions = events
    .map(ev => {
      const summary = ev.summary || "";
      const type = getSessionType(summary);

      if (!type) return null;

      const start = new Date(ev.start);
      const end = new Date(ev.end);

      if (isNaN(start) || isNaN(end)) return null;

      return {
        gpName: summary.split(" - ")[0].trim(),
        type,
        start,
        end,
        location: ev.location || "",
        summary
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  console.log("✅ Parsed sessions:", sessions.length);

  if (sessions.length === 0) {
    throw new Error("No sessions parsed — ICS structure may have changed.");
  }

  // STEP 2: Group by GP (FIXES CHINA BUG)
  const raceMap = new Map();

  for (const s of sessions) {
    const key = normalize(s.gpName);

    if (!raceMap.has(key)) {
      raceMap.set(key, {
        name: s.gpName,
        location: s.location,
        sessions: []
      });
    }

    raceMap.get(key).sessions.push(s);
  }

  let races = Array.from(raceMap.values());

  console.log("🏁 Unique races found:", races.length);

  // STEP 3: REMOVE Bahrain + Saudi
  races = races.filter(r => {
    const n = normalize(r.name);
    return !n.includes("bahrain") && !n.includes("saudiarabia");
  });

  console.log("🚫 After filtering:", races.length);

  // STEP 4: Sort races chronologically
  races.sort((a, b) => {
    const aStart = Math.min(...a.sessions.map(s => s.start));
    const bStart = Math.min(...b.sessions.map(s => s.start));
    return aStart - bStart;
  });

  // STEP 5: Format output
  const output = races.map((race, index) => {
    const sortedSessions = race.sessions.sort((a, b) => a.start - b.start);

    return {
      round: index + 1,
      name: race.name,
      location: race.location,
      sessions: sortedSessions.map(s => ({
        type: s.type,
        startUtc: s.start.toISOString(),
        endUtc: s.end.toISOString(),
        startLocalDate: shortDate(s.start),
        startLocalTime: shortTime(s.start)
      }))
    };
  });

  // STEP 6: WRITE FILE (GUARANTEED)
  const final = {
    generatedAt: new Date().toISOString(),
    totalRaces: output.length,
    races: output
  };

  await fs.writeFile(
    "f1_all_races.json",
    JSON.stringify(final, null, 2),
    "utf8"
  );

  console.log("✅ SUCCESS — wrote f1_all_races.json");
}

/* -------------------- RUN -------------------- */

updateAllRaces().catch(err => {
  console.error("❌ ERROR:", err.message);
  process.exit(1);
});
