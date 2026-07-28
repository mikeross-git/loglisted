import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
  type NextFunction,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from "express";
import multer from "multer";
import { postAnalyze } from "./api/analyze.js";
import { deleteResult, getResult } from "./api/result.js";
import { postSession } from "./api/session.js";
import { postUploadAuthorize } from "./api/upload-authorize.js";
import { AnonymousSessionManager } from "./lib/anonymous-session.js";
import { ScriptBudget } from "./lib/budget.js";
import { VersionedCache } from "./lib/cache.js";
import { DeletionTokenManager } from "./lib/deletion-token.js";
import type { LlmProvider } from "./lib/llm/provider.js";
import { MockLlmProvider, type MockLlmProviderOptions } from "./lib/llm/mock.js";
import { SafeLogger } from "./lib/logger.js";
import { parseModelPricing } from "./lib/model-pricing.js";
import type { OriginPolicy } from "./lib/origin.js";
import { AnonymousQuotas } from "./lib/quotas.js";
import { SlidingWindowRateLimiter } from "./lib/rate-limit.js";
import { ResultTokenManager } from "./lib/result-token.js";
import { MemoryAbuseStore } from "./lib/storage/memory-abuse-store.js";
import { MemoryCacheStore } from "./lib/storage/memory-cache-store.js";
import { MemoryResultStore } from "./lib/storage/memory-result-store.js";
import { ProcessingLock } from "./lib/storage/processing-lock.js";
import { TurnstileVerifier } from "./lib/turnstile.js";
import { UploadTokenManager } from "./lib/upload-token.js";
import {
  TURNSTILE_ALWAYS_PASS_TEST_SECRET,
  loadStagingConfig,
  type StagingConfig,
} from "./staging-config.js";

export interface StagingProviderFactories {
  mock?: (options: MockLlmProviderOptions) => LlmProvider;
  /**
   * Test sentinel only. Staging never selects or invokes this factory.
   */
  production?: () => LlmProvider;
}

export interface StagingAppOptions {
  providerFactories?: StagingProviderFactories;
  turnstileFetchImplementation?: typeof fetch;
}

export interface StagingRuntime {
  app: express.Express;
  provider: LlmProvider;
}

export const stagingHealthStatus = Object.freeze({
  ok: true as const,
  environment: "staging" as const,
  scoringMode: "mock" as const,
});

export function isStagingOriginAllowed(config: StagingConfig, origin: string | undefined): boolean {
  return origin === undefined || config.ALLOWED_ORIGINS.includes(origin);
}

