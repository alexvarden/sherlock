import { readFileSync } from "fs";

const load = (p: string) => JSON.parse(readFileSync(p, "utf-8"));

const RUNS = [
  { label: "nano 3000w",     dir: "a-case-of-identity-3000w" },
  { label: "nano 600w",      dir: "a-case-of-identity-600w" },
  { label: "nano 600w low",  dir: "a-case-of-identity-600w-lowreason" },
  { label: "mini 600w",      dir: "a-case-of-identity-600w-mini" },
  { label: "mini 3000w",     dir: "a-case-of-identity-3000w-mini" },
];

interface Lex { nodes: { id: string }[]; sections: unknown[] }
interface Graph {
  entities: { id: string; type: string; label: string }[];
  events: { id: string; source_nodes?: string[]; communicates?: unknown; participants?: string[]; performs?: string[] }[];
  stateEdges: unknown[];
  mentions: unknown[];
  clues: unknown[];
  memberOf: unknown[];
}

function fmt(lex: Lex, g: Graph) {
  const types: Record<string, number> = {};
  for (const e of g.entities) types[e.type] = (types[e.type] ?? 0) + 1;
  const validSentIds = new Set(lex.nodes.map((n) => n.id));
  let badRefs = 0, totalRefs = 0;
  for (const e of g.events) for (const sid of e.source_nodes ?? []) {
    totalRefs++;
    if (!validSentIds.has(sid)) badRefs++;
  }
  const eventsWithPerformer = g.events.filter((e) => e.performs && e.performs.length).length;
  return {
    sections: lex.sections.length,
    entities: g.entities.length,
    entityTypes: types,
    events: g.events.length,
    speechActs: g.events.filter((e) => e.communicates).length,
    eventsWithPerformer,
    stateEdges: g.stateEdges.length,
    mentions: g.mentions.length,
    clues: g.clues.length,
    memberships: g.memberOf.length,
    badSentenceRefs: `${badRefs}/${totalRefs}`,
  };
}

const results = RUNS.map((r) => {
  const lex = load(`./data/processed/${r.dir}/lexical.json`);
  const g = load(`./data/processed/${r.dir}/objective-graph.json`);
  return { ...r, summary: fmt(lex, g), graph: g };
});

const metrics: { key: keyof ReturnType<typeof fmt>; label: string }[] = [
  { key: "sections",          label: "sections" },
  { key: "entities",          label: "entities" },
  { key: "events",            label: "events" },
  { key: "speechActs",        label: "speech acts" },
  { key: "eventsWithPerformer", label: "w/performer" },
  { key: "stateEdges",        label: "state edges" },
  { key: "mentions",          label: "mentions" },
  { key: "clues",             label: "clues" },
  { key: "memberships",       label: "memberships" },
  { key: "badSentenceRefs",   label: "bad refs" },
];

const pad = (v: unknown, w: number) => String(v).padEnd(w);
const W = 16;
console.log(pad("metric", 13) + results.map((r) => pad(r.label, W)).join(""));
console.log("-".repeat(13 + W * results.length));
for (const m of metrics) {
  console.log(pad(m.label, 13) + results.map((r) => pad(r.summary[m.key], W)).join(""));
}

console.log("\n=== Entity types ===");
for (const r of results) console.log(`${r.label.padEnd(15)}`, r.summary.entityTypes);

console.log("\n=== Case duplication ===");
const cases = (g: Graph) => g.entities.filter((e) => e.type === "case").map((e) => e.id);
for (const r of results) {
  console.log(`${r.label.padEnd(15)} (${cases(r.graph).length}):`, cases(r.graph));
}
