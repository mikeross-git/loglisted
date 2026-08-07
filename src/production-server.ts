import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
  type NextFunction,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from "express";
import multer from "multer";
import { postAnalyze } from "./api/analyze.js";
import { getPrivacyStatus } from "./api/privacy-status.js";
import { getPublicRankings } from "./api/rankings.js";
import { deleteResult, getResult } from "./api/result.js";
import { postSession } from "./api/session.js";
import { postUploadAuthorize } from "./api/upload-authorize.js";
import {
  FramerCmsSynchronizer,
  syncFramerCmsBestEffort,
  type FramerCmsConnector,
} from "./integrations/framer-cms.js";
import { FramerRankingsReader } from "./integrations/framer-rankings.js";
import { AnonymousSessionManager } from "./lib/anonymous-session.js";
import type { AnalyzePipelineDependencies } from "./lib/analyze-screenplay.js";
import { ScriptBudget } from "./lib/budget.js";
import { VersionedCache } from "./lib/cache.js";
import { loadConfig, type AppConfig } from "./lib/config.js";
import { DeletionTokenManager } from "./lib/deletion-token.js";
import { ProcessingCapacityError, ValidationError } from "./lib/errors.js";
import { createLlmProvider } from "./lib/llm/factory.js";
import type { LlmProvider } from "./lib/llm/provider.js";
import { SafeLogger } from "./lib/logger.js";
import { missingModelPrices, parseModelPricing } from "./lib/model-pricing.js";
import type { OriginPolicy } from "./lib/origin.js";
import { AnonymousQuotas } from "./lib/quotas.js";
import { SlidingWindowRateLimiter } from "./lib/rate-limit.js";
import { ResultTokenManager } from "./lib/result-token.js";
import { securityHeaders } from "./lib/security-headers.js";
import { RedisAtomicSpendStore, type SpendLimits } from "./lib/spend-circuit-breaker.js";
import { RedisAbuseStore } from "./lib/storage/redis-abuse-store.js";
import { RedisCacheStore } from "./lib/storage/redis-cache-store.js";
import { EncryptedCacheStore } from "./lib/storage/encrypted-cache-store.js";
import { ProcessingLock } from "./lib/storage/processing-lock.js";
import { RedisResultStore } from "./lib/storage/redis-result-store.js";
import {
  UpstashRedisClient,
  type UpstashRedisCompatibleClient,
} from "./lib/storage/upstash-redis-client.js";
import { TurnstileVerifier } from "./lib/turnstile.js";
import { UploadTokenManager } from "./lib/upload-token.js";

export interface ProductionProviderFactories {
  openai?: (config: AppConfig) => LlmProvider;
  /** Test sentinel only. Production never selects or invokes this factory. */
  mock?: () => LlmProvider;
}

export interface ProductionAppOptions {
  providerFactories?: ProductionProviderFactories;
  redisClient?: UpstashRedisCompatibleClient;
  turnstileFetchImplementation?: typeof fetch;
  framerCmsConnector?: FramerCmsConnector;
}

export interface ProductionRuntime {
  app: express.Express;
  provider: LlmProvider;
}

type ValidatedProductionConfig = AppConfig & {
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  CACHE_ENCRYPTION_KEY: string;
  DEVICE_HMAC_SECRET: string;
  CSRF_SIGNING_SECRET: string;
  IP_HMAC_SECRET: string;
  RESULT_TOKEN_SIGNING_SECRET: string;
  DELETION_TOKEN_SIGNING_SECRET: string;
  SUMMARY_MODEL: string;
  SCORING_MODEL: string;
};

export const productionHealthStatus = Object.freeze({
  ok: true as const,
  environment: "production" as const,
  scoringMode: "production" as const,
  llmProvider: "openai" as const,
  dryRun: false as const,
});

