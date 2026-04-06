import test from "node:test";
import assert from "node:assert/strict";
import { resolveBeyConfig } from "../src/avatar-config.js";

test("resolveBeyConfig prefers BEY_API_KEY", () => {
  const config = resolveBeyConfig({
    BEY_API_KEY: "primary",
    BEYOND_API_KEY: "fallback",
  });

  assert.equal(config.apiKey, "primary");
});

test("resolveBeyConfig falls back to BEYOND_API_KEY", () => {
  const config = resolveBeyConfig({
    BEYOND_API_KEY: "legacy-key",
  });

  assert.equal(config.apiKey, "legacy-key");
  assert.equal(config.participantIdentity, "bey-avatar-agent");
  assert.equal(config.participantName, "bey-avatar-agent");
});
