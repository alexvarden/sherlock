import neo4j, { Driver, Session } from "neo4j-driver";

let _driver: Driver | null = null;

export function getDriver(): Driver {
  if (!_driver) {
    _driver = neo4j.driver(
      process.env.NEO4J_URI ?? "bolt://localhost:7687",
      neo4j.auth.basic(
        process.env.NEO4J_USER ?? "neo4j",
        process.env.NEO4J_PASSWORD ?? "sherlock"
      ),
      { disableLosslessIntegers: true }
    );
  }
  return _driver;
}

export function getSession(): Session {
  // Local Docker uses "neo4j"; Aura names the db after the instance id, so
  // honour NEO4J_DATABASE when set (see .env).
  return getDriver().session({ database: process.env.NEO4J_DATABASE ?? "neo4j" });
}

export async function closeDriver(): Promise<void> {
  if (_driver) {
    await _driver.close();
    _driver = null;
  }
}
