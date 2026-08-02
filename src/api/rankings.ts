import type { FramerRankingsReader } from "../integrations/framer-rankings.js";

export async function getPublicRankings(reader: FramerRankingsReader): Promise<Response> {
  try {
    return Response.json(await reader.getPublicRankings(), {
      headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    const status =
      typeof error === "object" &&
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
