import {
  CommentNode,
  ConditionalCommentNode,
  Document,
  DoctypeNode,
  ElementNode,
  MindboxBlockNode,
  MindboxStatementNode,
  Node,
  RawTextElementNode,
  StrayMindboxEndNode,
  StyleElementNode,
  TextNode,
} from "./types.js";
import {
  isInlineElement,
  isRawTextElement,
  isStyleElement,
  isVoidElement,
} from "./htmlTags.js";

const TAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9:-]*/;

function startsWithCI(src: string, target: string, pos: number): boolean {
  return src.substr(pos, target.length).toLowerCase() === target.toLowerCase();
}

// Атрибуты в исходнике иногда переносят вручную на несколько строк —
// например, у VML-тегов вроде <v:fill type="frame" ...\n  src="...">,
// частых в вёрстке под Outlook. При ФОРМАТИРОВАНИИ тег всегда печатается
// одной строкой (см. openTagString в formatter.ts) — необработанный
// перенос строки внутри attrsRaw ломает это допущение: в итоговом HTML
// появляется "лишняя" строка ровно там, где в исходнике был перенос
// (выглядит как самостоятельный тег, хотя это просто атрибут), а
// закрывающий тег остаётся приклеенным к этому обрывку без нормального
// переноса.
//
// ВАЖНО: эта функция больше НЕ вызывается здесь, при парсинге (раньше
// вызывалась прямо в parseElement, но это ломало живую построчную
// подсветку исходника в веб-интерфейсе — web/index.html гоняет
// window.HtmlFormatter.parseHtml по textarea НАПРЯМУЮ, без полного
// форматирования, чтобы подсветить исходник "как есть" поверх
// прозрачного textarea; если бы attrsRaw уже приходил схлопнутым, у
// подсвеченного слоя оказывалось МЕНЬШЕ строк, чем в самом textarea —
// и начиная с первого же многострочного тега курсор на экране переставал
// совпадать с реальным местом редактирования, и чем дальше, тем сильнее).
// node.attrsRaw в дереве — всегда СЫРОЙ, нетронутый текст. Схлопывание
// применяется только там, где действительно нужно печатать тег ОДНОЙ
// строкой — в formatter.ts, прямо перед сборкой открывающего тега (см.
// импорт normalizeAttrsWhitespace там).
//
// Схлопывает любой пробельный разрыв МЕЖДУ атрибутами (переносы строк,
// несколько пробелов подряд) до одного пробела — но только СНАРУЖИ
// кавычек: содержимое значений атрибутов (например, двойной пробел
// внутри alt="…") не трогаем ни на символ.
export function normalizeAttrsWhitespace(raw: string): string {
  let result = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (inSingle || inDouble) {
      result += c;
      if (inSingle && c === "'") inSingle = false;
      if (inDouble && c === '"') inDouble = false;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      if (c === "'") inSingle = true;
      else inDouble = true;
      result += c;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      result += " ";
      while (i < raw.length && /\s/.test(raw[i])) i++;
      continue;
    }
    result += c;
    i++;
  }
  return result;
}

// Теги, которые по стандартному поведению браузеров закрываются НЕЯВНО
// при появлении следующего "конфликтующего" тега того же уровня — сам
// тег не может вложить в себя такого соседа (два <tr> не бывают вложены
// друг в друга, один всегда идёт ПОСЛЕ другого). Без этого правила один
// пропущенный закрывающий тег (например, </tr> в разметке под Outlook,
// где таких строк — сотни) заставляет парсер "проглотить" вообще весь
// остаток документа как детей сломанного тега: он не находит "</tr>" и
// продолжает накапливать всё подряд, пока не наткнётся хоть на что-то
// одноимённое — что срывает разбор далеко за пределы места реальной
// ошибки. С этим правилом поломка остаётся локальной: ровно на том теге,
// где закрывающий тег действительно пропущен.
const IMPLICIT_CLOSE_ON_SIBLING: Record<string, Set<string>> = {
  tr: new Set(["tr"]),
  td: new Set(["td", "th", "tr"]),
  th: new Set(["td", "th", "tr"]),
  li: new Set(["li"]),
  option: new Set(["option", "optgroup"]),
  optgroup: new Set(["optgroup"]),
  dt: new Set(["dt", "dd"]),
  dd: new Set(["dt", "dd"]),
};

