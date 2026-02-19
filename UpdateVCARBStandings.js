// UpdateVCARBStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0";
const OPENF1 = "https://api.openf1.org/v1";

// REQUIRED placeholders (always present if data missing or partial)
const PLACEHOLDERS = [
  {
    driver_number: 30,
    acronym: "LAW",
    first_name: "Liam",
    last_name: "Lawson",
    full_name: "Liam Lawson",
  },
  {
    driver_number: 41,
    acronym: "LIN",
    first_name: "Arvid",
    last_name: "Lindblad",
    full_name: "Arvid Lindblad",
  },
];

function fmtPos(n) {
  return Number.isFinite(n) ? `P${n}` : "P—";
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
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 200)}`);
  }
  return res.json();
}

function makePlaceholderRow(p) {
  return {
    driver_number: p.driver_number,
    acronym: p.acronym,
    first_name: p.first_name,
    last_name: p.last_name,
    full_name: p.full_name,
    headshot_url: null,

    team_name: "Racing Bulls",
    team_colour: "#1E41FF",

    position: "P—",
    position_current: null,
    position_change: null,
    position_arrow: "—",

    points_current: 0,
    placeholder: true,
  };
}

/**
 * Enforce placeholders:
 * - If driversOut empty => use both placeholders
 * - If driversOut missing Liam or Arvid => append missing placeholders
 * - Keep stable order by driver_number
 */
function enforcePlaceholders(driversOut) {
  const list = Array.isArray(driversOut) ? [...driversOut] : [];

  // Build a set of present driver_numbers
  const presentNums = new Set(
    list
      .map((d) => Number(d?.driver_number))
      .filter((n) => Number.isFinite(n))
  );

  // If empty, force both placeholders
  if (list.length === 0) {
    return PLACEHOLDERS.map(makePlaceholderRow).sort(
      (a, b) => a.driver_number - b.driver_number
    );
  }

  // If missing specific placeholders, add them
  for (const p of PLACEHOLDERS) {
    if (!presentNums.has(p.driver_number)) {
      list.push(makePlaceholderRow(p));
      presentNums.add(p.driver_number);
    }
  }

  // Sort for consistent widget order
  list.sort((a, b) => Number(a.driver_number) - Number(b.driver_number));

  return list;
}

async function updateVcarbStandings() {
  const now = new Date();
  const year = now.getUTCFullYear();

  let driversOut = [];
  let teamOut = {
    display_name: "Racing Bulls",
    matched_team_name: null,
    position: "P—",
    position_current: null,
    position_change: null,
    position_arrow: "—",
    points_current: 0,
    placeholder: true,
  };

  let placeholderMode = false;
  let debug = { mode: "unknown", reason: null };

  try {
    // --- Try live data (best-effort) ---
    const sessions = await fetchJson(`${OPENF1}/sessions?session_name=Race`);
    const latestRace = Array.isArray(sessions) ? sessions[0] : null;
    if (!latestRace?.session_key) throw new Error("No race session key found");

    const drivers = await fetchJson(`${OPENF1}/drivers?session_key=latest`);
    const rbDrivers = (drivers || []).filter((d) => isRacingBulls(d?.team_name));

    if (!rbDrivers.length) throw new Error('No drivers returned for team "Racing Bulls"');

    // Build driver list without relying on championship endpoints (they can be empty/off)
    driversOut = rbDrivers.map((d) => ({
      driver_number: Number(d.driver_number),
      acronym: d?.name_acronym ?? null,
      first_name: d?.first_name ?? null,
      last_name: d?.last_name ?? null,
      full_name: d?.full_name ?? null,
      headshot_url: d?.headshot_url ?? null,
      team_name: d?.team_name ?? null,
      team_colour: d?.team_colour ?? null,

      // leave standings blank unless you add championship data later
      position: "P—",
      position_current: null,
      position_change: null,
      position_arrow: "—",
      points_current: 0,

      placeholder: false,
    }));

    // Team block stays best-effort; you can wire championship_teams later
    teamOut = {
      display_name: "Racing Bulls",
      matched_team_name: "Racing Bulls",
      position: "P—",
      position_current: null,
      position_change: null,
      position_arrow: "—",
      points_current: 0,
      placeholder: false,
    };

    debug = { mode: "live-drivers-only", reason: "OpenF1 driver list succeeded" };
  } catch (err) {
    placeholderMode = true;
    debug = { mode: "placeholder", reason: err?.message || String(err) };
    driversOut = []; // will be filled by enforcePlaceholders()
  }

  // 🔒 Guarantee placeholders are present
  const finalDrivers = enforcePlaceholders(driversOut);

  // If we had to inject any placeholders, mark placeholderMode true
  const injectedAny = finalDrivers.some((d) => d.placeholder === true);
  if (injectedAny) placeholderMode = true;

  const out = {
    header: `${year} Racing Bulls Standings`,
    generatedAtUtc: now.toISOString(),
    placeholder: placeholderMode,
    debug,
    team: teamOut,
    drivers: finalDrivers,
  };

  await fs.writeFile("vcarb_standings.json", JSON.stringify(out, null, 2), "utf8");
  console.log(
    `Wrote vcarb_standings.json (${placeholderMode ? "PLACEHOLDERS ENFORCED" : "LIVE"})`
  );
}

updateVcarbStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});