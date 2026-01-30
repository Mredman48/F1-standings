import fs from "fs";
import axios from "axios";

const URL = "https://ergast.com/api/f1/current/driverStandings.json";

async function updateStandings() {
  try {
    const res = await axios.get(URL, {
      headers: {
        "User-Agent": "f1-standings-bot/1.0 (GitHub Actions)",
        "Accept": "application/json"
      },
      maxRedirects: 5,
      timeout: 10000
    });

    const data = res.data;

    const standingsList =
      data?.MRData?.StandingsTable?.StandingsLists?.[0];

    if (!standingsList) {
      throw new Error("StandingsLists[0] missing — API returned no standings");
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

    console.log("Standings updated successfully!");

  } catch (err) {
    console.error("Failed to fetch Ergast data:", err.message);
    throw err;
  }
}

updateStandings();
