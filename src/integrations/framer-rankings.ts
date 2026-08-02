import type { FramerCmsConfig, FramerCmsConnector } from "./framer-cms.js";
import { defaultFramerCmsConnector, resolveFramerFieldMap } from "./framer-cms.js";
import type {
  PublicRankingRecord,
  PublicRankingsResponse,
  RankingScores,
} from "../types/rankings.js";

export interface FramerRankingsConfig extends FramerCmsConfig {
  FRAMER_RANKINGS_ENABLED: boolean;
  FRAMER_RANKINGS_CACHE_TTL_SECONDS: number;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function scoreValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(10, Math.max(0, value));
}

function imdbValue(value: unknown): string | null {
  const candidate = textValue(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !["imdb.com", "www.imdb.com"].includes(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export class FramerRankingsReader {
  private cached: { expiresAt: number; value: PublicRankingsResponse } | undefined;

  constructor(
    private readonly config: FramerRankingsConfig,
    private readonly connector: FramerCmsConnector = defaultFramerCmsConnector,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this.config.FRAMER_RANKINGS_ENABLED;
  }

  get configured(): boolean {
    return Boolean(
      this.config.FRAMER_API_TOKEN &&
      this.config.FRAMER_PROJECT_ID &&
      this.config.FRAMER_COLLECTION_ID,
    );
  }

  async getPublicRankings(): Promise<PublicRankingsResponse> {
    if (!this.enabled)
      throw Object.assign(new Error("Public rankings are disabled."), { status: 503 });
    if (!this.configured) {
      throw Object.assign(new Error("Public rankings are not configured."), { status: 503 });
    }
    const now = this.now();
    if (this.cached && this.cached.expiresAt > now) return this.cached.value;

    const projectId = this.config.FRAMER_PROJECT_ID;
    const token = this.config.FRAMER_API_TOKEN;
    const collectionId = this.config.FRAMER_COLLECTION_ID;
    if (!projectId || !token || !collectionId)
      throw new Error("Framer rankings configuration is incomplete.");

    const connection = await this.connector(projectId, token);
    try {
      const collection = await connection.getCollection(collectionId);
      if (!collection)
        throw Object.assign(new Error("Configured Framer collection was not found."), {
          status: 502,
        });
      const [fields, items] = await Promise.all([collection.getFields(), collection.getItems()]);
      const map = resolveFramerFieldMap(fields);
      const genreField = fields.find((field) => field.id === map.genreDropdown);
      const enumNames = new Map(genreField?.cases?.map((item) => [item.id, item.name]) ?? []);
      const genreCategoryField = fields.find((field) => field.id === map.genreCategory);
      const genreReferenceNames = new Map<string, string>();
      if (genreCategoryField?.type === "collectionReference" && genreCategoryField.collectionId) {
        const genreCollection = await connection.getCollection(genreCategoryField.collectionId);
        if (genreCollection) {
          const [genreFields, genreItems] = await Promise.all([
            genreCollection.getFields(),
            genreCollection.getItems(),
          ]);
          const labelField = genreFields.find(
            (field) =>
              field.type === "string" &&
              ["name", "title", "genre"].includes(field.name.toLowerCase()),
          );
          for (const genreItem of genreItems) {
            const label = labelField
              ? textValue(genreItem.fieldData?.[labelField.id]?.value)
              : genreItem.slug
                  .split("-")
                  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                  .join(" ");
            if (label) genreReferenceNames.set(genreItem.id, label);
          }
        }
      }
      const records = items
        .filter((item) => !item.draft)
        .map((item): PublicRankingRecord | null => {
          const data = item.fieldData;
          if (!data) return null;
          const value = (fieldId: string): unknown => data[fieldId]?.value;
          const genreRaw = textValue(value(map.genreDropdown));
          const genreCategoryRaw = textValue(value(map.genreCategory));
          const genreCategoryLabel =
            genreCategoryField?.type === "collectionReference"
              ? (genreReferenceNames.get(genreCategoryRaw) ?? "")
              : genreCategoryRaw;
          const scores: RankingScores = {
            overall: scoreValue(value(map.overallScore)),
            premise: scoreValue(value(map.premiseScore)),
            story: scoreValue(value(map.storyScore)),
            structure: scoreValue(value(map.structureScore)),
            characters: scoreValue(value(map.charactersScore)),
            dialogue: scoreValue(value(map.dialogueScore)),
            pacing: scoreValue(value(map.pacingScore)),
            theme: scoreValue(value(map.themeScore)),
            tone: scoreValue(value(map.toneScore)),
            marketability: scoreValue(value(map.marketabilityScore)),
            craft: scoreValue(value(map.craftScore)),
          };
          const writerName = textValue(value(map.writerName));
          const scriptTitle = textValue(value(map.scriptTitle));
          if (!writerName || !scriptTitle) return null;
          return {
            id: item.slug,
            slug: item.slug,
            writerName,
            scriptTitle,
            logline: textValue(value(map.logline)),
            format: textValue(value(map.format)),
            genre:
              genreCategoryLabel !== ""
                ? genreCategoryLabel
                : (enumNames.get(genreRaw) ?? genreRaw),
            imdbUrl: imdbValue(value(map.imdb)),
            scores,
            updatedAt: item.updatedAt ?? null,
          };
        })
        .filter((item): item is PublicRankingRecord => item !== null);
      const response: PublicRankingsResponse = {
        version: 1,
        generatedAt: new Date(now).toISOString(),
        records,
      };
      this.cached = {
        expiresAt: now + this.config.FRAMER_RANKINGS_CACHE_TTL_SECONDS * 1_000,
        value: response,
      };
      return response;
    } finally {
      await connection.disconnect().catch(() => undefined);
    }
  }
}
