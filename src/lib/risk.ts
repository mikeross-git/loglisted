import { z } from "zod";

export const RiskSignalsSchema = z
  .object({
    validTurnstile: z.boolean().default(false),
    sessionOlderThan24Hours: z.boolean().default(false),
    validOriginAndCsrf: z.boolean().default(false),
    sameCompletedFileBySession: z.boolean().default(false),
    suspiciouslyFastForm: z.boolean().default(false),
    repeatedAuthorizationAttempts: z.boolean().default(false),
    invalidTurnstileAttempts: z.boolean().default(false),
    sameFileAcrossManySessions: z.boolean().default(false),
    rapidDeviceRotationOnIp: z.boolean().default(false),
    rapidIpRotationForSession: z.boolean().default(false),
    frontendBackendHashMismatch: z.boolean().default(false),
    honeypotCompleted: z.boolean().default(false),
    uploadTokenReplay: z.boolean().default(false),
  })
  .strict();

export const RiskConfigSchema = z
  .object({
    weights: z
      .object({
        validTurnstile: z.number().default(-15),
        sessionOlderThan24Hours: z.number().default(-5),
        validOriginAndCsrf: z.number().default(-5),
        sameCompletedFileBySession: z.number().default(-5),
        suspiciouslyFastForm: z.number().default(20),
        repeatedAuthorizationAttempts: z.number().default(30),
        invalidTurnstileAttempts: z.number().default(40),
        sameFileAcrossManySessions: z.number().default(50),
        rapidDeviceRotationOnIp: z.number().default(50),
        rapidIpRotationForSession: z.number().default(40),
        frontendBackendHashMismatch: z.number().default(100),
        honeypotCompleted: z.number().default(100),
        uploadTokenReplay: z.number().default(100),
      })
      .strict()
      .default({
        validTurnstile: -15,
        sessionOlderThan24Hours: -5,
        validOriginAndCsrf: -5,
        sameCompletedFileBySession: -5,
        suspiciouslyFastForm: 20,
        repeatedAuthorizationAttempts: 30,
        invalidTurnstileAttempts: 40,
        sameFileAcrossManySessions: 50,
        rapidDeviceRotationOnIp: 50,
        rapidIpRotationForSession: 40,
        frontendBackendHashMismatch: 100,
        honeypotCompleted: 100,
        uploadTokenReplay: 100,
      }),
    thresholds: z
      .object({
        freshTurnstile: z.number().default(20),
        cooldown: z.number().default(40),
        temporaryBlock: z.number().default(60),
        blockAndFlag: z.number().default(80),
      })
      .strict()
      .default({
        freshTurnstile: 20,
        cooldown: 40,
        temporaryBlock: 60,
        blockAndFlag: 80,
      }),
  })
  .strict();

export type RiskSignals = z.input<typeof RiskSignalsSchema>;
export type RiskDecision =
  "allow" | "fresh_turnstile" | "cooldown" | "temporary_block" | "block_and_flag";

export function assessRisk(
  signalsInput: RiskSignals,
  configInput: z.input<typeof RiskConfigSchema> = {},
): { score: number; decision: RiskDecision } {
  const signals = RiskSignalsSchema.parse(signalsInput);
  const config = RiskConfigSchema.parse(configInput);
  const score = Object.entries(signals).reduce(
    (sum, [key, active]) => sum + (active ? config.weights[key as keyof typeof config.weights] : 0),
    0,
  );
  const decision =
    score >= config.thresholds.blockAndFlag
      ? "block_and_flag"
      : score >= config.thresholds.temporaryBlock
        ? "temporary_block"
        : score >= config.thresholds.cooldown
          ? "cooldown"
          : score >= config.thresholds.freshTurnstile
            ? "fresh_turnstile"
            : "allow";
  return { score, decision };
}