function assertProductionConfig(config: AppConfig): asserts config is ValidatedProductionConfig {
  if (
    config.APP_ENV !== "production" ||
    config.NODE_ENV !== "production" ||
    config.SCREENPLAY_SCORING_MODE !== "production"
  ) {
    throw new ValidationError("The live backend requires production environment and scoring mode.");
  }
  if (config.LLM_PROVIDER !== "openai" || config.AI_PROVIDER !== "openai") {
    throw new ValidationError("The live backend requires the configured OpenAI provider.");
  }
  if (config.DRY_RUN) {
    throw new ValidationError("The live backend cannot start in dry-run mode.");
  }
  if (config.ALLOW_MOCK_IN_PRODUCTION) {
    throw new ValidationError(
      "Mock-provider production override is forbidden for the live backend.",
    );
  }
  if (config.STORAGE_DRIVER !== "redis") {
    throw new ValidationError("The live backend requires Redis-backed atomic storage.");
  }
  if (
    !config.AI_PROVIDER_SUPPORTS_REQUEST_STORAGE_CONTROL ||
    config.AI_PROVIDER_REQUEST_STORAGE_DISABLED !== true
  ) {
    throw new ValidationError(
      "The live backend requires explicit provider request-storage control.",
    );
  }
  if (
    !config.UPSTASH_REDIS_REST_URL ||
    !config.UPSTASH_REDIS_REST_TOKEN ||
    !config.CACHE_ENCRYPTION_KEY ||
    !config.DEVICE_HMAC_SECRET ||
    !config.CSRF_SIGNING_SECRET ||
    !config.IP_HMAC_SECRET ||
    !config.RESULT_TOKEN_SIGNING_SECRET ||
    !config.DELETION_TOKEN_SIGNING_SECRET ||
    !config.SUMMARY_MODEL ||
    !config.SCORING_MODEL
  ) {
    throw new ValidationError("The live backend is missing required secrets or model settings.");
  }
  const pricing = parseModelPricing(config.MODEL_PRICING_JSON);
  const missing = missingModelPrices(pricing, [
    config.SUMMARY_MODEL,
    config.SCORING_MODEL,
    config.VERIFICATION_MODEL,
    config.ADJUDICATOR_MODEL,
  ]);
  if (missing.length > 0) {
    throw new ValidationError("The live backend requires pricing for every active model.", {
      details: { missingModelPriceCount: missing.length },
    });
  }
  const activeModels = [
    config.SUMMARY_MODEL,
    config.SCORING_MODEL,
    config.VERIFICATION_MODEL,
    config.ADJUDICATOR_MODEL,
  ].filter((model): model is string => Boolean(model));
  if (
    activeModels.some((model) => {
      const price = pricing.models[model];
      return !price || price.inputPerMillion <= 0 || price.outputPerMillion <= 0;
    })
  ) {
    throw new ValidationError("The live backend requires non-zero active-model pricing.");
  }
}

export function loadProductionConfig(environment: Record<string, string | undefined>): AppConfig {
  const config = loadConfig(environment);
  assertProductionConfig(config);
  return config;
}

export function createProductionProvider(
  config: AppConfig,
  factories: ProductionProviderFactories = {},
): LlmProvider {
  if (config.APP_ENV !== "production" || config.LLM_PROVIDER !== "openai") {
    throw new ValidationError("Production provider creation refused.");
  }
  return factories.openai?.(config) ?? createLlmProvider(config);
}

