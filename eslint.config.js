import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "web/formatter.bundle.js"],
  },
  {
    files: ["src/**/*.ts", "bin/**/*.ts", "tests/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: "module",
      globals: globals.node,
    },
  },
  // web/js/**/*.js — НЕ ES-модули, а classic <script src>, намеренно
  // делящие один общий global scope между собой (обычные, не type="module"
  // script'ы в одном документе выполняются последовательно и видят
  // top-level let/const друг друга — см. комментарий в web/index.html над
  // самими тегами <script>). "no-undef"/"no-unused-vars" в этой модели
  // дают массу ложных срабатываний: "неопределённая" переменная почти
  // всегда объявлена в СОСЕДНЕМ файле этой же последовательности загрузки,
  // а "неиспользуемая" — используется в файле, который грузится позже.
  // Настоящие опечатки в именах здесь ловит не линтер, а сама страница
  // (сломается в браузере) — см. регресс-проверку через Playwright,
  // которой перепроверяется весь пользовательский сценарий после любой
  // правки в этих файлах.
  {
    files: ["web/js/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, HtmlFormatter: "readonly" },
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
);
