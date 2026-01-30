// updateNextRace.js
import fs from "node:fs/promises";
import ical from "node-ical";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

// Set this to YOUR timezone for Widgy display
// If you want it to always show event/track local time instead, say so and I’ll adjust.
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA"; // change to "en-US" if you prefer

function daysUntil(date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// Short date like: "Fri, Mar 07"
function shortDateInTZ(dateObj, timeZone = USER_TZ) {
  return dateObj.toLocaleDateString(LOCALE, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "2-digit",
  });
}

// Short time like: "10:30 AM"
function shortTimeInTZ(dateObj, timeZone = USER_TZ) {
  return dateObj.toLocaleTimeString(LOCALE, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortDateTimeInTZ(dateObj, timeZone = USER_TZ) {
  // "Fri, Mar 07 10:30 AM"
  return `${shortDateInTZ(dateObj, timeZone)} ${shortTimeInTZ(dateObj, timeZone)}`;
}

// Try to normalize a session label from event summary
function getSessionType(summary) {
  const s = summary.toLowerCase();

  if (s.includes("practice 1") || s.includes("fp1")) return "FP1";
  if (s.includes("practice 2") || s.includes("fp2")) return "FP2";
  if (s.includes("practice 3") || s.includes("fp3")) return "FP3";
  if (s.includes("sprint qualifying")) return "Sprint Qualifying";
  if (s.includes("sprint")) return "Sprint";
  if (s.includes("qualifying") || s.includes("quali")) return "Qualifying";
  if (s.includes("race")) return "Race";

  return null;
}

// Extract GP name (best-effort) from summary like "Australian GP - Race"
function getGpName(summary) {
  const parts = summary.split(" - ");
  return parts[0]?.trim() || summary.trim();
}

async function updateNextRace() {
  const now = new Date();

  const data = await ical.async.fromURL(ICS_URL, {
    headers: {
      "User-Agent": "f1-standings-bot/1.0",
    },
  });

  const events = Object.values(data).filter((x) => x?.type === "VEVENT");

  const sessions = events
    .map((ev) => {
      const summary = (ev.summary || "").trim();
      const sessionType = getSessionType(summary);
      if (!sessionType) return null;

      const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
      const end = ev.end instanceof Date ? ev.end : new Date(ev.end);

      return {
        uid: ev.uid,
        summary,
        gpName: getGpName(summary),
        sessionType,
        start,
        end,
        location: ev.location || null,
        description: ev.description || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const nextRace = sessions.find((s) => s.sessionType === "Race" && s.start > now);
  if (!nextRace) {
    throw new Error("Could not find upcoming Race session in calendar feed.");
  }

  const gpName = nextRace.gpName;

  const gpSessions = sessions
    .filter((s) => s.gpName === gpName)
    .sort((a, b) => a.start - b.start);

  const weekendStart = gpSessions[0].start;
  const weekendEnd = gpSessions[gpSessions.length - 1].end;

  const sessionOrder = ["FP1", "FP2", "FP3", "Qualifying", "Sprint Qualifying", "Sprint", "Race"];
  const sessionsOut = sessionOrder
    .map((type) => {
      const s = gpSessions.find((x) => x.sessionType === type);
      if (!s) return null;

      return {
        type,

        // Machine-friendly (UTC)
        startUtc: s.start.toISOString(),
        endUtc: s.end.toISOString(),

        // Widgy-friendly (your local timezone)
        startLocalDateShort: shortDateInTZ(s.start),
        startLocalTimeShort: shortTimeInTZ(s.start),
        startLocalDateTimeShort: shortDateTimeInTZ(s.start),

        endLocalDateShort: shortDateInTZ(s.end),
        endLocalTimeShort: shortTimeInTZ(s.end),
        endLocalDateTimeShort: shortDateTimeInTZ(s.end),
      };
    })
    .filter(Boolean);

  const out = {
    header: `Next F1 race weekend`,
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ, // tells Widgy users what the “local” strings are

    source: {
      kind: "ics",
      url: ICS_URL,
    },

    grandPrix: {
      name: gpName,
      location: nextRace.location,
    },

    countdowns: {
      weekendStartsInDays: daysUntil(weekendStart, now),
      raceStartsInDays: daysUntil(nextRace.start, now),
    },

    weekend: {
      startUtc: weekendStart.toISOString(),
      endUtc: weekendEnd.toISOString(),

      // Widgy-friendly (your local timezone)
      startLocalDateShort: shortDateInTZ(weekendStart),
      startLocalTimeShort: shortTimeInTZ(weekendStart),
      startLocalDateTimeShort: shortDateTimeInTZ(weekendStart),

      endLocalDateShort: shortDateInTZ(weekendEnd),
      endLocalTimeShort: shortTimeInTZ(weekendEnd),
      endLocalDateTimeShort: shortDateTimeInTZ(weekendEnd),
    },

    race: {
      startUtc: nextRace.start.toISOString(),
      endUtc: nextRace.end.toISOString(),

      // Widgy-friendly (your local timezone)
      startLocalDateShort: shortDateInTZ(nextRace.start),
      startLocalTimeShort: shortTimeInTZ(nextRace.start),
      startLocalDateTimeShort: shortDateTimeInTZ(nextRace.start),
    },

    sessions: sessionsOut,

    notes:
      "Times are provided as UTC (startUtc/endUtc) plus pre-formatted short local strings for Widgy (startLocalDateShort/startLocalTimeShort). If you share this endpoint with others, the 'local' strings will be Edmonton time unless you change USER_TZ.",
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json for ${gpName}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});