// Теги, у которых ОДНОИМЁННЫЙ предок на несколько уровней выше — обычное
// дело, а не редкость, — и потому не может служить надёжной подсказкой
// "какой именно тег закрывает вот этот 'ничей' закрывающий". См.
// matchesAncestorClose ниже. IMPLICIT_CLOSE_ON_SIBLING покрывает тут
// tr/td/th/li/option/optgroup/dt/dd (они и так уже "предки-кандидаты" по
// смыслу соседства), но table в этот набор НЕ входит (вложенная
// <table> внутри <table> — совсем не то же самое, что два соседних
// <tr> — см. matchesImplicitClose: новый <table> НЕ должен неявно
// закрывать предыдущий, вложенность там законная) — при этом сама
// table точно так же часто оказывается многоуровневым предком (вёрстка
// email почти всегда — таблицы в таблицах), так что для целей ИМЕННО
// matchesAncestorClose её нужно исключать отдельно, своим набором.
const AMBIGUOUS_ANCESTOR_NAMES = new Set([...Object.keys(IMPLICIT_CLOSE_ON_SIBLING), "table"]);

// Ключевые слова конструкций шаблонизатора Mindbox внутри "@{...}" —
// см. MindboxBlockNode/MindboxStatementNode/StrayMindboxEndNode в
// types.ts и правила форматирования, согласованные с пользователем.
// "for"/"if" открывают блок (парную "end for"/"end if" ищем как
// обычный stopTag); "set"/"else"/"elseif" — самостоятельная строка без
// пары и без влияния на отступ.
const MINDBOX_END_RE = /^end\s+(for|if)\b/i;
const MINDBOX_OPEN_RE = /^(for|if)\b/i;
const MINDBOX_STATEMENT_RE = /^(set|else|elseif)\b/i;

type MindboxToken =
  | { kind: "open"; construct: "for" | "if"; raw: string; end: number }
  | { kind: "end"; construct: "for" | "if"; raw: string; end: number }
  | { kind: "statement"; raw: string; end: number };

class Parser {
  private src: string;
  private pos = 0;
  // Стек границ "конца условного комментария", в которых мы сейчас
  // находимся. Реальная вёрстка (особенно письма для Outlook) часто
  // намеренно не закрывает теги внутри <!--[if mso]>...<![endif]-->:
  // <table>/<tr>/<td> открываются в одном условном комментарии, а
  // закрываются в другом, отдельном, много ниже по документу. Без учёта
  // этой границы вложенный разбор <table>/<tr>/<td> проматывает её
  // насквозь и "проглатывает" сам маркер <![endif]--> как обычное
  // содержимое где-то в глубине вложенности — граница должна быть видна
  // на ЛЮБОМ уровне вложенности, а не только в прямом вызове parseNodes
  // для содержимого комментария, поэтому это состояние парсера, а не
  // просто локальный параметр одного вызова.
  private activeStops: number[] = [];
  // Цепочка имён РЕАЛЬНО открытых сейчас предков (от корня до самого
  // текущего stopTag на вершине) — обновляется в parseElement вокруг
  // рекурсивного разбора детей. Нужна для matchesAncestorClose: если
  // "ничей" закрывающий тег совпадает с каким-то предком ВЫШЕ текущего
  // (не только с самим stopTag, для которого уже есть отдельная проверка
  // matchesClosingTag), это значит, что мы уже вышли за пределы
  // собственной вложенности текущего тега — совсем как matchesImplicitClose
  // для нового открывающего тега-соседа, только тут сигнал приходит от
  // закрывающего тега выше по дереву. Без этого один пропущенный
  // закрывающий тег где-то в глубине заставляет наивный поиск "ближайший
  // </tag> с таким же именем" перепрыгнуть через несколько закрывающих
  // тегов ПРЕДКОВ (которые сами становятся "ничьими" узлами) и по ошибке
  // забрать себе закрывающий тег, который на самом деле принадлежит
  // одному из этих предков, — см. разбор конкретного случая в истории
  // сессии (пропавший </tr> в реальном письме под Outlook).
  private openAncestors: string[] = [];

  constructor(src: string) {
    this.src = src;
  }

