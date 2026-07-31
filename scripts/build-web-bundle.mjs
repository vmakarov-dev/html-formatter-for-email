// Собирает src/*.js (ESM, уже скомпилированный из TypeScript) в один
// самодостаточный скрипт без import/export — чтобы web/index.html можно
// было открыть прямо по file:// без локального сервера (браузеры
// блокируют ESM-импорты по file://, поэтому обычный <script type="module">
// с относительными путями там не работает).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Порядок важен: файлы без взаимных forward-ссылок, поэтому просто
// зависимости раньше зависящих от них модулей.
const files = [
  "dist/src/htmlTags.js",
  "dist/src/parser.js",
  "dist/src/cssFormatter.js",
  "dist/src/typograf.js",
  "dist/src/serviceCleanup.js",
  "dist/src/unopenedTags.js",
  "dist/src/formatter.js",
];

function stripModuleSyntax(code) {
  return code
    .split("\n")
    .filter((line) => !/^\s*import\s.*from\s+["'].*["'];?\s*$/.test(line))
    .join("\n")
    .replace(/^export\s+(?=(const|function|class)\b)/gm, "");
}

const parts = files.map((f) => stripModuleSyntax(readFileSync(join(root, f), "utf8")));

const bundle = `// Автоматически собрано из dist/src/*.js скриптом scripts/build-web-bundle.mjs.
// Не редактировать вручную — правьте исходники в src/ и пересоберите (npm run build:web).
(function (global) {
"use strict";

${parts.join("\n\n")}

global.HtmlFormatter = { formatHtml, formatHtmlWithDiagnostics, parseHtml, formatCss };
})(window);
`;

mkdirSync(join(root, "web"), { recursive: true });
writeFileSync(join(root, "web", "formatter.bundle.js"), bundle, "utf8");
console.log("web/formatter.bundle.js собран.");
