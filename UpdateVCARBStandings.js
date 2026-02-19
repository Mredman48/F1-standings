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

function isVcarbTeamName(teamName) {
  const t = normalize(teamName);
  return (
    t === "rb" ||
    t.includes("visa cash app") ||
    t.includes("racing bulls") ||
    t.includes("alphatauri")
  );
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

      // Handle rate limit
      if (res.status === 429) {
        const body = await res.text().catch(() => "");
        const backoff = 800 * Math.pow(2, attempt); // 0.8s, 1.6s, 3.2s...
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

async function getLatestVcarbDrivers() {
  // 1 call
  const drivers = await fetchJson(`${OPENF1}/drivers?session_key=latest`);

  const vcarb = (drivers || []).filter((d) => isVcarbTeamName(d?.team_name));

  // De-dup by driver_number
  const byNum = new Map();
  for (const d of vcarb) {
    if (d?.driver_number != null) byNum.set(Number(d.driver_number), d);
  }

  return [...byNum.values()].sort((a, b) => Number(a.driver_number) - Number(b.driver_number));
}

async function getDriverChampionshipFor(driverNumbers) {
  if (!driverNumbers.length) return [];

  // 1 call
  const qs = driverNumbers.map((n) => `driver_number=${encodeURIComponent(n)}`).join("&");
  return await fetchJson(`${OPENF1}/championship_drivers?session_key=latest&${qs}`);
}

async function getTeamChampionshipRow() {
  // 1 call for ALL teams, then filter locally (avoids multiple requests)
  const teams = await fetchJson(`${OPENF1}/championship_teams?session_key=latest`);

  const vcarb = (teams || []).find((t) => isVcarbTeamName(t?.team_name));
  return vcarb || null;
}

async function updateVcarbStandings() {
  const now = new Date();
  const year = now.getUTCFullYear();

  const vcarbDrivers = await getLatestVcarbDrivers();
  if (!vcarbDrivers.length) {
    throw new Error(
      "Could not find VCARB drivers from OpenF1 drivers?session_key=latest. Team name may have changed."
    );
  }

  const driverNumbers = vcarbDrivers
    .map((d) => Number(d.driver_number))
    .filter((n) => Number.isFinite(n));

  const champDrivers = await getDriverChampionshipFor(driverNumbers);
  const champByNum = new Map((champDrivers || []).map((r) => [Number(r.driver_number), r]));

  const driversOut = vcarbDrivers
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

  const teamRow = await getTeamChampionshipRow();

  const tPosCur = teamRow?.position_current != null ? Number(teamRow.position_current) : null;
  const tPosStart = teamRow?.position_start != null ? Number(teamRow.position_start) : null;
  const tPosDelta = Number.isFinite(tPosCur) && Number.isFinite(tPosStart) ? tPosStart - tPosCur : null;

  const tPtsCur = teamRow?.points_current != null ? Number(teamRow.points_current) : null;
  const tPtsStart = teamRow?.points_start != null ? Number(teamRow.points_start) : null;
  const tPtsDelta = Number.isFinite(tPtsCur) && Number.isFinite(tPtsStart) ? tPtsCur - tPtsStart : null;

  const out = {
    header: `${year} VCARB Standings`,
    generatedAtUtc: now.toISOString(),
    source: {
      provider: "OpenF1",
      drivers: `${OPENF1}/drivers?session_key=latest`,
      championship_drivers: `${OPENF1}/championship_drivers?session_key=latest&driver_number=${driverNumbers.join(
        "&driver_number="
      )}`,
      championship_teams: `${OPENF1}/championship_teams?session_key=latest`,
      note: "Requests are throttled (< 3/sec) with retry/backoff for 429 rate limits.",
    },

    team: {
      display_name: "VCARB",
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