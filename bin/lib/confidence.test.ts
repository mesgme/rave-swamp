import { assertEquals } from "jsr:@std/assert@1";
import { parseConfidenceResponse, fetchAllConfidence } from "./confidence.ts";

Deno.test("parseConfidenceResponse extracts confidence data from swamp JSON", () => {
  const json = JSON.stringify({
    content: {
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
    content: {
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

Deno.test("fetchAllConfidence defaults to score 0 for claims with no data", async () => {
  // "claim-does-not-exist-001" has no swamp data, so swamp data get returns non-zero exit
  const map = await fetchAllConfidence(["claim-does-not-exist-001"]);
  const entry = map.get("claim-does-not-exist-001");
  assertEquals(entry?.confidenceScore, 0);
  assertEquals(entry?.previousScore, null);
});

Deno.test("parseConfidenceResponse falls back to attributes key", () => {
  const json = JSON.stringify({
    attributes: {
      claimId: "claim-legacy-001",
      confidenceScore: 0.6,
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
  assertEquals(data?.claimId, "claim-legacy-001");
  assertEquals(data?.confidenceScore, 0.6);
});

Deno.test("parseConfidenceResponse extracts guidance array", () => {
  const json = JSON.stringify({
    content: {
      claimId: "claim-test-001",
      confidenceScore: 0.5,
      previousScore: null,
      computedAt: "2026-04-29T10:00:00Z",
      lastValidated: "2026-04-29T10:00:00Z",
      fAvg: 0.0,
      qAvg: 1.0,
      decayFactor: 1.0,
      statusTransition: null,
      guidance: ["CI run failed on job test", "Check the Actions log"],
      evidenceSnapshots: [],
    },
  });
  const data = parseConfidenceResponse(json);
  assertEquals(data?.guidance, ["CI run failed on job test", "Check the Actions log"]);
});

Deno.test("parseConfidenceResponse defaults guidance to empty array when absent", () => {
  const json = JSON.stringify({
    content: {
      claimId: "claim-test-001",
      confidenceScore: 0.85,
      previousScore: null,
      computedAt: "2026-04-29T10:00:00Z",
      lastValidated: "2026-04-29T10:00:00Z",
      fAvg: 1.0,
      qAvg: 1.0,
      decayFactor: 1.0,
      statusTransition: null,
      evidenceSnapshots: [],
    },
  });
  const data = parseConfidenceResponse(json);
  assertEquals(data?.guidance, []);
});