  parseDocument(): Document {
    const children = this.parseNodes();
    return { children };
  }

  // stopTag: имя тега, при встрече закрывающего </stopTag> парсинг
  // текущего уровня останавливается (не потребляя закрывающий тег).
  // stopMarker: литеральная строка-маркер (используется для условных
  // комментариев), при встрече которой парсинг останавливается.
  // stopAt: абсолютная позиция в исходнике, дойдя до которой парсинг
  // останавливается (используется, когда конец заранее найден заранее
  // через поиск по регулярному выражению, а не пошаговым сканированием).
  // stopMindboxEnd: "for"/"if" — при встрече парной "@{end for}"/
  // "@{end if}" парсинг текущего уровня останавливается (не потребляя
  // её), см. parseMindboxBlock.
  private parseNodes(
    stopTag?: string,
    stopMarker?: string,
    stopAt?: number,
    stopMindboxEnd?: "for" | "if",
  ): Node[] {
    const nodes: Node[] = [];
    let textStart = -1;

    const flushText = () => {
      if (textStart !== -1) {
        const value = this.src.slice(textStart, this.pos);
        if (value.length > 0) {
          nodes.push({ type: "text", value } as TextNode);
        }
        textStart = -1;
      }
    };

    while (this.pos < this.src.length) {
      if (stopAt !== undefined && this.pos >= stopAt) {
        break;
      }

      if (
        this.activeStops.length > 0 &&
        this.pos >= this.activeStops[this.activeStops.length - 1]
      ) {
        break;
      }

      if (stopMarker && startsWithCI(this.src, stopMarker, this.pos)) {
        break;
      }

      if (stopTag && this.matchesClosingTag(stopTag, this.pos)) {
        break;
      }

      if (stopTag && this.matchesImplicitClose(stopTag, this.pos)) {
        break;
      }

      if (stopMindboxEnd && this.matchesMindboxEnd(stopMindboxEnd, this.pos)) {
        break;
      }

      // Только ВНЕ условных комментариев: приём вёрстки под Outlook
      // намеренно кладёт "ничьи" закрывающие теги предков внутрь ОТДЕЛЬНОГО
      // условного комментария (закрывающая половина table>tr>td,
      // разрубленного на два комментария) — там совпадение по имени с
      // каким-то СЛУЧАЙНО открытым сейчас (в обычном контенте снаружи)
      // одноимённым предком ничего не значит и не должно мешать этому
      // тегу остаться "ничьим": его настоящую пару найдёт отдельный
      // механизм на уровне рендера (см. resolveStrayClose), а не разбор
      // текущей вложенности. Без этого ограничения любой закрывающий тег
      // из такого комментария (например, "</td>" для кнопки, вложенной
      // на 20 уровней вглубь письма) перехватывался бы первым попавшимся
      // реальным открытым предком с тем же именем where-то выше по дереву.
      if (this.activeStops.length === 0 && this.matchesAncestorClose(this.pos)) {
        break;
      }

      const ch = this.src[this.pos];

      if (ch === "<") {
        const next = this.src[this.pos + 1];

        if (this.src.startsWith("<!--", this.pos)) {
          flushText();
          nodes.push(this.parseComment());
          continue;
        }

        if (startsWithCI(this.src, "<!doctype", this.pos)) {
          flushText();
          nodes.push(this.parseDoctype());
          continue;
        }

        if (next === "!" || next === "?") {
          // CDATA, обработка XML-инструкций и прочие редкие конструкции —
          // сохраняем как есть, до ближайшего '>'.
          flushText();
          nodes.push(this.parseDoctype());
          continue;
        }

        if (next === "/") {
          // "Чужой" закрывающий тег без соответствующего открытия — типичный
          // случай: </td></tr></table> в одном условном комментарии, парном
          // с <table><tr><td> в другом (приём вёрстки под Outlook). Не
          // пытаемся выстроить вложенность вокруг него, но и не сливаем с
          // окружающим текстом (иначе при выводе он схлопнется в одну
          // строку с соседями через схлопывание пробелов в потоке) —
          // оформляем отдельным узлом, который всегда печатается на своей
          // строке.
          flushText();
          const start = this.pos;
          const nameMatch = TAG_NAME_RE.exec(this.src.slice(this.pos + 2));
          const strayTagName = nameMatch ? nameMatch[0] : "";
          const closeEnd = this.src.indexOf(">", this.pos);
          if (closeEnd === -1) {
            this.pos = this.src.length;
          } else {
            this.pos = closeEnd + 1;
          }
          nodes.push({
            type: "stray-close-tag",
            raw: this.src.slice(start, this.pos),
            tagName: strayTagName,
          });
          continue;
        }

        if (next && /[a-zA-Z]/.test(next)) {
          flushText();
          nodes.push(this.parseElement());
          continue;
        }
      }

      if (ch === "@" && this.src[this.pos + 1] === "{") {
        const token = this.parseMindboxToken(this.pos);
        if (token) {
          flushText();
          if (token.kind === "open") {
            this.pos = token.end;
            nodes.push(this.parseMindboxBlock(token.construct, token.raw));
            continue;
          }
          if (token.kind === "end") {
            this.pos = token.end;
            const strayNode: StrayMindboxEndNode = {
              type: "stray-mindbox-end",
              raw: token.raw,
              kind: token.construct,
            };
            nodes.push(strayNode);
            continue;
          }
          this.pos = token.end;
          const statementNode: MindboxStatementNode = { type: "mindbox-statement", raw: token.raw };
          nodes.push(statementNode);
          continue;
        }
        // Не распознали конструкцию (незакрытая "@{" либо неизвестное
        // ключевое слово) — "@" остаётся обычным текстовым символом,
        // падаем в обычное накопление текста ниже.
      }

      if (textStart === -1) textStart = this.pos;
      this.pos++;
    }

    flushText();
    return nodes;
  }

