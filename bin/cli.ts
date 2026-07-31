#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { formatHtml } from "../src/formatter.js";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function printUsage(): void {
  console.error(
    [
      "Использование:",
      "  html-formatter <input.html> [-o output.html] [--collapse-outlook-comments] [--no-typografy]",
      "  cat input.html | html-formatter",
      "",
      "Без -o результат печатается в stdout.",
      "--collapse-outlook-comments — схлопывать условные MSO/IE-комментарии",
      "  (<!--[if ...]>...<![endif]-->) в одну строку, не затрагивая отступы",
      "  остального документа. По умолчанию выключено.",
      "--no-typografy — отключить типограф (неразрывные пробелы, «ёлочки»,",
      "  тире вместо дефиса в тексте). По умолчанию типограф включён.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  let args = process.argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) {
    printUsage();
    return;
  }

  const collapseOutlookComments = args.includes("--collapse-outlook-comments");
  const typografy = !args.includes("--no-typografy");
  args = args.filter((a) => a !== "--collapse-outlook-comments" && a !== "--no-typografy");

  const outIdx = args.indexOf("-o");
  let outputPath: string | undefined;
  let inputArgs = args;
  if (outIdx !== -1) {
    outputPath = args[outIdx + 1];
    if (!outputPath) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    inputArgs = [...args.slice(0, outIdx), ...args.slice(outIdx + 2)];
  }

  const inputPath = inputArgs[0];

  let source: string;
  if (inputPath) {
    source = readFileSync(inputPath, "utf8");
  } else if (!process.stdin.isTTY) {
    source = await readStdin();
  } else {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const result = formatHtml(source, { collapseOutlookComments, typografy });

  if (outputPath) {
    writeFileSync(outputPath, result, "utf8");
  } else {
    process.stdout.write(result);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
