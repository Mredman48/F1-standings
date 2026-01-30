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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 300)}`);
  }

  return res.json();
}

async function updateStandings() {
  const [champRows, driverRows] = await Promise.all([
    getJson(CHAMP_URL),
    getJson(DRIVERS_URL)
  ]);

  const byNumber = new Map();
  for (const d of driverRows) {
    byNumber.set(d.driver_number, d);
  }

  const season = new Date().getFullYear(); // fallback
  const session_key = champRows?.[0]?.session_key ?? "latest";

  const drivers = champRows
    .slice()
    .sort((a, b) => a.position_current - b.position_current)
    .map(row => {
      const info = byNumber.get(row.driver_number) || {};
      const full = info.full_name || "";
      const [first_name, ...rest] = full.split(" ");
      const last_name = rest.join(" ");

      return {
        position: row.position_current,
        driver_number: row.driver_number,
        first_name,
        last_name,
        team: info.team_name ?? null,
        points: row.points_current
      };
    });

  const output = {
    header: `${season} Driver Standings`,
    season,
    session_key,
    updated_at: new Date().toISOString(),
    drivers
  };

  fs.writeFileSync(
    "f1_driver_standings.json",
    JSON.stringify(output, null, 2)
  );
}

updateStandings();
