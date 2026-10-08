import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify, constants } from "node:crypto";
import { signKalshi } from "./kalshi-auth.ts";

const msg = "1700000000000GET/trade-api/v2/portfolio/balance";

test("Ed25519 key signs and verifies (Kalshi default key type)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const sig = Buffer.from(signKalshi(pem, msg), "base64");
  assert.equal(verify(null, Buffer.from(msg), publicKey, sig), true);
});

test("RSA key signs with RSA-PSS SHA-256 and verifies", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const sig = Buffer.from(signKalshi(pem, msg), "base64");
  assert.equal(
    verify("sha256", Buffer.from(msg), { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }, sig),
    true,
  );
});
