import { connect, type CollectionItemInput, type Field, type FieldDataInput } from "framer-api";
import { z } from "zod";
import type { SafeLogger } from "../lib/logger.js";
import type { StoredResult } from "../lib/storage/result-store.js";
import { StoredResultSchema } from "../lib/storage/result-store.js";

const booleanFromEnvironment = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() === "true" : value),
  z.boolean(),
);

export const FramerCmsEnvironmentSchema = z
  .object({
    FRAMER_CMS_SYNC_ENABLED: booleanFromEnvironment.default(false),
    FRAMER_CMS_PUBLISH_MODE: z.enum(["draft", "published"]).default("draft"),
    FRAMER_API_TOKEN: z.string().optional(),
    FRAMER_PROJECT_ID: z.string().optional(),
    FRAMER_COLLECTION_ID: z.string().optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (!value.FRAMER_CMS_SYNC_ENABLED) return;
    for (const key of ["FRAMER_API_TOKEN", "FRAMER_PROJECT_ID", "FRAMER_COLLECTION_ID"] as const) {
      if (!value[key]?.trim()) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when Framer CMS synchronization is enabled.`,
        });
      }
    }
  });

export type FramerCmsConfig = z.infer<typeof FramerCmsEnvironmentSchema>;

export const FRAMER_FIELD_DISPLAY_NAMES = Object.freeze({
  writerName: "Writer S Name",
  email: "Email",
  test: "Test",
  scriptTitle: "Script Title",
  logline: "Logline",
  overallScore: "Overall Score",
  premiseScore: "Premise Score",
  storyScore: "Story Score",
  structureScore: "Structure Score",
  charactersScore: "Characters Score",
  dialogueScore: "Dialogue Score",
  pacingScore: "Pacing Score",
  themeScore: "Theme Score",
  toneScore: "Tone Score",
  marketabilityScore: "Marketability Score",
  craftScore: "Craft Score",
  genreCategory: "Genre Category",
  imdb: "IMDB",
  format: "Format",
});

export type FramerFieldKey = keyof typeof FRAMER_FIELD_DISPLAY_NAMES;
export type FramerFieldMap = Record<FramerFieldKey, string>;

function cmsValidationError(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}

type SupportedFieldType = "boolean" | "collectionReference" | "enum" | "link" | "number" | "string";

export interface CmsFieldDescriptor {
  id: string;
  name: string;
  type: string;
  cases?: readonly { id: string; name: string }[];
  collectionId?: string;
}

export interface CmsItemDescriptor {
  id: string;
  slug: string;
}

export interface FramerCmsCollectionAdapter {
  getFields(): Promise<CmsFieldDescriptor[]>;
  getItems(): Promise<CmsItemDescriptor[]>;
  addItems(items: CollectionItemInput[]): Promise<void>;
}

export interface FramerCmsConnectionAdapter {
  getCollection(id: string): Promise<FramerCmsCollectionAdapter | null>;
  disconnect(): Promise<void>;
}

export type FramerCmsConnector = (
  projectId: string,
  token: string,
) => Promise<FramerCmsConnectionAdapter>;

const defaultConnector: FramerCmsConnector = async (projectId, token) => {
  const framer = await connect(projectId, token);
  return {
    async getCollection(id) {
      const collection = await framer.getCollection(id);
      if (!collection) return null;
      return {
        getFields: async () => (await collection.getFields()).map(fieldDescriptorFromSdkField),
        getItems: async () =>
          (await collection.getItems()).map((item) => ({
            // Collection references require Framer's node ID. The legacy `id`
            // accessor may represent an external ID for managed collections.
            id: item.nodeId,
            slug: item.slug,
          })),
        addItems: (items) => collection.addItems(items),
      };
    },
    disconnect: () => framer.disconnect(),
  };
};

function fieldDescriptorFromSdkField(field: Field): CmsFieldDescriptor {
  return {
    id: field.id,
    name: field.name,
    type: field.type,
    ...(field.type === "enum"
      ? { cases: field.cases.map((enumCase) => ({ id: enumCase.id, name: enumCase.name })) }
      : {}),
    ...(field.type === "collectionReference" ? { collectionId: field.collectionId } : {}),
  };
}

export function resolveFramerFieldMap(fields: readonly CmsFieldDescriptor[]): FramerFieldMap {
  const resolved = {} as FramerFieldMap;
  for (const [key, displayName] of Object.entries(FRAMER_FIELD_DISPLAY_NAMES) as [
    FramerFieldKey,
    string,
  ][]) {
    const matches = fields.filter((field) => field.name === displayName);
    if (matches.length !== 1 || !matches[0]) {
      throw cmsValidationError(`Framer CMS field "${displayName}" was not found exactly once.`);
    }
    resolved[key] = matches[0].id;
  }
  return Object.freeze(resolved);
}

export function slugifyWriterName(writerName: string, resultId: string): string {
  const base = slugBase(writerName) || "writer";
  const suffix =
    resultId
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase()
      .slice(0, 8) || "result";
  return `${base}-${suffix}`;
}

function slugBase(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const formatLabels: Record<string, string> = {
  feature: "Feature",
  halfHourPilot: "Half-Hour TV Pilot",
  hourPilot: "Hour TV Pilot",
  short: "Short",
  unknown: "Unknown",
};

function supportedField(
  fields: readonly CmsFieldDescriptor[],
  id: string,
): CmsFieldDescriptor & { type: SupportedFieldType } {
  const field = fields.find((candidate) => candidate.id === id);
  if (
    !field ||
    !["boolean", "collectionReference", "enum", "link", "number", "string"].includes(field.type)
  ) {
    throw cmsValidationError(`Framer CMS field ${id} has an unsupported type.`);
  }
  return field as CmsFieldDescriptor & { type: SupportedFieldType };
}

function enumValue(field: CmsFieldDescriptor, displayValue: string): string {
  const match = field.cases?.find(
    (candidate) => candidate.name.toLowerCase() === displayValue.toLowerCase(),
  );
  if (!match) {
    throw cmsValidationError(`Framer enum field "${field.name}" lacks "${displayValue}".`);
  }
  return match.id;
}

function fieldEntry(
  field: CmsFieldDescriptor & { type: SupportedFieldType },
  value: string | number | boolean,
): FieldDataInput[string] {
  if (field.type === "boolean" && typeof value === "boolean") return { type: "boolean", value };
  if (field.type === "number" && typeof value === "number") return { type: "number", value };
  if (field.type === "enum" && typeof value === "string") {
    return { type: "enum", value: enumValue(field, value) };
  }
  if (field.type === "link" && typeof value === "string") return { type: "link", value };
  if (field.type === "collectionReference" && typeof value === "string") {
    return { type: "collectionReference", value };
  }
  if (field.type === "string") return { type: "string", value: String(value) };
  throw cmsValidationError(`Value is incompatible with Framer field "${field.name}".`);
}

function requiredContact(result: StoredResult) {
  const contact = result.internal.submissionContact;
  if (!contact) {
    throw cmsValidationError("Submission contact data is unavailable for CMS synchronization.");
  }
  const writerName = `${contact.firstName.trim()} ${contact.lastName.trim()}`
    .replace(/\s+/g, " ")
    .trim();
  if (!writerName) throw cmsValidationError("Writer name is required for CMS synchronization.");
  return { contact, writerName };
}

export interface BuiltFramerCmsItem {
  slug: string;
  fieldData: FieldDataInput;
  draft: boolean;
}

export function buildFramerCmsItem(
  input: StoredResult,
  fields: readonly CmsFieldDescriptor[],
  publishMode: "draft" | "published",
  referenceValues: Partial<Record<FramerFieldKey, string>> = {},
): BuiltFramerCmsItem {
  const result = StoredResultSchema.parse(input);
  const { contact, writerName } = requiredContact(result);
  const scriptTitle = result.projectTitle.trim();
  if (!scriptTitle) {
    throw cmsValidationError("Script title is required for CMS synchronization.");
  }
  const map = resolveFramerFieldMap(fields);
  const slug = slugifyWriterName(writerName, result.resultId);
  const isTest = result.internal.evaluationMode === "mock";
  const logline = result.internal.submissionLogline?.trim();
  const imdbUrl = contact.imdbUrl?.trim();
  const values: Record<FramerFieldKey, string | number | boolean | undefined> = {
    writerName,
    email: contact.email,
    test: supportedField(fields, map.test).type === "boolean" ? isTest : isTest ? "Yes" : "No",
    scriptTitle,
    logline: logline === "" ? undefined : logline,
    overallScore: result.overallScore,
    premiseScore: result.categoryScores.premise,
    storyScore: result.categoryScores.story,
    structureScore: result.categoryScores.structure,
    charactersScore: result.categoryScores.characters,
    dialogueScore: result.categoryScores.dialogue,
    pacingScore: result.categoryScores.pacing,
    themeScore: result.categoryScores.theme,
    toneScore: result.categoryScores.tone,
    marketabilityScore: result.categoryScores.marketability,
    craftScore: result.categoryScores.craft,
    genreCategory: referenceValues.genreCategory ?? result.declaredGenre.trim(),
    imdb: imdbUrl === "" ? undefined : imdbUrl,
    format: formatLabels[result.declaredFormat] ?? result.declaredFormat,
  };
  const fieldData: FieldDataInput = {};
  for (const [key, value] of Object.entries(values) as [
    FramerFieldKey,
    string | number | boolean | undefined,
  ][]) {
    if (value === undefined) continue;
    const field = supportedField(fields, map[key]);
    fieldData[field.id] = fieldEntry(field, value);
  }
  return { slug, fieldData, draft: publishMode === "draft" };
}

export interface FramerCmsSyncResult {
  status: "disabled" | "updated" | "created";
  itemId?: string;
  slug?: string;
  attempts: number;
}

function statusFromError(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  for (const key of ["status", "statusCode"]) {
    const value: unknown = Reflect.get(error, key);
    if (typeof value === "number") return value;
  }
  return undefined;
}

function isTransient(error: unknown): boolean {
  const status = statusFromError(error);
  return status === undefined || [429, 500, 502, 503, 504].includes(status);
}

export class FramerCmsSynchronizer {
  constructor(
    private readonly config: FramerCmsConfig,
    private readonly connector: FramerCmsConnector = defaultConnector,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly maximumAttempts = 3,
  ) {}

  get enabled(): boolean {
    return this.config.FRAMER_CMS_SYNC_ENABLED;
  }

  get configured(): boolean {
    return Boolean(
      this.config.FRAMER_API_TOKEN &&
      this.config.FRAMER_PROJECT_ID &&
      this.config.FRAMER_COLLECTION_ID,
    );
  }

  async syncResultToFramerCms(result: StoredResult): Promise<FramerCmsSyncResult> {
    if (!this.enabled) return { status: "disabled", attempts: 0 };
    const token = this.config.FRAMER_API_TOKEN;
    const projectId = this.config.FRAMER_PROJECT_ID;
    const collectionId = this.config.FRAMER_COLLECTION_ID;
    if (!token || !projectId || !collectionId) throw new Error("Framer CMS is not configured.");

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      let connection: FramerCmsConnectionAdapter | undefined;
      try {
        connection = await this.connector(projectId, token);
        const collection = await connection.getCollection(collectionId);
        if (!collection)
          throw Object.assign(new Error("Configured Framer collection not found."), {
            status: 400,
          });
        const [fields, existingItems] = await Promise.all([
          collection.getFields(),
          collection.getItems(),
        ]);
        const fieldMap = resolveFramerFieldMap(fields);
        const genreField = supportedField(fields, fieldMap.genreCategory);
        let genreReferenceId: string | undefined;
        if (genreField.type === "collectionReference") {
          if (!genreField.collectionId) {
            throw cmsValidationError("Genre reference collection is unavailable.");
          }
          const genreCollection = await connection.getCollection(genreField.collectionId);
          if (!genreCollection) {
            throw cmsValidationError("Genre reference collection was not found.");
          }
          const requestedGenreSlug = slugBase(result.declaredGenre);
          genreReferenceId = (await genreCollection.getItems()).find(
            (candidate) => slugBase(candidate.slug) === requestedGenreSlug,
          )?.id;
          if (!genreReferenceId) {
            throw cmsValidationError("Submitted genre has no matching Framer CMS item.");
          }
        }
        const item = buildFramerCmsItem(
          result,
          fields,
          this.config.FRAMER_CMS_PUBLISH_MODE,
          genreReferenceId ? { genreCategory: genreReferenceId } : {},
        );
        const existing = existingItems.find((candidate) => candidate.slug === item.slug);
        if (existing) {
          await collection.addItems([
            {
              id: existing.id,
              slug: item.slug,
              fieldData: item.fieldData,
              draft: item.draft,
            },
          ]);
          return { status: "updated", itemId: existing.id, slug: item.slug, attempts: attempt };
        }
        await collection.addItems([
          { slug: item.slug, fieldData: item.fieldData, draft: item.draft },
        ]);
        return { status: "created", slug: item.slug, attempts: attempt };
      } catch (error) {
        lastError = error;
        if (!isTransient(error) || attempt === this.maximumAttempts) throw error;
        await this.sleep(100 * 2 ** (attempt - 1));
      } finally {
        await connection?.disconnect().catch(() => undefined);
      }
    }
    throw lastError;
  }
}

export function loadFramerCmsConfig(
  environment: Record<string, string | undefined>,
): FramerCmsConfig {
  return FramerCmsEnvironmentSchema.parse(environment);
}

export async function syncFramerCmsBestEffort(
  synchronizer: FramerCmsSynchronizer,
  result: StoredResult,
  logger: SafeLogger,
): Promise<FramerCmsSyncResult | null> {
  if (!synchronizer.enabled) {
    try {
      logger.info("framer.cms_sync_disabled", { processingStage: "cms_sync" });
    } catch {
      // Diagnostics must never affect scoring or cached-result retrieval.
    }
    return { status: "disabled", attempts: 0 };
  }
  try {
    const outcome = await synchronizer.syncResultToFramerCms(result);
    try {
      logger.info("framer.cms_sync_completed", {
        processingStage: "cms_sync",
        jobId: result.resultId,
        status: outcome.status,
      });
    } catch {
      // Diagnostics must never affect scoring or cached-result retrieval.
    }
    return outcome;
  } catch (error) {
    try {
      logger.warn("framer.cms_sync_failed", {
        processingStage: "cms_sync",
        jobId: result.resultId,
        errorClass: error instanceof Error ? error.name : "UnknownError",
        retryable: isTransient(error),
      });
    } catch {
      // Diagnostics must never affect scoring or cached-result retrieval.
    }
    return null;
  }
}
