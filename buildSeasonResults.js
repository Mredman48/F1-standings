import fs from "node:fs/promises";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const YEAR = new Date().getUTCFullYear();
const OPENF1_BASE = "https://api.openf1.org/v1";
const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";
const OUTPUT_FILE = "f1_season_event_results.json";
const FALLBACK_DRIVERS_FILE = "fallback_drivers.json";

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
  if (s === "qualifying") return "qualifying";

  if (s === "sprint shootout") return "sprint_shootout";
  if (s === "sprint qualifying") return "sprint_shootout";
  if (s.includes("sprint shootout")) return "sprint_shootout";
  if (s.includes("sprint qualifying")) return "sprint_shootout";

  if (s === "practice 1" || s === "fp1") return "fp1";
  if (s === "practice 2" || s === "fp2") return "fp2";
  if (s === "practice 3" || s === "fp3") return "fp3";

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

function buildFormattedRaceName(baseRaceName, eventType) {
  const base = cleanText(baseRaceName) || "-";
  if (base === "-") return "-";
  return eventType === "sprint" ? `${base} Sprint` : base;
}

async function fetchJson(url, { allow401 = false, allow404 = false, retries = 5 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
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

    if (res.status === 404 && allow404) {
      return [];
    }

    if (res.status === 429) {
      if (attempt === retries) {
        throw new Error(`HTTP 429 from ${url}\n${text}`);
      }
      const waitMs = 1200 + attempt * 800;
      console.warn(`429 for ${url}. Retrying in ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    if ([500, 502, 503, 504].includes(res.status)) {
      if (attempt === retries) {
        throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
      }
      const waitMs = 1500 + attempt * 1200;
      console.warn(`HTTP ${res.status} for ${url}. Retrying in ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
    }

    return JSON.parse(text);
  }

  throw new Error(`Failed to fetch ${url}`);
}

async function loadFallbackDrivers() {
  try {
    const raw = await fs.readFile(FALLBACK_DRIVERS_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(`${FALLBACK_DRIVERS_FILE} is not an object. Ignoring fallback file.`);
      return {};
    }

    return parsed;
  } catch (err) {
    if (err?.code === "ENOENT") {
      console.warn(`${FALLBACK_DRIVERS_FILE} not found. Continuing without fallback driver enrichment.`);
      return {};
    }

    throw err;
  }
}

function getFallbackDriver(fallbackDrivers, driverNumber) {
  if (!Number.isFinite(driverNumber) || driverNumber <= 0) return null;

  const entry = fallbackDrivers[String(driverNumber)];
  if (!entry || typeof entry !== "object") return null;

  return {
    name:
      cleanText(entry.name) ||
      cleanText(entry.fullName) ||
      cleanText(entry.driverName) ||
      null,
    team:
      cleanText(entry.team) ||
      cleanText(entry.teamName) ||
      cleanText(entry.constructor) ||
      null,
  };
}

function needsFallbackDriverEnrichment(driver) {
  const hasName = cleanText(driver?.driverName);
  const hasTeam = cleanText(driver?.teamName);

  return !hasName || !hasTeam;
}

function enrichDriverWithFallback(driver, fallbackDrivers) {
  if (!needsFallbackDriverEnrichment(driver)) {
    return driver;
  }

  const fallback = getFallbackDriver(fallbackDrivers, driver.driverNumber);
  if (!fallback) {
    return driver;
  }

  return {
    ...driver,
    driverName: cleanText(driver.driverName) || fallback.name || null,
    teamName: cleanText(driver.teamName) || fallback.team || null,
  };
}

async function getCompletedTargetSessions(year) {
  const targetSessionNames = [
    "Practice 1",
    "Practice 2",
    "Practice 3",
    "Qualifying",
    "Sprint Shootout",
    "Sprint Qualifying",
    "Sprint",
    "Race",
  ];

  const results = await Promise.all(
    targetSessionNames.map((sessionName) =>
      fetchJson(
        `${OPENF1_BASE}/sessions?year=${year}&session_name=${encodeURIComponent(sessionName)}`,
        {
          allow401: true,
          allow404: true,
        }
      )
    )
  );

  if (results.some((r) => r?.__authLocked)) {
    throw new Error(
      "OpenF1 is auth-locked right now. Try again after the live-session restriction ends."
    );
  }

  const merged = results
    .flatMap((r) => (Array.isArray(r) ? r : []))
    .filter((s) => {
      const name = cleanText(s?.session_name);
      const isTarget = targetSessionNames.includes(name);
      const endMs = new Date(s?.date_end || s?.date_start || 0).getTime();
      return isTarget && Number.isFinite(endMs) && endMs > 0 && endMs <= Date.now();
    });

  const dedupedBySessionKey = new Map();

  for (const session of merged) {
    const sessionKey = Number(session?.session_key);
    if (!Number.isFinite(sessionKey)) continue;

    if (!dedupedBySessionKey.has(sessionKey)) {
      dedupedBySessionKey.set(sessionKey, session);
    }
  }

  return Array.from(dedupedBySessionKey.values()).sort((a, b) => {
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
    { allow401: true, retries: 5 }
  );

  if (rows?.__authLocked) {
    throw new Error(
      `OpenF1 became auth-locked while reading session_result for session_key=${sessionKey}`
    );
  }

  return rows || [];
}

async function getMeetingsByKey(year) {
  try {
    const meetings = await fetchJson(`${OPENF1_BASE}/meetings?year=${year}`, {
      allow401: true,
      retries: 5,
    });

    if (meetings?.__authLocked) {
      throw new Error(
        "OpenF1 is auth-locked right now. Try again after the live-session restriction ends."
      );
    }

    const map = new Map();

    for (const m of meetings || []) {
      const key = Number(m?.meeting_key);
      if (!Number.isFinite(key)) continue;

      map.set(key, {
        meetingKey: key,
        meetingName: cleanText(m?.meeting_name) || "",
        meetingOfficialName: cleanText(m?.meeting_official_name) || "",
        countryName: cleanText(m?.country_name) || "",
        locality: cleanText(m?.location) || "",
        circuit: cleanText(m?.circuit_short_name) || "",
        dateStartUtc: m?.date_start || null,
        dateEndUtc: m?.date_end || null,
      });
    }

    return map;
  } catch (err) {
    console.warn(
      `OpenF1 meetings unavailable, falling back to Jolpica schedule only: ${err.message}`
    );
    return new Map();
  }
}

async function getSeasonSchedule(year) {
  const data = await fetchJson(`${JOLPICA_BASE}/${year}.json`);
  const races = data?.MRData?.RaceTable?.Races || [];

  return races.map((race) => ({
    round: Number(race?.round) || null,
    raceName: cleanText(race?.raceName) || "",
    date: race?.date || "",
    circuit: cleanText(race?.Circuit?.circuitName) || "",
    locality: cleanText(race?.Circuit?.Location?.locality) || "",
    country: cleanText(race?.Circuit?.Location?.country) || "",
  }));
}

function buildMeetingScheduleMap(sessions, meetingsByKey, schedule) {
  const uniqueMeetingKeys = [
    ...new Set(
      sessions
        .map((s) => Number(s?.meeting_key))
        .filter((k) => Number.isFinite(k))
    ),
  ];

  const completedMeetings = uniqueMeetingKeys
    .map((meetingKey) => {
      const meeting = meetingsByKey.get(meetingKey);
      const firstSession = sessions.find((s) => Number(s?.meeting_key) === meetingKey);

      return {
        meetingKey,
        sortDate: meeting?.dateStartUtc || firstSession?.date_start || "",
      };
    })
    .sort((a, b) => String(a.sortDate).localeCompare(String(b.sortDate)));

  const byMeetingKey = new Map();

  for (let i = 0; i < completedMeetings.length; i += 1) {
    const item = completedMeetings[i];
    const scheduleRace = schedule[i] || null;
    if (!scheduleRace) continue;
    byMeetingKey.set(item.meetingKey, scheduleRace);
  }

  return byMeetingKey;
}

function normalizeMaybeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildQualifyingTimes(durationValue) {
  if (Array.isArray(durationValue)) {
    const q1 = normalizeMaybeNumber(durationValue[0]);
    const q2 = normalizeMaybeNumber(durationValue[1]);
    const q3 = normalizeMaybeNumber(durationValue[2]);
    const valid = [q1, q2, q3].filter((v) => Number.isFinite(v));

    return {
      q1,
      q2,
      q3,
      bestQualifyingTime: valid.length ? Math.min(...valid) : null,
    };
  }

  const single = normalizeMaybeNumber(durationValue);
  return {
    q1: single,
    q2: null,
    q3: null,
    bestQualifyingTime: single,
  };
}

function buildSessionObject(session, rows, meetingMeta, scheduleMeta, fallbackDrivers) {
  const eventType = normalizeEventType(session?.session_name);
  const sessionKey = Number(session?.session_key);

  const meetingName =
    cleanText(meetingMeta?.meetingName) ||
    cleanText(meetingMeta?.meetingOfficialName) ||
    cleanText(scheduleMeta?.raceName) ||
    "-";

  const raceName = buildFormattedRaceName(meetingName, eventType);

  const locationLocality =
    cleanText(meetingMeta?.locality) ||
    cleanText(session?.location) ||
    cleanText(scheduleMeta?.locality) ||
    "-";

  const locationCountry =
    cleanText(meetingMeta?.countryName) ||
    cleanText(session?.country_name) ||
    cleanText(scheduleMeta?.country) ||
    "-";

  const circuit =
    cleanText(meetingMeta?.circuit) ||
    cleanText(session?.circuit_short_name) ||
    cleanText(scheduleMeta?.circuit) ||
    "-";

  const isQualifyingStyle =
    eventType === "qualifying" || eventType === "sprint_shootout";

  const drivers = rows
    .map((row) => {
      const qualifyingTimes = isQualifyingStyle
        ? buildQualifyingTimes(row?.duration)
        : null;

      const normalizedPosition = normalizePosition(row);
      const driverNumber = Number(row?.driver_number) || null;

      const rawDriver = {
        driverNumber,
        driverName:
          cleanText(row?.full_name) ||
          cleanText(row?.broadcast_name) ||
          cleanText(row?.driver_name) ||
          cleanText(row?.name) ||
          null,
        teamName:
          cleanText(row?.team_name) ||
          cleanText(row?.constructor_name) ||
          cleanText(row?.team) ||
          null,
        position: normalizedPosition,
        positionRank: resultRank(normalizedPosition),
        classifiedPosition:
          Number.isFinite(Number(row?.position)) && Number(row?.position) > 0
            ? Number(row.position)
            : null,
        dnf: row?.dnf === true,
        dns: row?.dns === true,
        dsq: row?.dsq === true,
        duration: isQualifyingStyle ? null : row?.duration ?? null,
        qualifyingTimes,
        gapToLeader: row?.gap_to_leader ?? null,
        laps: row?.number_of_laps ?? null,
        points: row?.points ?? null,
        sessionKey: Number(row?.session_key) || sessionKey,
        meetingKey: Number(row?.meeting_key) || Number(session?.meeting_key) || null,
      };

      return enrichDriverWithFallback(rawDriver, fallbackDrivers);
    })
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
    raceName,
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

function buildGridLookupFromQualifyingEvents(events) {
  const lookup = new Map();

  for (const event of events) {
    const meetingKey = Number(event?.meetingKey);
    if (!Number.isFinite(meetingKey)) continue;

    const type = String(event?.eventType || "").toLowerCase();
    if (type !== "qualifying" && type !== "sprint_shootout") continue;

    const byDriver = new Map();

    for (const driver of event.drivers || []) {
      const driverNumber = Number(driver?.driverNumber);
      if (!Number.isFinite(driverNumber)) continue;

      byDriver.set(driverNumber, {
        startPosition: driver.position,
        startPositionRank:
          Number.isFinite(driver.positionRank) && driver.positionRank !== Infinity
            ? driver.positionRank
            : null,
        qualifyingLapTime: driver.qualifyingTimes?.bestQualifyingTime ?? null,
        qualifyingTimes: driver.qualifyingTimes ?? null,
      });
    }

    lookup.set(`${meetingKey}:${type}`, byDriver);
  }

  return lookup;
}

function enrichRaceAndSprintEvents(events, qualifyingLookup) {
  return events.map((event) => {
    const type = String(event?.eventType || "").toLowerCase();
    if (type !== "race" && type !== "sprint") {
      return event;
    }

    const meetingKey = Number(event?.meetingKey);

    let grid = null;
    if (type === "race") {
      grid = qualifyingLookup.get(`${meetingKey}:qualifying`) || null;
    } else if (type === "sprint") {
      grid =
        qualifyingLookup.get(`${meetingKey}:sprint_shootout`) ||
        qualifyingLookup.get(`${meetingKey}:qualifying`) ||
        null;
    }

    return {
      ...event,
      drivers: (event.drivers || []).map((driver) => {
        const gridInfo = grid?.get(Number(driver.driverNumber)) || null;

        return {
          ...driver,
          startPosition: gridInfo?.startPosition ?? null,
          startPositionRank: gridInfo?.startPositionRank ?? null,
          qualifyingLapTime: gridInfo?.qualifyingLapTime ?? null,
          qualifyingTimes: gridInfo?.qualifyingTimes ?? null,
        };
      }),
    };
  });
}

function buildBestByDriver(events) {
  const best = {};

  for (const event of events) {
    for (const driver of event.drivers || []) {
      const key = String(driver.driverNumber);

      const candidate = {
        driverNumber: driver.driverNumber,
        driverName: driver.driverName ?? null,
        teamName: driver.teamName ?? null,
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
  const [sessions, meetingsByKey, schedule, fallbackDrivers] = await Promise.all([
    getCompletedTargetSessions(YEAR),
    getMeetingsByKey(YEAR),
    getSeasonSchedule(YEAR),
    loadFallbackDrivers(),
  ]);

  const scheduleByMeetingKey = buildMeetingScheduleMap(
    sessions,
    meetingsByKey,
    schedule
  );

  const allEvents = [];

  for (const session of sessions) {
    const rows = await getSessionResults(session);
    const meetingKey = Number(session?.meeting_key);
    const meetingMeta = meetingsByKey.get(meetingKey) || null;
    const scheduleMeta = scheduleByMeetingKey.get(meetingKey) || null;

    const event = buildSessionObject(
      session,
      rows,
      meetingMeta,
      scheduleMeta,
      fallbackDrivers
    );

    allEvents.push(event);

    const enrichedCount = event.drivers.filter(
      (d) => cleanText(d.driverName) && cleanText(d.teamName)
    ).length;

    console.log(
      `Loaded ${event.sessionName} for ${event.raceName} (${event.date}) with ${event.drivers.length} drivers (${enrichedCount} with name+team)`
    );

    await sleep(450);
  }

  const qualifyingLookup = buildGridLookupFromQualifyingEvents(allEvents);
  const enrichedEvents = enrichRaceAndSprintEvents(allEvents, qualifyingLookup);

  const events = enrichedEvents;

  const competitiveEventsForBests = enrichedEvents.filter((event) => {
    const type = String(event?.eventType || "").toLowerCase();
    return type === "race" || type === "sprint";
  });

  const bestByDriverNumber = buildBestByDriver(competitiveEventsForBests);

  const out = {
    header: `${YEAR} F1 all session results`,
    generatedAtUtc: new Date().toISOString(),
    season: YEAR,
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
