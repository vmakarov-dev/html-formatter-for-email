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
  | StrayCloseTagNode;

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

export interface Document {
  children: Node[];
}