export function createStagingProvider(
  config: StagingConfig,
  factories: StagingProviderFactories = {},
): LlmProvider {
  if (config.APP_ENV !== "staging" || config.SCREENPLAY_SCORING_MODE !== "mock") {
    throw new Error("Public staging is restricted to mock screenplay scoring.");
  }
  return (
    factories.mock?.({ fixture: config.MOCK_LLM_SCENARIO, dryRun: config.DRY_RUN }) ??
    new MockLlmProvider({
      fixture: config.MOCK_LLM_SCENARIO,
      dryRun: config.DRY_RUN,
    })
  );
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

function clientIp(request: ExpressRequest): string {
  return request.ip ?? request.socket.remoteAddress ?? "127.0.0.1";
}

function webRequest(request: ExpressRequest, body?: BodyInit): Request {
  const headers = headersFromExpress(request);
  headers.delete("content-length");
  if (body instanceof FormData) headers.delete("content-type");
  return new Request(`${request.protocol}://${request.get("host")}${request.originalUrl}`, {
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

function testTurnstileFetch(config: StagingConfig): typeof fetch {
  return (_input, init) => {
    const body = init?.body;
    const parameters = body instanceof URLSearchParams ? body : new URLSearchParams();
    const token = parameters.get("response") ?? "";
    return Promise.resolve(
      Response.json({
        success:
          config.TURNSTILE_SECRET_KEY === TURNSTILE_ALWAYS_PASS_TEST_SECRET && token.length > 0,
        hostname: config.TURNSTILE_EXPECTED_HOSTNAMES[0],
        action: config.TURNSTILE_EXPECTED_ACTION,
      }),
    );
  };
}

export function createStagingApp(
  config: StagingConfig,
  options: StagingAppOptions = {},
): StagingRuntime {
  if (config.APP_ENV !== "staging" || config.SCREENPLAY_SCORING_MODE !== "mock") {
    throw new Error("Staging startup refused: production scoring is disabled.");
  }

  const originPolicy: OriginPolicy = {
    allowedOrigins: config.ALLOWED_ORIGINS,
    allowedMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedContentTypes: ["application/json", "multipart/form-data"],
  };
  const abuseStore = new MemoryAbuseStore();
  const logger = new SafeLogger();
  const cacheStore = new MemoryCacheStore();
  const cache = new VersionedCache(cacheStore);
  const results = new MemoryResultStore();
  const sessions = new AnonymousSessionManager({
    signingSecret: config.SESSION_SIGNING_SECRET,
    deviceHmacSecret: config.DEVICE_HMAC_SECRET,
    csrfSigningSecret: config.CSRF_SIGNING_SECRET,
    lifetimeSeconds: config.ANONYMOUS_SESSION_TTL_SECONDS,
    // The Framer site and Render staging hostname are cross-site.
    cookieSameSite: "None",
  });
  const uploadTokens = new UploadTokenManager(
    config.UPLOAD_TOKEN_SIGNING_SECRET,
    abuseStore,
    config.UPLOAD_TOKEN_TTL_SECONDS,
  );
  const resultTokens = new ResultTokenManager(config.RESULT_TOKEN_SIGNING_SECRET);
  const deletionTokens = new DeletionTokenManager(config.DELETION_TOKEN_SIGNING_SECRET);
  const provider = createStagingProvider(config, options.providerFactories);
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
  const quotas = new AnonymousQuotas(abuseStore, {
    maximumCompletedPerSession: config.MAX_COMPLETED_PER_SESSION,
    maximumCompletedPerIp: config.MAX_COMPLETED_PER_IP,
  });
  const rateLimiter = new SlidingWindowRateLimiter(
    abuseStore,
    config.ABUSE_TELEMETRY_TTL_SECONDS * 1_000,
  );
  const processingLock = new ProcessingLock(cacheStore);
  const turnstile = new TurnstileVerifier(abuseStore, {
    secretKey: config.TURNSTILE_SECRET_KEY,
    expectedHostnames: config.TURNSTILE_EXPECTED_HOSTNAMES,
    expectedAction: config.TURNSTILE_EXPECTED_ACTION,
    fetchImplementation:
      options.turnstileFetchImplementation ??
      (config.TURNSTILE_MODE === "test" ? testTurnstileFetch(config) : fetch),
  });
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
          maximumCostUsd: 0.1,
        },
        undefined,
        undefined,
        true,
      ),
    summaryModel: "mock-summary",
    scoringModel: "mock-scoring",
    resultTtlSeconds: config.RESULT_TTL_SECONDS,
    pdfExtractionOptions: {
      maximumFileBytes: config.MAX_PDF_BYTES,
      maximumPages: config.MAX_PDF_PAGES,
      minimumReadableTextLength: config.MIN_READABLE_TEXT_LENGTH,
      lowTextPageThreshold: config.PDF_LOW_TEXT_PAGE_THRESHOLD,
    },
  };

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use(
    cors({
      origin(origin, callback) {
        if (isStagingOriginAllowed(config, origin)) callback(null, true);
        else callback(new Error("Origin is not allowed."));
      },
      credentials: true,
      methods: [...originPolicy.allowedMethods],
      allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  const health = (_request: ExpressRequest, response: ExpressResponse) => {
    response.json(stagingHealthStatus);
  };
  app.get("/health", health);
  app.get("/api/health", health);

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
          csrfSigningSecret: config.CSRF_SIGNING_SECRET,
          deviceHmacSecret: config.DEVICE_HMAC_SECRET,
          ipHmacSecret: config.IP_HMAC_SECRET,
          directIp: clientIp(request),
          trustedProxy: { trustedProxyIps: [] },
          originPolicy,
          turnstile,
          rateLimiter,
          quotas,
          abuseStore,
          uploadTokens,
          globalAnalysesPerMinute: config.GLOBAL_ANALYSES_PER_MINUTE,
          telemetryTtlMs: config.ABUSE_TELEMETRY_TTL_SECONDS * 1_000,
          maxFileBytes: config.MAX_PDF_BYTES,
          authorizationAttemptsPer10Minutes: config.AUTHORIZATION_ATTEMPTS_PER_10_MINUTES,
          onRejection: ({ stage, errorClass, status, reasonCode }) => {
            logger.warn("staging.upload_authorization_rejected", {
              processingStage: stage,
              errorClass,
              status,
              environment: "staging",
              ...(reasonCode ? { reasonCode } : {}),
            });
          },
          findCachedResult: async (fileHash, sessionId) => {
            const stored = await results.findByFileAndSession(fileHash, sessionId);
            if (!stored) return null;
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
    limits: { fileSize: config.MAX_PDF_BYTES, files: 1 },
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
      const copy = Uint8Array.from(request.file.buffer);
      const form = new FormData();
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
            ipHmacSecret: config.IP_HMAC_SECRET,
            analysisAttemptsPer10Minutes: config.ANALYSIS_ATTEMPTS_PER_10_MINUTES,
            onRejection: ({ stage, errorClass, errorCode, status }) => {
              logger.warn("staging.analysis_rejected", {
                processingStage: stage,
                errorClass,
                errorCode,
                status,
                environment: "staging",
              });
            },
            ...pipelineDependencies,
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
      response.status(403).json({
        error: { code: "STAGING_REQUEST_REJECTED", message: "The request was rejected." },
      });
    },
  );
  return { app, provider };
}

export function startStagingServer(
  environment: Record<string, string | undefined>,
): ReturnType<express.Express["listen"]> {
  const config = loadStagingConfig(environment);
  const { app } = createStagingApp(config);
  return app.listen(config.PORT, config.HOST, () => {
    console.log("APP_ENV=staging");
    console.log("SCREENPLAY_SCORING_MODE=mock");
    console.log("Production scoring disabled");
    console.log(`Staging backend listening on http://${config.HOST}:${config.PORT}`);
  });
}
