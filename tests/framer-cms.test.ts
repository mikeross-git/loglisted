import { describe, expect, it, vi } from "vitest";
import type { CollectionItemInput } from "framer-api";
import {
  FRAMER_FIELD_DISPLAY_NAMES,
  FramerCmsSynchronizer,
  FramerCmsModerationService,
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
      websiteUrl: "https://janedoe.example.com/",
    },
    evaluationMode: "mock",
  },
};

function fields(): CmsFieldDescriptor[] {
  return Object.entries(FRAMER_FIELD_DISPLAY_NAMES).map(([key, name], index) => ({
    id: `field-${index}-${key}`,
    name,
    type:
      key === "test" || key === "flagged"
        ? "boolean"
        : key === "genreDropdown" || key === "flagStatus" || key === "flagReason"
          ? "enum"
          : key === "flaggedAt" || key === "flagReviewedAt"
            ? "date"
            : key.endsWith("Score")
              ? "number"
              : key === "imdb" || key === "website"
                ? "link"
                : "string",
    ...(key === "genreDropdown"
      ? {
          cases: [
            { id: "genre-action", name: "Action" },
            { id: "genre-comedy", name: "Comedy" },
          ],
        }
      : key === "flagStatus"
        ? {
            cases: [
              { id: "flag-clear", name: "Clear" },
              { id: "flag-pending", name: "Pending Review" },
              { id: "flag-confirmed", name: "Confirmed Violation" },
              { id: "flag-dismissed", name: "Dismissed" },
            ],
          }
        : key === "flagReason"
          ? {
              cases: [
                { id: "reason-copyright", name: "Copyright violation" },
                { id: "reason-inappropriate", name: "Inappropriate content" },
                { id: "reason-spam", name: "Spam" },
                { id: "reason-other", name: "Other" },
              ],
            }
          : {}),
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
    expect(fieldValue(item, "genreDropdown")).toBe("genre-comedy");
    expect(fieldValue(item, "logline")).toBe(result.internal.submissionLogline);
    expect(fieldValue(item, "website")).toBe("https://janedoe.example.com/");
    expect(fieldValue(item, "searchIndex")).toBe(
      "Jané Doe The Example A writer tests a secure CMS integration. Half-Hour TV Pilot Comedy",
    );
    expect(fieldValue(item, "overallScore")).toBe(7.6);
    for (const scoreKey of Object.keys(result.categoryScores)) {
      expect(fieldValue(item, `${scoreKey}Score`)).toBe(
        result.categoryScores[scoreKey as keyof typeof result.categoryScores],
      );
    }
  });

  it("maps moderation reports to the live CMS enum labels", async () => {
    const liveFields = fields().map((field) =>
      field.name === "Flagged"
        ? {
            ...field,
            type: "enum",
            cases: [
              { id: "flag-no", name: "No" },
              { id: "flag-violation", name: "Yes - Violation" },
              { id: "flag-deletion", name: "Yes - Deletion" },
            ],
          }
        : field.name === "Flag Reason"
          ? {
              ...field,
              cases: [
                { id: "reason-none", name: "None" },
                { id: "reason-copyright", name: "Copyright" },
                { id: "reason-inappropriate", name: "Inappropriate Content" },
                { id: "reason-spam", name: "Spam" },
                { id: "reason-other", name: "Other" },
              ],
            }
          : field,
    );
    const fieldMap = resolveFramerFieldMap(liveFields);
    const added: CollectionItemInput[][] = [];
    const connector = vi.fn(() =>
      Promise.resolve({
        getCollection: () =>
          Promise.resolve({
            getFields: () => Promise.resolve(liveFields),
            getItems: () =>
              Promise.resolve([
                {
                  id: "node-1",
                  slug: "sample-script-12345678",
                  draft: false,
                  fieldData: {
                    [fieldMap.writerName]: { type: "string", value: "Jane Doe" },
                    [fieldMap.scriptTitle]: { type: "string", value: "Sample Script" },
                    [fieldMap.flagStatus]: { type: "enum", value: "flag-clear" },
                  },
                },
              ]),
            addItems: (items: CollectionItemInput[]) => {
              added.push(items);
              return Promise.resolve();
            },
          }),
        disconnect: () => Promise.resolve(),
      }),
    );
    const service = new FramerCmsModerationService(
      {
        FRAMER_CMS_SYNC_ENABLED: true,
        FRAMER_CMS_PUBLISH_MODE: "published",
        FRAMER_API_TOKEN: "token",
        FRAMER_PROJECT_ID: "project",
        FRAMER_COLLECTION_ID: "collection",
      },
      connector,
    );

    expect(
      await service.flagPublishedRanking({
        slug: "sample-script-12345678",
        reportId: "report-1",
        reason: "copyright",
        createdAt: "2026-08-11T00:00:00.000Z",
      }),
    ).toBe("flagged");
    expect(added[0]?.[0]?.fieldData?.[fieldMap.flagged]?.value).toBe("flag-violation");
    expect(added[0]?.[0]?.fieldData?.[fieldMap.flagReason]?.value).toBe("reason-copyright");
    expect(added[0]?.[0]?.fieldData?.[fieldMap.flagStatus]?.value).toBe("flag-pending");
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
          websiteUrl: undefined,
        },
      },
    };
    const item = buildFramerCmsItem(production, fields(), "published");
    expect(fieldValue(item, "test")).toBe(false);
    expect(fieldValue(item, "logline")).toBeUndefined();
    expect(fieldValue(item, "imdb")).toBeUndefined();
    expect(fieldValue(item, "website")).toBeUndefined();
    expect(item.draft).toBe(false);
  });

  it("supports a Yes/No enum for Show on Loglist", () => {
    const enumFields = fields().map((field) =>
      field.name === "Show on Loglist"
        ? {
            ...field,
            type: "enum",
            cases: [
              { id: "show-yes", name: "Yes" },
              { id: "show-no", name: "No" },
            ],
          }
        : field,
    );
    const item = buildFramerCmsItem(result, enumFields, "draft");
    const showField = enumFields.find((field) => field.name === "Show on Loglist");
    if (!showField) throw new Error("Show on Loglist test field is missing.");
    expect(item.fieldData[showField.id]).toEqual({ type: "enum", value: "show-yes" });
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

  it("creates once and updates the stable existing item without duplicating it", async () => {
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
    expect((await sync.syncResultToFramerCms(result)).status).toBe("updated");
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({
      id: "framer-item-1",
      slug: "jane-doe-6f83ef39",
    });
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
