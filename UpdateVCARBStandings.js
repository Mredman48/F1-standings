// updateVcarbStandings.js
import fs from "node:fs/promises";

const ERGAST_BASE = "https://ergast.com/api/f1/current";
const UA = "f1-standings-bot/1.0";

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} fetching ${url}\n${text.slice(0, 200)}`);
  }

  return res.json();
}

function formatPosition(pos) {
  return `P${pos}`;
}

async function updateVcarbStandings() {
  const now = new Date();

  // Driver standings
  const driversData = await fetchJson(`${ERGAST_BASE}/driverStandings.json`);
  const constructorsData = await fetchJson(`${ERGAST_BASE}/constructorStandings.json`);

  const driverStandings =
    driversData?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];

  const constructorStandings =
    constructorsData?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];

  // Filter for VCARB drivers
  const vcarbDrivers = driverStandings.filter(
    (d) =>
      d?.Constructors?.[0]?.constructorId === "rb" ||
      d?.Constructors?.[0]?.constructorId === "alphatauri"
  );

  const formattedDrivers = vcarbDrivers.map((d) => ({
    position: formatPosition(d.position),
    positionNumber: Number(d.position),
    points: Number(d.points),
    wins: Number(d.wins),
    driver: {
      code: d.Driver.code,
      givenName: d.Driver.givenName,
      familyName: d.Driver.familyName,
      permanentNumber: d.Driver.permanentNumber,
    },
  }));

  // Find constructor
  const vcarbConstructor = constructorStandings.find(
    (c) => c.Constructor.constructorId === "rb"
  );

  const constructorBlock = vcarbConstructor
    ? {
        position: formatPosition(vcarbConstructor.position),
        positionNumber: Number(vcarbConstructor.position),
        points: Number(vcarbConstructor.points),
        wins: Number(vcarbConstructor.wins),
        name: vcarbConstructor.Constructor.name,
        nationality: vcarbConstructor.Constructor.nationality,
      }
    : null;

  const output = {
    header: `${now.getUTCFullYear()} VCARB Standings`,
    generatedAtUtc: now.toISOString(),
    team: {
      id: "rb",
      displayName: "Visa Cash App RB",
      shortName: "VCARB",
    },
    drivers: formattedDrivers,
    constructor: constructorBlock,
  };

  await fs.writeFile("vcarb_standings.json", JSON.stringify(output, null, 2), "utf8");
  console.log("Wrote vcarb_standings.json");
}

updateVcarbStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});