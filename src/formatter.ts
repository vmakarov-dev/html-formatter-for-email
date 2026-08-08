import { parseHtml, normalizeAttrsWhitespace } from "./parser.js";
import { formatCss } from "./cssFormatter.js";
import { isNeverCollapseElement } from "./htmlTags.js";
import { applyTypography, glueTrailingClingingWordBeforeInline, TypografStats } from "./typograf.js";
import { applyServiceCleanup, ServiceCleanupStats } from "./serviceCleanup.js";
import { ElementNode, Node } from "./types.js";

const INDENT_UNIT = "  ";

// "Имя тега" для записи в leak-стеке, соответствующей незакрытой
// Mindbox-конструкции @{for ...}/@{if ...} (см. case "mindbox-block" в
// Renderer.renderBlockNode и case "stray-mindbox-end") — префикс "@"
// невозможен в имени настоящего HTML-тега, поэтому такая запись никогда
// случайно не совпадёт с обычным незакрытым тегом при поиске пары в
// resolveStrayClose.
function mindboxLeakLabel(kind: "for" | "if"): string {
  return `@${kind}`;
}

// Теги, у которых есть узкий, точно известный набор осмысленных
// родителей — используется ТОЛЬКО как внутренний предохранитель в
// resolveStrayClose (см. suspectedMissingParentCounts/checkMissingParentGuard
// ниже), не как публичная диагностика: мы больше не предлагаем
// пользователю вставить родительский тег, которого нет в исходнике вообще
// ни в каком виде (ни открывающего, ни закрывающего) — слишком много
// тонкостей, решение остаётся за пользователем. Но сам ФАКТ "структурно
// непохоже, что у этого ребёнка правильный родитель" по-прежнему нужен
// движку — без него "ничей" закрывающий тег в resolveStrayClose иногда
// ошибочно утаскивает случайного одноимённого предка совсем из другого
// места документа (см. checkMissingParentGuard).
const REQUIRED_PARENT: Record<string, string[]> = {
  td: ["tr"],
  th: ["tr"],
  dt: ["dl"],
  dd: ["dl"],
  tr: ["table", "tbody", "thead", "tfoot"],
};

// Атрибуты, у которых пустое значение (attr="") почти всегда ошибка, а
// не осознанный выбор — в отличие, например, от alt="" (легитимный
// приём для декоративных картинок, специально исключён). background —
// не опечатка, а частый в вёрстке под Outlook атрибут для фонового
// изображения (см. background="..." у <td> в реальных письмах).
const EMPTY_ATTR_NAMES = new Set([
  "src",
  "class",
  "href",
  "background",
  "style",
  "id",
  "width",
  "height",
  "target",
  "bgcolor",
  "align",
]);

// Пустой href/target/src/background почти всегда значит "забыли
// подставить ссылку/адрес" — без значения тег визуально/функционально
// сломан, самим сформировать его не получится, нужно решение человека.
// width — то же самое, но ТОЛЬКО у <img> (пустой width у картинки почти
// наверняка должен был содержать реальное число, а не пустую строку) —
// у остальных тегов (td/table/div/...) пустой width, наоборот, обычно
// просто мусор, который можно смело убрать (см. EMPTY_ATTR_CAN_DELETE
// ниже). Остальные атрибуты из EMPTY_ATTR_NAMES (class/style/id/height/
// bgcolor/align) пустыми быть МОГУТ без вреда — обычно это забытый
// "хвост" после правки, безопасно удалить целиком.
const EMPTY_ATTR_MUST_FILL_ALWAYS = new Set(["href", "target", "src", "background"]);

// К какой из двух категорий относится ПУСТОЙ атрибут attrName у тега
// tagName — "fill" (нужно заполнить осмысленным значением, самим не
// вывести) или "delete" (безопасно удалить сам атрибут целиком).
function categorizeEmptyAttr(attrName: string, tagName: string): "fill" | "delete" {
  if (attrName === "width") {
    return tagName.toLowerCase() === "img" ? "fill" : "delete";
  }
  return EMPTY_ATTR_MUST_FILL_ALWAYS.has(attrName) ? "fill" : "delete";
}

// Разбирает attrsRaw на пары "имя=значение" посимвольно (тот же принцип,
// что и normalizeAttrsWhitespace в parser.ts) — только так можно
// надёжно отличить ГРАНИЦЫ атрибутов текущего тега от похожего текста
// внутри ЧУЖОГО значения в кавычках (простой regex по всей строке иногда
// путает вложенный JSON/строку с "именем=значением" самого тега).
// Возвращает имена (в нижнем регистре) тех атрибутов ИЗ EMPTY_ATTR_NAMES,
// чьё значение оказалось пустой строкой ("" или '').
function findEmptyAttrNames(attrsRaw: string): string[] {
  const found: string[] = [];
  const isSpace = (c: string) => /\s/.test(c);
  const isNameChar = (c: string) => /[a-zA-Z0-9:_-]/.test(c);
  let i = 0;
  while (i < attrsRaw.length) {
    while (i < attrsRaw.length && isSpace(attrsRaw[i])) i++;
    const nameStart = i;
    while (i < attrsRaw.length && isNameChar(attrsRaw[i])) i++;
    const name = attrsRaw.slice(nameStart, i);
    while (i < attrsRaw.length && isSpace(attrsRaw[i])) i++;
    if (attrsRaw[i] === "=") {
      i++;
      while (i < attrsRaw.length && isSpace(attrsRaw[i])) i++;
      const quote = attrsRaw[i];
      if (quote === '"' || quote === "'") {
        const valueStart = i + 1;
        let j = valueStart;
        while (j < attrsRaw.length && attrsRaw[j] !== quote) j++;
        if (name && j === valueStart && EMPTY_ATTR_NAMES.has(name.toLowerCase())) {
          found.push(name.toLowerCase());
        }
        i = j + 1;
      } else if (name) {
        // Значение без кавычек — просто пропускаем до пробела.
        while (i < attrsRaw.length && !isSpace(attrsRaw[i])) i++;
      } else {
        i++;
      }
    } else if (!name) {
      // Символ не подошёл ни под имя, ни под пробел, ни под "=" —
      // защита от зависания на "мусорном" символе, просто идём дальше.
      i++;
    }
  }
  return found;
}

// Одиночная (без пары) кавычка внутри значения атрибута — уже НЕ может
// сломать структуру дерева (см. justSawEquals в parser.ts — кавычка
// открывает "цитируемое" значение только сразу после "="), но почти
// всегда значит настоящую опечатку в исходнике, о которой стоит честно
// предупредить (без попапа с предложением что-то поменять — см. запрос
// пользователя, только информационно). Тот же посимвольный принцип
// разбора, что и у findEmptyAttrNames выше, но с двумя категориями:
// - "unclosed" (незакрытая) — значение НАЧАЛОСЬ с кавычки (сразу после
//   "="), но её пара либо вовсе не нашлась до конца attrsRaw, либо
//   найденное "значение" похоже на то, что проглотило целиком следующий
//   атрибут (см. SWALLOWED_ATTR_RE) — реальный случай: забыли закрыть
//   href, и всё до случайно подвернувшейся кавычки уже ИЗ СЛЕДУЮЩЕГО
//   атрибута стало частью его значения.
// - "unopened" (неоткрытая) — значение НЕ начиналось с кавычки (значит,
//   по правилам HTML это значение без кавычек, читается до первого
//   пробела), но внутри всё равно затесалась кавычка — где-то забыли
//   поставить открывающую пару перед тем, что должно было её закрыть.
//
// SWALLOWED_ATTR_RE намеренно заякорен на КОНЕЦ значения ("$"), а не на
// "где угодно внутри" — иначе ложно срабатывал на совершенно легитимные
// значения вида content="text/html; charset=utf-8" или
// content="width=device-width, initial-scale=1.0" (обычные meta-теги,
// реальный случай, пойманный на живом письме): у них "слово=" тоже
// встречается внутри, но за ним идёт ЕЩЁ содержимое значения перед
// настоящей закрывающей кавычкой. А вот у по-настоящему проглоченного
// атрибута ничего, кроме "слово=", после этого уже нет — кавычка, что
// нас остановила, и есть открывающая кавычка украденного соседа.
const SWALLOWED_ATTR_RE = /\s[a-zA-Z][a-zA-Z0-9:_-]*=$/;

