// "Очистка от служебных атрибутов": убирает разметку, которую оставляют
// после себя email-конструкторы (ESD-билдеры) и которая не несёт
// смысловой нагрузки для итогового HTML:
//
// 1. Теги <tbody>/</tbody> — браузеры и так неявно оборачивают строки
//    таблицы в tbody, если его нет; когда он есть явно в исходнике, это
//    почти всегда просто "шум" от конструктора. Разворачиваем: сам тег
//    убираем, а его содержимое (реальные <tr>) остаётся на его месте,
//    как прямые дети <table>.
// 2. class="esd-text" — служебный маркер-класс, который ESD-конструкторы
//    вешают на текстовые блоки. Убирается целиком; если у тега помимо
//    esd-text есть другие классы, остаются только они.
//
// Как и типограф (см. typograf.ts) — это осознанное изменение
// СОДЕРЖИМОГО документа, а не просто отступов, поэтому применяется
// только по явному включению опции (см. FormatOptions.cleanServiceAttrs
// в formatter.ts), хотя по умолчанию она включена.

import { Node } from "./types.js";

const ESD_TEXT_CLASS = "esd-text";

// Счётчик того, что реально убрала очистка — нужен только для сводной
// плашки "Удалены (не влияет на вёрстку):" в веб-интерфейсе (см.
// formatHtmlWithDiagnostics в formatter.ts), сам разбор дерева от него
// не зависит.
export interface ServiceCleanupStats {
  esdTextClass: number;
  tbody: number;
}

// Убирает токен esd-text из атрибута class у узла с attrsRaw — не
// трогая остальные классы и остальные атрибуты. Если после удаления
// класс становится пустым, убирается весь атрибут class целиком. Если
// esd-text среди классов вообще нет — attrsRaw не трогаем ни на символ
// (даже пробелы внутри class не перенормализуем), чтобы не менять
// содержимое там, где очистка не требовалась.
function stripEsdTextClass(node: { attrsRaw: string }, stats: ServiceCleanupStats): void {
  if (!node.attrsRaw) return;
  const match = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(node.attrsRaw);
  if (!match) return;
  const rawValue = match[2] !== undefined ? match[2] : (match[3] as string);
  const quote = match[2] !== undefined ? '"' : "'";
  const tokens = rawValue.split(/\s+/).filter(Boolean);
  if (!tokens.includes(ESD_TEXT_CLASS)) return;
  const remaining = tokens.filter((t) => t !== ESD_TEXT_CLASS);
  const replacement = remaining.length === 0 ? "" : `class=${quote}${remaining.join(" ")}${quote}`;
  const updated =
    node.attrsRaw.slice(0, match.index) + replacement + node.attrsRaw.slice(match.index + match[0].length);
  node.attrsRaw = updated.replace(/\s{2,}/g, " ").trim();
  stats.esdTextClass++;
}

// Рекурсивно чистит список узлов: возвращает НОВЫЙ массив (а не мутирует
// исходный на месте), потому что <tbody> разворачивается — на его месте
// в результирующем массиве оказывается несколько узлов (его дети) вместо
// одного, что нельзя выразить мутацией одного элемента массива.
export function applyServiceCleanup(nodes: Node[], stats: ServiceCleanupStats): Node[] {
  const result: Node[] = [];
  for (const node of nodes) {
    if (node.type === "element") {
      stripEsdTextClass(node, stats);
      node.children = applyServiceCleanup(node.children, stats);
      if (node.tagName.toLowerCase() === "tbody") {
        stats.tbody++;
        result.push(...node.children);
        continue;
      }
    } else if (node.type === "conditional-comment") {
      node.children = applyServiceCleanup(node.children, stats);
    } else if (node.type === "raw-text" || node.type === "style") {
      stripEsdTextClass(node, stats);
    }
    result.push(node);
  }
  return result;
}
