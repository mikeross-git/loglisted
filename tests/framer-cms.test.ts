import { describe, expect, it, vi } from "vitest";
import type { CollectionItemInput } from "framer-api";
import {
  FRAMER_FIELD_DISPLAY_NAMES,
  FramerCmsSynchronizer,
  buildFramerCmsItem,
  loadFramerCmsConfig,
  resolveFramerFieldMap,
  slugifyWriterName,
  syncFramerCmsBestEffort,
  type CmsFieldDescriptor,
  type FramerCmsConnectionAdapter,
} from "../src/integrations/framer-cms.js";
import type { StoredResult } from "../src/lib/storage/result-store.js";
import { SafeLogger, type LogEvent } from "../src/lib/logger.js";

const result: StoredResult = {
  resultId: "6f83ef39-8626-425b-868f-735d8a8088aa",
  anonymousSessionId: "b141e2de-81d3-48b0-86c8-7710e29e9743",
  fileHash: "a".repeat(64),
  projectTitle: "The Example",
  declaredFormat: "halfHourPilot",
  declaredGenre: "Comedy",
  categoryScores: {
    premise: 7.1,
    story: 7.2,
    structure: 7.3,
    characters: 7.4,
    dialogue: 7.5,
    pacing: 7.6,
    theme: 7.7,
    tone: 7.8,
    marketability: 7.9,
    craft: 8,
  },
  overallScore: 7.6,
  completedAt: "2026-07-28T18:00:00.000Z",
  internal: {
    versions: { scoring: "1" },
    inputTokens: 100,
    outputTokens: 20,
    estimatedCostUsd: 0,
    approvedMetadata: {},
    submissionLogline: "A writer tests a secure CMS integration.",
    submissionContact: {
      firstName: "  Jané ",
      lastName: " Doe ",
      email: "jane@example.com",
      imdbUrl: "https://www.imdb.com/name/nm0000001/",
    },
    evaluationMode: "mock",
  },
};

function fields(): CmsFieldDescriptor[] {
  return Object.entries(FRAMER_FIELD_DISPLAY_NAMES).map(([key, name], index) => ({
    id: `field-${index}-${key}`,
    name,
    type:
      key === "test"
        ? "boolean"
        : key.endsWith("Score")
          ? "number"
          : key === "imdb"
            ? "link"
            : "string",
  }));
}

function fieldValue(item: ReturnType<typeof buildFramerCmsItem>, key: string) {
  const field = fields().find((candidate) => candidate.id.endsWith(`-${key}`));
  if (!field) throw new Error("Missing test field.");
  return item.fieldData[field.id]?.value;
}