  private matchesClosingTag(tagName: string, pos: number): boolean {
    if (this.src[pos] !== "<" || this.src[pos + 1] !== "/") return false;
    let p = pos + 2;
    const start = p;
    while (p < this.src.length && /[a-zA-Z0-9:-]/.test(this.src[p])) p++;
    const name = this.src.slice(start, p);
    if (name.toLowerCase() !== tagName.toLowerCase()) return false;
    while (p < this.src.length && /\s/.test(this.src[p])) p++;
    return this.src[p] === ">";
  }

  // true, если в позиции pos начинается ОТКРЫВАЮЩИЙ тег, который для
  // tagName является неявным закрытием (см. IMPLICIT_CLOSE_ON_SIBLING) —
  // например, новый "<tr>" при разборе содержимого ещё не закрытого "tr".
  private matchesImplicitClose(tagName: string, pos: number): boolean {
    const closers = IMPLICIT_CLOSE_ON_SIBLING[tagName.toLowerCase()];
    if (!closers) return false;
    if (this.src[pos] !== "<") return false;
    const next = this.src[pos + 1];
    if (!next || !/[a-zA-Z]/.test(next)) return false;
    const nameMatch = TAG_NAME_RE.exec(this.src.slice(pos + 1));
    const newTagName = nameMatch ? nameMatch[0] : "";
    return closers.has(newTagName.toLowerCase());
  }

  // true, если в позиции pos начинается закрывающий тег, совпадающий с
  // каким-нибудь предком ВЫШЕ текущего stopTag (последнего элемента
  // openAncestors — для него уже есть отдельная проверка matchesClosingTag
  // в вызывающем цикле, поэтому здесь его намеренно пропускаем). См.
  // комментарий у объявления openAncestors.
  //
  // Предков с именем из AMBIGUOUS_ANCESTOR_NAMES (tr/td/th/li/option/...,
  // и отдельно table — см. её объявление) сюда намеренно НЕ берём в
  // расчёт: это теги, для которых ОДНОИМЁННЫЙ предок на несколько
  // уровней выше — обычное дело (несколько <tr> в одной <table>,
  // несколько <li> в одном <ul>, вложенные друг в друга <table> в
  // вёрстке email), а не редкость. Если "ничей" закрывающий тег с таким
  // именем всплывает на несколько уровней глубже, гораздо вероятнее, что
  // он принадлежит пропущенному тегу того же типа где-то РЯДОМ (типичная
  // причина — вручную вырезанный <tr>/<table>, см. checkMissingParentGuard
  // в formatter.ts), а не далёкому предку с тем же именем. Раньше без
  // этого исключения такой тег ошибочно "утаскивал" совпадающего по
  // имени предка на несколько уровней выше как СВОЙ закрывающий тег —
  // предок закрывался слишком рано, а всё, что в исходнике шло за ним на
  // самом деле дальше внутри общего контейнера, оказывалось вынесено
  // наружу и ломало вложенность всего оставшегося документа (реальный
  // случай — email с таблицами в 20+ уровней вложенности, где вырезали
  // один <table> и внешняя таблица закрывалась на десятки строк раньше
  // положенного, утаскивая за собой всё письмо). Без совпадения тут тег
  // просто останется "ничьим" (см. resolveStrayClose на рендере) — куда
  // безопаснее, чем неверная догадка.
  private matchesAncestorClose(pos: number): boolean {
    for (let i = this.openAncestors.length - 2; i >= 0; i--) {
      const name = this.openAncestors[i];
      if (AMBIGUOUS_ANCESTOR_NAMES.has(name.toLowerCase())) continue;
      if (this.matchesClosingTag(name, pos)) return true;
    }
    return false;
  }

