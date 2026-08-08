// AST-узлы HTML-документа. Первый шаг форматтера работает только с
// иерархией (отступами), поэтому атрибуты и текст хранятся как есть,
// без собственного парсинга/переформатирования содержимого.

export type Node =
  | DoctypeNode
  | ElementNode
  | RawTextElementNode
  | StyleElementNode
  | TextNode
  | CommentNode
  | ConditionalCommentNode
  | StrayCloseTagNode
  | MindboxBlockNode
  | MindboxStatementNode
  | StrayMindboxEndNode;

export interface DoctypeNode {
  type: "doctype";
  raw: string; // "<!DOCTYPE html>" целиком, как в исходнике
}

// Обычный элемент с дочерними узлами (div, p, span, a, ul, li, ...)
export interface ElementNode {
  type: "element";
  tagName: string;
  attrsRaw: string; // сырой текст атрибутов, без изменений
  selfClosed: boolean; // тег был записан как <tag ... /> в исходнике
  voidElement: boolean; // тег из списка void-элементов (br, img, ...)
  inline: boolean; // относится к инлайн-элементам (span, a, em, ...)
  // Был ли в исходнике настоящий закрывающий тег. false — тег остался
  // открытым (битая разметка либо намеренный приём вроде разрыва
  // <table> между двумя условными комментариями в вёрстке под Outlook).
  // В этом случае форматтер не должен дорисовывать закрывающий тег,
  // которого не было, — это меняло бы содержимое документа, а не только
  // отступы.
  explicitlyClosed: boolean;
  // true, если у ОТКРЫВАЮЩЕГО тега в исходнике так и не нашлось
  // настоящего ">" — разбор атрибутов оборвался предохранителем на начале
  // следующего тега (типичная причина — незакрытая кавычка в значении:
  // <a href="broken><img>, см. parseElement). Всё, что при этом попало в
  // attrsRaw, уже включает символы исходника до этого места — в том числе
  // сам ">", съеденный незакрытой кавычкой. Дописывать при выводе ЕЩЁ
  // один ">" в этом случае нельзя: тег и так уже "заканчивается" им, и
  // каждое повторное форматирование добавляло бы в текст пользователя по
  // лишнему символу (broken> -> broken>> -> broken>>>), то есть тихо
  // портило бы содержимое письма. См. openTagString в formatter.ts.
  unterminated: boolean;
  children: Node[];
}

// script, pre, textarea — содержимое чувствительно к пробелам,
// сохраняем его дословно (byte-for-byte).
export interface RawTextElementNode {
  type: "raw-text";
  tagName: string;
  attrsRaw: string;
  rawContent: string;
}

// style — содержимое переформатируем отдельным CSS-форматтером.
export interface StyleElementNode {
  type: "style";
  tagName: string;
  attrsRaw: string;
  rawContent: string;
}

export interface TextNode {
  type: "text";
  value: string; // сырой текст узла (может содержать чистый whitespace)
}

// Обычный текстовый комментарий <!-- ... -->. Не участвует в иерархии:
// получает отступ текущего уровня, но не создаёт вложенности.
export interface CommentNode {
  type: "comment";
  raw: string; // содержимое между <!-- и -->, без изменений
}

// Условный комментарий <!--[if ...]> ... <![endif]-->. Участвует в
// иерархии: маркеры открытия/закрытия — как открывающий/закрывающий тег,
// содержимое между ними — настоящие дочерние узлы.
export interface ConditionalCommentNode {
  type: "conditional-comment";
  openRaw: string; // например "<!--[if lte IE 9]>"
  closeRaw: string; // например "<![endif]-->"
  children: Node[];
}

// Закрывающий тег без соответствующего открытого элемента в этой
// области — например, </td></tr></table> в одном условном комментарии,
// парном с <table><tr><td> в другом (частый приём в вёрстке под
// Outlook). Сам по себе не открывает вложенность, но МОЖЕТ закрыть тег,
// оставшийся открытым где-то раньше по документу (даже в другом условном
// комментарии) — тогда он возвращает глубину отступа на уровень того
// тега. Если совпадения нет — просто печатается на текущем уровне своей
// отдельной строкой, не сливаясь с соседями в один "поток".
export interface StrayCloseTagNode {
  type: "stray-close-tag";
  raw: string; // например "</td>", как в исходнике
  tagName: string; // "td" — для поиска совпадения среди незакрытых тегов
}

// Блочная конструкция шаблонизатора Mindbox: @{for ...}/@{end for} или
// @{if ...}/@{end if}. Участвует в иерархии наравне с условными
// комментариями и обычными тегами: открывающая часть — как открывающий
// тег, содержимое между ней и парной @{end ...} — настоящие дочерние
// узлы (свободно вперемешку с обычной HTML-разметкой).
export interface MindboxBlockNode {
  type: "mindbox-block";
  kind: "for" | "if";
  openRaw: string; // например "@{for item in Order.Items}", как в исходнике
  closeRaw: string; // например "@{end for}"; пусто, если explicitlyClosed=false
  // Была ли в исходнике настоящая парная @{end for}/@{end if} — та же
  // роль, что и у ElementNode.explicitlyClosed: если пары нет, отступ
  // "утекает" дальше по документу через тот же leak-стек, что и у
  // незакрытых HTML-тегов (см. Renderer в formatter.ts), а закрывающую
  // конструкцию форматтер не сочиняет.
  explicitlyClosed: boolean;
  children: Node[];
}

// Самостоятельная инструкция Mindbox без пары: @{set ...} или
// @{else}/@{elseif ...}. Всегда своя строка на текущем уровне отступа —
// не открывает и не закрывает вложенность (аналог самозакрывающегося
// тега).
export interface MindboxStatementNode {
  type: "mindbox-statement";
  raw: string; // например "@{set counter = counter + 1}", как в исходнике
}

// "Ничья" @{end for}/@{end if} без соответствующей открывающей
// конструкции в этой области — зеркало StrayCloseTagNode для Mindbox.
export interface StrayMindboxEndNode {
  type: "stray-mindbox-end";
  raw: string; // например "@{end for}", как в исходнике
  kind: "for" | "if";
}

export interface Document {
  children: Node[];
}
