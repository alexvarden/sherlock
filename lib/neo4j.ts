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
  return getDriver().session({ database: "neo4j" });
}

export async function closeDriver(): Promise<void> {
  if (_driver) {
    await _driver.close();
    _driver = null;
  }
}
