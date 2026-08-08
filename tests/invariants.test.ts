// Сплошная проверка ИНВАРИАНТОВ движка диагностики незакрытых тегов.
//
// В отличие от точечных тестов в formatter.test.ts (там у каждого кейса
// прописан ожидаемый вывод), здесь не описывается "как должно выглядеть" —
// здесь проверяются СВОЙСТВА, которые обязаны выполняться на ЛЮБОМ входе.
// Именно они ловят целый класс дефектов, который точечные тесты
// пропускают: движок уверенно выдаёт стабильно НЕВЕРНЫЙ ответ.
//
// Инварианты:
//   И1  Идемпотентность. format(format(x)) === format(x). Форматирование
//       меняет отступы, а не содержимое: второй прогон менять уже нечего.
//       Нарушение = либо текст письма тихо портится при каждом нажатии
//       "Переформатировать", либо дерево разбора нестабильно.
//   И2  Стабильность диагностик. Набор незакрытых тегов на первом и
//       втором проходе совпадает. Нарушение = пользователю показывают
//       разные ошибки на одном и том же письме.
//   И3  Нет ложных срабатываний. На хорошо сформированном HTML движок не
//       имеет права сообщать ни об одном незакрытом теге.
//   И4  Сходимость. Если принять все подсказки движка, дефектов должно
//       стать МЕНЬШЕ. Нарушение = принятие подсказки рождает новые
//       ошибки, то есть подсказка была неверной.
//   И5  Локальность. Один дефект в разметке даёт единицы диагностик, а не
//       лавину на весь документ.
//
// Каждый кейс прогоняется в ДВУХ режимах: "чистая структура" и боевой
// режим по умолчанию (с удалением <tbody>, которое реально меняет
// дерево). Реальный дефект из письма пользователя проявлялся ТОЛЬКО во
// втором режиме и только на повторном форматировании.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHtmlWithDiagnostics, FormatOptions, UnclosedTagGroup } from "../src/formatter.js";

const MODES: { tag: string; opts: FormatOptions }[] = [
  { tag: "структура", opts: { cleanServiceAttrs: false, typografy: false } },
  { tag: "по умолчанию", opts: { cleanServiceAttrs: true, typografy: false } },
];

interface Case {
  name: string;
  html: string;
  // Хорошо сформированный документ — диагностик быть не должно вовсе (И3).
  valid?: boolean;
  // Сколько групп максимум разумно ожидать от заложенного дефекта (И5).
  maxGroups?: number;
}

const mso = (inner: string) => `<!--[if (gte mso 9)|(IE)]>${inner}<![endif]-->`;

const VALID: Case[] = [
  { name: "простая таблица", html: `<table><tr><td>x</td></tr></table>` },
  {
    name: "таблицы в 3 уровня",
    html: `<table><tr><td><table><tr><td><table><tr><td>x</td></tr></table></td></tr></table></td></tr></table>`,
  },
  { name: "tbody", html: `<table><tbody><tr><td>x</td></tr></tbody></table>` },
  // <a> имеет "прозрачную" модель содержимого: таблица внутри ссылки —
  // валидная и частая в письмах конструкция, ломать её нельзя.
  { name: "<a> оборачивает таблицу", html: `<td><a href="x"><table><tr><td>y</td></tr></table></a></td>` },
  { name: "<a> оборачивает блок", html: `<div><a href="x"><div>y</div></a></div>` },
  {
    name: "две соседние ячейки со ссылками",
    html: `<table><tr><td><a href="x"><img></a></td><td><a href="y"><img></a></td></tr></table>`,
  },
  { name: "список", html: `<ul><li>a</li><li>b</li></ul>` },
  {
    name: "письмо в 20 уровней вложенности",
    html: "<table><tr><td>".repeat(20) + "content" + "</td></tr></table>".repeat(20),
  },
  { name: "многострочный комментарий", html: `<div>\n<!-- line1\nline2 -->\n<p>x</p>\n</div>` },
  { name: "style и script", html: `<div><style>.a{color:red}</style><script>var a = 1 < 2;</script><p>x</p></div>` },
  { name: "'<' внутри значения атрибута", html: `<div onclick="if(x<y)f()">z</div>` },
  { name: "Mindbox @{for}", html: `<div>@{for item in items}<p>x</p>@{end for}</div>` },
  { name: "Mindbox @{if}/@{else}", html: `<div>@{if x}<p>a</p>@{else}<p>b</p>@{end if}</div>` },
  // Ключевой приём вёрстки под Outlook: table/tr/td намеренно разрублены
  // на два условных комментария. Диагностик быть НЕ должно.
  { name: "MSO-мост", html: `${mso("<table><tr><td>")}\n<div>visible</div>\n${mso("</td></tr></table>")}` },
  {
    name: "два MSO-моста подряд",
    html: `${mso("<table><tr><td>")}\n<div>a</div>\n${mso("</td></tr></table>")}\n${mso("<table><tr><td>")}\n<div>b</div>\n${mso("</td></tr></table>")}`,
  },
  {
    name: "вложенные MSO-мосты",
    html: `${mso("<table><tr><td>")}\n<div>\n${mso("<table><tr><td>")}\n<p>inner</p>\n${mso("</td></tr></table>")}\n</div>\n${mso("</td></tr></table>")}`,
  },
  {
    name: "MSO-мост с настоящей таблицей внутри",
    html: `${mso("<table><tr><td>")}\n<table><tr><td>real</td></tr></table>\n${mso("</td></tr></table>")}`,
  },
  {
    name: "MSO-мост с tbody внутри",
    html: `${mso("<table><tr><td>")}\n<table><tbody><tr><td>x</td></tr></tbody></table>\n${mso("</td></tr></table>")}`,
  },
  {
    name: "вложенный revealed-комментарий",
    html: `<!--[if mso]><div><!--[if !mso]><!--><p>x</p><!--<![endif]--></div><![endif]--><p>tail</p>`,
  },
  {
    name: "условный комментарий внутри MSO-моста",
    html: `<!--[if mso]><table><tr><td> <!--[if lte mso 11]>x<![endif]--> </td></tr></table><![endif]-->`,
  },
  {
    name: "MSO-мост закрывается в обычном контенте",
    html: `${mso("<table><tr><td>")}\n<div>x</div>\n</td></tr></table>`,
  },
  {
    name: "MSO-мост закрывается в комментарии, открывается в обычном контенте",
    html: `<table>\n<tr>\n<td>b</td>\n<!--[if mso]></tr></table><![endif]-->`,
  },
];