  // Находит позицию закрывающей "}" конструкции "@{...}", начинающейся в
  // pos (pos указывает на "@"). Кавычки внутри выражения (например,
  // строковый литерал сегмента "Test") пропускаются целиком, тем же
  // принципом, что и normalizeAttrsWhitespace — на случай, если внутри
  // литерала когда-нибудь встретится "}". Возвращает null, если "}" не
  // нашлась до конца исходника (незакрытая/битая конструкция — в этом
  // случае "@" остаётся обычным текстовым символом, см. вызывающую сторону).
  private findMindboxConstructEnd(pos: number): number | null {
    let i = pos + 2; // пропускаем "@{"
    let inSingle = false;
    let inDouble = false;
    while (i < this.src.length) {
      const c = this.src[i];
      if (inSingle) {
        if (c === "'") inSingle = false;
        i++;
        continue;
      }
      if (inDouble) {
        if (c === '"') inDouble = false;
        i++;
        continue;
      }
      if (c === "'") {
        inSingle = true;
        i++;
        continue;
      }
      if (c === '"') {
        inDouble = true;
        i++;
        continue;
      }
      if (c === "}") return i;
      i++;
    }
    return null;
  }

  // Разбирает конструкцию "@{...}" в позиции pos (чистый lookahead — не
  // трогает this.pos). null — это не "@{", распознаваемая конструкция
  // (незакрытая скобка либо неизвестное ключевое слово), тогда "@"
  // остаётся обычным текстовым символом (см. вызов в parseNodes) — на
  // случай синтаксиса Mindbox, который правила пока не описывают.
  private parseMindboxToken(pos: number): MindboxToken | null {
    if (this.src[pos] !== "@" || this.src[pos + 1] !== "{") return null;
    const closeIdx = this.findMindboxConstructEnd(pos);
    if (closeIdx === null) return null;
    const inner = this.src.slice(pos + 2, closeIdx).trim();
    const raw = this.src.slice(pos, closeIdx + 1);
    const end = closeIdx + 1;
    const endMatch = MINDBOX_END_RE.exec(inner);
    if (endMatch) {
      return { kind: "end", construct: endMatch[1].toLowerCase() as "for" | "if", raw, end };
    }
    const openMatch = MINDBOX_OPEN_RE.exec(inner);
    if (openMatch) {
      return { kind: "open", construct: openMatch[1].toLowerCase() as "for" | "if", raw, end };
    }
    if (MINDBOX_STATEMENT_RE.test(inner)) {
      return { kind: "statement", raw, end };
    }
    return null;
  }

  private matchesMindboxEnd(construct: "for" | "if", pos: number): boolean {
    const token = this.parseMindboxToken(pos);
    return token !== null && token.kind === "end" && token.construct === construct;
  }

