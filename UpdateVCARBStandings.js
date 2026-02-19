// UpdateVCARBStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0";
const OPENF1 = "https://api.openf1.org/v1";

// Keep under OpenF1 max 3 req/sec
const MIN_DELAY_MS = 550; // ~1.8 req/sec
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttledFetch(url, options) {
  const now = Date.now();
  const wait = Math.max(0, MIN_DELAY_MS - (now - lastRequestAt));
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  return fetch(url, options);
}

async function fetchJson(url, { timeoutMs = 20000, retries = 5 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await throttledFetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: ac.signal,
      });

      if (res.status === 429) {
        const body = await res.text().catch(() => "");
        const backoff = 800 * Math.pow(2, attempt);
        console.warn(`OpenF1 429 (attempt ${attempt + 1}/${retries + 1}). Backing off ${backoff}ms.`);
        console.warn(body.slice(0, 200));
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 250)}`);
      }

      return await res.json();
    }

    throw new Error(`OpenF1 429 persisted after ${retries + 1} attempts for ${url}`);
  } finally {
    clearTimeout(t);
  }
}

function fmtPos(n) {
  return Number.isFinite(n) ? `P${n}` : null;
}

function arrowFromDelta(delta) {
  if (!Number.isFinite(delta) || delta === 0) return "—";
  return delta > 0 ? "↑" : "↓";
}

function normalize(s) {
  return (s || "").toLowerCase().trim();
}

// Your key requirement:
function isRacingBulls(teamName) {
  const t = normalize(teamName);
  return (
    t === "racing bulls" ||
    t.includes("racing bulls") ||
    t.includes("visa cash app") ||
    t === "rb" ||
    t.includes("alphatauri")
  );
}

// 1) Find the latest *Race* session_key (championship endpoints require race sessions)  [oai_citation:1‡OpenF1](https://openf1.org/docs/?utm_source=chatgpt.com)
async function getLatestRaceSessionKey() {
  // Query all Race sessions; use date_end sorting to find the latest completed/most recent race
  const url = `${OPENF1}/sessions?session_name=Race`;
  const sessions = await fetchJson(url);

  if (!Array.isArray(sessions) || sessions.length === 0) {
    throw new Error("OpenF1 returned no Race sessions from /sessions?session_name=Race");
  }

  // Prefer the most recent by date_end, fallback to date_start
  const sorted = [...sessions].sort((a, b) => {
    const aEnd = a?.date_end ? Date.parse(a.date_end) : NaN;
    const bEnd = b?.date_end ? Date.parse(b.date_end) : NaN;
    const aStart = a?.date_start ? Date.parse(a.date_start) : NaN;
    const bStart = b?.date_start ? Date.parse(b.date_start) : NaN;

    const aKey = Number.isFinite(aEnd) ? aEnd : aStart;
    const bKey = Number.isFinite(bEnd) ? bEnd : bStart;

    return bKey - aKey;
  });

  const latest = sorted[0];
  if (!latest?.session_key) {
    throw new Error("Could not determine latest Race session_key from sessions list");
  }

  return {
    session_key: latest.session_key,
    meeting_name: latest.meeting_name ?? null,
    circuit_short_name: latest.circuit_short_name ?? null,
    country_name: latest.country_name ?? null,
    date_start: latest.date_start ?? null,
    date_end: latest.date_end ?? null,
    year: latest.year ?? null,
  };
}

// 2) Get Racing Bulls drivers from latest session (works fine for driver metadata)
async function getRacingBullsDriversLatest() {
  const drivers = await fetchJson(`${OPENF1}/drivers?session_key=latest`);
  const rb = (drivers || []).filter((d) => isRacingBulls(d?.team_name));

  // de-dupe by driver_number
  const byNum = new Map();
  for (const d of rb) {
    if (d?.driver_number != null) byNum.set(Number(d.driver_number), d);
  }
  return [...byNum.values()].sort((a, b) => Number(a.driver_number) - Number(b.driver_number));
}

// 3) Championship standings for those drivers — MUST use race session_key  [oai_citation:2‡OpenF1](https://openf1.org/docs/?utm_source=chatgpt.com)
async function getChampionshipDrivers(sessionKey, driverNumbers) {
  const qs = driverNumbers.map((n) => `driver_number=${encodeURIComponent(n)}`).join("&");
  const url = `${OPENF1}/championship_drivers?session_key=${encodeURIComponent(sessionKey)}&${qs}`;
  return await fetchJson(url);
}

// 4) Teams standings — fetch all teams for that race session_key and filter locally
async function getChampionshipTeamRow(sessionKey) {
  const url = `${OPENF1}/championship_teams?session_key=${encodeURIComponent(sessionKey)}`;
  const teams = await fetchJson(url);
  return (teams || []).find((t) => isRacingBulls(t?.team_name)) || null;
}

async function updateVcarbStandings() {
  const now = new Date();
  const year = now.getUTCFullYear();

  const race = await getLatestRaceSessionKey();

  const rbDrivers = await getRacingBullsDriversLatest();
  if (!rbDrivers.length) {
    throw new Error(
      'Could not find Racing Bulls drivers from /drivers?session_key=latest. You said they appear under "Racing Bulls"—if so, this means OpenF1 field names changed.'
    );
  }

  const driverNumbers = rbDrivers
    .map((d) => Number(d.driver_number))
    .filter((n) => Number.isFinite(n));

  const champDrivers = await getChampionshipDrivers(race.session_key, driverNumbers);
  const champByNum = new Map((champDrivers || []).map((r) => [Number(r.driver_number), r]));

  const driversOut = rbDrivers
    .map((d) => {
      const num = Number(d.driver_number);
      const c = champByNum.get(num);

      const posCur = c?.position_current != null ? Number(c.position_current) : null;
      const posStart = c?.position_start != null ? Number(c.position_start) : null;
      const posDelta = Number.isFinite(posCur) && Number.isFinite(posStart) ? posStart - posCur : null;

      const ptsCur = c?.points_current != null ? Number(c.points_current) : null;
      const ptsStart = c?.points_start != null ? Number(c.points_start) : null;
      const ptsDelta = Number.isFinite(ptsCur) && Number.isFinite(ptsStart) ? ptsCur - ptsStart : null;

      return {
        driver_number: num,
        acronym: d?.name_acronym ?? null,
        first_name: d?.first_name ?? null,
        last_name: d?.last_name ?? null,
        full_name: d?.full_name ?? null,
        headshot_url: d?.headshot_url ?? null,

        team_name: d?.team_name ?? null,
        team_colour: d?.team_colour ?? null,

        position: fmtPos(posCur),
        position_current: posCur,
        position_start: posStart,
        position_change: posDelta,
        position_arrow: arrowFromDelta(posDelta),

        points_current: ptsCur,
        points_start: ptsStart,
        points_gained_in_latest_race: ptsDelta,
      };
    })
    .sort((a, b) => {
      if (a.position_current == null && b.position_current == null) return 0;
      if (a.position_current == null) return 1;
      if (b.position_current == null) return -1;
      return a.position_current - b.position_current;
    });

  const teamRow = await getChampionshipTeamRow(race.session_key);

  const tPosCur = teamRow?.position_current != null ? Number(teamRow.position_current) : null;
  const tPosStart = teamRow?.position_start != null ? Number(teamRow.position_start) : null;
  const tPosDelta = Number.isFinite(tPosCur) && Number.isFinite(tPosStart) ? tPosStart - tPosCur : null;

  const tPtsCur = teamRow?.points_current != null ? Number(teamRow.points_current) : null;
  const tPtsStart = teamRow?.points_start != null ? Number(teamRow.points_start) : null;
  const tPtsDelta = Number.isFinite(tPtsCur) && Number.isFinite(tPtsStart) ? tPtsCur - tPtsStart : null;

  const out = {
    header: `${year} Racing Bulls Standings`,
    generatedAtUtc: now.toISOString(),
    source: {
      provider: "OpenF1",
      note:
        "Championship endpoints require a Race session_key (OpenF1 docs). This file uses the latest Race session_key from /sessions.", //  [oai_citation:3‡OpenF1](https://openf1.org/docs/?utm_source=chatgpt.com)
      latest_race_session: race,
      urls: {
        sessions_race: `${OPENF1}/sessions?session_name=Race`,
        drivers_latest: `${OPENF1}/drivers?session_key=latest`,
        championship_drivers: `${OPENF1}/championship_drivers?session_key=${race.session_key}&driver_number=${driverNumbers.join(
          "&driver_number="
        )}`,
        championship_teams: `${OPENF1}/championship_teams?session_key=${race.session_key}`,
      },
    },

    team: {
      display_name: "Racing Bulls",
      matched_team_name: teamRow?.team_name ?? null,

      position: fmtPos(tPosCur),
      position_current: tPosCur,
      position_start: tPosStart,
      position_change: tPosDelta,
      position_arrow: arrowFromDelta(tPosDelta),

      points_current: tPtsCur,
      points_start: tPtsStart,
      points_gained_in_latest_race: tPtsDelta,
    },

    drivers: driversOut,
  };

  await fs.writeFile("vcarb_standings.json", JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote vcarb_standings.json");
}

updateVcarbStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});