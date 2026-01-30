import fs from "fs";

const UA = "f1-next-race-bot/1.0 (GitHub Actions)";
const API = "https://api.openf1.org/v1";

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json"
    },
    redirect: "follow"
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}\n${txt.slice(0, 400)}`);
  }

  return res.json();
}

function toUnixSeconds(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function buildCountdownParts(targetUnix) {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, targetUnix - now);

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);

  return { days, hours, minutes };
}

// Convert a UTC ISO string to "track-local" ISO-like string using meeting gmt_offset like "08:00:00" or "-03:00:00"
function toTrackLocalIso(utcIso, gmtOffset) {
  if (!utcIso || !gmtOffset) return null;

  const sign = gmtOffset.startsWith("-") ? -1 : 1;
  const [hh, mm, ss] = gmtOffset.replace("-", "").split(":").map(Number);
  const offsetMs = sign * ((hh * 3600 + mm * 60 + (ss || 0)) * 1000);

  const t = new Date(utcIso).getTime() + offsetMs;
  const d = new Date(t);

  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function pickWeekendStartSession(sessions) {
  // Choose the earliest session by date_start — robust across Sprint/format changes
  if (!sessions.length) return null;
  return sessions.slice().sort((a, b) => new Date(a.date_start) - new Date(b.date_start))[0];
}

function pickRaceSession(sessions) {
  // Prefer explicit "Race" session_name; fallback to session_type
  return (
    sessions.find(s => (s.session_name || "").toLowerCase() === "race") ||
    sessions.find(s => (s.session_type || "").toLowerCase() === "race") ||
    null
  );
}

async function updateNextRace() {
  const nowIso = new Date().toISOString();
  const year = new Date().getUTCFullYear();

  // Find next upcoming meeting (race weekend)
  const meetings = await getJson(
    `${API}/meetings?year=${year}&date_start>=${encodeURIComponent(nowIso)}`
  );

  if (!Array.isArray(meetings) || meetings.length === 0) {
    throw new Error(`No upcoming meetings found for year ${year} after ${nowIso}`);
  }

  meetings.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
  const next = meetings[0];

  // Fetch all sessions for that meeting
  const sessions = await getJson(`${API}/sessions?meeting_key=${next.meeting_key}`);
  if (!Array.isArray(sessions) || sessions.length === 0) {
    throw new Error(`No sessions found for meeting_key ${next.meeting_key}`);
  }

  sessions.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

  const weekendStart = pickWeekendStartSession(sessions);
  const race = pickRaceSession(sessions);

  if (!weekendStart) throw new Error("Could not determine weekend start session");
  if (!race) throw new Error("Could not find Race session");

  const weekendStartUnix = toUnixSeconds(weekendStart.date_start);
  const raceStartUnix = toUnixSeconds(race.date_start);

  const weekendCountdown = buildCountdownParts(weekendStartUnix);
  const raceCountdown = buildCountdownParts(raceStartUnix);

  const output = {
    header: `Next F1 Race – ${next.meeting_name}`,
    generated_at_utc: nowIso,

    meeting: {
      year: next.year,
      meeting_key: next.meeting_key,
      meeting_name: next.meeting_name,
      meeting_official_name: next.meeting_official_name ?? null,
      country_name: next.country_name,
      location: next.location,
      circuit_short_name: next.circuit_short_name,
      gmt_offset: next.gmt_offset,
      date_start_utc: next.date_start,
      date_end_utc: next.date_end
    },

    countdowns: {
      race_weekend: {
        target: "weekend_start",
        weekend_start_session_name: weekendStart.session_name,
        weekend_start_utc: weekendStart.date_start,
        weekend_start_unix: weekendStartUnix,
        days: weekendCountdown.days,
        hours: weekendCountdown.hours,
        minutes: weekendCountdown.minutes
      },
      race: {
        target: "race_start",
        race_start_utc: race.date_start,
        race_start_unix: raceStartUnix,
        days: raceCountdown.days,
        hours: raceCountdown.hours,
        minutes: raceCountdown.minutes
      },
      note:
        "Countdown values are computed at build time. For a live ticking countdown, use the *_unix timestamps in your client and recompute."
    },

    sessions: sessions.map(s => ({
      session_key: s.session_key,
      session_name: s.session_name,
      session_type: s.session_type,

      date_start_utc: s.date_start,
      date_end_utc: s.date_end,
      date_start_unix: toUnixSeconds(s.date_start),
      date_end_unix: toUnixSeconds(s.date_end),

      // Track-local time derived from gmt_offset (not end-user local)
      date_start_track_local: toTrackLocalIso(s.date_start, next.gmt_offset),
      date_end_track_local: toTrackLocalIso(s.date_end, next.gmt_offset)
    }))
  };

  fs.writeFileSync("next_race.json", JSON.stringify(output, null, 2));
  console.log(`Wrote next_race.json for ${next.meeting_name}`);
}

updateNextRace();
