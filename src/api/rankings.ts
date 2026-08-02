import type { FramerRankingsReader } from "../integrations/framer-rankings.js";
import { z } from "zod";
import { rankingScoreKeys, type PublicRankingsQuery } from "../types/rankings.js";

const RankingsQuerySchema = z.object({
  search: z.string().trim().max(200).default(""),
  format: z.string().trim().max(100).default(""),
  genre: z.string().trim().max(100).default(""),
  score: z.enum(rankingScoreKeys).default("overall"),
  minScore: z.coerce.number().min(0).max(10).nullable().default(null),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .pipe(z.union([z.literal(25), z.literal(50), z.literal(100)]))
    .default(25),
});

export function parseRankingsQuery(parameters = new URLSearchParams()): PublicRankingsQuery {
  const parsed = RankingsQuerySchema.parse({
    ...Object.fromEntries(parameters),
    minScore: parameters.has("minScore") ? parameters.get("minScore") : null,
  });
  return {
    search: parsed.search,
    format: parsed.format,
    genre: parsed.genre,
    scoreKey: parsed.score,
    minimumScore: parsed.minScore,
    direction: parsed.direction,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}

export async function getPublicRankings(
  reader: FramerRankingsReader,
  parameters = new URLSearchParams(),
): Promise<Response> {
  try {
    return Response.json(await reader.getPublicRankings(parseRankingsQuery(parameters)), {
      headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    const status =
      error instanceof z.ZodError
        ? 400
        : typeof error === "object" &&
            error !== null &&
            typeof Reflect.get(error, "status") === "number"
          ? (Reflect.get(error, "status") as number)
          : 502;
    return Response.json(
      {
        error: {
          code: "RANKINGS_UNAVAILABLE",
          message: "The rankings are temporarily unavailable.",
        },
      },
      { status },
    );
  }
}
