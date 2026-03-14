import fs from "node:fs/promises";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const YEAR = new Date().getUTCFullYear();
const OPENF1_BASE = "https://api.openf1.org/v1";
const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";
const OUTPUT_FILE = "f1_season_event_results.json";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeEventType(sessionName) {
  const s = cleanText(sessionName).toLowerCase();
  if (s === "race") return "race";
  if (s === "sprint") return "sprint";
  return s || "-";
}

function normalizePosition(row) {
  if (row?.dsq === true) return "DSQ";
  if (row?.dns === true) return "DNS";
  if (row?.dnf === true) return "DNF";

  const pos = Number(row?.position);
  if (Number.isFinite(pos) && pos > 0) return `P${pos}`;

  return "-";
}

function resultRank(position) {
  const p = String(position || "").toUpperCase().trim();
  if (/^P\d+$/.test(p)) return Number(p.slice(1));
  return Infinity;
}

function isBetterResult(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;

  const a = resultRank(candidate.position);
  const b = resultRank(current.position);

  const aClassified = Number.isFinite(a) && a !== Infinity;
  const bClassified = Number.isFinite(b) && b !== Infinity;

  if (aClassified && !bClassified) return true;
  if (!aClassified && bClassified) return false;
  if (aClassified && bClassified) {
    if (a < b) return true;
    if (a > b) return false;
  }

  const ad = String(candidate.date || "");
  const bd = String(current.date || "");
  return ad < bd;
}

function normalizeKey(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildFormattedRaceName(meetingName, eventType) {
  const base = cleanText(meetingName) || "-";
  if (base === "-") return "-";
  return eventType === "sprint" ? `${base} Sprint` : base;
}

async function fetchJson(url, { allow401 = false } = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
    redirect: "follow",
  });

  const text = await res.text();

  if (res.status === 401 && allow401) {
    return {
      __authLocked: true,
      status: 401,
      url,
      body: text,
    };
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }

  return JSON.parse(text);
}

async function getCompletedRaceAndSprintSessions(year) {
  const sessions = await fetchJson(
    `${OPENF1_BASE}/sessions?year=${year}&session_name=Race&session_name=Sprint`,
    { allow401: true }
  );

  if (sessions?.__authLocked) {
    throw new Error(
      "OpenF1 is auth-locked right now. Try again after the live-session restriction ends."
    );
  }

  return (sessions || [])
    .filter((s) => {
      const name = cleanText(s?.session_name);
      const isTarget = name === "Race" || name === "Sprint";
      const endMs = new Date(s?.date_end || s?.date_start || 0).getTime();
      return isTarget && Number.isFinite(endMs) && endMs > 0 && endMs <= Date.now();
    })
    .sort((a, b) => {
      const da = new Date(a?.date_start || 0).getTime();
      const db = new Date(b?.date_start || 0).getTime();
      return da - db;
    });
}

async function getSessionResults(session) {
  const sessionKey = Number(session?.session_key);
  if (!Number.isFinite(sessionKey)) return [];

  const rows = await fetchJson(
    `${OPENF1_BASE}/session_result?session_key=${sessionKey}`,
    { allow401: true }
  );

  if (rows?.__authLocked) {
    throw new Error(
      `OpenF1 became auth-locked while reading session_result for session_key=${sessionKey}`
    );
  }

  return rows || [];
}

async function getSeasonSchedule(year) {
  const data = await fetchJson(`${JOLPICA_BASE}/${year}.json`);
  const races = data?.MRData?.RaceTable?.Races || [];

  return races.map((race) => ({
    round: Number(race?.round) || null,
    raceName: cleanText(race?.raceName) || "-",
    date: race?.date || "-",
    circuit: cleanText(race?.Circuit?.circuitName) || "-",
    locality: cleanText(race?.Circuit?.Location?.locality) || "-",
    country: cleanText(race?.Circuit?.Location?.country) || "-",
  }));
}

function attachScheduleToSessions(sessions, schedule) {
  const races = sessions.filter(
    (s) => normalizeEventType(s?.session_name) === "race"
  );

  const scheduleByRaceSessionKey = new Map();

  for (let i = 0; i < races.length; i += 1) {
    const session = races[i];
    const scheduleRace = schedule[i] || null;
    if (!scheduleRace) continue;

    const meetingKey = Number(session?.meeting_key);
    const sessionKey = Number(session?.session_key);

    if (Number.isFinite(sessionKey)) {
      scheduleByRaceSessionKey.set(sessionKey, scheduleRace);
    }

    if (Number.isFinite(meetingKey)) {
      for (const s of sessions) {
        if (Number(s?.meeting_key) === meetingKey) {
          const sk = Number(s?.session_key);
          if (Number.isFinite(sk)) {
            scheduleByRaceSessionKey.set(sk, scheduleRace);
          }
        }
      }
    }
  }

  return scheduleByRaceSessionKey;
}