  // this.pos должен указывать сразу ПОСЛЕ открывающей "@{for ...}"/
  // "@{if ...}" (см. вызов в parseNodes). Ищет парную "@{end for}"/
  // "@{end if}" тем же принципом, что parseElement ищет закрывающий
  // HTML-тег: если её нет — конструкция остаётся explicitlyClosed=false,
  // и её отступ "утекает" дальше по документу через leak-стек в
  // Renderer (formatter.ts), как у незакрытого HTML-тега.
  private parseMindboxBlock(construct: "for" | "if", openRaw: string): MindboxBlockNode {
    const children = this.parseNodes(undefined, undefined, undefined, construct);
    const token = this.parseMindboxToken(this.pos);
    const explicitlyClosed = token !== null && token.kind === "end" && token.construct === construct;
    let closeRaw = "";
    if (explicitlyClosed && token) {
      closeRaw = token.raw;
      this.pos = token.end;
    }
    return { type: "mindbox-block", kind: construct, openRaw, closeRaw, explicitlyClosed, children };
  }

  private consumeClosingTag(): void {
    // Вызывается, когда текущая позиция указывает на "</tagName ...>".
    const end = this.src.indexOf(">", this.pos);
    this.pos = end === -1 ? this.src.length : end + 1;
  }

  private parseDoctype(): DoctypeNode {
    const start = this.pos;
    const end = this.src.indexOf(">", this.pos);
    if (end === -1) {
      this.pos = this.src.length;
      return { type: "doctype", raw: this.src.slice(start) };
    }
    this.pos = end + 1;
    return { type: "doctype", raw: this.src.slice(start, this.pos) };
  }

