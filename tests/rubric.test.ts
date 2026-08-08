import { describe, expect, it } from "vitest";
import { scoringAnchors, screenplayRubric } from "../src/lib/rubric.js";

describe("screenplay rubric", () => {
  it("contains exactly ten categories whose criteria sum to one", () => {
    expect(Object.keys(screenplayRubric)).toHaveLength(10);
    for (const criteria of Object.values(screenplayRubric)) {
      expect(Object.values(criteria).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    }
  });

  it("preserves the approved scoring anchors", () => {
    expect(scoringAnchors).toEqual({
      good: 7,
      sustainedProfessionalExecution: 8,
      exceptionalProfessionalExecution: 9,
      extraordinarilyRareAbove: 9.5,
    });
  });
});
