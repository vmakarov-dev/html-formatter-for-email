import { parseHtml, normalizeAttrsWhitespace } from "./parser.js";
import { formatCss } from "./cssFormatter.js";
import { isNeverCollapseElement } from "./htmlTags.js";
import { applyTypography, TypografStats } from "./typograf.js";
import { applyServiceCleanup, ServiceCleanupStats } from "./serviceCleanup.js";
import { REQUIRED_PARENT } from "./unopenedTags.js";
import { ElementNode, Node } from "./types.js";

const INDENT_UNIT = "  ";

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

// normalizeAttrsWhitespace — намеренно ЗДЕСЬ, при сборке строки для
// ВЫВОДА, а не на этапе парсинга (см. комментарий у самой функции в
// parser.ts): node.attrsRaw в дереве всегда сырой, схлопывание нужно
// только тегу, который печатается одной строкой.
function openTagString(node: ElementNode): string {
  const attrs = node.attrsRaw ? " " + normalizeAttrsWhitespace(node.attrsRaw) : "";
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
function collapseFlowWhitespace(text: string): string {
  let result = "";
  let inTag = false;
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inTag) {
      result += c;
      if (inSingle) {
        if (c === "'") inSingle = false;
      } else if (inDouble) {
        if (c === '"') inDouble = false;
      } else if (c === "'") {
        inSingle = true;
      } else if (c === '"') {
        inDouble = true;
      } else if (c === ">") {
        inTag = false;
      }
      i++;
      continue;
    }
    if (c === "<") {
      inTag = true;
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

// Зеркальная диагностика к UnclosedTagInfo: не "тег без пары", а "тег,
// перед которым пропущен родитель" (например, <td>, чей единственный
// осмысленный родитель — <tr>, но сейчас его реальный родитель в дереве
// — <table>/<tbody>, потому что <tr> в исходнике вырезали). См.
// checkUnopenedChild ниже и REQUIRED_PARENT в unopenedTags.ts — там же
// объяснение, почему обнаружение устроено иначе, чем у незакрытых тегов.
export interface UnopenedTagInfo {
  tagName: string; // какого тега не хватает (например, "tr")
  // 0-based номер строки, ПЕРЕД которой предположительно должен был бы
  // стоять открывающий тег — та же строка, где сейчас печатается первый
  // "потерявшийся" ребёнок серии (см. REQUIRED_PARENT).
  insertBeforeLine: number;
  // Уровень отступа для предполагаемого открывающего тега.
  depth: number;
  // Если дальше по документу нашёлся "ничей" закрывающий тег с тем же
  // именем, который так и не сматчился ни с одним настоящим открытым
  // предком (см. ExtraTagInfo и разбор пары в case "stray-close-tag"),
  // это, скорее всего, ДВЕ стороны одной и той же правки — кто-то вырезал
  // сам открывающий тег, а закрывающий по невнимательности оставил.
  // pairId — общий идентификатор для UI: он же будет и у соответствующей
  // записи в ExtraTagInfo, чтобы решение по одной из двух подсказок
  // ("Добавить?"/"Удалить?") снимало и вторую тоже — они предлагают два
  // взаимоисключающих способа починить один и тот же дефект. undefined —
  // пары не нашлось, показываем только "Добавить?".
  pairId?: number;
}

// Обратная сторона пары к UnopenedTagInfo (см. pairId там же) — "ничей"
// закрывающий тег, СОВСЕМ не нашедший себе открывающего (ни настоящего в
// this.leakStack, ни просто более раннего по документу, см.
// resolveStrayClose), но при этом его имя совпадает с тегом, который
// ГДЕ-ТО РАНЬШЕ уже был отмечен как "неоткрытый" (см. checkUnopenedChild
// и pendingUnopenedByTag). Обе диагностики описывают одну и ту же
// правку с двух сторон: можно либо вставить недостающий открывающий тег
// (UnopenedTagInfo), либо убрать вот этот, оставшийся без пары,
// закрывающий (этот интерфейс) — какой вариант ближе к тому, что
// пользователь имел в виду на самом деле, решает он сам в UI.
export interface ExtraTagInfo {
  tagName: string;
  // 0-based номер строки, где напечатан сам "лишний" закрывающий тег —
  // в отличие от UnopenedTagInfo.insertBeforeLine (место для ВСТАВКИ
  // нового текста), здесь это строка уже СУЩЕСТВУЮЩЕГО в выводе тега,
  // которую предлагается удалить целиком.
  line: number;
  depth: number;
  pairId: number;
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
  // Имя тега РЕАЛЬНОГО (структурного) родителя текущей точки рендера —
  // не спутывать с currentUnclosedAncestor (тот — ближайший НЕЗАКРЫТЫЙ
  // предок, для утечки глубины). Обновляется вокруг рекурсии в детей
  // ЛЮБОГО элемента (закрытого или нет), но НЕ вокруг условных
  // комментариев — они "прозрачны" для этой проверки (см.
  // checkUnopenedChild): комментарий — не настоящий HTML-тег, реальным
  // родителем его содержимого считается ближайший настоящий тег снаружи.
  private currentParentTagName: string | null = null;
  private unopenedTags: UnopenedTagInfo[] = [];
  private extraTags: ExtraTagInfo[] = [];
  // Очередь ещё не сматченных UnopenedTagInfo-записей, по имени
  // недостающего тега — FIFO (не LIFO, как this.leakStack): пропущенные
  // открывающие теги логически паруются с ближайшим ПОСЛЕДУЮЩИМ "ничьим"
  // закрывающим тегом того же имени в порядке появления по документу, а
  // не как обычная вложенность (см. case "stray-close-tag").
  private pendingUnopenedByTag = new Map<string, UnopenedTagInfo[]>();
  private nextPairId = 1;
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

  constructor(private readonly options: ResolvedFormatOptions) {}

  render(nodes: Node[]): string {
    this.renderNodes(nodes);
    // Всё, что осталось в стеке к самому концу документа (не закрылось и
    // не было вытеснено закрытием предка), "закрылось" бы неявно только
    // в самом конце — используем это как точку вставки подсказки.
    for (const entry of this.leakStack) {
      if (entry && entry.insertBeforeLine === Infinity) {
        entry.insertBeforeLine = this.out.length;
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

  getUnopenedTags(): UnopenedTagInfo[] {
    return this.unopenedTags;
  }

  getExtraTags(): ExtraTagInfo[] {
    return this.extraTags;
  }

  getEmptyAttrsToFill(): EmptyAttrGroup[] {
    return [...this.emptyAttrsFillByName.entries()].map(([attrName, lines]) => ({ attrName, lines }));
  }

  getEmptyAttrsToDelete(): EmptyAttrGroup[] {
    return [...this.emptyAttrsDeleteByName.entries()].map(([attrName, lines]) => ({ attrName, lines }));
  }

  private indent(depth = this.depth): string {
    return INDENT_UNIT.repeat(depth);
  }

  // ЕДИНСТВЕННЫЙ способ класть готовую строку в this.out — вся
  // диагностика (номера строк в UnclosedTagInfo/UnopenedTagInfo/
  // ExtraTagInfo/EmptyAttrGroup — это индексы this.out) держится на
  // инварианте "один элемент this.out — ровно одна визуальная строка
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
  // индекс строки, на которой вот-вот напечатается ЕГО открывающий тег
  // (см. вызовы ниже: тот же принцип, что и у checkUnopenedChild). Детей
  // такого узла эта функция не трогает — они либо получат свой
  // собственный вызов через обычную рекурсию renderNodes (обычные
  // блочные потомки), либо их нужно обойти отдельно через
  // checkEmptyAttrsDeep (инлайн-поток, схлопнутый в одну строку, — там
  // дети НЕ проходят через renderNodes самостоятельно).
  private checkEmptyAttrsOwn(node: Node): void {
    if (node.type !== "element" && node.type !== "raw-text" && node.type !== "style") return;
    if (!node.attrsRaw) return;
    const names = findEmptyAttrNames(node.attrsRaw);
    if (names.length === 0) return;
    const line = this.out.length;
    for (const name of names) {
      const map =
        categorizeEmptyAttr(name, node.tagName) === "fill"
          ? this.emptyAttrsFillByName
          : this.emptyAttrsDeleteByName;
      const list = map.get(name);
      if (list) list.push(line);
      else map.set(name, [line]);
    }
  }

  // Рекурсивно проверяет узел И ВСЕХ его потомков, приписывая им одну и
  // ту же строку — для случаев, когда всё поддерево печатается на ОДНОЙ
  // строке вывода и потому не проходит через обычную построчную
  // рекурсию renderNodes самостоятельно (инлайн-поток/схлопнутый
  // условный комментарий, см. вызовы в renderBlockNode).
  private checkEmptyAttrsDeep(node: Node): void {
    this.checkEmptyAttrsOwn(node);
    if (node.type === "element" || node.type === "conditional-comment") {
      for (const child of node.children) this.checkEmptyAttrsDeep(child);
    }
  }

  // Проверяет ОДНОГО ребёнка (см. REQUIRED_PARENT в unopenedTags.ts): не
  // потерялся ли перед ним родитель. runTag передаётся по ссылке через
  // возвращаемое значение — вызывающая сторона (renderNodes) хранит его
  // как ЛОКАЛЬНУЮ переменную (не поле класса!), потому что серия
  // однотипных пропусков считается только среди СОСЕДЕЙ одного и того же
  // списка детей — рекурсия в детей текущего узла не должна влиять на
  // серию, которую отслеживает вызывающий уровень, и наоборот.
  //
  // Если ближайший (самый глубокий, ещё не закрытый) "утёкший" тег в
  // leakStack как раз входит в набор допустимых родителей — не флагуем:
  // это почти наверняка приём вёрстки под Outlook, где <table><tr><td>
  // намеренно разрублены на два условных комментария, и "неправильный"
  // структурный родитель — просто следствие того, что реальный,
  // допустимый родитель существует, просто не является ПРЯМЫМ
  // узлом-предком в дереве (лежит в другом условном комментарии). Ложно
  // принять эту легитимную конструкцию за баг было бы хуже, чем изредка
  // пропустить настоящий.
  //
  // Намеренно смотрим только на САМУЮ БЛИЖНЮЮ (последнюю в стеке) запись,
  // а не на весь leakStack целиком: более дальние предки — это просто
  // РЕАЛЬНЫЕ структурные предки текущего узла где-то выше по дереву (сам
  // факт, что где-то выше есть открытый <table>, не означает, что
  // непосредственный родитель ЭТОГО узла — то же самое; например,
  // отдельная вложенная MSO-обёртка может держать в стеке свой <table>,
  // пока внутри нее совсем в другом месте у РЕАЛЬНОГО контента пропущен
  // свой собственный, отдельный <table>). Проверка "есть ли где-то в
  // стеке" ловила такие случаи как ложное совпадение и глушила настоящий
  // баг.
  private checkUnopenedChild(node: Node, runTag: string | null): string | null {
    if (node.type !== "element") return null;
    const validParents = REQUIRED_PARENT[node.tagName.toLowerCase()];
    if (validParents === undefined) return null;
    const actualParent = (this.currentParentTagName ?? "").toLowerCase();
    if (validParents.includes(actualParent)) return null;
    const nearestLeak = this.leakStack[this.leakStack.length - 1];
    if (nearestLeak && validParents.includes(nearestLeak.tagName.toLowerCase())) return null;
    const required = validParents[0];
    if (runTag !== required) {
      const entry: UnopenedTagInfo = { tagName: required, insertBeforeLine: this.out.length, depth: this.depth };
      this.unopenedTags.push(entry);
      const queue = this.pendingUnopenedByTag.get(required);
      if (queue) {
        queue.push(entry);
      } else {
        this.pendingUnopenedByTag.set(required, [entry]);
      }
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

      runTag = this.checkUnopenedChild(node, runTag);
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
    // Если где-то раньше уже отметили пропущенного родителя с ТЕМ ЖЕ
    // именем (см. checkUnopenedChild/pendingUnopenedByTag) — этот "ничей"
    // закрывающий тег почти наверняка родная пара именно ЕМУ, а не
    // случайному постороннему тегу с тем же именем, оставшемуся глубже в
    // стеке. Не даём общему поиску "по всему стеку без разбора" утащить
    // чужое совпадение — пусть тег останется по-настоящему ничьим, и его
    // подхватит пара pendingUnopenedByTag/extraTags (см. case
    // "stray-close-tag" ниже). Иначе, например, вырезанный <table> из-за
    // этого фолбэка закрывал бы случайную ДАЛЁКУЮ вложенную таблицу
    // где-то ещё в документе вместо того, чтобы честно предложить
    // вставить пропущенный <table> ровно там, где он пропал.
    if ((this.pendingUnopenedByTag.get(tagName.toLowerCase())?.length ?? 0) > 0) return null;
    return this.findAndResolveStray(tagName, () => true);
  }

  private findAndResolveStray(
    tagName: string,
    eligible: (entry: LeakEntry) => boolean,
  ): number | null {
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
        const matched = this.leakStack[i];
        matched.resolved = true;
        const popToDepth = matched.popToDepth;
        // Всё, что было открыто ПОЗЖЕ найденного (индексы выше i),
        // считается закрытым разом вместе с ним (см. комментарий класса
        // выше), но сами эти записи по имени не "разрешились" — для
        // подсказки "здесь пропущен тег" фиксируем им точку, где это
        // попутно произошло, если она ещё не была зафиксирована раньше.
        //
        // Но "попутно" не всегда значит "ненадёжно": если запись k — по
        // НАСТОЯЩЕМУ дереву разбора потомок найденного тега (проверяем по
        // цепочке parentEntry, а не по совпадению чисел глубины — при
        // сильно перепутанной разметке две совершенно не связанные ветки
        // документа могут случайно идти подряд с монотонно растущей
        // глубиной, это ничего не доказывает), то это ровно тот же
        // случай, что и обычное закрытие предком — просто предок закрылся
        // через "ничей" тег, а не через явный </tag>. Пример:
        // <div><span>text</div> — единственный "</div>" в исходнике
        // относится к div, а span — его настоящий прямой потомок, так что
        // позиция вставки для span настолько же надёжна, как если бы div
        // закрылся обычным образом. А если k — потомок какого-то СОВСЕМ
        // ДРУГОГО, не относящегося к matched элемента (просто оказался
        // рядом на стеке из-за путаницы в другом месте документа) —
        // показывать точную позицию вставки как решённое нельзя.
        for (let k = i + 1; k < this.leakStack.length; k++) {
          const collateral = this.leakStack[k];
          if (!collateral) continue;
          if (collateral.insertBeforeLine === Infinity) {
            collateral.insertBeforeLine = this.out.length;
            collateral.insertConfidence = isDescendantOfEntry(collateral, matched)
              ? "reliable"
              : "uncertain";
          }
        }
        this.leakStack.length = i;
        return popToDepth;
      }
    }
    return null;
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
        } else {
          // Совсем "ничей" тег — не нашлось ни настоящего открытого
          // предка, ни чужого совпадения. Если при этом где-то раньше
          // уже отметили пропущенный открывающий тег с ТЕМ ЖЕ именем
          // (см. checkUnopenedChild/pendingUnopenedByTag) — это, скорее
          // всего, две стороны одной правки: свяжем их общим pairId (см.
          // UnopenedTagInfo.pairId) для UI.
          const queue = this.pendingUnopenedByTag.get(node.tagName.toLowerCase());
          const paired = queue?.shift();
          if (paired) {
            const pairId = this.nextPairId++;
            paired.pairId = pairId;
            this.extraTags.push({
              tagName: node.tagName,
              line: this.out.length,
              depth: this.depth,
              pairId,
            });
          }
        }
        // Печатаем уже на итоговом уровне: либо на глубине найденного
        // открывающего тега (симметрично обычным закрывающим тегам),
        // либо, если совпадения нет, на текущей глубине как есть.
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
        this.pushLine(this.indent(d) + node.openRaw);
        this.depth = d + 1;
        this.conditionalCommentDepth++;
        // Отметка стека ДО рендера детей — нужна, чтобы отличить два
        // разных случая ниже (см. комментарий у проверки leakStack).
        const leakMark = this.leakStack.length;
        this.renderNodes(node.children);
        this.conditionalCommentDepth--;
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
          };
          this.leakStack.push(ownEntry);
          this.allLeakEntries.push(ownEntry);
        }
        this.depth = d + 1;
        if (node.children.length > 0) {
          // currentParentTagName обновляем БЕЗУСЛОВНО (в отличие от
          // currentUnclosedAncestor выше) — для проверки "неоткрытых"
          // тегов важен РЕАЛЬНЫЙ структурный родитель в дереве, а он есть
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
              pruned.insertBeforeLine = this.out.length;
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
  // "Очистка от служебных атрибутов": убирает теги <tbody>/</tbody>
  // (разворачивает — тег убирается, содержимое остаётся на его месте) и
  // class="esd-text" (убирается целиком; если у тега есть другие
  // классы — остаются только они). См. src/serviceCleanup.ts. Включено
  // по умолчанию.
  cleanServiceAttrs?: boolean;
}

type ResolvedFormatOptions = Required<FormatOptions>;

const DEFAULT_OPTIONS: ResolvedFormatOptions = {
  collapseOutlookComments: false,
  typografy: true,
  cleanServiceAttrs: true,
};

// Применяет типограф ко всем текстовым узлам дерева (мутирует их value
// на месте — доc, полученный из parseHtml, создаётся заново на каждый
// вызов formatHtml и никем больше не используется, так что мутация
// безопасна). Теги/атрибуты/содержимое script,pre,style и обычные
// комментарии не входят в число текстовых узлов вовсе, поэтому их
// заведомо не трогаем — обходить их отдельно не нужно.
function applyTypographyToTree(nodes: Node[], stats: TypografStats): void {
  for (const node of nodes) {
    if (node.type === "text") {
      node.value = applyTypography(node.value, stats);
    } else if (node.type === "element" || node.type === "conditional-comment") {
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
  return items;
}

export interface FormatResult {
  html: string;
  // Теги, для которых нигде в документе не нашлось настоящего
  // закрывающего тега (ни обычного </tag>, ни "ничьего" — даже в другом
  // условном комментарии). Пустой массив — незакрытых тегов нет.
  unclosedTags: UnclosedTagInfo[];
  // Теги, перед которыми похоже пропущен единственно возможный
  // родитель (см. UnopenedTagInfo/checkUnopenedChild). Пустой массив —
  // подозрений нет.
  unopenedTags: UnopenedTagInfo[];
  // "Ничьи" закрывающие теги, для которых нашлась пара среди unopenedTags
  // (см. ExtraTagInfo). Пустой массив — либо таких вообще нет, либо ни
  // один не удалось связать с записью в unopenedTags.
  extraTags: ExtraTagInfo[];
  // Атрибуты из EMPTY_ATTR_NAMES, встреченные с пустым значением ("" или
  // ''), сгруппированные по имени — раздельно по категориям (см.
  // categorizeEmptyAttr): emptyAttrsToFill — самим не вывести значение,
  // нужно решение человека (href/target/src/background, а также width у
  // <img>); emptyAttrsToDelete — безопасно удалить атрибут целиком
  // (остальные, включая width НЕ у <img>). Пустой массив — таких нет.
  emptyAttrsToFill: EmptyAttrGroup[];
  emptyAttrsToDelete: EmptyAttrGroup[];
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
  const serviceCleanupStats: ServiceCleanupStats = { esdTextClass: 0, tbody: 0 };
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
    unopenedTags: renderer.getUnopenedTags(),
    extraTags: renderer.getExtraTags(),
    emptyAttrsToFill: renderer.getEmptyAttrsToFill(),
    emptyAttrsToDelete: renderer.getEmptyAttrsToDelete(),
    removedServiceItems: serviceCleanupStatsToItems(serviceCleanupStats),
    typografyItems: typografStatsToItems(typografStats),
  };
}

export function formatHtml(source: string, options: FormatOptions = {}): string {
  return formatHtmlWithDiagnostics(source, options).html;
}
