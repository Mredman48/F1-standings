// updateWeekendResults.js
import fs from "node:fs/promises";
import ical from "node-ical";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Calendar feed you already use
const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

// Ergast-compatible sources
const ERGAST_BASES = [
  "https://api.jolpi.ca/ergast/f1",
  "https://ergast.com/api/f1",
];

// OpenF1 for headshots (optional, best-effort)
const OPENF1_BASE = "https://api.openf1.org/v1";

function safeGet(obj, pathArr) {
  return pathArr.reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    redirect: "follow",
  });
  const text = await res.text();
  return { res, text };
}

async function fetchJson(url, headers = {}) {
  const { res, text } = await fetchText(url, { Accept: "application/json", ...headers });
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 160)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return data;
}

async function fetchErgastWithFallback(p) {
  const attempts = [];
  for (const base of ERGAST_BASES) {
    const url = `${base}${p}`;
    try {
      const data = await fetchJson(url);
      return { data, url, attempts };
    } catch (e) {
      attempts.push({ url, error: e?.message || String(e) });
    }
  }
  throw new Error(`All Ergast attempts failed: ${JSON.stringify(attempts, null, 2)}`);
}

function getSessionType(summary) {
  const s = String(summary || "").toLowerCase();
  if (s.includes("practice 1") || s.includes("fp1")) return "FP1";
  if (s.includes("practice 2") || s.includes("fp2")) return "FP2";
  if (s.includes("practice 3") || s.includes("fp3")) return "FP3";
  if (s.includes("sprint qualifying")) return "Sprint Qualifying";
  if (s.includes("sprint")) return "Sprint";
  if (s.includes("qualifying") || s.includes("quali")) return "Qualifying";
  if (s.includes("race")) return "Race";
  return null;
}

function getGpName(summary) {
  const parts = String(summary || "").split(" - ");
  return (parts[0] || summary || "").trim();
}

function isoDateOnly(d) {
  // YYYY-MM-DD in UTC
  return d.toISOString().slice(0, 10);
}

