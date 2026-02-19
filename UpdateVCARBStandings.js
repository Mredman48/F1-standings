// UpdateVCARBStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0";
const OPENF1 = "https://api.openf1.org/v1";

// Team name variants (OpenF1 team_name can vary by season/branding)
const TEAM_NAME_CANDIDATES = [
  "Visa Cash App RB",
  "RB",
  "Racing Bulls",
  "Scuderia AlphaTauri", // historical fallback
  "AlphaTauri",          // historical fallback
];

function fmtPos(n) {
  return Number.isFinite(n) ? `P${n}` : null;
}

function arrowFromDelta(delta) {
  if (!Number.isFinite(delta) || delta === 0) return "—";
  return delta > 0 ? "↑" : "↓";
}

async function fetchJson(url, { timeoutMs = 20000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ac.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 250)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
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

async function getLatestVcarbDrivers() {
  // Pull all drivers for latest session, then filter to VCARB
  const url = `${OPENF1}/drivers?session_key=latest`;
  const drivers = await fetchJson(url);

  const vcarb = (drivers || []).filter((d) => isVcarbTeamName(d?.team_name));

  // De-dup by driver_number (sometimes multiple entries)
  const byNum = new Map();
  for (const d of vcarb) {
    if (d?.driver_number != null) byNum.set(Number(d.driver_number), d);
  }

  // Convert to array sorted by driver_number
  return [...byNum.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, d]) => d);
}

async function getDriverChampionshipFor(driverNumbers) {
  if (!driverNumbers.length) return [];

  const qs = driverNumbers.map((n) => `driver_number=${encodeURIComponent(n)}`).join("&");
  const url = `${OPENF1}/championship_drivers?session_key=latest&${qs}`;
  return await fetchJson(url);
}

async function getTeamChampionship() {
  // Try variants until OpenF1 returns a non-empty array
  for (const name of TEAM_NAME_CANDIDATES) {
    const url = `${OPENF1}/championship_teams?session_key=latest&team_name=${encodeURIComponent(name)}`;
    const data = await fetchJson(url);
    if (Array.isArray(data) && data.length > 0) {
      return { team_name: name, row: data[0] };
    }
  }
  return { team_name: null, row: null };
}

async function updateVcarbStandings() {
  const now = new Date();
  const year = now.getUTCFullYear();

  const vcarbDrivers = await getLatestVcarbDrivers();
  if (!vcarbDrivers.length) {
    throw new Error(
      "Could not find any VCARB drivers from OpenF1 drivers?session_key=latest. Team name may have changed."
    );
  }

  const driverNumbers = vcarbDrivers.map((d) => Number(d.driver_number)).filter(Number.isFinite);

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
        position_change: posDelta, // positive = gained places
        position_arrow: arrowFromDelta(posDelta),

        points_current: ptsCur,
        points_start: ptsStart,
        points_gained_in_latest_race: ptsDelta,
      };
    })
    // Sort by championship position if available
    .sort((a, b) => {
      if (a.position_current == null && b.position_current == null) return 0;
      if (a.position_current == null) return 1;
      if (b.position_current == null) return -1;
      return a.position_current - b.position_current;
    });

  const teamChamp = await getTeamChampionship();

  const teamRow = teamChamp.row;
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
      championship_teams: `${OPENF1}/championship_teams?session_key=latest&team_name=<team>`,
    },

    team: {
      display_name: "Visa Cash App RB",
      short_name: "VCARB",
      matched_team_name: teamChamp.team_name,
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