import type { ComponentType } from "react";
import TheGameIsAfoot from "./the-game-is-afoot";

// SERVER-ONLY. Maps article slug → body component. The bodies read fs at build
// time (static JSON), so this module must never reach a client bundle — import
// it only from a server component (crane-ai's article/[slug] route). Metadata
// for the same articles lives in ./index (client-safe). Slugs without an entry
// here are draft/announced posts the host renders with a placeholder.
export const articleBodies: Record<string, ComponentType> = {
  "the-game-is-afoot": TheGameIsAfoot,
};
