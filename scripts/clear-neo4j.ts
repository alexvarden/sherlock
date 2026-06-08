import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  process.env.NEO4J_URI ?? "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER ?? "neo4j",
    process.env.NEO4J_PASSWORD ?? "sherlock"
  ),
  { disableLosslessIntegers: true }
);

async function main() {
  const session = driver.session({ database: "neo4j" });
  try {
    console.log("Clearing all nodes and relationships...");
    await session.run("MATCH (n) DETACH DELETE n");
    console.log("Database cleared.");
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
