// updateAllRaces.js
import fs from "node:fs/promises";
import ical from "node-ical";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

/* -------------------- helpers -------------------- */

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/formula 1/g, "")
    .replace(/grand prix/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function getSessionType(summary) {
  const s = summary.toLowerCase();

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
  const ics = await ical.async.fromURL(ICS_URL);

  const events = Object.values(ics).filter(e => e.type === "VEVENT");

  // STEP 1: Extract ALL sessions
  const sessions = events
    .map(ev => {
      const summary = ev.summary || "";
      const sessionType = getSessionType(summary);

      if (!sessionType) return null;

      return {
        gpName: summary.split(" - ")[0].trim(),
        sessionType,
        start: new Date(ev.start),
        end: new Date(ev.end),
        location: ev.location || "",
        summary
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  // STEP 2: Group by race weekend (KEY FIX HERE)
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

  // STEP 3: Convert to array
  let races = Array.from(raceMap.values());

  // STEP 4: REMOVE Bahrain + Saudi Arabia (your requirement)
  races = races.filter(r => {
    const n = normalize(r.name);

    return (
      !n.includes("bahrain") &&
      !n.includes("saudiarabia")
    );
  });

  // STEP 5: Sort races by first session date
  races.sort((a, b) => {
    const aStart = Math.min(...a.sessions.map(s => s.start));
    const bStart = Math.min(...b.sessions.map(s => s.start));
    return aStart - bStart;
  });

  // STEP 6: Format output
  const output = races.map((race, index) => {
    const sessionsSorted = race.sessions.sort((a, b) => a.start - b.start);

    return {
      round: index + 1,
      name: race.name,
      location: race.location,
      sessions: sessionsSorted.map(s => ({
        type: s.sessionType,
        startUtc: s.start.toISOString(),
        endUtc: s.end.toISOString(),
        startLocalDate: shortDate(s.start),
        startLocalTime: shortTime(s.start)
      }))
    };
  });

  // STEP 7: Write file
  await fs.writeFile(
    "f1_all_races.json",
    JSON.stringify({ races: output }, null, 2)
  );

  console.log("✅ Built f1_all_races.json with", output.length, "races");
}

updateAllRaces().catch(err => {
  console.error(err);
  process.exit(1);
});
