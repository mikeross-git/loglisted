import { loadEnvFile } from "node:process";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from "express";
import multer from "multer";
import { z } from "zod";
import { postAnalyze } from "./api/analyze.js";
import { deleteResult, getResult } from "./api/result.js";
import { postSession } from "./api/session.js";
import { postUploadAuthorize } from "./api/upload-authorize.js";
import { AnonymousSessionManager } from "./lib/anonymous-session.js";
import { ScriptBudget } from "./lib/budget.js";
import { VersionedCache } from "./lib/cache.js";
import { DeletionTokenManager } from "./lib/deletion-token.js";
import { MockLlmProvider, mockFixtureNames } from "./lib/llm/mock.js";
import { parseModelPricing } from "./lib/model-pricing.js";
import type { OriginPolicy } from "./lib/origin.js";
import { AnonymousQuotas } from "./lib/quotas.js";
import { SlidingWindowRateLimiter } from "./lib/rate-limit.js";
import { ResultTokenManager } from "./lib/result-token.js";
import { MemoryAbuseStore } from "./lib/storage/memory-abuse-store.js";
import { MemoryCacheStore } from "./lib/storage/memory-cache-store.js";
import { ProcessingLock } from "./lib/storage/processing-lock.js";
import { MemoryResultStore } from "./lib/storage/memory-result-store.js";
import { TurnstileVerifier } from "./lib/turnstile.js";
import { UploadTokenManager } from "./lib/upload-token.js";
import type { WindowResult } from "./lib/storage/abuse-store.js";
import {
  FramerCmsSynchronizer,
  loadFramerCmsConfig,
  syncFramerCmsBestEffort,
} from "./integrations/framer-cms.js";
import { SafeLogger } from "./lib/logger.js";

try {
  loadEnvFile(".env.local");
} catch (error) {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code !== "ENOENT") throw error;
}

if (process.env["NODE_ENV"] === "production") {
  throw new Error("The local mock development server cannot run with NODE_ENV=production.");
}

const booleanFromEnvironment = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() === "true" : value),
  z.boolean(),
);

const DevEnvironmentSchema = z
  .object({
    APP_ENV: z.literal("development").default("development"),
    SCREENPLAY_SCORING_MODE: z.literal("mock").default("mock"),
    NODE_ENV: z.enum(["development", "test"]).default("development"),
    PORT: z.coerce.number().pipe(z.literal(3000)).default(3000),
    FRONTEND_ORIGIN: z.literal("http://localhost:5173").default("http://localhost:5173"),
    ALLOWED_ORIGINS: z
      .string()
      .default("http://localhost:5173,http://127.0.0.1:5173")
      .transform((value) => value.split(",").map((origin) => new URL(origin.trim()).origin)),
    VITE_API_BASE_URL: z.literal("http://localhost:3000").default("http://localhost:3000"),
    VITE_TURNSTILE_MODE: z.literal("mock").default("mock"),
    LLM_PROVIDER: z.literal("mock").default("mock"),
    MOCK_LLM_SCENARIO: z.enum(mockFixtureNames).default("successful_pilot"),
    DRY_RUN: booleanFromEnvironment.default(true),
    ALLOW_MOCK_IN_PRODUCTION: z.literal("false").default("false"),
    TURNSTILE_MODE: z.literal("mock").default("mock"),
    ALLOW_MOCK_TURNSTILE_IN_PRODUCTION: z.literal("false").default("false"),
    ABUSE_STORE: z.literal("memory").default("memory"),
    CACHE_STORE: z.literal("memory").default("memory"),
    RESULT_STORE: z.literal("memory").default("memory"),
    RAW_PDF_PERSISTENCE_ENABLED: z.literal("false").default("false"),
    RAW_TEXT_PERSISTENCE_ENABLED: z.literal("false").default("false"),
    REDACT_TITLE_PAGE_PII: z.literal("true").default("true"),
    ANONYMOUS_SESSION_SECRET: z.string().min(32),
    CSRF_SECRET: z.string().min(32),
    UPLOAD_TOKEN_SECRET: z.string().min(32),
    RESULT_TOKEN_SECRET: z.string().min(32),
    DELETION_TOKEN_SECRET: z.string().min(32),
    IP_HMAC_SECRET: z.string().min(32),
    DEVICE_ID_HMAC_SECRET: z.string().min(32),
    UPLOAD_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    ANONYMOUS_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
    TARGET_COST_PER_SCRIPT_USD: z.coerce.number().positive().default(0.1),
    DEVELOPMENT_LLM_SPEND_LIMIT_USD: z.coerce.number().positive().default(5),
    OPENAI_API_KEY: z.string().optional(),
  })
  .passthrough();

