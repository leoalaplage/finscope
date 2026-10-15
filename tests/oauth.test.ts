import { describe, expect, it } from "vitest";
import { pkce, readIdToken, safeNext } from "../lib/oauth";

const token = (claims: Record<string, unknown>) => {
  // As a provider writes it: the JSON's UTF-8 bytes, base64url.
  const part = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
};
const now = Date.parse("2026-10-15T12:00:00Z");
const google = { iss: "https://accounts.google.com", aud: "client-1", exp: now / 1000 + 600, nonce: "n1", sub: "1234", email: "Leo@Example.com", email_verified: true, name: "Léo" };

describe("an ID token from the provider", () => {
  it("gives the identity when issuer, audience, expiry and nonce are this sign-in's", () => {
    expect(readIdToken("google", token(google), "client-1", "n1", now)).toEqual({ sub: "1234", email: "leo@example.com", emailVerified: true, name: "Léo" });
  });

  it("refuses another issuer, another site's token, an expired one and a replayed nonce", () => {
    expect(() => readIdToken("google", token({ ...google, iss: "https://evil.example" }), "client-1", "n1", now)).toThrow(/issued/);
    expect(() => readIdToken("google", token({ ...google, aud: "client-2" }), "client-1", "n1", now)).toThrow(/another site/);
    expect(() => readIdToken("google", token({ ...google, exp: now / 1000 - 3600 }), "client-1", "n1", now)).toThrow(/expired/);
    expect(() => readIdToken("google", token(google), "client-1", "other", now)).toThrow(/did not match/);
  });

  it("does not take a Microsoft work account's address as verified", () => {
    const claims = readIdToken("microsoft", token({ ...google, iss: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0" }), "client-1", "n1", now);
    expect(claims.emailVerified).toBe(false);
    expect(claims.email).toBe("leo@example.com");
  });
});

describe("after signing in", () => {
  it("only ever goes to a page of this site", () => {
    expect(safeNext("/t/account")).toBe("/t/account");
    expect(safeNext("/t/s/DAL?x=1")).toBe("/t/s/DAL?x=1");
    expect(safeNext("https://evil.example")).toBe("/t/account");
    expect(safeNext("//evil.example/x")).toBe("/t/account");
    expect(safeNext(null)).toBe("/t/account");
  });

  it("sends a PKCE challenge that is the verifier's SHA-256", async () => {
    const { verifier, challenge } = await pkce();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    expect(challenge).toBe(btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });
});