describe("Framer CMS integration", () => {
  it("discovers exact display-name IDs and rejects missing fields", () => {
    expect(resolveFramerFieldMap(fields()).writerName).toContain("writerName");
    expect(() => resolveFramerFieldMap(fields().slice(1))).toThrow(/Writer S Name/);
  });

  it("maps contact, mock marker, format, genre, logline, and all scores", () => {
    const item = buildFramerCmsItem(result, fields(), "draft");
    expect(item.slug).toBe("jane-doe-6f83ef39");
    expect(item.draft).toBe(true);
    expect(fieldValue(item, "writerName")).toBe("Jané Doe");
    expect(fieldValue(item, "email")).toBe("jane@example.com");
    expect(fieldValue(item, "test")).toBe(true);
    expect(fieldValue(item, "format")).toBe("Half-Hour TV Pilot");
    expect(fieldValue(item, "genreCategory")).toBe("Comedy");
    expect(fieldValue(item, "logline")).toBe(result.internal.submissionLogline);
    expect(fieldValue(item, "overallScore")).toBe(7.6);
    for (const scoreKey of Object.keys(result.categoryScores)) {
      expect(fieldValue(item, `${scoreKey}Score`)).toBe(
        result.categoryScores[scoreKey as keyof typeof result.categoryScores],
      );
    }
  });

  it("uses No for production and omits empty optional fields", () => {
    const contact = result.internal.submissionContact;
    if (!contact) throw new Error("Test contact is missing.");
    const production: StoredResult = {
      ...result,
      internal: {
        ...result.internal,
        evaluationMode: undefined,
        submissionLogline: undefined,
        submissionContact: {
          ...contact,
          imdbUrl: undefined,
        },
      },
    };
    const item = buildFramerCmsItem(production, fields(), "published");
    expect(fieldValue(item, "test")).toBe(false);
    expect(fieldValue(item, "logline")).toBeUndefined();
    expect(fieldValue(item, "imdb")).toBeUndefined();
    expect(item.draft).toBe(false);
  });

  it("writes Genre Category as a Framer collection reference when configured that way", () => {
    const referenceFields = fields().map((field) =>
      field.name === "Genre Category"
        ? { ...field, type: "collectionReference", collectionId: "genres-collection" }
        : field,
    );
    const item = buildFramerCmsItem(result, referenceFields, "draft", {
      genreCategory: "genre-item-comedy",
    });
    const genreField = referenceFields.find((field) => field.name === "Genre Category");
    if (!genreField) throw new Error("Test genre field is missing.");
    expect(item.fieldData[genreField.id]).toEqual({
      type: "collectionReference",
      value: "genre-item-comedy",
    });
  });

  it("uses a stable safe suffix and never an email in slugs", () => {
    expect(slugifyWriterName("Éva O'Neil", result.resultId)).toBe("eva-o-neil-6f83ef39");
    expect(slugifyWriterName("", result.resultId)).toBe("writer-6f83ef39");
  });

  it("does not call Framer when disabled", async () => {
    const connector = vi.fn();
    const sync = new FramerCmsSynchronizer(
      loadFramerCmsConfig({ FRAMER_CMS_SYNC_ENABLED: "false" }),
      connector,
    );
    expect(await sync.syncResultToFramerCms(result)).toEqual({
      status: "disabled",
      attempts: 0,
    });
    expect(connector).not.toHaveBeenCalled();
  });

  it("creates once and treats the stable slug as an existing idempotent item", async () => {
    const added: CollectionItemInput[] = [];
    const existing: { id: string; slug: string }[] = [];
    const connection: FramerCmsConnectionAdapter = {
      getCollection: vi.fn(() =>
        Promise.resolve({
          getFields: () => Promise.resolve(fields()),
          getItems: () => Promise.resolve(existing),
          addItems: (items: CollectionItemInput[]) => {
            added.push(...items);
            const slug = items[0]?.slug;
            if (slug) existing.push({ id: "framer-item-1", slug });
            return Promise.resolve();
          },
        }),
      ),
      disconnect: vi.fn(() => Promise.resolve()),
    };
    const sync = new FramerCmsSynchronizer(
      loadFramerCmsConfig({
        FRAMER_CMS_SYNC_ENABLED: "true",
        FRAMER_CMS_PUBLISH_MODE: "draft",
        FRAMER_API_TOKEN: "secret-token",
        FRAMER_PROJECT_ID: "project-id",
        FRAMER_COLLECTION_ID: "collection-id",
      }),
      () => Promise.resolve(connection),
    );
    expect((await sync.syncResultToFramerCms(result)).status).toBe("created");
    expect((await sync.syncResultToFramerCms(result)).status).toBe("existing");
    expect(added).toHaveLength(1);
  });

  it("retries transient errors only and never retries permanent validation errors", async () => {
    let calls = 0;
    const transientConnector = (): Promise<FramerCmsConnectionAdapter> => {
      calls += 1;
      if (calls < 3) {
        return Promise.reject(Object.assign(new Error("temporary"), { status: 503 }));
      }
      return Promise.resolve({
        getCollection: () =>
          Promise.resolve({
            getFields: () => Promise.resolve(fields()),
            getItems: () => Promise.resolve([]),
            addItems: () => Promise.resolve(),
          }),
        disconnect: () => Promise.resolve(),
      });
    };
    const config = loadFramerCmsConfig({
      FRAMER_CMS_SYNC_ENABLED: "true",
      FRAMER_API_TOKEN: "secret",
      FRAMER_PROJECT_ID: "project",
      FRAMER_COLLECTION_ID: "collection",
    });
    const sync = new FramerCmsSynchronizer(config, transientConnector, () => Promise.resolve());
    expect((await sync.syncResultToFramerCms(result)).attempts).toBe(3);

    const permanent = vi.fn(() =>
      Promise.reject(Object.assign(new Error("invalid"), { status: 400 })),
    );
    await expect(
      new FramerCmsSynchronizer(config, permanent, () => Promise.resolve()).syncResultToFramerCms(
        result,
      ),
    ).rejects.toThrow("invalid");
    expect(permanent).toHaveBeenCalledOnce();
  });

  it("requires all server-only credentials only when enabled", () => {
    expect(() => loadFramerCmsConfig({ FRAMER_CMS_SYNC_ENABLED: "true" })).toThrow();
    expect(loadFramerCmsConfig({}).FRAMER_CMS_SYNC_ENABLED).toBe(false);
  });

  it("sanitizes failures without logging credentials or submission content", async () => {
    const events: LogEvent[] = [];
    const config = loadFramerCmsConfig({
      FRAMER_CMS_SYNC_ENABLED: "true",
      FRAMER_API_TOKEN: "super-secret-framer-token",
      FRAMER_PROJECT_ID: "project",
      FRAMER_COLLECTION_ID: "collection",
    });
    const sync = new FramerCmsSynchronizer(config, () =>
      Promise.reject(new Error("jane@example.com super-secret-framer-token")),
    );
    expect(
      await syncFramerCmsBestEffort(sync, result, new SafeLogger((event) => events.push(event))),
    ).toBeNull();
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("super-secret-framer-token");
    expect(serialized).not.toContain("jane@example.com");
    expect(serialized).not.toContain(result.internal.submissionLogline);
  });
});
