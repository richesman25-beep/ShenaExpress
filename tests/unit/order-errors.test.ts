import { describe, expect, it } from "vitest";
import { formatError } from "../../src/lib/api";

describe("Messages français à l'enregistrement des commandes", () => {
  it("explique un conflit concurrent sans exposer l'erreur technique", () => {
    expect(formatError({ code: "firestore/aborted", message: "Transaction aborted" })).toMatch(/autre opération.*réessayer/);
  });
  it("conserve les explications métier sur les doublons", () => {
    const message = "Ce numéro de suivi est déjà utilisé par un autre colis.";
    expect(formatError({ code: "functions/already-exists", message })).toBe(message);
  });
  it("traduit les erreurs techniques Firestore en français", () => {
    expect(formatError({ message: "Firestore transactions require all reads to be executed before all writes." })).toMatch(/enregistrement.*contacter l'administrateur/);
    expect(formatError({ code: "already-exists", message: "Document already exists" })).toMatch(/déjà utilisé/);
  });
});
