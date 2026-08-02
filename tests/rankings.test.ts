import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getPublicRankings } from "../src/api/rankings.js";
import {
  ScreenplayRankingsTable,
  applyRankingsQuery,
  queryFromSearchParams,
} from "../src/frontend/ScreenplayRankingsTable.js";
import {
  FRAMER_FIELD_DISPLAY_NAMES,
  type CmsFieldDescriptor,
  type FramerCmsConnectionAdapter,
} from "../src/integrations/framer-cms.js";
import { FramerRankingsReader } from "../src/integrations/framer-rankings.js";
import type { PublicRankingRecord } from "../src/types/rankings.js";

function fields(): CmsFieldDescriptor[] {
  return Object.entries(FRAMER_FIELD_DISPLAY_NAMES).map(([key, name], index) => ({
    id: `${index}-${key}`,
    name,
    type: key === "genreDropdown" ? "enum" : key.endsWith("Score") ? "number" : "string",
    ...(key === "genreDropdown" ? { cases: [{ id: "comedy", name: "Comedy" }] } : {}),
  }));
}

function fieldId(key: keyof typeof FRAMER_FIELD_DISPLAY_NAMES): string {
  const field = fields().find((candidate) => candidate.id.endsWith(`-${key}`));
  if (!field) throw new Error("Missing test field.");
  return field.id;
}

function fieldData(email: string, overall: number) {
  const data: Record<string, { type: string; value: unknown }> = {
    [fieldId("writerName")]: { type: "string", value: "Writer One" },
    [fieldId("email")]: { type: "string", value: email },
    [fieldId("scriptTitle")]: { type: "string", value: "Script One" },
    [fieldId("logline")]: { type: "string", value: "A precise test logline." },
    [fieldId("format")]: { type: "string", value: "Feature" },
    [fieldId("genreDropdown")]: { type: "enum", value: "comedy" },
    [fieldId("imdb")]: { type: "link", value: "https://www.imdb.com/name/nm0000001/" },
  };
  for (const key of [
    "overallScore",
    "premiseScore",
    "storyScore",
    "structureScore",
    "charactersScore",
    "dialogueScore",
    "pacingScore",
    "themeScore",
    "toneScore",
    "marketabilityScore",
    "craftScore",
  ] as const)
    data[fieldId(key)] = { type: "number", value: overall };
  return data;
}

function createReader() {
  const disconnect = vi.fn(() => Promise.resolve());
  const connection: FramerCmsConnectionAdapter = {
    getCollection: () =>
      Promise.resolve({
        getFields: () => Promise.resolve(fields()),
        getItems: () =>
          Promise.resolve([
            {
              id: "published",
              slug: "writer-one",
              draft: false,
              updatedAt: "2026-08-01T00:00:00.000Z",
              fieldData: fieldData("private@example.com", 12),
            },
            {
              id: "draft",
              slug: "draft",
              draft: true,
              fieldData: fieldData("draft@example.com", 8),
            },
          ]),
        addItems: () => Promise.resolve(),
      }),
    disconnect,
  };
  const connector = vi.fn(() => Promise.resolve(connection));
  return {
    instance: new FramerRankingsReader(
      {
        FRAMER_CMS_SYNC_ENABLED: true,
        FRAMER_CMS_PUBLISH_MODE: "published",
        FRAMER_API_TOKEN: "secret",
        FRAMER_PROJECT_ID: "project",
        FRAMER_COLLECTION_ID: "collection",
        FRAMER_RANKINGS_ENABLED: true,
        FRAMER_RANKINGS_CACHE_TTL_SECONDS: 60,
      },
      connector,
      () => 1_000,
    ),
    connector,
    disconnect,
  };
}

const records: PublicRankingRecord[] = [
  {
    id: "1",
    slug: "one",
    writerName: "Alpha Writer",
    scriptTitle: "Comedy One",
    logline: "A funny search target",
    format: "Feature",
    genre: "Comedy",
    imdbUrl: null,
    websiteUrl: null,
    updatedAt: null,
    scores: {
      overall: 7,
      premise: 9,
      story: 7,
      structure: 7,
      characters: 7,
      dialogue: 7,
      pacing: 7,
      theme: 7,
      tone: 7,
      marketability: 7,
      craft: 7,
    },
  },
  {
    id: "2",
    slug: "two",
    writerName: "Beta Writer",
    scriptTitle: "Drama Two",
    logline: "A dramatic target",
    format: "Feature",
    genre: "Drama",
    imdbUrl: null,
    websiteUrl: null,
    updatedAt: null,
    scores: {
      overall: 9,
      premise: 6,
      story: 9,
      structure: 9,
      characters: 9,
      dialogue: 9,
      pacing: 9,
      theme: 9,
      tone: 9,
      marketability: 9,
      craft: 9,
    },
  },
];

describe("public screenplay rankings", () => {
  it("maps only published CMS rows and never exposes email", async () => {
    const { instance } = createReader();
    const response = await instance.getPublicRankings();
    expect(response.records).toHaveLength(1);
    expect(response.records[0]).toMatchObject({ genre: "Comedy", scores: { overall: 10 } });
    expect(JSON.stringify(response)).not.toContain("private@example.com");
  });

  it("uses the TTL cache and disconnects", async () => {
    const { instance, connector, disconnect } = createReader();
    await instance.getPublicRankings();
    await instance.getPublicRankings();
    expect(connector).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("returns a generic unavailable response when disabled", async () => {
    const { instance } = createReader();
    Object.defineProperty(instance, "enabled", { value: false });
    const response = await getPublicRankings(instance);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Framer");
  });

  it("combines search, format, genre, minimum and selected-score sorting", () => {
    const query = queryFromSearchParams(
      new URLSearchParams("search=target&format=Feature&genre=Comedy&score=premise&minScore=8"),
    );
    expect(applyRankingsQuery(records, query).map((item) => item.id)).toEqual(["1"]);
    expect(
      applyRankingsQuery(records, {
        ...query,
        genre: "",
        minimumScore: null,
        direction: "asc",
      }).map((item) => item.id),
    ).toEqual(["2", "1"]);
  });

  it("renders semantic desktop and mobile canvas sample views", () => {
    const html = renderToStaticMarkup(
      createElement(ScreenplayRankingsTable, {
        apiBaseUrl: "https://api.example",
        canvasMode: true,
      }),
    );
    expect(html).toContain("<table>");
    expect(html).toContain("loglisted-rankings__mobile-card");
    expect(html).not.toContain("<details>");
    expect(html).toContain("Overall Score");
    expect(html).toContain("The arithmetic mean of all ten screenplay category scores.");
    expect(html).toContain("loglisted-rankings__logline-preview");
    expect(html).not.toContain("Email");
  });
});