// Ищет начало СЛЕДУЮЩЕГО настоящего атрибута (имя сразу за пробелом,
// сразу с "=" и сразу настоящей кавычкой) — используется, чтобы понять,
// где именно заканчивается "потерявшее открывающую кавычку" значение
// текущего атрибута (см. поиск "unopened" ниже). Без этой границы поиск
// одиночной кавычки останавливался на первом же пробеле (как того требуют
// правила HTML для значений без кавычек) — и пропускал случаи вроде
// `style=display: block; ...; border: 0">`, где потерянное значение
// состоит из МНОГИХ слов (CSS-подобных деклараций через "; "), а
// затесавшаяся кавычка обнаруживается только далеко впереди, перед самым
// закрытием тега.
const NEXT_ATTR_START_RE = /\s[a-zA-Z][a-zA-Z0-9:_-]*=["']/;

export interface QuoteIssue {
  attrName: string;
  kind: "unclosed" | "unopened";
}

function findQuoteIssues(attrsRaw: string): QuoteIssue[] {
  const found: QuoteIssue[] = [];
  const isSpace = (c: string) => /\s/.test(c);
  const isNameChar = (c: string) => /[a-zA-Z0-9:_-]/.test(c);
  let i = 0;
  while (i < attrsRaw.length) {
    while (i < attrsRaw.length && isSpace(attrsRaw[i])) i++;
    const nameStart = i;
    while (i < attrsRaw.length && isNameChar(attrsRaw[i])) i++;
    const name = attrsRaw.slice(nameStart, i);
    while (i < attrsRaw.length && isSpace(attrsRaw[i])) i++;
    if (attrsRaw[i] === "=") {
      i++;
      while (i < attrsRaw.length && isSpace(attrsRaw[i])) i++;
      const quote = attrsRaw[i];
      if (quote === '"' || quote === "'") {
        const valueStart = i + 1;
        let j = valueStart;
        while (j < attrsRaw.length && attrsRaw[j] !== quote) j++;
        const value = attrsRaw.slice(valueStart, j);
        if (name && (j >= attrsRaw.length || SWALLOWED_ATTR_RE.test(value))) {
          found.push({ attrName: name.toLowerCase(), kind: "unclosed" });
        }
        i = j + 1;
      } else if (name) {
        // Значение без кавычек. Ищем ближайшую кавычку не только в первом
        // "слове" (до пробела) — потерянное значение вполне может
        // растянуться на несколько слов (см. NEXT_ATTR_START_RE выше) —
        // а границей служит начало следующего НАСТОЯЩЕГО атрибута
        // (name="...") либо конец attrsRaw, если такого не нашлось.
        const valueStart = i;
        const rest = attrsRaw.slice(valueStart);
        const nextAttrMatch = NEXT_ATTR_START_RE.exec(rest);
        const scanEnd = nextAttrMatch ? valueStart + nextAttrMatch.index : attrsRaw.length;
        const scanned = attrsRaw.slice(valueStart, scanEnd);
        const quoteIdx = scanned.search(/["']/);
        if (quoteIdx !== -1) {
          found.push({ attrName: name.toLowerCase(), kind: "unopened" });
          i = valueStart + quoteIdx + 1;
        } else {
          // Кавычка нигде до следующего настоящего атрибута не нашлась —
          // просто продвигаемся минимум на одно "слово" (как раньше), не
          // трогая scanEnd: остаток нужно разобрать обычным образом
          // (следующие токены могут оказаться настоящими атрибутами).
          while (i < attrsRaw.length && !isSpace(attrsRaw[i])) i++;
        }
      } else {
        i++;
      }
    } else if (!name) {
      i++;
    }
  }
  return found;
}

// Возвращает имена ВСЕХ атрибутов узла в порядке появления (в нижнем
// регистре, с повторами, если в разметке они реально есть) — нужно,
// чтобы пронумеровать occurrence атрибута (см. QuoteIssueLocation ниже)
// СРЕДИ ВСЕХ узлов на одной строке вывода: при схлопывании нескольких
// инлайн-тегов в одну строку (см. isFlowNode) один и тот же атрибут может
// встретиться несколько раз на строке, но диагностика (см. findQuoteIssues
// выше) сработает не для всех — например, у одного <a> атрибут style
// абсолютно валиден, а у соседнего <img> на той же строке — потерял
// кавычку. Простого сопоставления "по имени атрибута" здесь недостаточно,
// нужно знать, КОТОРОЕ по счёту вхождение виновато.
function extractAttrNamesInOrder(attrsRaw: string): string[] {
  const names: string[] = [];
  const isSpace = (c: string) => /\s/.test(c);
  const isNameChar = (c: string) => /[a-zA-Z0-9:_-]/.test(c);
  let i = 0;
  while (i < attrsRaw.length) {
    while (i < attrsRaw.length && isSpace(attrsRaw[i])) i++;
    const nameStart = i;
    while (i < attrsRaw.length && isNameChar(attrsRaw[i])) i++;
    const name = attrsRaw.slice(nameStart, i);
    if (name) names.push(name.toLowerCase());
    while (i < attrsRaw.length && isSpace(attrsRaw[i])) i++;
    if (attrsRaw[i] === "=") {
      i++;
      while (i < attrsRaw.length && isSpace(attrsRaw[i])) i++;
      const quote = attrsRaw[i];
      if (quote === '"' || quote === "'") {
        const valueStart = i + 1;
        let j = valueStart;
        while (j < attrsRaw.length && attrsRaw[j] !== quote) j++;
        i = j + 1;
      } else if (name) {
        while (i < attrsRaw.length && !isSpace(attrsRaw[i])) i++;
      } else {
        i++;
      }
    } else if (!name) {
      i++;
    }
  }
  return names;
}

// normalizeAttrsWhitespace — намеренно ЗДЕСЬ, при сборке строки для
// ВЫВОДА, а не на этапе парсинга (см. комментарий у самой функции в
// parser.ts): node.attrsRaw в дереве всегда сырой, схлопывание нужно
// только тегу, который печатается одной строкой.
function openTagString(node: ElementNode): string {
  const attrs = node.attrsRaw ? " " + normalizeAttrsWhitespace(node.attrsRaw) : "";
  // У тега без настоящего ">" в исходнике (см. ElementNode.unterminated)
  // ">" НЕ дописываем: символ, которым тег фактически обрывается, уже
  // лежит внутри attrsRaw. Иначе каждое форматирование добавляло бы по
  // одному лишнему ">" в текст письма (broken> -> broken>> -> ...).
  if (node.unterminated) {
    return `<${node.tagName}${attrs}`;
  }
  if (node.voidElement) {
    return `<${node.tagName}${attrs}${node.selfClosed ? " />" : ">"}`;
  }
  if (node.selfClosed) {
    return `<${node.tagName}${attrs} />`;
  }
  return `<${node.tagName}${attrs}>`;
}

// Узел можно держать в инлайн-потоке (не переносить на отдельную строку
// принудительно), только если весь его контент — тоже текст/инлайн-теги,
// без блочных элементов, комментариев и т.п. внутри. Явно не закрытые в
// исходнике инлайн-теги сюда не годятся: serializeFlow всегда дописывает
// закрывающий тег, а для них его сочинять нельзя (см. explicitlyClosed).
function hasOnlyInlineFlowContent(node: ElementNode): boolean {
  for (const child of node.children) {
    if (child.type === "text") continue;
    if (
      child.type === "element" &&
      child.inline &&
      child.explicitlyClosed &&
      hasOnlyInlineFlowContent(child)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function isFlowNode(node: Node): boolean {
  if (node.type === "text") return true;
  if (node.type === "element" && node.inline && node.explicitlyClosed) {
    return hasOnlyInlineFlowContent(node);
  }
  return false;
}

// Сериализует текст/инлайн-элемент в плоскую HTML-строку для потока.
// Пробелы схлопываются до одного (стандартное поведение HTML-рендера),
// обрезка внешних краёв делается один раз на уровне всего сегмента —
// см. collapseFlowWhitespace ниже (сам serializeFlow пробелы НЕ трогает,
// кроме собственного текста текстовых узлов, — это безопасно, потому что
// значения атрибутов туда не попадают).
function serializeFlow(node: Node): string {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type === "element") {
    if (node.voidElement || node.selfClosed) {
      return openTagString(node);
    }
    const inner = node.children.map(serializeFlow).join("");
    return `${openTagString(node)}${inner}</${node.tagName}>`;
  }
  return "";
}

// Схлопывает пробельные пробеги до одного пробела и обрезает края — но
// ТОЛЬКО вне тегов (< ... >), не трогая содержимое кавычек внутри них.
// Раньше это делалось простым node.value.replace(/\s+/g, " ") прямо на
// уже СКЛЕЕННОЙ строке всего инлайн-сегмента (см. serializeFlow) — и
// заодно ломало значения атрибутов инлайн-тегов, если внутри них
// специально стоит несколько пробелов подряд (например, alt="a  b"):
// текст элемента и его открывающий тег после join() неотличимы друг от
// друга для простого регэкспа. Отслеживаем границы тегов (и кавычки
// внутри них, как и при разборе) явно, чтобы разница была видна.
//
// justSawEquals — та же защита, что и в parseElement/normalizeAttrsWhitespace
// (см. src/parser.ts): кавычка открывает "внутри кавычек" ТОЛЬКО если стоит
// прямо после "=" (пропуская пробелы). Без этого одна незакрытая кавычка в
// значении атрибута (см. findQuoteIssues) сбивала здесь чётность кавычек —
// ровно тот же класс бага, что чинили в самом парсере, только в этой
// отдельной копии похожей логики: настоящий перенос строки между двумя
// соседними инлайн-тегами (например, "\n" между двумя <a>) ошибочно
// считался "внутри тега" и просачивался в результат буквально, вместо того
// чтобы схлопнуться в пробел — из-за чего инлайн-сегмент рендерился со
// сломанными переносами, а диагностика кавычек у нескольких узлов в одном
// сегменте съезжала на одну и ту же (неверную) строку.
function collapseFlowWhitespace(text: string): string {
  let result = "";
  let inTag = false;
  let inSingle = false;
  let inDouble = false;
  let justSawEquals = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inTag) {
      result += c;
      if (inSingle) {
        if (c === "'") inSingle = false;
      } else if (inDouble) {
        if (c === '"') inDouble = false;
      } else if (c === "'" && justSawEquals) {
        inSingle = true;
      } else if (c === '"' && justSawEquals) {
        inDouble = true;
      } else if (c === ">") {
        inTag = false;
      }
      if (c === "=") justSawEquals = true;
      else if (!/\s/.test(c)) justSawEquals = false;
      i++;
      continue;
    }
    if (c === "<") {
      inTag = true;
      justSawEquals = false;
      result += c;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      result += " ";
      while (i < text.length && /\s/.test(text[i])) i++;
      continue;
    }
    result += c;
    i++;
  }
  return result.trim();
}

// Сериализует ЛЮБОЙ узел (не только текст/инлайн-теги, как serializeFlow)
// в плоскую однострочную строку — используется, когда условный
// комментарий целиком схлопывается в одну строку (опция
// collapseOutlookComments). Пробелы всюду схлопываются до одного, не
// закрытые в исходнике теги остаются без закрывающего тега (см.
// explicitlyClosed) — как и везде, форматтер не сочиняет то, чего не
// было. Вложенные условные комментарии тоже схлопываются рекурсивно.
function serializeCompact(node: Node): string {
  switch (node.type) {
    case "text":
      return node.value.replace(/\s+/g, " ");
    case "element": {
      const open = openTagString(node);
      if (node.voidElement || node.selfClosed) return open;
      const inner = node.children.map(serializeCompact).join("");
      return node.explicitlyClosed ? `${open}${inner}</${node.tagName}>` : `${open}${inner}`;
    }
    case "raw-text": {
      const attrs = node.attrsRaw ? " " + normalizeAttrsWhitespace(node.attrsRaw) : "";
      const content = node.rawContent.replace(/\s+/g, " ");
      return `<${node.tagName}${attrs}>${content}</${node.tagName}>`;
    }
    case "style": {
      const attrs = node.attrsRaw ? " " + normalizeAttrsWhitespace(node.attrsRaw) : "";
      const content = node.rawContent.replace(/\s+/g, " ").trim();
      return `<${node.tagName}${attrs}>${content}</${node.tagName}>`;
    }
    case "doctype":
      return node.raw.replace(/\s+/g, " ");
    case "comment":
      return `<!--${node.raw.replace(/\s+/g, " ")}-->`;
    case "conditional-comment": {
      const inner = collapseFlowWhitespace(node.children.map(serializeCompact).join(""));
      const middle = inner.length > 0 ? ` ${inner} ` : "";
      return `${node.openRaw}${middle}${node.closeRaw}`;
    }
    case "stray-close-tag":
      return node.raw;
    case "mindbox-statement":
      return node.raw.replace(/\s+/g, " ");
    case "stray-mindbox-end":
      return node.raw;
    case "mindbox-block": {
      const inner = collapseFlowWhitespace(node.children.map(serializeCompact).join(""));
      const middle = inner.length > 0 ? ` ${inner} ` : "";
      return node.explicitlyClosed ? `${node.openRaw}${middle}${node.closeRaw}` : `${node.openRaw}${middle}`;
    }
  }
}

// Идёт вверх по настоящей цепочке предков (см. LeakEntry.parentEntry) —
// не по стеку, а по реальной вложенности AST — и проверяет, встретится
// ли на ней ancestor. Используется только в resolveStrayClose, чтобы
// отличить "настоящего потомка совпавшего тега" от случайного соседа по
// стеку из другой, не связанной ветки документа.
function isDescendantOfEntry(entry: LeakEntry, ancestor: LeakEntry): boolean {
  let cur = entry.parentEntry;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parentEntry;
  }
  return false;
}

// Второй, не менее надёжный вид "предка" — приём ghost-таблиц под Outlook:
//   <!--[if mso]><td><![endif]-->
//   <div>… весь видимый контент …
//   <!--[if mso]></td><![endif]-->
// Здесь <td> намеренно открыт ВНУТРИ условного комментария, а настоящее
// содержимое (div) лежит СНАРУЖИ него. По дереву разбора они — соседи, а
// не предок и потомок (комментарий это отдельный узел), поэтому
// isDescendantOfEntry выше их родства не видит. Но в ОТРИСОВАННОМ письме
// div находится именно внутри этого td, и точка, где td закрывается, —
// ровно то место, где закрылся бы и div. Значит, позиция вставки для него
// такая же надёжная, как при обычном закрытии предком.
//
// Проверять "открыт позже" отдельно не нужно: сюда попадают только записи,
// лежащие в leak-стеке ВЫШЕ совпавшей, а туда они кладутся строго в
// порядке открытия.
//
// Без этой поправки единственный незакрытый <div> в реальном письме
// (внутри ghost-колонки) получал "uncertain": ни серой строки-подсказки,
// ни кнопки "Добавить?" — хотя место вставки вычислялось верное.
function isWrappedByOutlookBridge(entry: LeakEntry, wrapper: LeakEntry): boolean {
  return wrapper.openedInConditionalComment && !entry.openedInConditionalComment;
}

interface LeakEntry {
  tagName: string;
  // Глубина, на которую нужно вернуться, когда этот тег наконец
  // закроется — совпадает с глубиной строки его открывающего тега.
  popToDepth: number;
  // Индекс строки в this.out, где напечатан открывающий тег — нужен
  // только для диагностики "незакрытый тег" (см. UnclosedTagInfo).
  line: number;
  // true, если позже нашёлся настоящий закрывающий тег с совпадающим
  // именем (обычный </tag> или "ничей" стрей-тег, включая случай из
  // другого условного комментария) — тогда тег не считается проблемным.
  // Если запись просто вытеснена из стека попутно при закрытии предка
  // (см. leakMark ниже) — resolved остаётся false: у самого тега всё
  // равно нет ни одного настоящего закрывающего тега где-либо в
  // документе, это только неявное закрытие браузером/парсером.
  resolved: boolean;
  // Индекс строки в this.out, ПЕРЕД которой браузер неявно закрыл бы этот
  // тег — момент, когда предок с настоящим закрывающим тегом "утащил" его
  // за собой (см. leakMark). Пока такого не произошло, остаётся Infinity;
  // если тег так и не вытеснился до самого конца документа — render()
  // подставляет туда индекс конца документа. Нужно только для подсказки
  // "здесь предположительно нужен закрывающий тег" в веб-интерфейсе — сам
  // formatHtml по-прежнему ничего не сочиняет в реальном HTML-выводе.
  insertBeforeLine: number;
  // Насколько можно доверять insertBeforeLine как КОНКРЕТНОМУ месту
  // вставки (а не просто факту "тег не закрыт"):
  // - "reliable": тег вытеснен закрытием СВОЕГО прямого предка, либо
  //   спокойно долежал непосредственно до конца документа — это ровно то
  //   место, где браузер закрыл бы его сам.
  // - "uncertain": тег был вытеснен ПОПУТНО, когда чужой "ничей" тег
  //   разрешил СОВСЕМ ДРУГУЮ, более свежую запись в стеке (см.
  //   resolveStrayClose) — сам этот тег при этом ни с чем не совпал, мы
  //   просто знаем, что где-то тут его потеряли из виду. Настоящая пара
  //   для него может быть где угодно дальше по документу — показывать
  //   точную позицию вставки в этом случае вводит в заблуждение.
  insertConfidence: "reliable" | "uncertain";
  // Ближайший НЕЗАКРЫТЫЙ предок этого тега в РЕАЛЬНОМ дереве разбора (не
  // по стеку, а по настоящей вложенности AST) на момент открытия — или
  // null, если такого нет. Нужен только для одной проверки в
  // resolveStrayClose: действительно ли "попутно" вытесненная запись —
  // настоящий потомок того тега, который совпал, а не просто случайный
  // сосед по стеку из-за перепутанной разметки где-то в другом месте
  // документа (там одинаковая глубина ничего не доказывает — см. пример
  // в resolveStrayClose).
  parentEntry: LeakEntry | null;
  // true, если тег открылся, пока рендер находился ВНУТРИ условного
  // комментария (на любом уровне вложенности, не обязательно прямо в
  // нём) — то есть это часть приёма table>tr>td, разрубленного на два
  // условных комментария (см. класс-комментарий Renderer). Нужно для
  // resolveStrayClose: "ничей" закрывающий тег, сам стоящий внутри
  // условного комментария, должен в первую очередь искать пару СРЕДИ
  // ТАКИХ ЖЕ записей, а не среди обычного видимого контента между двумя
  // комментариями — иначе случайная опечатка где-то в обычном тексте
  // письма (никак не связанная с MSO-приёмом) перехватывает законную
  // пару у настоящей MSO-тройки.
  openedInConditionalComment: boolean;
  // Текст (openRaw) ближайшего условного комментария, внутри которого тег
  // открылся — например "<!--[if gte mso 9]>", или null, если тег открылся
  // вне всякого условного комментария (см. openedInConditionalComment).
  // Нужен, чтобы предложенная обёртка (см. closesInsideConditionalComment
  // ниже и UnclosedTagGroup) повторяла ТО ЖЕ условие, а не общее "[if mso]".
  openedInConditionalCommentText: string | null;
  // true, если в момент, когда insertBeforeLine наконец определился (тег
  // "вытеснился" из стека — закрытием предка, попутным резолвом чужого
  // "ничьего" тега или концом документа), рендер всё ещё находился ВНУТРИ
  // какого-нибудь условного комментария (необязательно ТОГО ЖЕ самого, но
  // на практике это и не важно — если предложенная точка вставки и так уже
  // лежит внутри чьей-то outlook-конструкции, добавлять ещё одну новую не
  // нужно). Пока тег так и не вытеснился — остаётся false (не используется).
  closesInsideConditionalComment: boolean;
}

export interface UnclosedTagInfo {
  // 0-based номер строки в итоговом HTML (совпадает с индексом при
  // html.split("\n")), где напечатан открывающий тег.
  line: number;
  tagName: string;
  // 0-based номер строки, ПЕРЕД которой предположительно должен был бы
  // стоять закрывающий тег (см. LeakEntry.insertBeforeLine).
  insertBeforeLine: number;
  // Уровень отступа для предполагаемого закрывающего тега (в "единицах",
  // умножить на используемый шаг отступа — 2 пробела).
  depth: number;
  // См. LeakEntry.insertConfidence — веб-интерфейс показывает серую
  // подсказку с конкретным местом вставки только при "reliable".
  insertConfidence: "reliable" | "uncertain";
}

// Цепочка вложенных незакрытых тегов, вытесненных в ОДНУ и ту же точку
// вставки (см. Renderer.getUnclosedTagGroups) — веб-интерфейс показывает
// такую цепочку одним общим попапом ("первый тег...последний тег" в
// статусе) вместо отдельного попапа на каждый тег. tags.length === 1 —
// обычный одиночный незакрытый тег, ничем не отличается от прежнего
// поведения.
export interface UnclosedTagGroup {
  // От первого (самый внешний, раньше открылся) до последнего (самый
  // внутренний, позже открылся).
  tags: UnclosedTagInfo[];
  insertBeforeLine: number;
  insertConfidence: "reliable" | "uncertain";
  // true — у цепочки нет собственной outlook-конструкции в точке
  // вставки (см. LeakEntry.closesInsideConditionalComment), и веб-
  // интерфейсу нужно предложить обернуть ВСЕ закрывающие теги в новую
  // <!--[if ...]-->...<![endif]--> вместо того, чтобы просто дописать их
  // по отдельности — см. conditionalCommentText (текст условия для
  // обёртки, тот же, что был у исходного открывающего комментария).
  needsConditionalCommentWrap: boolean;
  conditionalCommentText: string | null;
}

// Диагностика "пустых атрибутов" (см. EMPTY_ATTR_NAMES/findEmptyAttrNames/
// categorizeEmptyAttr выше) — сгруппирована ПО ИМЕНИ атрибута внутри
// каждой из двух категорий (fill/delete, см. Renderer.getEmptyAttrsToFill/
// getEmptyAttrsToDelete): одна запись на имя, а не одна на каждое
// вхождение, потому что в UI это именно так и показывается
// (маркированный список "имя: строка, строка, ..."). Ни на список "надо
// заполнить", ни на список "можно удалить" эта диагностика сама по себе
// не предлагает попап принять/отклонить конкретное вхождение — только
// сводку и (для "можно удалить") кнопку "удалить все", см. запрос
// пользователя.
export interface EmptyAttrGroup {
  attrName: string;
  // 0-based номера строк, в порядке появления по документу.
  lines: number[];
}

// Диагностика "проблема с кавычкой" (см. QuoteIssue/findQuoteIssues выше) —
// в отличие от EmptyAttrGroup хранит не просто номер строки, а ЕЩЁ и
// occurrence: порядковый номер (1-based) появления ЭТОГО имени атрибута
// СРЕДИ ВСЕХ узлов на этой же строке (см. extractAttrNamesInOrder/
// attrNameOccurrenceOnLine в Renderer). Нужен веб-интерфейсу, чтобы точно
// найти в DOM именно то вхождение атрибута, у которого реально есть
// проблема, а не любое одноимённое на той же (после схлопывания инлайн-
// потока в одну строку) визуальной строке — иначе, если на строке
// одновременно есть валидное и сломанное вхождение одного и того же имени
// атрибута (реальный случай: у одного <a> валидный style, у соседнего
// <img> на той же строке — style без кавычек), подсветка могла попасть не
// на то вхождение.
export interface QuoteIssueLocation {
  line: number;
  occurrence: number;
}

export interface QuoteIssueGroup {
  attrName: string;
  locations: QuoteIssueLocation[];
}

// Рендерер держит ДВЕ вещи как общее изменяемое состояние вместо
// параметра depth, передаваемого по цепочке рекурсии:
//
// 1. this.depth — текущий уровень отступа. Обычно ведёт себя как обычный
//    счётчик вложенности дерева, НО для тегов, не закрытых в исходнике
//    (см. ElementNode.explicitlyClosed), после рендера их содержимого
//    глубина НЕ возвращается назад — она "утекает" во всё, что идёт
//    дальше по документу, пока где-то (даже в другом условном
//    комментарии) не найдётся соответствующий закрывающий тег.
// 2. this.leakStack — глобальный стек таких "утёкших" тегов. Одиночный
//    закрывающий тег (StrayCloseTagNode) при рендере ищет совпадение по
//    имени в этом стеке (с конца, как в реальном разборе HTML) и, если
//    находит, возвращает глубину на уровень исходного открывающего тега.
//
// Это именно то поведение, которое нужно для вёрстки под Outlook: там
// <table><tr><td> открываются в одном <!--[if mso]>-->, специально не
// закрываются внутри него, и закрываются позже отдельным условным
// комментарием — а между ними идёт весь обычный, видимый всем контент,
// который на самом деле вложен в этот table/tr/td.
class Renderer {
  private depth = 0;
  private leakStack: LeakEntry[] = [];
  // Все когда-либо созданные записи об "утёкших" тегах, включая уже
  // убранные из leakStack (попутным закрытием предка) — leakStack сам по
  // себе используется только для поиска СОВПАДЕНИЙ по ходу рендера, а
  // allLeakEntries — источник итоговой диагностики "незакрытый тег".
  private allLeakEntries: LeakEntry[] = [];
  private out: string[] = [];
  // Ближайший ещё не закрытый (по-настоящему открытый выше по дереву, а
  // не просто по позиции в стеке) предок текущей точки рендера — см.
  // LeakEntry.parentEntry. Обновляется только вокруг рекурсии в детей
  // НЕЗАКРЫТОГО элемента (см. renderBlockNode); для explicitlyClosed
  // элементов не трогается, потому что у них самих нет записи в стеке —
  // ближайший "утёкший" предок для их детей остаётся тем же, что был снаружи.
  private currentUnclosedAncestor: LeakEntry | null = null;
  // Счётчик вложенности условных комментариев в текущей точке рендера —
  // см. LeakEntry.openedInConditionalComment и resolveStrayClose. Счётчик,
  // а не boolean, потому что условные комментарии могут быть вложены
  // друг в друга.
  private conditionalCommentDepth = 0;
  // Стек ТЕКСТОВ условий (node.openRaw, например "<!--[if gte mso 9]>")
  // открытых сейчас условных комментариев — параллельно conditionalCommentDepth
  // выше (тот только считает вложенность, этот хранит САМИ тексты). Нужен
  // для группировки цепочек незакрытых тегов (см. UnclosedTagGroup ниже):
  // если тегу для закрытия нужна НОВАЯ outlook-конструкция, она должна
  // повторять ТО ЖЕ условие, что было у исходного открывающего комментария,
  // а не универсальное "[if mso]" — см. LeakEntry.openedInConditionalCommentText.
  private conditionalCommentTextStack: string[] = [];
  // Номера строк вывода, на которых НАЧАЛИСЬ сейчас открытые условные
  // комментарии — параллельно двум стекам выше. Нужны для одной вещи:
  // подсказать правильную точку вставки закрывающего тега для элемента,
  // который сам живёт в ОБЫЧНОМ, видимом всем контенте, а "вытеснился"
  // из стека уже внутри outlook-конструкции. См. insertLineFor.
  private conditionalCommentStartLines: number[] = [];
  // Имя тега РЕАЛЬНОГО (структурного) родителя текущей точки рендера —
  // не спутывать с currentUnclosedAncestor (тот — ближайший НЕЗАКРЫТЫЙ
  // предок, для утечки глубины). Обновляется вокруг рекурсии в детей
  // ЛЮБОГО элемента (закрытого или нет), но НЕ вокруг условных
  // комментариев — они "прозрачны" для этой проверки (см.
  // checkMissingParentGuard): комментарий — не настоящий HTML-тег,
  // реальным родителем его содержимого считается ближайший настоящий тег
  // снаружи.
  private currentParentTagName: string | null = null;
  // "Подозрения" checkMissingParentGuard — см. её же комментарий и
  // REQUIRED_PARENT выше. Кроме имени пропущенного родителя запоминаем
  // ГЛУБИНУ leak-стека на момент подозрения: без неё вето в
  // resolveStrayClose было чисто глобальным (Map<имя, счётчик>) и гасило
  // ПЕРВЫЙ ЖЕ встреченный дальше одноимённый "ничей" тег — где угодно по
  // документу, в любой посторонней ветке. Одна осиротевшая ячейка в
  // начале письма из-за этого ломала исправные Outlook-конструкции ниже,
  // и ровно один к одному: N сирот — N испорченных конструкций.
  //
  // Глубина даёт вето точный смысл: гасить нужно только совпадение с
  // тегом, который лежал в стеке ЕЩЁ ДО того, как подозрение возникло —
  // то есть с посторонним, заведомо более ранним тегом (ровно этот
  // случай вето и защищает: вырезанный <table> не должен закрывать
  // далёкую чужую таблицу). Тег, открытый уже ПОСЛЕ подозрения, к нему
  // отношения не имеет, и мешать его законному разрешению нельзя.
  private suspectedMissingParents: { tagName: string; leakDepth: number }[] = [];
  // См. EmptyAttrGroup/findEmptyAttrNames/categorizeEmptyAttr выше — ключ
  // Map сохраняет порядок первой вставки (гарантия спецификации), так
  // что getEmptyAttrsToFill/getEmptyAttrsToDelete отдают группы в
  // порядке первого появления атрибута по документу без отдельной
  // сортировки. Две отдельные Map, а не одна с полем category — иначе
  // пришлось бы решать, что делать с ОДНИМ именем ("width"), у которого
  // конкретные вхождения могут попасть в РАЗНЫЕ категории (см.
  // categorizeEmptyAttr — зависит от тега).
  private emptyAttrsFillByName = new Map<string, number[]>();
  private emptyAttrsDeleteByName = new Map<string, number[]>();
  // См. QuoteIssue/findQuoteIssues/QuoteIssueLocation выше — та же идея
  // группировки по имени, что и у emptyAttrsFillByName/DeleteByName, но
  // значение — не просто номер строки, а {line, occurrence} (см.
  // QuoteIssueLocation), разложенная по тем же двум категориям
  // ("unclosed"/"unopened").
  private unclosedQuoteByName = new Map<string, QuoteIssueLocation[]>();
  private unopenedQuoteByName = new Map<string, QuoteIssueLocation[]>();
  // Счётчик "которое по счёту вхождение этого имени атрибута на этой
  // строке" (ключ "line:name") — считает ВСЕ узлы с этим именем атрибута
  // на строке, независимо от того, есть ли у них проблема с кавычкой (см.
  // QuoteIssueLocation и extractAttrNamesInOrder выше): иначе, если на
  // строке есть и валидное, и сломанное вхождение одного и того же имени,
  // occurrence сломанного мог бы совпасть с валидным.
  private attrNameOccurrenceOnLine = new Map<string, number>();

  constructor(private readonly options: ResolvedFormatOptions) {}

  render(nodes: Node[]): string {
    this.renderNodes(nodes);
    // Всё, что осталось в стеке к самому концу документа (не закрылось и
    // не было вытеснено закрытием предка), "закрылось" бы неявно только
    // в самом конце — используем это как точку вставки подсказки.
    for (const entry of this.leakStack) {
      if (entry && entry.insertBeforeLine === Infinity) {
        entry.insertBeforeLine = this.out.length;
        entry.closesInsideConditionalComment = this.conditionalCommentDepth > 0;
      }
    }
    return this.out.join("\n");
  }

  // Вызывать после render(). Тег считается по-настоящему незакрытым, если
  // ни разу не нашёлся его настоящий закрывающий тег — ни как обычный
  // </tag>, ни как "ничей" тег в этом же или другом условном комментарии
  // (см. resolveStrayClose). Просто "вытеснен из стека закрытием предка"
  // (родитель закрылся, неявно потянув его за собой) в счёт не идёт —
  // сам тег всё равно нигде не закрыт явно.
  getUnclosedTags(): UnclosedTagInfo[] {
    return this.allLeakEntries
      .filter((e) => !e.resolved)
      .map((e) => ({
        line: e.line,
        tagName: e.tagName,
        insertBeforeLine: e.insertBeforeLine,
        depth: e.popToDepth,
        insertConfidence: e.insertConfidence,
      }));
  }

  // Группирует незакрытые теги в "цепочки" — см. UnclosedTagGroup: серию
  // ВЛОЖЕННЫХ (по-настоящему, через parentEntry, а не просто случайно
  // совпавших по номеру строки) незакрытых предков, которые все вытеснились
  // в ОДНУ и ту же точку вставки (см. запрос пользователя — веб-интерфейс
  // показывает такую цепочку одним общим попапом с двумя линиями-
  // указателями, к первому и последнему тегу, вместо кучи отдельных
  // попапов подряд). Одиночный незакрытый тег без цепочки — просто группа
  // из одного элемента, так что вызывающей стороне не нужно разбирать два
  // разных случая отдельно.
  //
  // Линейный проход по allLeakEntries (порядок — порядок появления в
  // документе, он же порядок открытия тегов) — а не полный обход дерева:
  // цепочка родитель→потомок→потомок физически не может идти иначе, кроме
  // как подряд по возрастанию времени открытия, так что не нужно
  // реконструировать дерево заново, достаточно смотреть на
  // parentEntry/insertBeforeLine соседей-кандидатов.
  getUnclosedTagGroups(): UnclosedTagGroup[] {
    const unresolved = this.allLeakEntries.filter((e) => !e.resolved);
    const consumed = new Set<LeakEntry>();
    const chains: LeakEntry[][] = [];
    for (const entry of unresolved) {
      if (consumed.has(entry)) continue;
      const chain = [entry];
      consumed.add(entry);
      let current = entry;
      for (;;) {
        // Цепочка продолжается только если у current РОВНО ОДИН ещё не
        // взятый незакрытый потомок в этой же точке вставки — при
        // ветвлении (два и более кандидата) ни один не считается
        // "продолжением", каждый остаётся собственной отдельной цепочкой
        // (см. запрос пользователя — только линейная последовательность,
        // не дерево).
        const children = unresolved.filter(
          (e) =>
            !consumed.has(e) &&
            e.parentEntry === current &&
            e.insertBeforeLine === current.insertBeforeLine,
        );
        if (children.length !== 1) break;
        current = children[0];
        chain.push(current);
        consumed.add(current);
      }
      chains.push(chain);
    }
    return chains.map((chain) => this.buildUnclosedTagGroup(chain));
  }

  private buildUnclosedTagGroup(chain: LeakEntry[]): UnclosedTagGroup {
    const tags: UnclosedTagInfo[] = chain.map((e) => ({
      line: e.line,
      tagName: e.tagName,
      insertBeforeLine: e.insertBeforeLine,
      depth: e.popToDepth,
      insertConfidence: e.insertConfidence,
    }));
    // "reliable" только если ВСЕ теги цепочки reliable — как и у
    // одиночных тегов (см. insertConfidence в LeakEntry), показывать
    // серую подсказку/попап для группы, где хоть один участник под
    // сомнением, было бы так же вводящим в заблуждение, как и для
    // одиночного uncertain-тега.
    const insertConfidence: "reliable" | "uncertain" = chain.every(
      (e) => e.insertConfidence === "reliable",
    )
      ? "reliable"
      : "uncertain";
    const first = chain[0];
    // Обёртка нужна, только если ВСЯ цепочка целиком открылась в ОДНОМ и
    // том же условном комментарии, и точка вставки закрывающих тегов уже
    // НЕ находится ни в каком условном комментарии (см. запрос
    // пользователя) — частичное совпадение (например, только внешний тег
    // открылся в outlook, а внутренний — уже снаружи) означает, что это
    // не единая MSO-конструкция, и мы не пытаемся угадывать, что тут
    // предложить.
    const needsWrap =
      insertConfidence === "reliable" &&
      first.openedInConditionalCommentText !== null &&
      chain.every(
        (e) =>
          e.openedInConditionalComment &&
          !e.closesInsideConditionalComment &&
          e.openedInConditionalCommentText === first.openedInConditionalCommentText,
      );
    return {
      tags,
      insertBeforeLine: first.insertBeforeLine,
      insertConfidence,
      needsConditionalCommentWrap: needsWrap,
      conditionalCommentText: needsWrap ? first.openedInConditionalCommentText : null,
    };
  }

  getEmptyAttrsToFill(): EmptyAttrGroup[] {
    return [...this.emptyAttrsFillByName.entries()].map(([attrName, lines]) => ({ attrName, lines }));
  }

  getEmptyAttrsToDelete(): EmptyAttrGroup[] {
    return [...this.emptyAttrsDeleteByName.entries()].map(([attrName, lines]) => ({ attrName, lines }));
  }

  getUnclosedQuoteAttrs(): QuoteIssueGroup[] {
    return [...this.unclosedQuoteByName.entries()].map(([attrName, locations]) => ({ attrName, locations }));
  }

  getUnopenedQuoteAttrs(): QuoteIssueGroup[] {
    return [...this.unopenedQuoteByName.entries()].map(([attrName, locations]) => ({ attrName, locations }));
  }

  private indent(depth = this.depth): string {
    return INDENT_UNIT.repeat(depth);
  }

  // ЕДИНСТВЕННЫЙ способ класть готовую строку в this.out — вся
  // диагностика (номера строк в UnclosedTagInfo/EmptyAttrGroup — это
  // индексы this.out) держится на инварианте "один элемент this.out —
  // ровно одна визуальная строка
  // итогового вывода". Некоторые узлы сохраняют содержимое БЕЗ
  // изменений, "как есть" (обычные комментарии, raw-text/script/pre) —
  // включая любые переносы строк из самого исходника (например,
  // многострочный HTML-комментарий). Если пропустить такой текст ОДНИМ
  // обычным push с переносами ВНУТРИ строки, this.out.length перестаёт
  // совпадать с количеством строк в итоговом html.split("\n") начиная с
  // этой самой точки — а раз номера строк во всей диагностике буквально
  // равны this.out.length в момент вставки, ВСЕ последующие диагностики
  // (line/insertBeforeLine) в документе после такого узла массово
  // съезжают на разницу. Реальный случай: многострочный HTML-комментарий
  // где-то в середине письма — из-за него диагностика по всему, что
  // идёт ПОСЛЕ него, указывала на строки на 2 меньше настоящих. Разбивка
  // на отдельные push по каждому переносу никак не меняет сам итоговый
  // текст (join("\n") между элементами массива и "\n" ВНУТРИ одного
  // элемента дают на выходе абсолютно одну и ту же строку) — только
  // подсчёт номеров строк становится верным.
  private pushLine(text: string): void {
    if (text.indexOf("\n") === -1) {
      this.out.push(text);
      return;
    }
    for (const part of text.split("\n")) this.out.push(part);
  }

  // Проверяет ТОЛЬКО собственные атрибуты узла (не детей) — вызывать для
  // каждого узла ровно там, где уже известно, что this.out.length —
  // индекс строки, на которой вот-вот напечатается ЕГО открывающий тег.
  // Заодно (см. findQuoteIssues) ловит одиночные непарные кавычки внутри
  // значений — чисто информационная диагностика, отдельная от "пустых
  // атрибутов", но проверяется тем же проходом по тем же узлам, чтобы не
  // заводить второй параллельный обход дерева. Детей такого узла эта
  // функция не трогает — они либо получат свой собственный вызов через
  // обычную рекурсию renderNodes (обычные блочные потомки), либо их
  // нужно обойти отдельно через checkEmptyAttrsDeep (инлайн-поток,
  // схлопнутый в одну строку, — там дети НЕ проходят через renderNodes
  // самостоятельно).
  private checkEmptyAttrsOwn(node: Node): void {
    if (node.type !== "element" && node.type !== "raw-text" && node.type !== "style") return;
    if (!node.attrsRaw) return;
    const line = this.out.length;
    const names = findEmptyAttrNames(node.attrsRaw);
    for (const name of names) {
      const map =
        categorizeEmptyAttr(name, node.tagName) === "fill"
          ? this.emptyAttrsFillByName
          : this.emptyAttrsDeleteByName;
      const list = map.get(name);
      if (list) list.push(line);
      else map.set(name, [line]);
    }
    const quoteIssues = findQuoteIssues(node.attrsRaw);
    // occurrence считаем для ВСЕХ имён атрибутов узла безусловно (не
    // только при наличии проблемы) — иначе валидное вхождение этого же
    // имени на другом узле той же строки (см. attrNameOccurrenceOnLine)
    // не "займёт" свой номер, и нумерация собьётся для узлов, идущих
    // ПОСЛЕ него на этой же строке.
    const namesInOrder = extractAttrNamesInOrder(node.attrsRaw);
    const ordinalsByName = new Map<string, number[]>();
    for (const attrName of namesInOrder) {
      const key = `${line}:${attrName}`;
      const next = (this.attrNameOccurrenceOnLine.get(key) ?? 0) + 1;
      this.attrNameOccurrenceOnLine.set(key, next);
      const list = ordinalsByName.get(attrName);
      if (list) list.push(next);
      else ordinalsByName.set(attrName, [next]);
    }
    if (quoteIssues.length > 0) {
      // localIdxByName — которое по счёту (внутри ЭТОГО узла) вхождение
      // данного имени соответствует текущей проблеме: на практике почти
      // всегда 0 (дублирующиеся имена атрибутов внутри одного тега —
      // невалидная редкость), но на всякий случай не полагаемся на это.
      const localIdxByName = new Map<string, number>();
      for (const issue of quoteIssues) {
        const localIdx = localIdxByName.get(issue.attrName) ?? 0;
        localIdxByName.set(issue.attrName, localIdx + 1);
        const occurrence = ordinalsByName.get(issue.attrName)?.[localIdx] ?? 1;
        const map = issue.kind === "unclosed" ? this.unclosedQuoteByName : this.unopenedQuoteByName;
        const loc: QuoteIssueLocation = { line, occurrence };
        const list = map.get(issue.attrName);
        if (list) list.push(loc);
        else map.set(issue.attrName, [loc]);
      }
    }
  }

  // Рекурсивно проверяет узел И ВСЕХ его потомков, приписывая им одну и
  // ту же строку — для случаев, когда всё поддерево печатается на ОДНОЙ
  // строке вывода и потому не проходит через обычную построчную
  // рекурсию renderNodes самостоятельно (инлайн-поток/схлопнутый
  // условный комментарий, см. вызовы в renderBlockNode).
  private checkEmptyAttrsDeep(node: Node): void {
    this.checkEmptyAttrsOwn(node);
    if (node.type === "element" || node.type === "conditional-comment" || node.type === "mindbox-block") {
      for (const child of node.children) this.checkEmptyAttrsDeep(child);
    }
  }

  // Внутренний предохранитель (НЕ публичная диагностика — см.
  // REQUIRED_PARENT/suspectedMissingParentCounts выше): проверяет ОДНОГО
  // ребёнка — не потерялся ли перед ним родитель. runTag передаётся по
  // ссылке через возвращаемое значение — вызывающая сторона (renderNodes)
  // хранит его как ЛОКАЛЬНУЮ переменную (не поле класса!), потому что
  // серия однотипных пропусков считается только среди СОСЕДЕЙ одного и
  // того же списка детей — рекурсия в детей текущего узла не должна
  // влиять на серию, которую отслеживает вызывающий уровень, и наоборот.
  //
  // Если ближайший (самый глубокий, ещё не закрытый) "утёкший" тег в
  // leakStack как раз входит в набор допустимых родителей — не считаем
  // подозрительным: это почти наверняка приём вёрстки под Outlook, где
  // <table><tr><td> намеренно разрублены на два условных комментария, и
  // "неправильный" структурный родитель — просто следствие того, что
  // реальный, допустимый родитель существует, просто не является ПРЯМЫМ
  // узлом-предком в дереве (лежит в другом условном комментарии).
  //
  // Намеренно смотрим только на САМУЮ БЛИЖНЮЮ (последнюю в стеке) запись,
  // а не на весь leakStack целиком: более дальние предки — это просто
  // РЕАЛЬНЫЕ структурные предки текущего узла где-то выше по дереву (сам
  // факт, что где-то выше есть открытый <table>, не означает, что
  // непосредственный родитель ЭТОГО узла — то же самое).
  private checkMissingParentGuard(node: Node, runTag: string | null): string | null {
    if (node.type !== "element") return null;
    const validParents = REQUIRED_PARENT[node.tagName.toLowerCase()];
    if (validParents === undefined) return null;
    const actualParent = (this.currentParentTagName ?? "").toLowerCase();
    if (validParents.includes(actualParent)) return null;
    const nearestLeak = this.leakStack[this.leakStack.length - 1];
    if (nearestLeak && validParents.includes(nearestLeak.tagName.toLowerCase())) return null;
    const required = validParents[0];
    if (runTag !== required) {
      this.suspectedMissingParents.push({ tagName: required, leakDepth: this.leakStack.length });
    }
    return required;
  }

  private renderNodes(nodes: Node[]): void {
    let i = 0;
    let runTag: string | null = null;
    while (i < nodes.length) {
      const node = nodes[i];

      if (isFlowNode(node)) {
        const segment: Node[] = [];
        while (i < nodes.length && isFlowNode(nodes[i])) {
          segment.push(nodes[i]);
          i++;
        }
        const text = collapseFlowWhitespace(segment.map(serializeFlow).join(""));
        if (text.length > 0) {
          // Все узлы сегмента (и их потомки — инлайн-теги внутри
          // инлайн-тегов, например <a><b>...) окажутся на ОДНОЙ строке
          // вместе, поэтому здесь именно checkEmptyAttrsDeep, а не Own.
          for (const flowNode of segment) this.checkEmptyAttrsDeep(flowNode);
          this.pushLine(this.indent() + text);
        }
        runTag = null;
        continue;
      }

      runTag = this.checkMissingParentGuard(node, runTag);
      this.checkEmptyAttrsOwn(node);
      this.renderBlockNode(node);
      i++;
    }
  }

  // Ищет среди "утёкших" тегов последний (самый недавний) с таким именем
  // — как и настоящие браузеры при разборе несбалансированной разметки.
  // Найденный тег и всё, что было открыто позже него (и тоже так и не
  // закрылось), считаются закрытыми разом. Возвращает глубину, на
  // которую нужно вернуться, либо null, если совпадения нет вовсе (тогда
  // это просто одиночный "ничей" тег, ни на что не влияющий).
  //
  // "Ничей" закрывающий тег почти всегда должен в первую очередь искать
  // пару в своём же "мире": если он сам стоит внутри условного
  // комментария (fromConditionalComment) — это обычно вторая половина
  // приёма table>tr>td, разрубленного на два условных комментария (см.
  // комментарий класса выше), и его законная пара тоже была открыта
  // внутри какого-то условного комментария (openedInConditionalComment).
  // И СИММЕТРИЧНО: обычный закрывающий тег из видимого контента (вне
  // всякого комментария) должен в первую очередь искать пару среди
  // тоже-обычных, некомментарийных записей — а не хватать первую попавшуюся
  // MSO-тройку только потому, что она "свежее" в стеке. Без этой симметрии
  // всего одна опечатка в обычном контенте (например, потерянный где-то
  // закрывающий тег, из-за которого настоящий закрывающий тег ВНЕШНЕЙ
  // обычной table сам стал "ничьим") может перехватить чужую MSO-пару и
  // утащить её за собой как побочный ущерб, хотя её настоящий закрывающий
  // тег в документе реально есть и просто должен резолвиться отдельно.
  // Если совпадения в "своём мире" не нашлось — откатываемся к обычному
  // поиску по всему стеку без разбора (не оставлять тег вовсе без пары,
  // если единственный кандидат — из другого мира).
  private resolveStrayClose(tagName: string, fromConditionalComment: boolean): number | null {
    const sameWorld = this.findAndResolveStray(
      tagName,
      (e) => e.openedInConditionalComment === fromConditionalComment,
    );
    if (sameWorld !== null) return sameWorld;
    // Если где-то раньше уже заподозрили пропущенного родителя с ТЕМ ЖЕ
    // именем (см. checkMissingParentGuard/suspectedMissingParentCounts) —
    // этот "ничей" закрывающий тег почти наверняка родная пара именно
    // ЕМУ, а не случайному постороннему тегу с тем же именем, оставшемуся
    // глубже в стеке. Не даём общему поиску "по всему стеку без разбора"
    // утащить чужое совпадение — пусть тег останется по-настоящему
    // ничьим (просто печатается на текущей глубине, без диагностики).
    // Иначе, например, вырезанный <table> из-за этого фолбэка закрывал бы
    // случайную ДАЛЁКУЮ вложенную таблицу где-то ещё в документе вместо
    // того, чтобы честно остаться на месте, где реально пропал.
    // Прежде чем включать вето ниже — проверяем НАСТОЯЩУЮ цепочку предков
    // текущей точки рендера (currentUnclosedAncestor -> parentEntry -> ...).
    // Если "ничей" закрывающий тег совпал по имени с одним из них, никакой
    // догадки тут вообще нет: мы физически находимся ВНУТРИ содержимого
    // этого тега прямо сейчас, и это гарантированно его пара.
    //
    // Реальный дефект, ради которого это появилось: вето ниже считает
    // "подозрения" ГЛОБАЛЬНО, по одному лишь имени тега и без всякой
    // привязки к месту в документе. Из-за этого одна осиротевшая ячейка
    // где-нибудь в начале письма (<table><td>x</td></table> — потерян
    // <tr>) отключала разрешение ПЕРВОГО же встреченного дальше "</tr>" —
    // в том числе абсолютно исправного MSO-моста в другом конце
    // документа. Ложные "незакрытые теги" при этом множились один к
    // одному: N осиротевших ячеек — N испорченных конструкций ниже.
    // Проверка по реальной цепочке предков не зависит ни от порядка в
    // стеке, ни от посторонних подозрений и снимает ровно эти случаи, не
    // трогая те, ради которых вето и вводилось (там совпавший тег лежит в
    // СОСЕДНЕЙ ветке документа, а не на цепочке предков — см.
    // регрессионный тест про вырезанный <table> в MSO-колонке).
    const ancestorMatch = this.findAncestorChainMatch(tagName);
    if (ancestorMatch !== null) return this.resolveMatchedEntry(ancestorMatch);
    const tagKey = tagName.toLowerCase();
    const candidateIndex = this.findStrayCandidateIndex(tagName, () => true);
    if (candidateIndex === -1) return null;
    const suspicionIndex = this.suspectedMissingParents.findIndex((s) => s.tagName === tagKey);
    if (suspicionIndex !== -1 && candidateIndex < this.suspectedMissingParents[suspicionIndex].leakDepth) {
      // Кандидат лежал в стеке ещё ДО того, как возникло подозрение —
      // значит, это посторонний, более ранний тег из другой части
      // документа (см. suspectedMissingParents). Гасим подозрение и
      // оставляем закрывающий тег по-настоящему "ничьим".
      this.suspectedMissingParents.splice(suspicionIndex, 1);
      return null;
    }
    return this.resolveMatchedEntry(this.leakStack[candidateIndex]);
  }

  // Куда на самом деле нужно предложить дописать закрывающий тег для
  // записи entry, если прямо сейчас она вытесняется из стека.
  //
  // Обычно это текущая строка. НО: если сам тег живёт в обычном, видимом
  // ВСЕМ почтовым клиентам контенте (openedInConditionalComment === false),
  // а вытесняется он уже ВНУТРИ outlook-конструкции, то текущая строка —
  // это строка внутри <!--[if mso]>...<![endif]-->, которую видит ТОЛЬКО
  // Outlook. Закрывающий тег, поставленный туда, для всех остальных
  // клиентов не существует: тег как был незакрытым, так и остаётся, —
  // при том что диагностика после такой "починки" показывает, что всё
  // чисто. Поэтому точку вставки переносим ПЕРЕД самым внешним из сейчас
  // открытых условных комментариев — там закрывающий тег увидят все.
  //
  // Все открытые сейчас комментарии заведомо начались ПОЗЖЕ самого тега
  // (он открылся вне их всех), поэтому нужен именно самый внешний —
  // элемент [0].
  private insertLineFor(entry: LeakEntry): number {
    if (
      !entry.openedInConditionalComment &&
      this.conditionalCommentStartLines.length > 0
    ) {
      return this.conditionalCommentStartLines[0];
    }
    return this.out.length;
  }

  // true, если предложенная для entry точка вставки (см. insertLineFor)
  // и правда оказывается внутри условного комментария. Для тега из
  // обычного контента это теперь всегда false — мы сознательно вынесли
  // точку наружу.
  private insertPointInsideConditionalComment(entry: LeakEntry): boolean {
    if (!entry.openedInConditionalComment && this.conditionalCommentStartLines.length > 0) {
      return false;
    }
    return this.conditionalCommentDepth > 0;
  }

  // Ближайший ещё не разрешённый предок с таким именем по НАСТОЯЩЕЙ
  // цепочке вложенности дерева разбора (не по стеку). См. resolveStrayClose.
  private findAncestorChainMatch(tagName: string): LeakEntry | null {
    const needle = tagName.toLowerCase();
    for (let cur = this.currentUnclosedAncestor; cur !== null; cur = cur.parentEntry) {
      if (!cur.resolved && cur.tagName.toLowerCase() === needle) return cur;
    }
    return null;
  }

  // Помечает найденную запись разрешённой, фиксирует "попутную" точку
  // вставки всему, что лежит в стеке ВЫШЕ неё, и обрезает стек.
  //
  // Всё, что было открыто ПОЗЖЕ найденного (индексы выше i), считается
  // закрытым разом вместе с ним (см. комментарий класса выше), но сами
  // эти записи по имени не "разрешились" — для подсказки "здесь пропущен
  // тег" фиксируем им точку, где это попутно произошло, если она ещё не
  // была зафиксирована раньше.
  //
  // Но "попутно" не всегда значит "ненадёжно": если запись k — по
  // НАСТОЯЩЕМУ дереву разбора потомок найденного тега (проверяем по
  // цепочке parentEntry, а не по совпадению чисел глубины — при сильно
  // перепутанной разметке две совершенно не связанные ветки документа
  // могут случайно идти подряд с монотонно растущей глубиной, это ничего
  // не доказывает), то это ровно тот же случай, что и обычное закрытие
  // предком — просто предок закрылся через "ничей" тег, а не через явный
  // </tag>. Пример: <div><span>text</div> — единственный "</div>" в
  // исходнике относится к div, а span — его настоящий прямой потомок,
  // так что позиция вставки для span настолько же надёжна, как если бы
  // div закрылся обычным образом. А если k — потомок какого-то СОВСЕМ
  // ДРУГОГО, не относящегося к matched элемента (просто оказался рядом на
  // стеке из-за путаницы в другом месте документа) — показывать точную
  // позицию вставки как решённое нельзя.
  private resolveMatchedEntry(matched: LeakEntry): number {
    matched.resolved = true;
    const i = this.leakStack.indexOf(matched);
    // Запись с цепочки предков в норме всегда лежит и в стеке, но при
    // сильно перепутанной разметке её могло вытеснить оттуда раньше —
    // тогда просто отдаём её глубину, ничего не обрезая.
    if (i === -1) return matched.popToDepth;
    for (let k = i + 1; k < this.leakStack.length; k++) {
      const collateral = this.leakStack[k];
      if (!collateral) continue;
      if (collateral.insertBeforeLine === Infinity) {
        collateral.insertBeforeLine = this.insertLineFor(collateral);
        collateral.closesInsideConditionalComment = this.insertPointInsideConditionalComment(collateral);
        collateral.insertConfidence =
          isDescendantOfEntry(collateral, matched) || isWrappedByOutlookBridge(collateral, matched)
            ? "reliable"
            : "uncertain";
      }
    }
    this.leakStack.length = i;
    return matched.popToDepth;
  }

  private findAndResolveStray(
    tagName: string,
    eligible: (entry: LeakEntry) => boolean,
  ): number | null {
    const i = this.findStrayCandidateIndex(tagName, eligible);
    if (i === -1) return null;
    // "Попутная" точка вставки для всего, что было открыто ПОЗЖЕ
    // найденного, проставляется внутри resolveMatchedEntry (см. там же
    // разбор случаев про isDescendantOfEntry).
    return this.resolveMatchedEntry(this.leakStack[i]);
  }

  // Индекс подходящей записи в leak-стеке БЕЗ каких-либо изменений
  // состояния — чтобы вызывающая сторона могла сперва решить, стоит ли
  // вообще принимать это совпадение (см. вето в resolveStrayClose).
  private findStrayCandidateIndex(
    tagName: string,
    eligible: (entry: LeakEntry) => boolean,
  ): number {
    for (let i = this.leakStack.length - 1; i >= 0; i--) {
      // this.leakStack[i] в норме никогда не бывает undefined (массив
      // либо растёт через push, либо укорачивается через это же
      // усечение), но при сильно перепутанной разметке — например,
      // одного вложенного незакрытого тега достаточно, чтобы парсер
      // "проглотил" все последующие настоящие закрывающие теги как его
      // детей — сюда снизу (см. leakMark в renderBlockNode) можно
      // попасть с уже урезанным массивом. Пропускаем дыру вместо падения.
      if (!this.leakStack[i]) continue;
      if (
        this.leakStack[i].tagName.toLowerCase() === tagName.toLowerCase() &&
        eligible(this.leakStack[i])
      ) {
        return i;
      }
    }
    return -1;
  }

  private renderBlockNode(node: Node): void {
    switch (node.type) {
      case "doctype": {
        this.pushLine(this.indent() + node.raw);
        return;
      }

      case "comment": {
        // Обычный комментарий: получает отступ текущего уровня, но не
        // создаёт собственной вложенности — его содержимое не трогаем.
        this.pushLine(this.indent() + `<!--${node.raw}-->`);
        return;
      }

      case "stray-close-tag": {
        const resolved = this.resolveStrayClose(node.tagName, this.conditionalCommentDepth > 0);
        if (resolved !== null) {
          this.depth = resolved;
        }
        // Совсем "ничей" тег (совпадения нет) печатается на текущей
        // глубине как есть, без диагностики — форматтер не выдумывает,
        // какой открывающий тег имелся в виду, это на усмотрение
        // пользователя. Иначе — на глубине найденного открывающего тега,
        // симметрично обычным закрывающим тегам.
        this.pushLine(this.indent() + node.raw);
        return;
      }

      case "mindbox-statement": {
        // @{set ...} / @{else} / @{elseif ...} — самостоятельная строка,
        // не открывающая и не закрывающая вложенность (см. типы в
        // types.ts и согласованные правила форматирования).
        this.pushLine(this.indent() + node.raw);
        return;
      }

      case "stray-mindbox-end": {
        // "Ничья" @{end for}/@{end if} — зеркало case "stray-close-tag"
        // выше, только по отдельному пространству имён MINDBOX_LEAK_LABEL
        // (чтобы никогда не совпасть по имени с настоящим HTML-тегом).
        const label = mindboxLeakLabel(node.kind);
        const resolved = this.resolveStrayClose(label, this.conditionalCommentDepth > 0);
        if (resolved !== null) {
          this.depth = resolved;
        }
        this.pushLine(this.indent() + node.raw);
        return;
      }

      case "conditional-comment": {
        if (this.options.collapseOutlookComments) {
          // Комментарий целиком (открывающая конструкция, содержимое и
          // закрывающая) схлопывается в одну строку и никак не влияет на
          // отступы окружающего документа — ни глубина, ни стек
          // незакрытых тегов не трогаются вовсе. Дети сюда не попадают
          // через обычную renderNodes-рекурсию — проверяем их отдельно,
          // все на эту же строку.
          for (const child of node.children) this.checkEmptyAttrsDeep(child);
          const inner = collapseFlowWhitespace(node.children.map(serializeCompact).join(""));
          const middle = inner.length > 0 ? ` ${inner} ` : "";
          this.pushLine(this.indent() + node.openRaw + middle + node.closeRaw);
          return;
        }

        const d = this.depth;
        // Строка САМОГО открывающего маркера — до pushLine, т.е. это его
        // будущий индекс в this.out (см. conditionalCommentStartLines).
        const openMarkerLine = this.out.length;
        this.pushLine(this.indent(d) + node.openRaw);
        this.depth = d + 1;
        this.conditionalCommentDepth++;
        this.conditionalCommentTextStack.push(node.openRaw);
        this.conditionalCommentStartLines.push(openMarkerLine);
        // Отметка стека ДО рендера детей — нужна, чтобы отличить два
        // разных случая ниже (см. комментарий у проверки leakStack).
        const leakMark = this.leakStack.length;
        this.renderNodes(node.children);
        this.conditionalCommentDepth--;
        this.conditionalCommentTextStack.pop();
        this.conditionalCommentStartLines.pop();
        // Если внутри всё аккуратно закрылось (глубина вернулась ровно к
        // d + 1, то есть к уровню собственного содержимого комментария),
        // закрывающий маркер выравниваем с открывающим — как обычный
        // парный блок.
        //
        // Стек мог и УМЕНЬШИТЬСЯ ниже leakMark — это значит, что "ничей"
        // тег ВНУТРИ этого комментария (см. resolveStrayClose) разрешил
        // запись, доставшуюся не от его собственных детей, а от кого-то
        // СНАРУЖИ, открытого ещё раньше (типичный приём вёрстки под
        // Outlook: table>tr>td открываются в одном условном комментарии, а
        // закрываются в другом, отдельном). this.depth в этот момент уже
        // равен popToDepth САМОЙ ВНЕШНЕЙ разрешённой записи (table — она
        // резолвится последней из тройки td>tr>table, поэтому её значение
        // и остаётся в this.depth к концу цикла) — а это ровно глубина, на
        // которой table САМ был напечатан, то есть на 1 больше глубины
        // ПЕРВОГО, открывающего комментария (её собственные дети — то
        // есть table — печатаются на d+1). Вычитаем эту единицу — и
        // получаем НАСТОЯЩИЙ уровень, на котором лежит весь этот блок
        // "открывающий комментарий + мостик + закрывающий комментарий" в
        // документе, а не уровень того, что в нём только что резолвилось.
        // Полагается на типичную структуру приёма (table — прямой
        // потомок самого условного комментария, без промежуточной
        // обёртки) — для неё это верно во всех реальных случаях в этой
        // кодовой базе.
        if (this.leakStack.length < leakMark) {
          this.depth = Math.max(0, this.depth - 1);
          this.pushLine(this.indent(this.depth) + node.closeRaw);
        } else if (this.depth === d + 1) {
          this.depth = d;
          this.pushLine(this.indent(d) + node.closeRaw);
        } else {
          this.pushLine(this.indent() + node.closeRaw);
        }
        return;
      }

      case "raw-text": {
        // script/pre/textarea: содержимое не трогаем вовсе (byte-for-byte),
        // меняем только отступ строки, где стоит открывающий тег.
        const attrs = node.attrsRaw ? " " + normalizeAttrsWhitespace(node.attrsRaw) : "";
        const openTag = `<${node.tagName}${attrs}>`;
        if (node.rawContent.trim().length === 0) {
          this.pushLine(this.indent() + `${openTag}</${node.tagName}>`);
        } else {
          this.pushLine(this.indent() + openTag + node.rawContent + `</${node.tagName}>`);
        }
        return;
      }

      case "style": {
        const attrs = node.attrsRaw ? " " + normalizeAttrsWhitespace(node.attrsRaw) : "";
        const openTag = `<${node.tagName}${attrs}>`;
        const cssLines = formatCss(node.rawContent);
        if (cssLines.length === 0) {
          this.pushLine(this.indent() + `${openTag}</${node.tagName}>`);
          return;
        }
        this.pushLine(this.indent() + openTag);
        for (const line of cssLines) {
          this.pushLine(line.length > 0 ? this.indent(this.depth + 1) + line : "");
        }
        this.pushLine(this.indent() + `</${node.tagName}>`);
        return;
      }

      case "mindbox-block": {
        // @{for ...}/@{if ...} ... @{end for}/@{end if} — те же правила
        // отступа и та же leak-механика, что у незакрытого HTML-тега
        // (см. case "element" ниже, ровно тот же алгоритм, только запись
        // в leak-стеке помечена MINDBOX_LEAK_LABEL, а не именем тега,
        // чтобы не пересечься по имени с настоящими HTML-тегами и чтобы
        // диагностика "незакрытый тег" отличала конструкцию от тега —
        // см. mindboxLeakLabel/isMindboxLeakLabel).
        const d = this.depth;
        this.pushLine(this.indent(d) + node.openRaw);
        const leakMark = this.leakStack.length;
        let ownEntry: LeakEntry | null = null;
        if (!node.explicitlyClosed) {
          ownEntry = {
            tagName: mindboxLeakLabel(node.kind),
            popToDepth: d,
            line: this.out.length - 1,
            resolved: false,
            insertBeforeLine: Infinity,
            insertConfidence: "reliable",
            parentEntry: this.currentUnclosedAncestor,
            openedInConditionalComment: this.conditionalCommentDepth > 0,
            openedInConditionalCommentText:
              this.conditionalCommentTextStack[this.conditionalCommentTextStack.length - 1] ?? null,
            closesInsideConditionalComment: false,
          };
          this.leakStack.push(ownEntry);
          this.allLeakEntries.push(ownEntry);
        }
        this.depth = d + 1;
        if (node.children.length > 0) {
          if (ownEntry) {
            const savedAncestor = this.currentUnclosedAncestor;
            this.currentUnclosedAncestor = ownEntry;
            this.renderNodes(node.children);
            this.currentUnclosedAncestor = savedAncestor;
          } else {
            this.renderNodes(node.children);
          }
        }

        if (node.explicitlyClosed) {
          const prunedFrom = Math.min(leakMark, this.leakStack.length);
          for (let k = prunedFrom; k < this.leakStack.length; k++) {
            const pruned = this.leakStack[k];
            if (pruned && pruned.insertBeforeLine === Infinity) {
              pruned.insertBeforeLine = this.insertLineFor(pruned);
              pruned.closesInsideConditionalComment = this.insertPointInsideConditionalComment(pruned);
            }
          }
          this.leakStack.length = prunedFrom;
          this.depth = d;
          this.pushLine(this.indent(d) + node.closeRaw);
        }
        return;
      }

      case "element": {
        if (node.voidElement || node.selfClosed) {
          this.pushLine(this.indent() + openTagString(node));
          return;
        }

        if (node.explicitlyClosed && node.children.length === 0) {
          this.pushLine(this.indent() + openTagString(node) + `</${node.tagName}>`);
          return;
        }

        // Если всё содержимое элемента — поток (текст/инлайн-теги, без
        // блочных потомков), держим его на одной строке целиком: это и
        // читаемо, и не может изменить рендер (в отличие от разрыва
        // инлайн-контента на отдельные строки). Такой контент по
        // построению не может ничего "утечь" — hasOnlyInlineFlowContent
        // требует explicitlyClosed на каждом уровне. Исключение — теги из
        // isNeverCollapseElement (сейчас только <td>): для них открывающий
        // и закрывающий тег всегда на отдельных строках, даже если внутри
        // просто текст.
        if (
          node.explicitlyClosed &&
          !isNeverCollapseElement(node.tagName) &&
          hasOnlyInlineFlowContent(node)
        ) {
          // node сам уже проверен (см. checkEmptyAttrsOwn в renderNodes,
          // вызывается перед диспетчеризацией сюда) — здесь только его
          // ДЕТИ, они на эту же итоговую строку не проходят через
          // renderNodes самостоятельно (см. checkEmptyAttrsDeep выше).
          for (const child of node.children) this.checkEmptyAttrsDeep(child);
          const text = collapseFlowWhitespace(node.children.map(serializeFlow).join(""));
          this.pushLine(this.indent() + openTagString(node) + text + `</${node.tagName}>`);
          return;
        }

        const d = this.depth;
        this.pushLine(this.indent(d) + openTagString(node));
        // Незакрытый тег кладём в стек СРАЗУ при открытии (в реальном
        // порядке документа), а не задним числом после обработки детей —
        // иначе для цепочки вложенных незакрытых тегов (table>tr>td)
        // порядок в стеке перевернулся бы: td (самый внутренний) попал бы
        // туда раньше table (самого внешнего), хотя на самом деле именно
        // td открыт позже и должен закрываться первым. Для тегов,
        // закрытых по-настоящему (explicitlyClosed), это уже известно
        // заранее из парсинга — свою запись в стек не кладём вовсе, нужно
        // будет только вычистить то, что успело "утечь" из детей.
        const leakMark = this.leakStack.length;
        let ownEntry: LeakEntry | null = null;
        if (!node.explicitlyClosed) {
          ownEntry = {
            tagName: node.tagName,
            popToDepth: d,
            line: this.out.length - 1,
            resolved: false,
            insertBeforeLine: Infinity,
            // По умолчанию "reliable" — так и останется, если запись
            // вытеснится закрытием своего предка или долежит до конца
            // документа. Понижается до "uncertain" только в одном месте
            // — resolveStrayClose, если её случайно утащило чужое
            // совпадение (см. там).
            insertConfidence: "reliable",
            parentEntry: this.currentUnclosedAncestor,
            openedInConditionalComment: this.conditionalCommentDepth > 0,
            openedInConditionalCommentText:
              this.conditionalCommentTextStack[this.conditionalCommentTextStack.length - 1] ?? null,
            closesInsideConditionalComment: false,
          };
          this.leakStack.push(ownEntry);
          this.allLeakEntries.push(ownEntry);
        }
        this.depth = d + 1;
        if (node.children.length > 0) {
          // currentParentTagName обновляем БЕЗУСЛОВНО (в отличие от
          // currentUnclosedAncestor выше) — для checkMissingParentGuard
          // важен РЕАЛЬНЫЙ структурный родитель в дереве, а он есть
          // всегда, закрылся тег явно или нет.
          const savedParentTagName = this.currentParentTagName;
          this.currentParentTagName = node.tagName.toLowerCase();
          // Пока рендерим детей НЕЗАКРЫТОГО тега, он сам становится
          // ближайшим "утёкшим" предком для них (см. LeakEntry.parentEntry).
          // Для explicitlyClosed тегов ownEntry остаётся null — у них нет
          // записи в стеке, и ближайший утёкший предок для их детей не
          // меняется (наследуется снаружи).
          if (ownEntry) {
            const savedAncestor = this.currentUnclosedAncestor;
            this.currentUnclosedAncestor = ownEntry;
            this.renderNodes(node.children);
            this.currentUnclosedAncestor = savedAncestor;
          } else {
            this.renderNodes(node.children);
          }
          this.currentParentTagName = savedParentTagName;
        }

        if (node.explicitlyClosed) {
          // Тег реально закрылся в исходнике — значит, всё, что осталось
          // "утёкшим" внутри него (не закрытые дочерние теги), браузер
          // тоже неявно закрыл бы вместе с ним. Убираем их из стека,
          // чтобы случайный одноимённый "ничей" тег где-то дальше по
          // документу не сматчился с уже закрытым контекстом (для
          // диагностики "незакрытый тег" они всё равно остаются
          // помеченными как unresolved — неявное закрытие предком не
          // равнозначно настоящему закрывающему тегу, см. getUnclosedTags).
          //
          // Math.min — намеренно: при сильно перепутанной разметке
          // "ничей" закрывающий тег из ЕЩЁ не обработанных детей этого
          // элемента может успеть сматчиться с записью, которая была в
          // стеке ЕЩЁ ДО leakMark (см. resolveStrayClose — он ищет по
          // всему стеку, не только "внутри" текущего элемента). Тогда
          // текущая длина стека уже меньше leakMark, и присвоение
          // leakStack.length = leakMark не обрежет массив, а НАРАСТИТ
          // его пустыми дырами (стандартное поведение JS для
          // array.length = N при N больше текущей длины) — ровно это и
          // приводило к падению на .tagName у дыры чуть позже.
          const prunedFrom = Math.min(leakMark, this.leakStack.length);
          // Прежде чем обрезать — запоминаем каждой ещё не разрешённой
          // записи, что её неявно закрыли бы прямо тут (перед строкой с
          // закрывающим тегом текущего элемента, которую пушим ниже).
          for (let k = prunedFrom; k < this.leakStack.length; k++) {
            const pruned = this.leakStack[k];
            if (pruned && pruned.insertBeforeLine === Infinity) {
              pruned.insertBeforeLine = this.insertLineFor(pruned);
              pruned.closesInsideConditionalComment = this.insertPointInsideConditionalComment(pruned);
            }
          }
          this.leakStack.length = prunedFrom;
          this.depth = d;
          this.pushLine(this.indent(d) + `</${node.tagName}>`);
        }
        // Если тег НЕ закрылся явно — ничего дополнительно не делаем:
        // его запись уже в стеке (см. выше), закрывающий тег не сочиняем,
        // а глубина не возвращается назад — она "утекает" во всё, что
        // идёт дальше, пока не найдётся настоящий парный close.
        return;
      }
    }
  }
}

export interface FormatOptions {
  // "Сжать комментарии для Outlook": условные комментарии
  // (<!--[if ...]>...<![endif]-->) целиком схлопываются в одну строку
  // (открывающая конструкция, содержимое и закрывающая), не влияя на
  // отступы окружающего документа. Выключено по умолчанию — по умолчанию
  // условные комментарии участвуют в иерархии как полноценные теги
  // (см. предыдущую задачу).
  collapseOutlookComments?: boolean;
  // "Типограф": расстановка неразрывных пробелов, замена прямых кавычек
  // на «ёлочки» и дефиса между словами на длинное тире — только в
  // текстовых узлах (теги/атрибуты/script/pre/style/комментарии не
  // трогаются). Применяется только там, где рядом есть кириллица —
  // см. src/typograf.ts. Включено по умолчанию.
  typografy?: boolean;
  // "Очистка лишнего кода": убирает теги <tbody>/</tbody> (разворачивает
  // — тег убирается, содержимое остаётся на его месте), class="esd-text"
  // (убирается целиком; если у тега есть другие классы — остаются только
  // они) и заменяет &#39; на настоящий апостроф. См. src/serviceCleanup.ts.
  // Включено по умолчанию.
  cleanServiceAttrs?: boolean;
}

type ResolvedFormatOptions = Required<FormatOptions>;

const DEFAULT_OPTIONS: ResolvedFormatOptions = {
  collapseOutlookComments: false,
  typografy: true,
  cleanServiceAttrs: true,
};

// true, если сосед (node) сам по себе — инлайн-элемент (span/a/b/em/...):
// рядом с ним текст — обычный поток человеческого текста, что бы ни было
// с ДРУГОЙ стороны. undefined (края у списка детей нет) инлайном не
// считается — это "нейтральный" случай, см. applyTypographyToTree.
function isInlineNeighbor(node: Node | undefined): boolean {
  return node !== undefined && node.type === "element" && node.inline;
}

// true, если сосед — настоящий "блочный сигнал": то, что всегда стоит на
// отдельной строке (любой НЕ-инлайн тег, комментарий, условный
// комментарий, Mindbox-конструкция и т.п.). undefined (края нет) СЮДА НЕ
// СЧИТАЕТСЯ намеренно — иначе текст, который является ЕДИНСТВЕННЫМ
// содержимым обычного <p>/<span>/<td> (оба соседа отсутствуют), ошибочно
// считался бы "голым между блоками" только потому, что у него нет
// соседей вовсе — а такой текст почти всегда настоящий контент. Нужен
// хотя бы ОДИН реальный блочный сосед, не просто отсутствие соседей.
function isBlockNeighborSignal(node: Node | undefined): boolean {
  if (!node) return false;
  if (node.type === "element") return !node.inline;
  if (node.type === "text") return false;
  return true;
}

// Применяет типограф ко всем текстовым узлам дерева (мутирует их value
// на месте — доc, полученный из parseHtml, создаётся заново на каждый
// вызов formatHtml и никем больше не используется, так что мутация
// безопасна). Теги/атрибуты/содержимое script,pre,style и обычные
// комментарии не входят в число текстовых узлов вовсе, поэтому их
// заведомо не трогаем — обходить их отдельно не нужно.
//
// Текстовый узел, "голый" между блочными тегами — реальный случай:
// "$(if [Field: Tier] == "BASIC")" сидит прямо между двумя <table>
// (закрывающим тегом одной и открывающим следующей), не внутри td/span/p
// — в 99% случаев это НЕ настоящий контент, который увидит получатель
// письма, а служебная разметка стороннего шаблонизатора, синтаксис
// которого мы можем вообще не знать. Условие — ни с одной стороны нет
// инлайн-элемента (см. isInlineNeighbor — иначе это обычный поток текста)
// И хотя бы с одной стороны есть настоящий блочный сосед (см.
// isBlockNeighborSignal — иначе это просто одинокий текст внутри
// обычного контейнера, почти наверняка настоящий контент). В отличие от
// защиты по $()/{}/[] (см. INTERPOLATION_RE в typograf.ts, действует по
// СОДЕРЖИМОМУ независимо от позиции), это защита по ПОЗИЦИИ независимо
// от содержимого — работает и для синтаксиса, который мы никогда не
// видели, если он просто оказывается "голым" текстом между блочными
// тегами. Согласовано с пользователем: осознанно допускаем редкий риск
// пропустить настоящий, но неудачно свёрстанный голый текст без обёртки
// — компромисс в пользу более широкого покрытия.
function applyTypographyToTree(nodes: Node[], stats: TypografStats): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === "text") {
      const prev = nodes[i - 1];
      const next = nodes[i + 1];
      const isBareBetweenBlocks =
        !isInlineNeighbor(prev) &&
        !isInlineNeighbor(next) &&
        (isBlockNeighborSignal(prev) || isBlockNeighborSignal(next));
      if (!isBareBetweenBlocks) {
        node.value = applyTypography(node.value, stats);
        // Предлог/короткое слово — последнее "слово" ЭТОГО узла, а
        // реальное следующее слово лежит уже внутри соседнего инлайн-тега
        // (см. glueTrailingClingingWordBeforeInline в typograf.ts) — сам
        // applyTypography такое не видит, он не знает про соседей по дереву.
        if (isInlineNeighbor(next)) {
          node.value = glueTrailingClingingWordBeforeInline(node.value, stats);
        }
      }
    } else if (
      node.type === "element" ||
      node.type === "conditional-comment" ||
      node.type === "mindbox-block"
    ) {
      applyTypographyToTree(node.children, stats);
    }
  }
}

