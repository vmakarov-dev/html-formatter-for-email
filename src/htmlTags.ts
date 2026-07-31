// Стандартные списки тегов, нужные форматтеру для решения:
// - нужен ли тегу отдельный закрывающий тег (void-элементы),
// - нужно ли сохранять инлайн-поток (не разрывать строки внутри текста),
// - нужно ли сохранять содержимое дословно (raw-text элементы).

export const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// Элементы, содержимое которых чувствительно к пробелам и не должно
// парситься/переформатироваться — сохраняется byte-for-byte.
export const RAW_TEXT_ELEMENTS = new Set(["script", "pre", "textarea"]);

// Элемент со специальным содержимым (CSS), которое форматируется отдельно.
export const STYLE_ELEMENTS = new Set(["style"]);

// Инлайн-элементы: остаются в потоке текста, не переносятся на отдельную
// строку сами по себе (в отличие от блочных элементов).
export const INLINE_ELEMENTS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "label",
  "mark",
  "meter",
  "noscript",
  "output",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
  "button",
  "img",
  "input",
  "select",
  "textarea",
]);

// Теги, которые никогда не схлопываются в одну строку со своим
// содержимым, даже если оно — чистый текстовый поток (в отличие,
// например, от <p> или <li>). Открывающий и закрывающий тег всегда на
// отдельных строках — так ячейки проще визуально сканировать в глубоко
// вложенной табличной вёрстке (письма и т.п.).
export const NEVER_COLLAPSE_ELEMENTS = new Set(["td"]);

export function isNeverCollapseElement(tagName: string): boolean {
  return NEVER_COLLAPSE_ELEMENTS.has(tagName.toLowerCase());
}

export function isVoidElement(tagName: string): boolean {
  return VOID_ELEMENTS.has(tagName.toLowerCase());
}

export function isRawTextElement(tagName: string): boolean {
  return RAW_TEXT_ELEMENTS.has(tagName.toLowerCase());
}

export function isStyleElement(tagName: string): boolean {
  return STYLE_ELEMENTS.has(tagName.toLowerCase());
}

export function isInlineElement(tagName: string): boolean {
  return INLINE_ELEMENTS.has(tagName.toLowerCase());
}