const environment = DevEnvironmentSchema.parse(process.env);
const framerCms = new FramerCmsSynchronizer(loadFramerCmsConfig(process.env));
const logger = new SafeLogger();
const requiredOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
if (!requiredOrigins.every((origin) => environment.ALLOWED_ORIGINS.includes(origin))) {
  throw new Error("Local ALLOWED_ORIGINS must include both supported Vite origins.");
}

const originPolicy: OriginPolicy = {
  allowedOrigins: requiredOrigins,
  allowedMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedContentTypes: ["application/json", "multipart/form-data"],
};

class DevelopmentAbuseStore extends MemoryAbuseStore {
  override incrementWindow(
    key: string,
    nowMs: number,
    windowMs: number,
    limit: number,
    telemetryTtlMs: number,
  ): Promise<WindowResult> {
    if (key.startsWith("duplicates:")) {
      return Promise.resolve({ allowed: true, count: 1, retryAfterMs: 0 });
    }
    return super.incrementWindow(key, nowMs, windowMs, limit, telemetryTtlMs);
  }
}

class DevelopmentUnlimitedRateLimiter extends SlidingWindowRateLimiter {
  override check(): Promise<WindowResult> {
    return Promise.resolve({ allowed: true, count: 1, retryAfterMs: 0 });
  }
}

class DevelopmentUnlimitedQuotas extends AnonymousQuotas {
  override assertCompletedQuota(): Promise<void> {
    return Promise.resolve();
  }

  override recordCompleted(): Promise<void> {
    return Promise.resolve();
  }
}

const abuseStore = new DevelopmentAbuseStore();
const cacheStore = new MemoryCacheStore();
const cache = new VersionedCache(cacheStore);
const results = new MemoryResultStore();
const sessions = new AnonymousSessionManager({
  signingSecret: environment.ANONYMOUS_SESSION_SECRET,
  deviceHmacSecret: environment.DEVICE_ID_HMAC_SECRET,
  csrfSigningSecret: environment.CSRF_SECRET,
  lifetimeSeconds: environment.ANONYMOUS_SESSION_TTL_SECONDS,
});
const uploadTokens = new UploadTokenManager(
  environment.UPLOAD_TOKEN_SECRET,
  abuseStore,
  environment.UPLOAD_TOKEN_TTL_SECONDS,
);
const resultTokens = new ResultTokenManager(environment.RESULT_TOKEN_SECRET);
const deletionTokens = new DeletionTokenManager(environment.DELETION_TOKEN_SECRET);
const provider = new MockLlmProvider({
  fixture: environment.MOCK_LLM_SCENARIO,
  dryRun: environment.DRY_RUN,
});
const pricing = parseModelPricing({
  models: {
    "mock-summary": {
      inputPerMillion: 0.1,
      outputPerMillion: 0.2,
      cachedInputPerMillion: 0,
    },
    "mock-scoring": {
      inputPerMillion: 0.2,
      outputPerMillion: 0.4,
      cachedInputPerMillion: 0,
    },
  },
});
const quotas = new DevelopmentUnlimitedQuotas(abuseStore);
const rateLimiter = new DevelopmentUnlimitedRateLimiter(abuseStore, 24 * 60 * 60_000);
const processingLock = new ProcessingLock(cacheStore);
const turnstile = new TurnstileVerifier(abuseStore, {
  secretKey: "local-mock-turnstile-secret",
  expectedHostnames: ["localhost"],
  expectedAction: "screenplay_upload",
  fetchImplementation: (_input, init) => {
    const body = init?.body;
    const parameters = body instanceof URLSearchParams ? body : new URLSearchParams();
    const token = parameters.get("response") ?? "";
    return Promise.resolve(
      Response.json({
        success: token.startsWith("local-turnstile:"),
        hostname: "localhost",
        action: "screenplay_upload",
      }),
    );
  },
});

function clientIp(request: ExpressRequest): string {
  return request.socket.remoteAddress ?? "127.0.0.1";
}