export function isProductionOriginAllowed(config: AppConfig, origin: string | undefined): boolean {
  return origin === undefined || config.CORS_ALLOWED_ORIGINS.includes(origin);
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

export function createProductionApp(
  config: AppConfig,
  options: ProductionAppOptions = {},
): ProductionRuntime {
  // Revalidate the safety invariants even when a parsed-looking object is supplied by a test.
  assertProductionConfig(config);
  const validated = config;
  const redis =
    options.redisClient ??
    new UpstashRedisClient({
      url: validated.UPSTASH_REDIS_REST_URL,
      token: validated.UPSTASH_REDIS_REST_TOKEN,
    });
  const rawCacheStore = new RedisCacheStore(redis);
  const encryptedCacheStore = new EncryptedCacheStore(
    rawCacheStore,
    validated.CACHE_ENCRYPTION_KEY,
  );
  const cache = new VersionedCache(encryptedCacheStore, {
    pdfExtraction: Math.min(validated.CHUNK_CACHE_TTL_HOURS * 3_600, 3_600),
    screenplayMetadata: validated.CHUNK_CACHE_TTL_HOURS * 3_600,
    chunks: validated.CHUNK_CACHE_TTL_HOURS * 3_600,
    chunkSummary: validated.SUMMARY_CACHE_TTL_DAYS * 86_400,
    reducedScreenplay: validated.COMPRESSED_REPRESENTATION_TTL_DAYS * 86_400,
    representativeExcerpts: validated.CHUNK_CACHE_TTL_HOURS * 3_600,
    finalScore: validated.RESULT_TTL_SECONDS,
  });
  const abuseStore = new RedisAbuseStore(redis);
  const results = new RedisResultStore(redis);
  const spendStore = new RedisAtomicSpendStore(redis);
  const provider = createProductionProvider(validated, options.providerFactories);
  const pricing = parseModelPricing(validated.MODEL_PRICING_JSON);
  const logger = new SafeLogger();
  const originPolicy: OriginPolicy = {
    allowedOrigins: validated.CORS_ALLOWED_ORIGINS,
    allowedMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedContentTypes: ["application/json", "multipart/form-data"],
  };
  const trustedProxy = {
    trustedProxyIps: validated.TRUSTED_PROXY_IPS,
    trustedProxyHops: validated.TRUSTED_PROXY_HOPS,
  };
  const sessions = new AnonymousSessionManager({
    signingSecret: validated.SESSION_SIGNING_SECRET,
    deviceHmacSecret: validated.DEVICE_HMAC_SECRET,
    csrfSigningSecret: validated.CSRF_SIGNING_SECRET,
    lifetimeSeconds: validated.ANONYMOUS_SESSION_TTL_SECONDS,
    cookieSameSite: "None",
  });
  const uploadTokens = new UploadTokenManager(
    validated.UPLOAD_TOKEN_SIGNING_SECRET,
    abuseStore,
    validated.UPLOAD_TOKEN_TTL_SECONDS,
  );
  const resultTokens = new ResultTokenManager(validated.RESULT_TOKEN_SIGNING_SECRET);
  const deletionTokens = new DeletionTokenManager(validated.DELETION_TOKEN_SIGNING_SECRET);
  const quotas = new AnonymousQuotas(abuseStore);
  const rateLimiter = new SlidingWindowRateLimiter(
    abuseStore,
    validated.ABUSE_TELEMETRY_TTL_SECONDS * 1_000,
  );
  const processingLock = new ProcessingLock(rawCacheStore);
  const turnstile = new TurnstileVerifier(abuseStore, {
    secretKey: validated.TURNSTILE_SECRET_KEY,
    expectedHostnames: [validated.TURNSTILE_EXPECTED_HOSTNAME],
    expectedAction: validated.TURNSTILE_EXPECTED_ACTION,
    ...(options.turnstileFetchImplementation
      ? { fetchImplementation: options.turnstileFetchImplementation }
      : {}),
  });
  const spendLimits: SpendLimits = {
    hourlySpendLimitUsd: validated.HOURLY_LLM_SPEND_LIMIT_USD,
    dailySpendLimitUsd: validated.DAILY_LLM_SPEND_LIMIT_USD,
    maxAnalysesPerHour: validated.MAX_ANALYSES_PER_HOUR_GLOBAL,
  };
  const framerCms = new FramerCmsSynchronizer(
    {
      FRAMER_CMS_SYNC_ENABLED: validated.FRAMER_CMS_SYNC_ENABLED,
      FRAMER_CMS_PUBLISH_MODE: validated.FRAMER_CMS_PUBLISH_MODE,
      FRAMER_API_TOKEN: validated.FRAMER_API_TOKEN,
      FRAMER_PROJECT_ID: validated.FRAMER_PROJECT_ID,
      FRAMER_COLLECTION_ID: validated.FRAMER_COLLECTION_ID,
    },
    options.framerCmsConnector,
  );
  const rankings = new FramerRankingsReader(
    {
      FRAMER_CMS_SYNC_ENABLED: validated.FRAMER_CMS_SYNC_ENABLED,
      FRAMER_CMS_PUBLISH_MODE: validated.FRAMER_CMS_PUBLISH_MODE,
      FRAMER_API_TOKEN: validated.FRAMER_API_TOKEN,
      FRAMER_PROJECT_ID: validated.FRAMER_PROJECT_ID,
      FRAMER_COLLECTION_ID: validated.FRAMER_COLLECTION_ID,
      FRAMER_RANKINGS_ENABLED: validated.FRAMER_RANKINGS_ENABLED,
      FRAMER_RANKINGS_CACHE_TTL_SECONDS: validated.FRAMER_RANKINGS_CACHE_TTL_SECONDS,
    },
    options.framerCmsConnector,
  );
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
          maximumInputTokens: validated.MAX_TOTAL_INPUT_TOKENS_PER_SCRIPT,
          maximumOutputTokens: validated.MAX_TOTAL_OUTPUT_TOKENS_PER_SCRIPT,
          maximumCostUsd: validated.MAX_LLM_COST_USD_PER_SUBMISSION,
        },
        spendStore,
        spendLimits,
        false,
        true,
      ),
    summaryModel: validated.SUMMARY_MODEL,
    scoringModel: validated.SCORING_MODEL,
    llmConcurrency: validated.LLM_CONCURRENCY,
    summaryOutputTokens: validated.MAX_CHUNK_SUMMARY_OUTPUT_TOKENS,
    scoringInputTokens: validated.MAX_SCORING_INPUT_TOKENS,
    scoringOutputTokens: validated.MAX_SCORING_OUTPUT_TOKENS,
    representativeExcerptTokenBudget: validated.REPRESENTATIVE_EXCERPT_TOKEN_BUDGET,
    timeoutMs: validated.LLM_TIMEOUT_MS,
    resultTtlSeconds: validated.RESULT_TTL_SECONDS,
    pdfExtractionOptions: {
      maxFileBytes: validated.MAX_PDF_BYTES,
      maxPages: validated.MAX_PDF_PAGES,
      minPages: validated.MIN_PDF_PAGES,
      minimumReadableTextLength: validated.MIN_READABLE_TEXT_LENGTH,
      lowTextPageThreshold: validated.PDF_LOW_TEXT_PAGE_THRESHOLD,
    },
  } satisfies AnalyzePipelineDependencies;

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", validated.TRUSTED_PROXY_HOPS);
  app.use(
    cors({
      origin(origin, callback) {
        if (isProductionOriginAllowed(validated, origin)) callback(null, true);
        else callback(new Error("Origin is not allowed."));
      },
      credentials: true,
      methods: [...originPolicy.allowedMethods],
      allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    }),
  );
  app.use((_request, response, next) => {
    for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  const health = (_request: ExpressRequest, response: ExpressResponse) => {
    response.json({
      ...productionHealthStatus,
      framerCmsSyncEnabled: framerCms.enabled,
      rankingsEnabled: rankings.enabled,
    });
  };
  app.get("/health", health);
  app.get("/api/health", health);
  app.get(
    "/api/privacy-status",
    route(async (request, response) => {
      await sendWebResponse(
        await getPrivacyStatus(webRequest(request), {
          config: validated,
          provider,
          model: validated.SCORING_MODEL,
        }),
        response,
      );
    }),
  );
  app.get(
    "/api/rankings",
    route(async (request, response) => {
      const parameters = new URL(request.originalUrl, "http://localhost").searchParams;
      await sendWebResponse(await getPublicRankings(rankings, parameters), response);
    }),
  );
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
          csrfSigningSecret: validated.CSRF_SIGNING_SECRET,
          deviceHmacSecret: validated.DEVICE_HMAC_SECRET,
          ipHmacSecret: validated.IP_HMAC_SECRET,
          directIp: clientIp(request),
          trustedProxy,
          originPolicy,
          turnstile,
          rateLimiter,
          quotas,
          abuseStore,
          uploadTokens,
          globalAnalysesPerMinute: validated.GLOBAL_ANALYSES_PER_MINUTE,
          telemetryTtlMs: validated.ABUSE_TELEMETRY_TTL_SECONDS * 1_000,
          maxFileBytes: validated.MAX_PDF_BYTES,
          onRejection: ({ stage, errorClass, status, reasonCode }) => {
            logger.warn("production.upload_authorization_rejected", {
              processingStage: stage,
              errorClass,
              status,
              environment: "production",
              ...(reasonCode ? { reasonCode } : {}),
            });
          },
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
    limits: { fileSize: validated.MAX_PDF_BYTES, files: 1 },
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
      const uploadedFile = request.file;
      const copy = Uint8Array.from(uploadedFile.buffer);
      const form = new FormData();
      try {
        form.set(
          "file",
          new File([copy.buffer], uploadedFile.originalname, { type: uploadedFile.mimetype }),
        );
        await sendWebResponse(
          await postAnalyze(webRequest(request, form), {
            sessions,
            uploadTokens,
            quotas,
            rateLimiter,
            originPolicy,
            directIp: clientIp(request),
            trustedProxy,
            ipHmacSecret: validated.IP_HMAC_SECRET,
            admitGlobalCapacity: async () => {
              const snapshot = await spendStore.beginAnalysis(new Date(), spendLimits);
              if (
                snapshot.hourlyReservedUsd >= spendLimits.hourlySpendLimitUsd ||
                snapshot.dailyReservedUsd >= spendLimits.dailySpendLimitUsd
              ) {
                throw new ProcessingCapacityError("Global spend capacity has been reached.");
              }
            },
            onRejection: ({
              stage,
              errorClass,
              errorCode,
              reasonCode,
              providerStatus,
              providerRequestId,
              providerCode,
              providerParam,
              failureKind,
              status,
            }) => {
              logger.warn("production.analysis_rejected", {
                processingStage: stage,
                errorClass,
                errorCode,
                ...(reasonCode ? { reasonCode } : {}),
                ...(providerStatus !== undefined ? { providerStatus } : {}),
                ...(providerRequestId ? { providerRequestId } : {}),
                ...(providerCode ? { providerCode } : {}),
                ...(providerParam ? { providerParam } : {}),
                ...(failureKind ? { failureKind } : {}),
                status,
                environment: "production",
              });
            },
            ...pipelineDependencies,
            onSuccessfulResult: (result) =>
              syncFramerCmsBestEffort(framerCms, result, logger).then(() => undefined),
          }),
          response,
        );
      } finally {
        uploadedFile.buffer.fill(0);
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
        error: { code: "REQUEST_REJECTED", message: "The request was rejected." },
      });
    },
  );
  return { app, provider };
}

export function startProductionServer(
  environment: Record<string, string | undefined>,
): ReturnType<express.Express["listen"]> {
  const config = loadProductionConfig(environment);
  const { app } = createProductionApp(config);
  return app.listen(config.PORT, config.HOST, () => {
    console.log("APP_ENV=production");
    console.log("SCREENPLAY_SCORING_MODE=production");
    console.log("Live OpenAI scoring enabled");
    console.log(`Production backend listening on http://${config.HOST}:${config.PORT}`);
  });
}