  private parseComment(): CommentNode | ConditionalCommentNode {
    const start = this.pos;
    this.pos += 4; // пропускаем "<!--"

    const rest = this.src.slice(this.pos);
    const isConditional = /^\s*\[if\b/.test(rest);

    if (!isConditional) {
      const end = this.src.indexOf("-->", this.pos);
      if (end === -1) {
        const raw = this.src.slice(this.pos);
        this.pos = this.src.length;
        return { type: "comment", raw };
      }
      const raw = this.src.slice(this.pos, end);
      this.pos = end + 3;
      return { type: "comment", raw };
    }

    // Условный комментарий: <!--[if cond]> ... <![endif]-->
    const openMarkerEnd = this.src.indexOf(">", this.pos);
    if (openMarkerEnd === -1) {
      // Не нашли конец маркера — деградируем в обычный комментарий.
      this.pos = this.src.length;
      return { type: "comment", raw: this.src.slice(start + 4) };
    }
    const condPart = this.src.slice(this.pos, openMarkerEnd + 1); // "[if ...]>"
    this.pos = openMarkerEnd + 1;

    // "Downlevel-revealed" вариант: после "[if ...]>" идёт "<!-->", которая
    // для обычных браузеров закрывает внешний комментарий и "открывает"
    // содержимое. В реальной вёрстке между этими двумя маркерами (а также
    // между частями закрывающей конструкции "<!--<![endif]-->") почти
    // всегда стоит перенос строки с отступом — это чисто форматирование
    // источника, не несущее смысла, поэтому в выводе оба маркера
    // нормализуем в компактный однострочный вид без этого разрыва.
    const revealedMatch = /^\s*<!-->/.exec(this.src.slice(this.pos));
    const revealed = revealedMatch !== null;
    let openRaw = "<!--" + condPart;
    if (revealed) {
      openRaw += "<!-->";
      this.pos += revealedMatch[0].length;
    }

    // Закрывающая конструкция ("<![endif]-->" либо, для revealed-варианта,
    // "<!--<![endif]-->") может быть написана как одной строкой, так и
    // разбита переносами/отступами между частями — ищем её целиком через
    // regex по остатку исходника, а не пошаговым сканированием, чтобы не
    // потерять границу.
    const closePattern = revealed ? /<!--\s*<!\[endif\]\s*-->/gi : /<!\[endif\]\s*-->/gi;
    closePattern.lastIndex = this.pos;
    const closeMatch = closePattern.exec(this.src);
    const normalizedCloseRaw = revealed ? "<!--<![endif]-->" : "<![endif]-->";

    if (closeMatch === null) {
      // Не нашли закрывающий маркер — деградируем, забирая всё до конца.
      const children = this.parseNodes();
      return { type: "conditional-comment", openRaw, closeRaw: "", children };
    }

    // Границу конца условного комментария кладём в общий стек парсера:
    // без этого вложенный разбор элементов (у которых внутри данного
    // условного комментария может не быть закрывающего тега — обычный
    // приём в вёрстке под Outlook) не увидит эту границу и проскочит её.
    this.activeStops.push(closeMatch.index);
    const children = this.parseNodes();
    this.activeStops.pop();

    this.pos = closeMatch.index + closeMatch[0].length;
    return { type: "conditional-comment", openRaw, closeRaw: normalizedCloseRaw, children };
  }

  private parseElement(): Node {
    // this.pos указывает на '<', далее — имя тега.
    this.pos += 1;
    const nameMatch = TAG_NAME_RE.exec(this.src.slice(this.pos));
    const tagName = nameMatch ? nameMatch[0] : "";
    this.pos += tagName.length;

    const attrsStart = this.pos;
    let selfClosed = false;
    let inSingle = false;
    let inDouble = false;

    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (inSingle) {
        if (c === "'") inSingle = false;
        this.pos++;
        continue;
      }
      if (inDouble) {
        if (c === '"') inDouble = false;
        this.pos++;
        continue;
      }
      if (c === "'") {
        inSingle = true;
        this.pos++;
        continue;
      }
      if (c === '"') {
        inDouble = true;
        this.pos++;
        continue;
      }
      if (c === ">") {
        break;
      }
      this.pos++;
    }

    let attrsRaw = this.src.slice(attrsStart, this.pos);
    if (/\/\s*$/.test(attrsRaw)) {
      selfClosed = true;
      attrsRaw = attrsRaw.replace(/\/\s*$/, "");
    }
    attrsRaw = attrsRaw.trim();

    this.pos += 1; // пропускаем '>'

    const voidElement = isVoidElement(tagName);
    const inline = isInlineElement(tagName);

    if (voidElement || selfClosed) {
      const el: ElementNode = {
        type: "element",
        tagName,
        attrsRaw,
        selfClosed,
        voidElement,
        inline,
        explicitlyClosed: true,
        children: [],
      };
      return el;
    }

    if (isRawTextElement(tagName)) {
      const closeIdx = this.findClosingTagIndex(tagName);
      const rawContent =
        closeIdx === -1 ? this.src.slice(this.pos) : this.src.slice(this.pos, closeIdx);
      if (closeIdx === -1) {
        this.pos = this.src.length;
      } else {
        this.pos = closeIdx;
        this.consumeClosingTag();
      }
      const node: RawTextElementNode = {
        type: "raw-text",
        tagName,
        attrsRaw,
        rawContent,
      };
      return node;
    }

    if (isStyleElement(tagName)) {
      const closeIdx = this.findClosingTagIndex(tagName);
      const rawContent =
        closeIdx === -1 ? this.src.slice(this.pos) : this.src.slice(this.pos, closeIdx);
      if (closeIdx === -1) {
        this.pos = this.src.length;
      } else {
        this.pos = closeIdx;
        this.consumeClosingTag();
      }
      const node: StyleElementNode = {
        type: "style",
        tagName,
        attrsRaw,
        rawContent,
      };
      return node;
    }

    this.openAncestors.push(tagName);
    const children = this.parseNodes(tagName);
    this.openAncestors.pop();
    const explicitlyClosed = this.matchesClosingTag(tagName, this.pos);
    if (explicitlyClosed) {
      this.consumeClosingTag();
    }
    // Если совпадения нет — тег не закрыт в исходнике (битая разметка,
    // EOF, либо намеренный приём вроде разрыва <table> между условными
    // комментариями в вёрстке под Outlook); ничего не потребляем и НЕ
    // сочиняем закрывающий тег при выводе — см. explicitlyClosed.

    const el: ElementNode = {
      type: "element",
      tagName,
      attrsRaw,
      selfClosed: false,
      voidElement: false,
      inline,
      explicitlyClosed,
      children,
    };
    return el;
  }

  private findClosingTagIndex(tagName: string): number {
    let searchFrom = this.pos;
    while (true) {
      const idx = this.src.toLowerCase().indexOf("</" + tagName.toLowerCase(), searchFrom);
      if (idx === -1) return -1;
      if (this.matchesClosingTag(tagName, idx)) return idx;
      searchFrom = idx + 1;
    }
  }
}

export function parseHtml(src: string): Document {
  return new Parser(src).parseDocument();
}
