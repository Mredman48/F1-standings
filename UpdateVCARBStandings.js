// UpdateVCARBStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0";
const OPENF1 = "https://api.openf1.org/v1";

const PLACEHOLDER_DRIVERS = [
  {
    driver_number: 30,
    acronym: "LAW",
    first_name: "Liam",
    last_name: "Lawson",
    full_name: "Liam Lawson",
  },
  {
    driver_number: 99,
    acronym: "LIN",
    first_name: "Arvid",
    last_name: "Lindblad",
    full_name: "Arvid Lindblad",
  },
];

function fmtPos(n) {
  return Number.isFinite(n) ? `P${n}` : "P—";
}

function arrowFromDelta(delta) {
  if (!Number.isFinite(delta) || delta === 0) return "—";
  return delta > 0 ? "↑" : "↓";
}

function normalize(s) {
  return (s || "").toLowerCase().trim();
}

function isRacingBulls(teamName) {
  const t = normalize(teamName);
  return (
    t === "racing bulls" ||
    t.includes("racing bulls") ||
    t.includes("visa cash app") ||
    t === "rb"
  );
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return await res.json();
}

async function updateVcarbStandings() {
  const now = new Date();
  const year = now.getUTCFullYear();

  let driversOut = [];
  let teamOut = null;
  let placeholderMode = false;

  try {
    // --- Attempt to fetch real data ---
    const sessions = await fetchJson(`${OPENF1}/sessions?session_name=Race`);
    const latestRace = sessions?.[0];

    if (!latestRace?.session_key) throw new Error("No race session key");

    const drivers = await fetchJson(`${OPENF1}/drivers?session_key=latest`);
    const rbDrivers = (drivers || []).filter((d) =>
      isRacingBulls(d?.team_name)
    );

    if (!rbDrivers.length) throw new Error("No RB drivers returned");

    const driverNumbers = rbDrivers
      .map((d) => Number(d.driver_number))
      .filter((n) => Number.isFinite(n));

    const champDrivers = await fetchJson(
      `${OPENF1}/championship_drivers?session_key=${latestRace.session_key}&driver_number=${driverNumbers.join(
        "&driver_number="
      )}`
    );

    const champByNum = new Map(
      (champDrivers || []).map((r) => [Number(r.driver_number), r])
    );

    driversOut = rbDrivers.map((d) => {
      const num = Number(d.driver_number);
      const c = champByNum.get(num);

      const posCur = c?.position_current ?? null;
      const posStart = c?.position_start ?? null;
      const posDelta =
        Number.isFinite(posCur) && Number.isFinite(posStart)
          ? posStart - posCur
          : null;

      return {
        driver_number: num,
        acronym: d?.name_acronym ?? null,
        first_name: d?.first_name ?? null,
        last_name: d?.last_name ?? null,
        full_name: d?.full_name ?? null,
        team_name: d?.team_name ?? null,
        team_colour: d?.team_colour ?? null,

        position: fmtPos(posCur),
        position_current: posCur,
        position_change: posDelta,
        position_arrow: arrowFromDelta(posDelta),
        points_current: c?.points_current ?? 0,
      };
    });

    const teams = await fetchJson(
      `${OPENF1}/championship_teams?session_key=${latestRace.session_key}`
    );

    const teamRow = (teams || []).find((t) =>
      isRacingBulls(t?.team_name)
    );

    teamOut = {
      display_name: "Racing Bulls",
      matched_team_name: teamRow?.team_name ?? null,
      position: fmtPos(teamRow?.position_current),
      position_current: teamRow?.position_current ?? null,
      position_arrow: arrowFromDelta(
        teamRow?.position_start != null && teamRow?.position_current != null
          ? teamRow.position_start - teamRow.position_current
          : null
      ),
      points_current: teamRow?.points_current ?? 0,
    };
  } catch (err) {
    console.warn("OpenF1 failed, using placeholders:", err.message);
    placeholderMode = true;

    driversOut = PLACEHOLDER_DRIVERS.map((d) => ({
      ...d,
      team_name: "Racing Bulls",
      team_colour: "#1E41FF",
      position: "P—",
      position_current: null,
      position_change: null,
      position_arrow: "—",
      points_current: 0,
    }));

    teamOut = {
      display_name: "Racing Bulls",
      matched_team_name: null,
      position: "P—",
      position_current: null,
      position_arrow: "—",
      points_current: 0,
    };
  }

  const out = {
    header: `${year} Racing Bulls Standings`,
    generatedAtUtc: now.toISOString(),
    placeholder: placeholderMode,

    team: teamOut,
    drivers: driversOut,
  };

  await fs.writeFile(
    "vcarb_standings.json",
    JSON.stringify(out, null, 2),
    "utf8"
  );

  console.log(
    `Wrote vcarb_standings.json (${placeholderMode ? "PLACEHOLDER MODE" : "LIVE DATA"})`
  );
}

updateVcarbStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});