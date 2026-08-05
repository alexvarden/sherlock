-- ─────────────────────────────────────────────────────────────────────────────
-- The graph, as two tables.
--
-- This schema is deliberately generic rather than normalised into domain tables
-- (sentences / entities / events / …). It is the exhibit for the article arc:
-- the argument being made is "a graph is two tables", so the model has to be
-- readable as exactly that.
--
-- Three axes are promoted out of JSONB into real, indexable columns, because
-- they are what the arc is actually about:
--
--   pos                 WHERE  — ordinal position along the story
--   valid_from_section  WHEN   — the validity window of a relationship
--   valid_to_section
--   (the edge itself)   WHOSE PERSPECTIVE
--
-- Everything else lives in props. See the ticket for what was rejected and why
-- (full JSONB, typed views, SQL/PGQ-shaped vertex/edge tables).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE nodes (
  story   TEXT NOT NULL,
  id      TEXT NOT NULL,

  -- story | section | lexical | entity | event
  kind    TEXT NOT NULL,

  -- entities only: character | location | object | case | document | organisation
  subkind TEXT,

  -- Display label. Story name, section title, entity label, event label.
  -- NULL for lexical nodes, whose text lives in props (it is content, not a name).
  name    TEXT,

  -- Ordinal position along the story, in the unit natural to the kind:
  --   section  -> section index
  --   lexical  -> global sentence/paragraph position across the whole story
  --   event    -> index of the section the event occurs in
  --   entity   -> NULL (an entity has no single position; see props.firstSection)
  --   story    -> NULL
  --
  -- One column, one meaning: "how far into the story is this". That is what
  -- makes both the reader window (lexical range) and the perspective cutoff
  -- (events at or before section N) plain indexed integer comparisons.
  pos     INT,

  props   JSONB NOT NULL DEFAULT '{}'::jsonb,

  PRIMARY KEY (story, id)
);

CREATE TABLE edges (
  -- Surrogate key. A natural key over (story, from_id, to_id, rel_type,
  -- valid_from_section) would require the validity columns to be NOT NULL and
  -- would forbid legitimately repeated relations. Idempotency is the loader's
  -- job instead: per-story delete-then-insert in one transaction.
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  story              TEXT NOT NULL,
  from_id            TEXT NOT NULL,
  to_id              TEXT NOT NULL,

  -- PARTICIPATED_IN | PERFORMED | SPOKE_IN | TOLD_TO | MENTIONED_IN
  -- IS_INSIDE | LOCATED_AT | OWNS | CLUE_FOR | MEMBER_OF
  rel_type           TEXT NOT NULL,

  -- The temporal window, as section indices. Inclusive lower bound, exclusive
  -- upper bound; NULL upper bound means "still true at the end of the story".
  -- Point-in-time relations (MENTIONED_IN, CLUE_FOR) set only valid_from_section.
  -- Relations whose timing is carried by their event endpoint instead
  -- (PARTICIPATED_IN, PERFORMED, SPOKE_IN, TOLD_TO) leave both NULL — the
  -- event node's own pos is the time.
  valid_from_section INT,
  valid_to_section   INT,

  props              JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Both endpoints must exist. Neo4j dropped unmatched relationships silently;
  -- here a genuine extraction bug fails loudly instead. The loader pre-filters
  -- and reports dangling references so this fires only on real breakage.
  FOREIGN KEY (story, from_id) REFERENCES nodes (story, id) ON DELETE CASCADE,
  FOREIGN KEY (story, to_id)   REFERENCES nodes (story, id) ON DELETE CASCADE
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- (story, kind, pos) serves three shapes at once: the (story, kind) prefix for
-- "all entities in X", the range scan for the reader window, and the ordered
-- cutoff scan for "events at or before section N" — the hottest query in the
-- perspective model.
CREATE INDEX nodes_story_kind_pos ON nodes (story, kind, pos);
CREATE INDEX nodes_story_subkind  ON nodes (story, subkind);
CREATE INDEX nodes_story_name     ON nodes (story, name);

-- Traversal in both directions. rel_type leads because every traversal in the
-- query layer is typed — there is no "all edges from X" query.
CREATE INDEX edges_story_type_from ON edges (story, rel_type, from_id);
CREATE INDEX edges_story_type_to   ON edges (story, rel_type, to_id);

-- The validity window, for "what was true at section N".
CREATE INDEX edges_story_valid_from ON edges (story, valid_from_section);
CREATE INDEX edges_story_valid_to   ON edges (story, valid_to_section);
