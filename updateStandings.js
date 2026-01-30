import fs from "fs";

const URL = "https://ergast.com/api/f1/current/driverStandings.json";

async function updateStandings() {
  const res = await fetch(URL, {
    headers: {
      "User-Agent": "f1-standings-bot/1.0 (GitHub Actions)"
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP error ${res.status}`);
  }

  const data = await res.json();

  const standingsList =
    data.MRData.StandingsTable.StandingsLists[0];

  if (!standingsList) {
    throw new Error("No standings data returned");
  }

  const drivers = standingsList.DriverStandings.map(d => ({
    position: Number(d.position),
    driver: `${d.Driver.givenName} ${d.Driver.familyName}`,
    team: d.Constructors[0].name,
    points: Number(d.points),
    wins: Number(d.wins)
  }));

  const output = {
    season: data.MRData.StandingsTable.season,
    round: standingsList.round,
    updated_at: new Date().toISOString(),
    drivers
  };

  fs.writeFileSync(
    "f1_driver_standings.json",
    JSON.stringify(output, null, 2)
  );
}

updateStandings();
