import { describe, expect, it } from "vitest";
import { usernameSchema } from "@/lib/domain/team-codes";
import { loginMode } from "./login-identifier";

describe("loginMode", () => {
  it("une adresse e-mail part vers la connexion par e-mail", () => {
    expect(loginMode("awa@boutique.ci")).toBe("email");
    expect(loginMode(" Awa@Boutique.ci ")).toBe("email");
  });

  it("un nom d'utilisateur (employé, compte sans e-mail) part vers la connexion par nom d'utilisateur", () => {
    expect(loginMode("caisse.awa")).toBe("username");
    expect(loginMode("Kone_2")).toBe("username");
    expect(loginMode("")).toBe("username");
  });

  it("aucun nom d'utilisateur valide ne peut être pris pour une adresse", () => {
    expect(usernameSchema.safeParse("awa@ci").success).toBe(false);
  });
});
