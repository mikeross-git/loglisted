export const MOCK_ANALYSIS_MINIMUM_MILLISECONDS = 10_000;
export const MOCK_ANALYSIS_COMPLETION_HOLD_MILLISECONDS = 750;

export function remainingMockAnalysisDelay(
  startedAt: number,
  now = Date.now(),
  minimumMilliseconds = MOCK_ANALYSIS_MINIMUM_MILLISECONDS,
): number {
  return Math.max(0, minimumMilliseconds - Math.max(0, now - startedAt));
}

export async function waitForMinimumMockAnalysisDuration(
  startedAt: number,
  minimumMilliseconds = MOCK_ANALYSIS_MINIMUM_MILLISECONDS,
): Promise<void> {
  const remaining = remainingMockAnalysisDelay(startedAt, Date.now(), minimumMilliseconds);
  if (remaining > 0) {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, remaining));
  }
}

export async function holdCompletedMockAnalysis(): Promise<void> {
  await new Promise<void>((resolve) =>
    globalThis.setTimeout(resolve, MOCK_ANALYSIS_COMPLETION_HOLD_MILLISECONDS),
  );
}
