import { describe, expect, it } from "vitest";
import { versions } from "../src/lib/version.js";

describe("version constants", () => {
  it("contains every independent pipeline version as an immutable nonempty value", () => {
    expect(Object.keys(versions).sort()).toEqual(
      [
        "parserVersion",
        "metadataVersion",
        "chunkerVersion",
        "summaryPromptVersion",
        "reducerVersion",
        "excerptSamplerVersion",
        "rubricVersion",
        "scoringPromptVersion",
        "riskModelVersion",
        "costConfigVersion",
      ].sort(),
    );
    expect(Object.values(versions).every((version) => version.length > 0)).toBe(true);
    expect(Object.isFrozen(versions)).toBe(true);
  });
});
