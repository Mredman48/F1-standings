import fs from "fs";

const UA = "f1-next-race-bot/1.0 (GitHub Actions)";
const CALENDAR_LANDING = "https://calendar.formula1.com/";

// ---------- helpers ----------
async function fetchText(url, accept = "*/*") {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Accept": accept,
    },
  });

  const text = await res.text();
  return { ok: res.ok, status: res.status, headers: res.headers, text, finalUrl: res.url };
}

// Unfold ICS lines (RFC: lines can be folded with CRLF + space)
function unfoldIcs(ics) {
  return ics.replace(/\r?\n[ \t]/g, "");
}

function parseIcsEvents(icsRaw) {
  const ics = unfoldIcs(icsRaw);
  const lines = ics.split(/\r?\n/);

  const events = [];
  let cur = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur) events.push(cur);
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;

      const left = line.slice(0, idx);
      const value = line.slice(idx + 1);

      // left can be like DTSTART;TZID=Europe/London or DTSTART
      const [key] = left.split(";");
      cur[key] = value;
    }
  }

  return events;
}

function icsDateToIso(dt) {
  // Common formats:
  // 20260308T060000Z  (UTC)
  // 20260308T060000   (floating / local; treat as UTC to be consistent)
  if (!dt) return null;
  const m = dt.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;

  const [, y, mo, d, hh, mm, ss] = m;
  const z = m[7] ? "Z" : "Z";
  return `${y}-${mo}-${d}T${hh}:${mm}:${ss}${z}`;
}

function toUnixSeconds(iso) {
  return iso ? Math.floor(new Date(iso).getTime() / 1000) : null;
}

function countdownParts(targetUnix) {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, targetUnix - now);

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);

  return { days, hours, minutes };
}

