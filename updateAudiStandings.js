// updateAudiStandings.js
import fs from "node:fs";

// OpenF1 endpoints (championship standings are "beta" and available for race sessions)
const DRIVERS_CHAMP_URL = "https://api.openf1.org/v1/championship_drivers?session_key=latest";
const TEAMS_CHAMP_URL = "https://api.openf1.org/v1/championship_teams?session_key=latest";
const DRIVERS_INFO_URL = "https://api.openf1.org/v1/drivers?session_key=latest";

const OUT_FILE = "audi_standings.json";

// Configure the match rules here.
// In 2026 it may be "Audi", but depending on feed it could still be "Sauber" or "Kick Sauber".
// Add/adjust as needed.
const TEAM_MATCH = [
  "audi",
  "sauber",      // optional fallback
  "kick sauber", // optional fallback
];

function isAudiTeamName(name) {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return TEAM_MATCH.some((needle) => n.includes(needle));
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "f1-standings-bot/1.0",
      "Accept": "application/json",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} fetching ${url}\n${text.slice(0, 300)}`);
  }
  return res.json();
}

function splitName(fullName) {
  const full = (fullName || "").trim();
  if (!full) return { first_name: null, last_name: null };

  const parts = full.split(/\s+/);
  return {
    first_name: parts[0] ?? null,
    last_name: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

async function updateAudiStandings() {
  // Pull:
  // - driver standings (positions/points)
  // - team standings (positions/points)
  // - driver info (to map driver_number -> team_name + names)
  const [champDrivers, champTeams, driversInfo] = await Promise.all([
    getJson(DRIVERS_CHAMP_URL),
    getJson(TEAMS_CHAMP_URL),
    getJson(DRIVERS_INFO_URL),
  ]);

  // Map driver_number -> info (team_name, full_name, etc.)
  const infoByNumber = new Map();
  for (const d of driversInfo) infoByNumber.set(d.driver_number, d);

  // Filter drivers to Audi team
  const audiDrivers = (champDrivers || [])
    .map((row) => {
      const info = infoByNumber.get(row.driver_number) || {};
      const team = info.team_name ?? null;
      if (!isAudiTeamName(team)) return null;

      // Prefer API-provided name parts when present
      const first_name = info.first_name ?? splitName(info.full_name).first_name;
      const last_name = info.last_name ?? splitName(info.full_name).last_name;

      return {
        driver_number: row.driver_number,
        first_name,
        last_name,
        team_name: team,
        position: Number(row.position_current),
        positionLabel: `P${Number(row.position_current)}`,
        points: Number(row.points_current),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.position - b.position);

  // Filter constructor to Audi team
  const audiTeamRows = (champTeams || [])
    .filter((t) => isAudiTeamName(t.team_name))
    .map((t) => ({
      team_name: t.team_name,
      position: Number(t.position_current),
      positionLabel: `P${Number(t.position_current)}`,
      points: Number(t.points_current),
    }))
    .sort((a, b) => a.position - b.position);

  // Most likely only one match, but keep array just in case naming changes
  const out = {
    header: `${new Date().getFullYear()} Audi Standings`,
    updated_at_utc: new Date().toISOString(),
    source: "openf1",
    team_match_rules: TEAM_MATCH,
    drivers: audiDrivers,
    constructors: audiTeamRows,
    notes:
      "Drivers are filtered by team_name from /v1/drivers?session_key=latest. Adjust TEAM_MATCH if OpenF1 uses a different Audi naming in a given season.",
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_FILE} (drivers=${audiDrivers.length}, constructors=${audiTeamRows.length})`);
}

updateAudiStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});