// Сырые счётчики (см. TypografStats/ServiceCleanupStats) в человекочитаемый
// список "подпись: количество" для сводных плашек в веб-интерфейсе —
// пункты с нулевым счётчиком в список не попадают вовсе (см. запрос
// пользователя: "если 0 раз — не упоминаем").
export interface CountedItem {
  label: string;
  count: number;
}

function typografStatsToItems(stats: TypografStats): CountedItem[] {
  const items: CountedItem[] = [];
  if (stats.nbsp > 0) items.push({ label: "Неразрывные пробелы", count: stats.nbsp });
  if (stats.dash > 0) items.push({ label: "Тире вместо дефиса", count: stats.dash });
  if (stats.quotes > 0) items.push({ label: "Кавычки «ёлочки» вместо «лапок»", count: stats.quotes });
  return items;
}

function serviceCleanupStatsToItems(stats: ServiceCleanupStats): CountedItem[] {
  const items: CountedItem[] = [];
  if (stats.esdTextClass > 0) items.push({ label: 'class="esd-text"', count: stats.esdTextClass });
  if (stats.tbody > 0) items.push({ label: "<tbody>", count: stats.tbody });
  if (stats.apostropheEntity > 0) {
    items.push({ label: "&#39; заменено на апостроф", count: stats.apostropheEntity });
  }
  return items;
}