const DEFECTS: Case[] = [
  {
    name: "незакрытый <a> перед соседним <td> (реальное письмо)",
    html: `<table><tr>\n<td><a href="u1">\n<img>\n<td><a href="u2"><img></a></td>\n</tr></table>`,
    maxGroups: 1,
  },
  { name: "пропущен </tr>", html: `<table><tr><td>a</td><tr><td>b</td></tr></table>`, maxGroups: 2 },
  { name: "пропущен </td>", html: `<table><tr><td>a<td>b</td></tr></table>`, maxGroups: 2 },
  { name: "незакрытый <div>", html: `<div><p>x</p>`, maxGroups: 1 },
  { name: "незакрытый <a> перед </td>", html: `<table><tr><td><a href="x">text</td></tr></table>`, maxGroups: 1 },
  { name: "незакрытый <span> внутри <div>", html: `<div><span>text</div>`, maxGroups: 1 },
  { name: "'ничей' закрывающий тег", html: `<div>x</div></span>`, maxGroups: 1 },
  { name: "убежавшая кавычка в href", html: `<table><tr><td><a href="broken><img></a></td></tr></table>`, maxGroups: 2 },
  { name: "незакрытые <li>", html: `<ul><li>a<li>b</ul>`, maxGroups: 2 },
  { name: "незакрытый <b> перед соседним <td>", html: `<table><tr><td><b>bold<td>next</td></tr></table>`, maxGroups: 2 },
  {
    name: "незакрытый <div> внутри ячейки",
    html: `<div class="outer">\n<table><tr><td>\n<div class="btn">Click\n</td></tr></table>\n</div>\n<p>footer</p>`,
    maxGroups: 1,
  },
  {
    name: "MSO-мост + сломанные иконки внутри",
    html: `${mso("<table><tr><td>")}\n<table><tr>\n<td><a href="u1"><img>\n<td><a href="u2"><img></a></td>\n</tr></table>\n${mso("</td></tr></table>")}`,
    maxGroups: 2,
  },
  {
    name: "MSO-мост + незакрытый <div> внутри",
    html: `${mso("<table><tr><td>")}\n<div><div>x</div>\n${mso("</td></tr></table>")}`,
    maxGroups: 2,
  },
  { name: "незакрытый @{for}", html: `<div>@{for item in items}<p>x</p></div>`, maxGroups: 1 },
  {
    name: "незакрытый <style> внутри условного комментария",
    html: `<!--[if mso]><style>a{}<![endif]--><p>tail</p><style>b{}</style>`,
    maxGroups: 1,
  },
  {
    name: "осиротевшая ячейка перед исправным MSO-мостом",
    html: `<table><td>x</td></table>\n<table>\n<tr>\n<td>b</td>\n<!--[if mso]></tr></table><![endif]-->`,
    maxGroups: 1,
  },
  {
    name: "осиротевший <tr> перед MSO-мостом",
    html: `<div><tr><td>x</td></tr></div>\n${mso("<table><tr><td>")}\n<div>x</div>\n</td></tr></table>`,
    maxGroups: 1,
  },
  {
    name: "вырезанный <table> в MSO-колонке",
    html: `<!--[if mso]>\n<table><tr><td>\n<![endif]-->\n<div>\n<tr><td>content</td></tr>\n</table>\n</div>\n<!--[if mso]>\n</td></tr></table>\n<![endif]-->`,
    maxGroups: 1,
  },
  {
    name: "тег из обычного контента вытесняется внутри MSO-конструкции",
    html: `${mso("<table><tr><td>")}\n<div>\n<p>x</p>\n${mso("</td></tr></table>")}`,
    maxGroups: 1,
  },
  {
    name: "потерян <![endif]--> у открывающей половины моста",
    html: `<!--[if mso]><table><tr><td>\n<div>a</div>\n${mso("</td></tr></table>")}\n<p>tail</p>`,
    maxGroups: 2,
  },
];

