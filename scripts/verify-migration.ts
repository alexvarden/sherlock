import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  process.env.NEO4J_URI ?? "bolt://localhost:7687",
  neo4j.auth.basic(process.env.NEO4J_USER ?? "neo4j", process.env.NEO4J_PASSWORD ?? "sherlock"),
  { disableLosslessIntegers: true }
);

async function main() {
  const session = driver.session();
  try {
    const stories = await session.run("MATCH (s:Story) RETURN s.slug AS slug ORDER BY s.slug");
    console.log("Stories in Neo4j:");
    stories.records.forEach(r => console.log(`  - ${r.get("slug")}`));
    console.log(`\nTotal: ${stories.records.length} stories`);
    
    const counts = await session.run(`
      MATCH (s:Story)
      OPTIONAL MATCH (e:Entity {story: s.slug})
      OPTIONAL MATCH (ev:Event {story: s.slug})
      RETURN s.slug as slug, count(DISTINCT e) as entities, count(DISTINCT ev) as events
      ORDER BY s.slug
    `);
    console.log("\nEntity/Event counts:");
    counts.records.forEach(r => {
      console.log(`  ${r.get("slug")}: ${r.get("entities")}e / ${r.get("events")}ev`);
    });
  } finally {
    await session.close();
    await driver.close();
  }
}

main();
