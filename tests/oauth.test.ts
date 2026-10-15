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

describe("Sign in with Apple", () => {
  it("signs its client secret ES256 with the team's key, for Apple, naming the Services ID", async () => {
    const { appleClientSecret } = await import("../lib/oauth");
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----`;
    const jwt = await appleClientSecret(now, { teamId: "TEAM123", keyId: "KEY456", clientId: "com.tenqay.web", privateKey: pem });
    const [header, payload, signature] = jwt.split(".");
    const decode = (part: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4)), (char) => char.charCodeAt(0))));
    expect(decode(header)).toEqual({ alg: "ES256", kid: "KEY456" });
    expect(decode(payload)).toMatchObject({ iss: "TEAM123", aud: "https://appleid.apple.com", sub: "com.tenqay.web", iat: now / 1000, exp: now / 1000 + 300 });
    const bytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((signature.length + 3) % 4)), (char) => char.charCodeAt(0));
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, bytes, new TextEncoder().encode(`${header}.${payload}`))).toBe(true);
  });

  it("takes Apple's verified address, written as a string, and the name posted on the first sign-in", async () => {
    const { appleName } = await import("../lib/oauth");
    const claims = readIdToken("apple", token({ iss: "https://appleid.apple.com", aud: "com.tenqay.web", exp: now / 1000 + 600, nonce: "n1", sub: "001.abc", email: "x@privaterelay.appleid.com", email_verified: "true" }), "com.tenqay.web", "n1", now);
    expect(claims).toMatchObject({ sub: "001.abc", email: "x@privaterelay.appleid.com", emailVerified: true });
    expect(appleName(JSON.stringify({ name: { firstName: "Léo", lastName: "Thiré" } }))).toBe("Léo Thiré");
    expect(appleName(null)).toBeNull();
  });
});