function headersFromExpress(request: ExpressRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function webRequest(request: ExpressRequest, body?: BodyInit): Request {
  const url = `http://localhost:${environment.PORT}${request.originalUrl}`;
  const headers = headersFromExpress(request);
  headers.delete("content-length");
  if (body instanceof FormData) {
    headers.delete("content-type");
  }
  return new Request(url, {
    method: request.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

async function sendWebResponse(
  response: Response,
  expressResponse: ExpressResponse,
): Promise<void> {
  expressResponse.status(response.status);
  response.headers.forEach((value, name) => expressResponse.setHeader(name, value));
  if (response.status === 204) {
    expressResponse.end();
    return;
  }
  expressResponse.send(Buffer.from(await response.arrayBuffer()));
}

type AsyncRoute = (
  request: ExpressRequest,
  response: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

function route(handler: AsyncRoute) {
  return (request: ExpressRequest, response: ExpressResponse, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

const pipelineDependencies = {
  cache,
  processingLock,
  results,
  resultTokens,
  deletionTokens,
  provider,
  pricing,
  createBudget: () =>
    new ScriptBudget(
      {
        maximumInputTokens: 180_000,
        maximumOutputTokens: 8_000,
        maximumCostUsd: environment.DEVELOPMENT_LLM_SPEND_LIMIT_USD,
      },
      undefined,
      undefined,
      environment.DRY_RUN,
    ),
  summaryModel: "mock-summary",
  scoringModel: "mock-scoring",
  resultTtlSeconds: 30 * 86_400,
};

const app = express();
app.disable("x-powered-by");
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || requiredOrigins.includes(origin)) callback(null, true);
      else callback(new Error("Origin is not allowed."));
    },
    credentials: true,
    methods: [...originPolicy.allowedMethods],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    environment: "development",
    llmProvider: "mock",
    turnstileMode: "mock",
    storageMode: "memory",
    framerCmsSyncEnabled: framerCms.enabled,
    framerCmsConfigured: framerCms.configured,
  });
});

app.post(
  "/api/session",
  route(async (request, response) => {
    await sendWebResponse(
      await postSession(webRequest(request, JSON.stringify(request.body)), {
        sessions,
        originPolicy,
      }),
      response,
    );
  }),
);

app.post(
  "/api/upload-authorize",
  route(async (request, response) => {
    await sendWebResponse(
      await postUploadAuthorize(webRequest(request, JSON.stringify(request.body)), {
        sessions,
        csrfSigningSecret: environment.CSRF_SECRET,
        deviceHmacSecret: environment.DEVICE_ID_HMAC_SECRET,
        ipHmacSecret: environment.IP_HMAC_SECRET,
        directIp: clientIp(request),
        trustedProxy: { trustedProxyIps: [] },
        originPolicy,
        turnstile,
        rateLimiter,
        quotas,
        abuseStore,
        uploadTokens,
        findCachedResult: async (fileHash, sessionId) => {
          const stored = await results.findByFileAndSession(fileHash, sessionId);
          if (!stored) return null;
          await syncFramerCmsBestEffort(framerCms, stored, logger);
          return {
            resultId: stored.resultId,
            resultAccessToken: resultTokens.issue(stored.resultId, sessionId).token,
            deletionToken: deletionTokens.issue(stored.resultId, sessionId),
          };
        },
      }),
      response,
    );
  }),
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

app.post(
  "/api/analyze",
  upload.single("file"),
  route(async (request, response) => {
    if (!request.file) {
      response
        .status(400)
        .json({ error: { code: "ANALYSIS_FAILED", message: "File is missing." } });
      return;
    }
    const form = new FormData();
    const copy = Uint8Array.from(request.file.buffer);
    try {
      form.set(
        "file",
        new File([copy.buffer], request.file.originalname, {
          type: request.file.mimetype,
        }),
      );
      await sendWebResponse(
        await postAnalyze(webRequest(request, form), {
          sessions,
          uploadTokens,
          quotas,
          rateLimiter,
          originPolicy,
          directIp: clientIp(request),
          trustedProxy: { trustedProxyIps: [] },
          ipHmacSecret: environment.IP_HMAC_SECRET,
          ...pipelineDependencies,
          onSuccessfulResult: (result) =>
            syncFramerCmsBestEffort(framerCms, result, logger).then(() => undefined),
        }),
        response,
      );
    } finally {
      request.file.buffer.fill(0);
      copy.fill(0);
    }
  }),
);

app.get(
  "/api/result/:resultId",
  route(async (request, response) => {
    const resultId = request.params["resultId"];
    await sendWebResponse(
      await getResult(webRequest(request), typeof resultId === "string" ? resultId : "", {
        sessions,
        resultTokens,
        results,
        originPolicy,
      }),
      response,
    );
  }),
);

app.delete(
  "/api/result/:resultId",
  route(async (request, response) => {
    const resultId = request.params["resultId"];
    await sendWebResponse(
      await deleteResult(webRequest(request), typeof resultId === "string" ? resultId : "", {
        sessions,
        deletionTokens,
        results,
        cache,
        originPolicy,
      }),
      response,
    );
  }),
);

app.use(
  (_error: unknown, _request: ExpressRequest, response: ExpressResponse, _next: NextFunction) => {
    void _next;
    response.status(500).json({
      error: { code: "DEVELOPMENT_SERVER_ERROR", message: "The local request failed." },
    });
  },
);

app.listen(environment.PORT, "localhost", () => {
  console.log(`Backend:
http://localhost:${environment.PORT}

Frontend:
http://localhost:5173

Health:
http://localhost:${environment.PORT}/api/health

Mode:
Mock LLM / Mock Turnstile / In-memory storage`);
});
