import { assertEquals } from "jsr:@std/assert@1";
import { parseConfidenceResponse } from "./confidence.ts";

Deno.test("parseConfidenceResponse extracts confidence data from swamp JSON", () => {
  const json = JSON.stringify({
    attributes: {
      claimId: "claim-ci-green-on-main-001",
      confidenceScore: 0.72,
      previousScore: 0.8,
      computedAt: "2026-03-30T10:00:00Z",
      lastValidated: "2026-03-28T10:00:00Z",
      fAvg: 1.0,
      qAvg: 0.95,
      decayFactor: 0.9,
      statusTransition: "0.800→0.720",
      evidenceSnapshots: [],
    },
  });
  const data = parseConfidenceResponse(json);
  assertEquals(data?.claimId, "claim-ci-green-on-main-001");
  assertEquals(data?.confidenceScore, 0.72);
  assertEquals(data?.previousScore, 0.8);
  assertEquals(data?.statusTransition, "0.800→0.720");
});

Deno.test("parseConfidenceResponse returns null for empty response", () => {
  assertEquals(parseConfidenceResponse(""), null);
  assertEquals(parseConfidenceResponse("{}"), null);
});

Deno.test("parseConfidenceResponse returns null for malformed JSON", () => {
  assertEquals(parseConfidenceResponse("not json"), null);
});

Deno.test("parseConfidenceResponse handles null previousScore", () => {
  const json = JSON.stringify({
    attributes: {
      claimId: "claim-test-001",
      confidenceScore: 0.85,
      previousScore: null,
      computedAt: "2026-03-30T10:00:00Z",
      lastValidated: "2026-03-28T10:00:00Z",
      fAvg: 1.0,
      qAvg: 1.0,
      decayFactor: 1.0,
      statusTransition: null,
      evidenceSnapshots: [],
    },
  });
  const data = parseConfidenceResponse(json);
  assertEquals(data?.previousScore, null);
  assertEquals(data?.statusTransition, null);
});