function normalizeSummary(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Try to extract a “weekend name” and session label from SUMMARY.
// Examples we handle:
// "FORMULA 1 AUSTRALIAN GRAND PRIX 2026 - Practice 1"
// "Formula 1: Australian Grand Prix - Qualifying"
// "Australian Grand Prix - Race"
function splitWeekendAndSession(summary) {
  const s = normalizeSummary(summary);

  // If it has " - " assume last part is session name
  const parts = s.split(" - ");
  if (parts.length >= 2) {
    const session = parts[parts.length - 1].trim();
    const weekend = parts.slice(0, -1).join(" - ").trim();
    return { weekend, session };
  }

  // Fallback: if contains ":" (some calendars do)
  const colonParts = s.split(":");
  if (colonParts.length >= 2) {
    return { weekend: colonParts.slice(1).join(":").trim(), session: null };
  }

  return { weekend: s, session: null };
}

function isRaceSession(sessionName) {
  const s = (sessionName || "").toLowerCase();
  return s === "race" || s.includes("grand prix") && s.includes("race") || s.includes("race");
}

// ---------- main ----------
async function updateNextRace() {
  const generatedAt = new Date().toISOString();

  // 1) Try to fetch ICS directly (some servers respond with calendar when Accept asks for it)
  let icsText = null;

  const direct = await fetchText(CALENDAR_LANDING, "text/calendar,*/*");
  if (direct.ok && /BEGIN:VCALENDAR/.test(direct.text)) {
    icsText = direct.text;
  } else {
    // 2) Otherwise: scrape for an .ics URL in the landing HTML
    // (calendar.formula1.com is JS-heavy, but it often still embeds/redirects to an ICS link)
    const html = direct.text || "";
    const icsUrlMatch =
      html.match(/https?:\/\/[^"' ]+\.ics[^"' ]*/i) ||
      html.match(/webcal:\/\/[^"' ]+\.ics[^"' ]*/i);

    if (!icsUrlMatch) {
      throw new Error(
        `Could not locate an ICS feed from ${CALENDAR_LANDING}. Status=${direct.status}`
      );
    }

    const rawUrl = icsUrlMatch[0].replace(/^webcal:\/\//i, "https://");
    const icsRes = await fetchText(rawUrl, "text/calendar,*/*");

    if (!icsRes.ok || !/BEGIN:VCALENDAR/.test(icsRes.text)) {
      throw new Error(
        `ICS fetch failed. url=${rawUrl} status=${icsRes.status} body=${icsRes.text.slice(0, 200)}`
      );
    }

    icsText = icsRes.text;
  }

  // Parse ICS events
  const vevents = parseIcsEvents(icsText);

  // Convert to normalized session objects
  const sessions = vevents
    .map(ev => {
      const isoStart = icsDateToIso(ev.DTSTART);
      const isoEnd = icsDateToIso(ev.DTEND);
      const startUnix = toUnixSeconds(isoStart);

      return {
        summary: normalizeSummary(ev.SUMMARY),
        location: ev.LOCATION ? normalizeSummary(ev.LOCATION) : null,
        description: ev.DESCRIPTION ? normalizeSummary(ev.DESCRIPTION) : null,
        start_utc: isoStart,
        end_utc: isoEnd,
        start_unix: startUnix,
        end_unix: toUnixSeconds(isoEnd),
      };
    })
    .filter(s => s.start_unix && s.start_unix > Math.floor(Date.now() / 1000) - 3600) // keep upcoming (with 1h grace)
    .sort((a, b) => a.start_unix - b.start_unix);

  if (sessions.length === 0) {
    throw new Error("No upcoming sessions found in calendar feed.");
  }

  // Identify the next weekend by taking the first upcoming session and grouping by its "weekend" token
  const first = sessions[0];
  const firstParts = splitWeekendAndSession(first.summary);
  const weekendKey = firstParts.weekend;

  const weekendSessions = sessions
    .filter(s => splitWeekendAndSession(s.summary).weekend === weekendKey)
    .sort((a, b) => a.start_unix - b.start_unix);

  const weekendStart = weekendSessions[0];

  // Find race session within the weekend group
  let race = weekendSessions.find(s => isRaceSession(splitWeekendAndSession(s.summary).session));
  if (!race) {
    // fallback: look for "Race" in summary
    race = weekendSessions.find(s => (s.summary || "").toLowerCase().includes("race"));
  }
  if (!race) {
    // Don’t hard fail—still publish weekend info. Race sometimes appears later in some feeds.
    // But provide countdowns if/when it exists.
    race = null;
  }

  const weekendStartCountdown = countdownParts(weekendStart.start_unix);
  const raceCountdown = race ? countdownParts(race.start_unix) : null;

  const output = {
    header: `Next F1 Weekend – ${weekendKey}`,
    generated_at_utc: generatedAt,

    countdowns: {
      race_weekend: {
        target: "weekend_start",
        weekend_start_utc: weekendStart.start_utc,
        weekend_start_unix: weekendStart.start_unix,
        days: weekendStartCountdown.days,
        hours: weekendStartCountdown.hours,
        minutes: weekendStartCountdown.minutes,
      },
      race: race
        ? {
            target: "race_start",
            race_start_utc: race.start_utc,
            race_start_unix: race.start_unix,
            days: raceCountdown.days,
            hours: raceCountdown.hours,
            minutes: raceCountdown.minutes,
          }
        : {
            target: "race_start",
            race_start_utc: null,
            race_start_unix: null,
            days: null,
            hours: null,
            minutes: null,
            note:
              "Race session not yet present in the calendar feed for this weekend (it may appear closer to the event). Weekend countdown and session list are still valid.",
          },
      note:
        "Countdown values are computed at build time. For a live ticking countdown, recompute using *_unix in your client.",
    },

    sessions: weekendSessions.map(s => {
      const parts = splitWeekendAndSession(s.summary);
      return {
        weekend: parts.weekend,
        session: parts.session, // e.g., Practice 1 / Qualifying / Sprint / Race (best effort)
        summary: s.summary,
        location: s.location,
        start_utc: s.start_utc,
        end_utc: s.end_utc,
        start_unix: s.start_unix,
        end_unix: s.end_unix,
      };
    }),
  };

  fs.writeFileSync("next_race.json", JSON.stringify(output, null, 2));
  console.log(`Wrote next_race.json for weekend: ${weekendKey}`);
}

updateNextRace();