export interface FormatResult {
  html: string;
  // Теги, для которых нигде в документе не нашлось настоящего
  // закрывающего тега (ни обычного </tag>, ни "ничьего" — даже в другом
  // условном комментарии). Пустой массив — незакрытых тегов нет.
  unclosedTags: UnclosedTagInfo[];
  // То же самое, но сгруппированное в цепочки (см. UnclosedTagGroup) —
  // основной источник данных для веб-интерфейса (попапы/статус); плоский
  // unclosedTags выше сохранён как есть для обратной совместимости и
  // существующих тестов.
  unclosedTagGroups: UnclosedTagGroup[];
  // Атрибуты из EMPTY_ATTR_NAMES, встреченные с пустым значением ("" или
  // ''), сгруппированные по имени — раздельно по категориям (см.
  // categorizeEmptyAttr): emptyAttrsToFill — самим не вывести значение,
  // нужно решение человека (href/target/src/background, а также width у
  // <img>); emptyAttrsToDelete — безопасно удалить атрибут целиком
  // (остальные, включая width НЕ у <img>). Пустой массив — таких нет.
  emptyAttrsToFill: EmptyAttrGroup[];
  emptyAttrsToDelete: EmptyAttrGroup[];
  // Одиночные (без пары) кавычки внутри значений атрибутов (см.
  // QuoteIssue/findQuoteIssues выше) — чисто информационная диагностика,
  // без попапа с предложением что-то поменять: unclosedQuoteAttrs —
  // значение НАЧАЛОСЬ с кавычки, но её пара не нашлась (или "проглотила"
  // соседний атрибут); unopenedQuoteAttrs — кавычка затесалась внутрь
  // значения БЕЗ кавычек, значит где-то забыли открывающую пару. Пустой
  // массив — таких нет. На саму структуру дерева/тегов эти кавычки уже не
  // влияют (см. justSawEquals в parser.ts).
  unclosedQuoteAttrs: QuoteIssueGroup[];
  unopenedQuoteAttrs: QuoteIssueGroup[];
  // Сводки для плашек "Удалены (не влияет на вёрстку):" и "Типографика
  // готова:" в веб-интерфейсе (см. typografStatsToItems/
  // serviceCleanupStatsToItems выше) — пустой массив, если соответствующая
  // опция была выключена или ничего менять не потребовалось.
  removedServiceItems: CountedItem[];
  typografyItems: CountedItem[];
}

