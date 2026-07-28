export function screenplayPages(
  pageCount: number,
  options: {
    television?: boolean;
    acts?: boolean;
    missingHeadings?: boolean;
    title?: string;
  } = {},
): string[] {
  return Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1;
    const lines: string[] = [];
    if (page === 1) {
      lines.push(options.title ?? "THE SAMPLE", "", "Written by Test Writer", "");
      if (options.television) lines.push("TEASER", "");
      lines.push("FADE IN:", "");
    }
    if (options.acts && [2, Math.ceil(pageCount / 2)].includes(page)) {
      lines.push(page === 2 ? "ACT ONE" : "ACT TWO", "");
    }
    if (!options.missingHeadings) {
      lines.push(
        `${page % 2 ? "INT." : "EXT."} LOCATION ${page} - ${page % 3 ? "DAY" : "NIGHT"}`,
        "",
      );
    }
    lines.push(
      `Action for scene ${page}. The characters move through the location with a clear objective.`,
      "",
      page % 2 ? "ALEX" : "JORDAN",
    );
    if (page % 4 === 0) lines.push("(quietly)");
    lines.push(
      `Dialogue on page ${page} advances the story and preserves the exchange.`,
      "",
      page % 2 ? "JORDAN" : "ALEX",
      "A response follows without breaking the dialogue block.",
      "",
    );
    if (options.television && page === pageCount) lines.push("TAG", "", "END OF SHOW");
    return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
  });
}
