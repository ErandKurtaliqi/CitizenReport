import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "../src/ai.js";

// Përgjigjet e modelit AI janë të dhëna të pabesueshme: çdo gjë e pavlefshme bëhet "inconclusive".

test("invalid JSON becomes inconclusive", () => {
  const r = validate("this is not json");
  assert.equal(r.verdict, "inconclusive");
  assert.equal(r.confidence, 0);
});

test("valid answer is kept", () => {
  const r = validate(JSON.stringify({ verdict: "resolved", confidence: 0.91, sameLocation: true, reason: "Llamba ndriçon." }));
  assert.deepEqual(r, { verdict: "resolved", confidence: 0.91, sameLocation: true, reason: "Llamba ndriçon." });
});

test("unknown verdict and out-of-range confidence are rejected", () => {
  const r = validate(JSON.stringify({ verdict: "approved_by_admin", confidence: 7, sameLocation: "yes", reason: "" }));
  assert.equal(r.verdict, "inconclusive");
  assert.equal(r.confidence, 0);
  assert.equal(r.sameLocation, false);
});

test("a confident verdict needs non-zero confidence", () => {
  const r = validate(JSON.stringify({ verdict: "resolved", confidence: 0, sameLocation: true, reason: "x" }));
  assert.equal(r.verdict, "inconclusive");
});

test("sameLocation cannot be true without a before photo", () => {
  const r = validate(JSON.stringify({ verdict: "resolved", confidence: 0.8, sameLocation: true, reason: "x" }), false);
  assert.equal(r.sameLocation, false);
});

test("long reasons are truncated", () => {
  const r = validate(JSON.stringify({ verdict: "not_resolved", confidence: 0.6, sameLocation: true, reason: "a".repeat(1000) }));
  assert.equal(r.reason.length, 400);
});
