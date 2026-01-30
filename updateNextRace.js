// updateNextRace.js
import fs from "node:fs/promises";
import ical from "node-ical";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

function daysUntil(date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
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
  // common patterns: "X GP - Y" or "X Grand Prix - Y"
  const parts = summary.split(" - ");
  return parts[0]?.trim() || summary.trim();
}

async function updateNextRace() {
  const now = new Date();

  // node-ical can fetch and parse the ICS for you
  const data = await ical.async.fromURL(ICS_URL, {
    headers: {
      // some CDNs behave better with a UA
      "User-Agent": "f1-standings-bot/1.0",
    },
  });

  // Pull VEVENTs only
  const events = Object.values(data).filter((x) => x?.type === "VEVENT");

  // Keep only session events we recognize
  const sessions = events
    .map((ev) => {
      const summary = (ev.summary || "").trim();
      const sessionType = getSessionType(summary);
      if (!sessionType) return null;

      // node-ical returns Date objects in JS Date type
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

  // Find the next Race session in the future
  const nextRace = sessions.find((s) => s.sessionType === "Race" && s.start > now);
  if (!nextRace) {
    throw new Error("Could not find upcoming Race session in calendar feed.");
  }

  // Group all sessions with same gpName that fall within that weekend window.
  // Safer than matching by date range alone: use gpName and proximity.
  const gpName = nextRace.gpName;

  const gpSessions = sessions
    .filter((s) => s.gpName === gpName)
    .sort((a, b) => a.start - b.start);

  // Weekend boundaries
  const weekendStart = gpSessions[0].start;
  const weekendEnd = gpSessions[gpSessions.length - 1].end;

  // Build a predictable output structure
  const sessionOrder = ["FP1", "FP2", "FP3", "Qualifying", "Sprint Qualifying", "Sprint", "Race"];
  const sessionsOut = sessionOrder
    .map((type) => {
      const s = gpSessions.find((x) => x.sessionType === type);
      if (!s) return null;
      return {
        type,
        startUtc: s.start.toISOString(),
        endUtc: s.end.toISOString(),
      };
    })
    .filter(Boolean);

  const out = {
    header: `Next F1 race weekend`,
    generatedAtUtc: now.toISOString(),
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
    },
    sessions: sessionsOut,
    // Tip for consumers:
    notes: "All times are UTC. Render in local time in the client (e.g., new Date(startUtc).toLocaleString()).",
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json for ${gpName}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});
