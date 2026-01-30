import fs from "fs";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const CHAMP_URL = "https://api.openf1.org/v1/championship_drivers?session_key=latest";
const DRIVERS_URL = "https://api.openf1.org/v1/drivers?session_key=latest";

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json"
    }
  });

  const contentType = res.headers.get("content-type") || "";

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 500)}`);
  }

  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(`Non-JSON response for ${url}\n${text.slice(0, 500)}`);
  }

  return res.json();
}

async function updateStandings() {
  const [champRows, driverRows] = await Promise.all([
    getJson(CHAMP_URL),
    getJson(DRIVERS_URL)
  ]);

  // Build driver lookup by number
  const byNumber = new Map();
  for (const d of driverRows) {
    // OpenF1 "drivers" includes fields like full_name, team_name, etc.
    byNumber.set(d.driver_number, d);
  }

  // champRows fields: driver_number, points_current, position_current, session_key, meeting_key, ...
  const session_key = champRows?.[0]?.session_key ?? "latest";
  const meeting_key = champRows?.[0]?.meeting_key ?? null;

  const drivers = champRows
    .slice()
    .sort((a, b) => (a.position_current ?? 999) - (b.position_current ?? 999))
    .map((row) => {
      const info = byNumber.get(row.driver_number) || {};
      return {
        position: row.position_current,
        driver_number: row.driver_number,
        driver: info.full_name ?? null,
        team: info.team_name ?? null,
        points: row.points_current
      };
    });

  const output = {
    source: "openf1",
    session_key,
    meeting_key,
    updated_at: new Date().toISOString(),
    drivers
  };

  fs.writeFileSync("f1_driver_standings.json", JSON.stringify(output, null, 2));
  console.log(`Wrote f1_driver_standings.json (${drivers.length} drivers)`);
}

updateStandings();
