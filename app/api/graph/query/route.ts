import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/neo4j";

// Very basic read-only guard — block obvious write operations
const WRITE_PATTERN = /\b(CREATE|MERGE|SET|DELETE|REMOVE|DROP|CALL\s+apoc\.schema)\b/i;

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    // Neo4j Node: has labels[] + properties{}
    if (Array.isArray(v.labels) && typeof v.properties === "object") {
      return { _labels: v.labels, ...(v.properties as Record<string, unknown>) };
    }
    // Neo4j Relationship: has type string + properties{} + startNodeElementId
    if (typeof v.type === "string" && v.startNodeElementId !== undefined && typeof v.properties === "object") {
      return { _type: v.type, ...(v.properties as Record<string, unknown>) };
    }
  }
  return value;
}

export async function POST(req: NextRequest) {
  const { query, story } = (await req.json()) as { query?: string; story?: string };

  if (!query?.trim()) {
    return NextResponse.json({ ok: false, message: "Missing query" }, { status: 400 });
  }

  if (WRITE_PATTERN.test(query)) {
    return NextResponse.json({ ok: false, message: "Only read queries are allowed" }, { status: 403 });
  }

  const session = getSession();
  try {
    const params = story ? { story } : {};
    const result = await session.run(query, params);

    const columns = result.records[0]?.keys ?? [];
    const rows = result.records.map((r) => {
      const row: Record<string, unknown> = {};
      for (const key of r.keys) {
        row[key as string] = serializeValue(r.get(key));
      }
      return row;
    });

    return NextResponse.json({ ok: true, columns, rows });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Query failed" },
      { status: 500 }
    );
  } finally {
    await session.close();
  }
}