const CASES: Case[] = [...VALID.map((c) => ({ ...c, valid: true })), ...DEFECTS];

const signature = (groups: UnclosedTagGroup[]) =>
  JSON.stringify(
    groups.map((g) => ({
      t: g.tags.map((t) => `${t.tagName}@${t.line}`),
      ins: g.insertBeforeLine,
      conf: g.insertConfidence,
    })),
  );

const brief = (groups: UnclosedTagGroup[]) =>
  groups.map((g) => `[${g.tags.map((t) => t.tagName + "@" + t.line).join(",")}]→${g.insertBeforeLine}`).join(" ") ||
  "(пусто)";

// Ровно то, что вставляет веб-интерфейс по кнопке "Добавить?" — см.
// buildGroupInsertLines в web/js/popup-actions.js.
function buildGroupInsertLines(g: UnclosedTagGroup): string[] {
  const lines: string[] = [];
  if (g.needsConditionalCommentWrap && g.conditionalCommentText) {
    lines.push("  ".repeat(g.tags[0].depth) + g.conditionalCommentText);
  }
  for (let i = g.tags.length - 1; i >= 0; i--) {
    const t = g.tags[i];
    const text = t.tagName.startsWith("@") ? `@{end ${t.tagName.slice(1)}}` : `</${t.tagName}>`;
    lines.push("  ".repeat(t.depth) + text);
  }
  if (g.needsConditionalCommentWrap) lines.push("  ".repeat(g.tags[0].depth) + "<![endif]-->");
  return lines;
}

for (const mode of MODES) {
  for (const c of CASES) {
    test(`инварианты [${mode.tag}]: ${c.name}`, () => {
      const r1 = formatHtmlWithDiagnostics(c.html, mode.opts);
      const r2 = formatHtmlWithDiagnostics(r1.html, mode.opts);

      // И1 — идемпотентность текста.
      assert.equal(r1.html, r2.html, "И1: повторное форматирование изменило документ");

      // И2 — стабильность диагностик.
      assert.equal(
        signature(r2.unclosedTagGroups),
        signature(r1.unclosedTagGroups),
        `И2: диагностики разъехались между проходами: ${brief(r1.unclosedTagGroups)} -> ${brief(r2.unclosedTagGroups)}`,
      );

      // И3 — ноль ложных срабатываний на валидном HTML.
      if (c.valid) {
        assert.equal(
          r1.unclosedTagGroups.length,
          0,
          `И3: ложные незакрытые теги на валидном HTML: ${brief(r1.unclosedTagGroups)}`,
        );
      }

      // И5 — локальность.
      if (c.maxGroups !== undefined) {
        assert.ok(
          r1.unclosedTagGroups.length <= c.maxGroups,
          `И5: лавина диагностик — групп ${r1.unclosedTagGroups.length}, ожидалось не больше ${c.maxGroups}: ${brief(r1.unclosedTagGroups)}`,
        );
      }

      // И4 — сходимость: принимаем все надёжные подсказки разом (снизу
      // вверх, чтобы не съезжали номера строк) и ждём, что дефектов
      // станет строго меньше.
      const reliable = r1.unclosedTagGroups
        .filter((g) => g.insertConfidence === "reliable")
        .sort((a, b) => b.insertBeforeLine - a.insertBeforeLine);
      if (reliable.length > 0) {
        const lines = r1.html.split("\n");
        for (const g of reliable) lines.splice(g.insertBeforeLine, 0, ...buildGroupInsertLines(g));
        const r3 = formatHtmlWithDiagnostics(lines.join("\n"), mode.opts);
        assert.ok(
          r3.unclosedTagGroups.length < r1.unclosedTagGroups.length,
          `И4: приняли ${reliable.length} подсказок, но групп было ${r1.unclosedTagGroups.length}, стало ${r3.unclosedTagGroups.length}: ${brief(r3.unclosedTagGroups)}`,
        );
      }
    });
  }
}