function parseIcsSessions(icsData) {
  const events = Object.values(icsData).filter((x) => x?.type === "VEVENT");

  const sessions = events
    .map((ev) => {
      const summary = (ev.summary || "").trim();
      const sessionType = getSessionType(summary);
      if (!sessionType) return null;

      const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
      const end = ev.end instanceof Date ? ev.end : new Date(ev.end);

      return {
        summary,
        gpName: getGpName(summary),
        sessionType,
        start,
        end,
        location: ev.location || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  return sessions;
}

function findNextRaceWeekend(sessions, now) {
  // Find next Race session in the future
  const nextRace = sessions.find((s) => s.sessionType === "Race" && s.start > now);
  if (!nextRace) return null;

  const gpName = nextRace.gpName;

  // All sessions for that GP
  const gpSessions = sessions.filter((s) => s.gpName === gpName).sort((a, b) => a.start - b.start);
  if (!gpSessions.length) return null;

  const weekendStart = gpSessions[0].start;
  const weekendEnd = gpSessions[gpSessions.length - 1].end;

  // Helpful lookup by type
  const byType = {};
  for (const s of gpSessions) byType[s.sessionType] = s;

  return {
    gpName,
    locationRaw: nextRace.location,
    weekendStart,
    weekendEnd,
    sessions: gpSessions,
    sessionByType: byType,
    raceStart: byType["Race"]?.start || nextRace.start,
    raceEnd: byType["Race"]?.end || nextRace.end,
    qualiEnd: byType["Qualifying"]?.end || null,
  };
}

async function getSeasonSchedule(seasonTag = "current") {
  // /current.json returns the schedule list of races
  const { data, url } = await fetchErgastWithFallback(`/${seasonTag}.json`);
  const races = safeGet(data, ["MRData", "RaceTable", "Races"]) || [];
  return { races, source: url };
}

function matchRaceByDate(races, raceStartUtc) {
  const targetDate = isoDateOnly(raceStartUtc);
  // Find schedule race whose date matches target date
  return races.find((r) => String(r.date) === targetDate) || null;
}

async function getQualifying(season, round) {
  const { data, url } = await fetchErgastWithFallback(`/${season}/${round}/qualifying.json`);
  const race = safeGet(data, ["MRData", "RaceTable", "Races", 0]) || null;
  const qualifying = race?.QualifyingResults || [];
  return { qualifying, source: url };
}

async function getRaceResults(season, round) {
  const { data, url } = await fetchErgastWithFallback(`/${season}/${round}/results.json`);
  const race = safeGet(data, ["MRData", "RaceTable", "Races", 0]) || null;
  const results = race?.Results || [];
  return { results, raceMeta: race, source: url };
}

async function getLastCompletedRace() {
  const { data, url } = await fetchErgastWithFallback(`/current/last/results.json`);
  const race = safeGet(data, ["MRData", "RaceTable", "Races", 0]) || null;
  if (!race) throw new Error("No last race found.");
  return { race, source: url };
}

// OpenF1 headshot map (best-effort)
async function getOpenF1DriverHeadshotsByYear(year) {
  try {
    // Pull most recent sessions for year, then drivers from latest race session.
    // If it fails, we just return empty map.
    const sessions = await fetchJson(`${OPENF1_BASE}/sessions?year=${encodeURIComponent(year)}&session_name=Race`);
    if (!Array.isArray(sessions) || sessions.length === 0) return new Map();
    sessions.sort((a, b) => String(b.date_start).localeCompare(String(a.date_start)));
    const sessionKey = sessions[0]?.session_key;
    if (!sessionKey) return new Map();

    const drivers = await fetchJson(`${OPENF1_BASE}/drivers?session_key=${encodeURIComponent(sessionKey)}`);
    const map = new Map();
    if (Array.isArray(drivers)) {
      for (const d of drivers) {
        if (d?.driver_number != null) {
          map.set(Number(d.driver_number), d.headshot_url || null);
        }
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function mapPodium(results, headshotMap) {
  return (results || [])
    .filter((r) => ["1", "2", "3"].includes(String(r.position)))
    .map((r) => {
      const d = r.Driver || {};
      const num = d.permanentNumber ? Number(d.permanentNumber) : null;

      return {
        position: `P${r.position}`,
        points: r.points ? Number(r.points) : null,
        status: r.status || null,
        time: r?.Time?.time || null,
        driver: {
          driverId: d.driverId || null,
          code: d.code || null,
          permanentNumber: num,
          givenName: d.givenName || null,
          familyName: d.familyName || null,
          headshotUrl: num != null ? headshotMap.get(num) || null : null,
          constructor: r?.Constructor?.name || null,
        },
      };
    });
}

function mapQualifying(qualifying, headshotMap) {
  return (qualifying || []).map((q) => {
    const d = q.Driver || {};
    const num = d.permanentNumber ? Number(d.permanentNumber) : null;

    return {
      position: `P${q.position}`,
      q1: q.Q1 || null,
      q2: q.Q2 || null,
      q3: q.Q3 || null,
      driver: {
        driverId: d.driverId || null,
        code: d.code || null,
        permanentNumber: num,
        givenName: d.givenName || null,
        familyName: d.familyName || null,
        headshotUrl: num != null ? headshotMap.get(num) || null : null,
        constructor: q?.Constructor?.name || null,
      },
    };
  });
}

function mapRaceResultsTimes(results, headshotMap) {
  // full classification times/status, not lap-by-lap
  return (results || []).map((r) => {
    const d = r.Driver || {};
    const num = d.permanentNumber ? Number(d.permanentNumber) : null;

    return {
      position: `P${r.position}`,
      points: r.points ? Number(r.points) : null,
      status: r.status || null,
      time: r?.Time?.time || null, // null for some statuses
      driver: {
        driverId: d.driverId || null,
        code: d.code || null,
        permanentNumber: num,
        givenName: d.givenName || null,
        familyName: d.familyName || null,
        headshotUrl: num != null ? headshotMap.get(num) || null : null,
        constructor: r?.Constructor?.name || null,
      },
    };
  });
}

async function updateWeekendResults() {
  const now = new Date();

  // --- 1) Read calendar sessions and identify next race weekend ---
  const icsData = await ical.async.fromURL(ICS_URL, {
    headers: { "User-Agent": UA },
  });
  const allSessions = parseIcsSessions(icsData);
  const nextWeekend = findNextRaceWeekend(allSessions, now);

  if (!nextWeekend) {
    throw new Error("Could not locate next race weekend from ICS feed.");
  }

  // --- 2) Match this weekend to an Ergast round using schedule date ---
  const sched = await getSeasonSchedule("current");
  const matchedRace = matchRaceByDate(sched.races, nextWeekend.raceStart);

  // If we can’t match, we still fallback to last race behavior.
  const currentSeason = matchedRace?.season || (sched.races?.[0]?.season ?? null);
  const currentRound = matchedRace?.round || null;
  const currentRaceName = matchedRace?.raceName || nextWeekend.gpName;

  // --- 3) Decide mode: pre-weekend vs in-weekend ---
  const weekendStarted = now >= nextWeekend.weekendStart;
  const weekendEnded = now > nextWeekend.weekendEnd;

  // --- 4) Headshot map (best-effort) ---
  const headshots = currentSeason ? await getOpenF1DriverHeadshotsByYear(Number(currentSeason)) : new Map();

  // --- 5) Build output based on your rule ---
  // Before weekend starts: show previous race data (fully populated)
  // Once weekend starts: lock to current event and null quali/race until sessions finish
  let status = "PRE_WEEKEND_SHOW_PREVIOUS";
  let weekend = null;
  let podium = null;
  let qualifying = null;
  let raceResultsTimes = null;

  if (!weekendStarted) {
    // Previous completed race
    const last = await getLastCompletedRace();
    const lastSeason = last.race?.season;
    const lastRound = last.race?.round;

    // Quali for last completed race
    const lastQual = await getQualifying(lastSeason, lastRound);

    status = "PRE_WEEKEND_SHOW_PREVIOUS";
    weekend = {
      type: "PREVIOUS_COMPLETED_RACE",
      season: lastSeason || null,
      round: lastRound || null,
      raceName: last.race?.raceName || null,
      date: last.race?.date || null,
      timeUtc: last.race?.time || null,
      circuit: {
        name: last.race?.Circuit?.circuitName || null,
        locality: last.race?.Circuit?.Location?.locality || null,
        country: last.race?.Circuit?.Location?.country || null,
      },
    };

    qualifying = mapQualifying(lastQual.qualifying, headshots);

    const lastResults = last.race?.Results || [];
    podium = mapPodium(lastResults, headshots);
    raceResultsTimes = mapRaceResultsTimes(lastResults, headshots);
  } else {
    // Weekend has started: focus on current event, but gate results by session end time
    status = "WEEKEND_IN_PROGRESS_RESULTS_GATED";

    weekend = {
      type: "CURRENT_WEEKEND",
      season: currentSeason ? String(currentSeason) : null,
      round: currentRound ? String(currentRound) : null,
      raceName: currentRaceName || null,
      weekendStartUtc: nextWeekend.weekendStart.toISOString(),
      weekendEndUtc: nextWeekend.weekendEnd.toISOString(),
      raceStartUtc: nextWeekend.raceStart.toISOString(),
      raceEndUtc: nextWeekend.raceEnd.toISOString(),
      qualifyingEndUtc: nextWeekend.qualiEnd ? nextWeekend.qualiEnd.toISOString() : null,
      sessionEnds: {
        qualifyingEnded: nextWeekend.qualiEnd ? now > nextWeekend.qualiEnd : null,
        raceEnded: now > nextWeekend.raceEnd,
      },
      locationRaw: nextWeekend.locationRaw,
    };

    // Qualifying: only after Qualifying ends
    const qualiEnded = nextWeekend.qualiEnd ? now > nextWeekend.qualiEnd : false;
    if (qualiEnded && currentSeason && currentRound) {
      try {
        const q = await getQualifying(currentSeason, currentRound);
        qualifying = mapQualifying(q.qualifying, headshots);
      } catch {
        qualifying = null;
      }
    } else {
      qualifying = null;
    }

    // Race results: only after Race ends
    const raceEnded = now > nextWeekend.raceEnd;
    if (raceEnded && currentSeason && currentRound) {
      try {
        const r = await getRaceResults(currentSeason, currentRound);
        podium = mapPodium(r.results, headshots);
        raceResultsTimes = mapRaceResultsTimes(r.results, headshots);
        status = weekendEnded ? "WEEKEND_COMPLETE_RESULTS_AVAILABLE" : "RACE_COMPLETE_RESULTS_AVAILABLE";
      } catch {
        podium = null;
        raceResultsTimes = null;
      }
    } else {
      podium = null;
      raceResultsTimes = null;
    }
  }

  const out = {
    header: "F1 results (smart mode)",
    generatedAtUtc: now.toISOString(),
    source: {
      ics: ICS_URL,
      schedule: sched.source,
      ergastBases: ERGAST_BASES,
      openf1: OPENF1_BASE,
    },
    mode: status,
    nextWeekendMeta: {
      gpName: nextWeekend.gpName,
      weekendStartUtc: nextWeekend.weekendStart.toISOString(),
      weekendEndUtc: nextWeekend.weekendEnd.toISOString(),
      raceStartUtc: nextWeekend.raceStart.toISOString(),
      raceEndUtc: nextWeekend.raceEnd.toISOString(),
      qualifyingEndUtc: nextWeekend.qualiEnd ? nextWeekend.qualiEnd.toISOString() : null,
      matchedErgast: {
        season: currentSeason ? String(currentSeason) : null,
        round: currentRound ? String(currentRound) : null,
        raceName: currentRaceName || null,
        matchedByRaceDateUtc: isoDateOnly(nextWeekend.raceStart),
      },
    },
    weekend,
    qualifying,       // null until quali ends (during weekend)
    podium,           // null until race ends (during weekend)
    raceResultsTimes, // null until race ends (during weekend)
    notes:
      "Rule: before weekendStart show previous completed race. After weekendStart, switch to current weekend but keep qualifying/race fields null until their session end times pass (from ICS).",
  };

  await fs.writeFile("f1_results_smart.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_results_smart.json (${status})`);
}

updateWeekendResults().catch((err) => {
  console.error(err);
  process.exit(1);
});