function buildSessionObject(session, rows, scheduleMeta) {
  const eventType = normalizeEventType(session?.session_name);
  const sessionKey = Number(session?.session_key);

  const openf1MeetingName = cleanText(session?.meeting_name);
  const jolpicaRaceName = cleanText(scheduleMeta?.raceName);
  const meetingName = openf1MeetingName || jolpicaRaceName || "-";

  const locationLocality =
    cleanText(session?.location) ||
    cleanText(scheduleMeta?.locality) ||
    "-";

  const locationCountry =
    cleanText(session?.country_name) ||
    cleanText(scheduleMeta?.country) ||
    "-";

  const circuit =
    cleanText(session?.circuit_short_name) ||
    cleanText(scheduleMeta?.circuit) ||
    "-";

  const drivers = rows
    .map((row) => ({
      driverNumber: Number(row?.driver_number) || null,
      position: normalizePosition(row),
      positionRank: resultRank(normalizePosition(row)),
      classifiedPosition:
        Number.isFinite(Number(row?.position)) && Number(row?.position) > 0
          ? Number(row.position)
          : null,
      dnf: row?.dnf === true,
      dns: row?.dns === true,
      dsq: row?.dsq === true,
      duration: row?.duration ?? null,
      gapToLeader: row?.gap_to_leader ?? null,
      laps: row?.number_of_laps ?? null,
      sessionKey: Number(row?.session_key) || sessionKey,
      meetingKey: Number(row?.meeting_key) || Number(session?.meeting_key) || null,
    }))
    .filter((d) => Number.isFinite(d.driverNumber) && d.driverNumber > 0)
    .sort((a, b) => {
      const ar = a.positionRank;
      const br = b.positionRank;
      const aOk = Number.isFinite(ar) && ar !== Infinity;
      const bOk = Number.isFinite(br) && br !== Infinity;
      if (aOk && bOk) return ar - br;
      if (aOk) return -1;
      if (bOk) return 1;
      return a.driverNumber - b.driverNumber;
    });

  return {
    eventType,
    sessionKey,
    meetingKey: Number(session?.meeting_key) || null,
    meetingName,
    raceName: buildFormattedRaceName(meetingName, eventType),
    sessionName: cleanText(session?.session_name) || "-",
    officialName: cleanText(session?.session_name) || "-",
    round: scheduleMeta?.round ?? null,
    dateStartUtc: session?.date_start || null,
    dateEndUtc: session?.date_end || null,
    date: String(session?.date_start || "").slice(0, 10) || "-",
    circuit,
    location: {
      locality: locationLocality,
      country: locationCountry,
    },
    drivers,
  };
}

function buildBestByDriver(events) {
  const best = {};

  for (const event of events) {
    for (const driver of event.drivers || []) {
      const key = String(driver.driverNumber);

      const candidate = {
        driverNumber: driver.driverNumber,
        position: driver.position,
        eventType: event.eventType,
        meetingName: event.meetingName,
        raceName: event.raceName,
        sessionName: event.sessionName,
        round: event.round,
        date: event.date,
        dateStartUtc: event.dateStartUtc,
        circuit: event.circuit,
        location: event.location,
        sessionKey: event.sessionKey,
        meetingKey: event.meetingKey,
      };

      if (isBetterResult(candidate, best[key])) {
        best[key] = candidate;
      }
    }
  }

  return best;
}

async function buildSeasonResults() {
  const [sessions, schedule] = await Promise.all([
    getCompletedRaceAndSprintSessions(YEAR),
    getSeasonSchedule(YEAR),
  ]);

  const scheduleBySessionKey = attachScheduleToSessions(sessions, schedule);
  const events = [];

  for (const session of sessions) {
    const rows = await getSessionResults(session);
    const scheduleMeta =
      scheduleBySessionKey.get(Number(session?.session_key)) || null;

    const event = buildSessionObject(session, rows, scheduleMeta);
    events.push(event);

    console.log(
      `Loaded ${event.raceName} (${event.date}) with ${event.drivers.length} drivers`
    );

    await sleep(120);
  }

  const bestByDriverNumber = buildBestByDriver(events);

  const out = {
    header: `${YEAR} F1 race and sprint results`,
    generatedAtUtc: new Date().toISOString(),
    season: YEAR,
    source: {
      primary: "OpenF1 sessions + session_result",
      enrichment: "Jolpica season schedule",
      note:
        "Meeting names come from OpenF1 when available, with Jolpica used to enrich round, circuit, and location data.",
    },
    events,
    bestByDriverNumber,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");

  console.log(
    `Wrote ${OUTPUT_FILE} with ${events.length} events and ${Object.keys(bestByDriverNumber).length} driver bests`
  );
}

buildSeasonResults().catch((err) => {
  console.error(err);
  process.exit(1);
});
