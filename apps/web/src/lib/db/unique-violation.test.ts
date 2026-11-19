import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./unique-violation";

describe("isUniqueViolation", () => {
  it("reconnaît la contrainte visée, directement ou enveloppée par l'ORM", () => {
    const pg = { code: "23505", constraint: "user_username_unique" };
    expect(isUniqueViolation(pg, "user_username_unique")).toBe(true);
    expect(isUniqueViolation(new Error("Failed query", { cause: pg }), "user_username_unique")).toBe(true);
    expect(isUniqueViolation({ code: "23505", message: 'duplicate key value violates unique constraint "user_username_unique"' }, "user_username_unique")).toBe(true);
  });

  it("ne confond ni une autre contrainte, ni une autre erreur", () => {
    expect(isUniqueViolation({ code: "23505", constraint: "user_email_unique" }, "user_username_unique")).toBe(false);
    expect(isUniqueViolation({ code: "40001", constraint: "user_username_unique" }, "user_username_unique")).toBe(false);
    expect(isUniqueViolation(new Error("réseau"), "user_username_unique")).toBe(false);
    expect(isUniqueViolation(null, "user_username_unique")).toBe(false);
    expect(isUniqueViolation("23505", "user_username_unique")).toBe(false);
  });
});