export function formatHtmlWithDiagnostics(
  source: string,
  options: FormatOptions = {},
): FormatResult {
  const doc = parseHtml(source);
  const resolved: ResolvedFormatOptions = { ...DEFAULT_OPTIONS, ...options };
  const serviceCleanupStats: ServiceCleanupStats = { esdTextClass: 0, tbody: 0, apostropheEntity: 0 };
  if (resolved.cleanServiceAttrs) {
    doc.children = applyServiceCleanup(doc.children, serviceCleanupStats);
  }
  const typografStats: TypografStats = { nbsp: 0, dash: 0, quotes: 0 };
  if (resolved.typografy) {
    applyTypographyToTree(doc.children, typografStats);
  }
  const renderer = new Renderer(resolved);
  const html = renderer.render(doc.children);
  return {
    html,
    unclosedTags: renderer.getUnclosedTags(),
    unclosedTagGroups: renderer.getUnclosedTagGroups(),
    emptyAttrsToFill: renderer.getEmptyAttrsToFill(),
    emptyAttrsToDelete: renderer.getEmptyAttrsToDelete(),
    unclosedQuoteAttrs: renderer.getUnclosedQuoteAttrs(),
    unopenedQuoteAttrs: renderer.getUnopenedQuoteAttrs(),
    removedServiceItems: serviceCleanupStatsToItems(serviceCleanupStats),
    typografyItems: typografStatsToItems(typografStats),
  };
}

export function formatHtml(source: string, options: FormatOptions = {}): string {
  return formatHtmlWithDiagnostics(source, options).html;
}
