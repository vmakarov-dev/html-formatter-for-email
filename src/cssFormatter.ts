// Минимальный форматтер CSS для содержимого <style>. Не претендует на
// полноту (не разбирает CSS в AST), но корректно расставляет отступы
// для селекторов, деклараций и вложенных at-правил (@media и т.п.),
// уважая строки в кавычках, чтобы не спотыкаться на "{", "}", ";" внутри
// значений.

const INDENT = "  ";

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function formatDeclaration(raw: string): string | null {
  const text = collapseWhitespace(raw);
  if (text.length === 0) return null;
  const colonIdx = text.indexOf(":");
  if (colonIdx === -1) return `${text};`;
  const prop = text.slice(0, colonIdx).trim();
  const value = text.slice(colonIdx + 1).trim();
  return `${prop}: ${value};`;
}

export function formatCss(source: string): string[] {
  const lines: string[] = [];
  let depth = 0;
  let buffer = "";
  let inSingle = false;
  let inDouble = false;
  let inComment = false;

  const flushDeclaration = () => {
    const decl = formatDeclaration(buffer);
    buffer = "";
    if (decl) lines.push(INDENT.repeat(depth) + decl);
  };

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];

    if (inComment) {
      buffer += c;
      if (c === "/" && source[i - 1] === "*") inComment = false;
      continue;
    }
    if (inSingle) {
      buffer += c;
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      buffer += c;
      if (c === '"') inDouble = false;
      continue;
    }

    if (c === "/" && next === "*") {
      inComment = true;
      buffer += c;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      buffer += c;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      buffer += c;
      continue;
    }

    if (c === "{") {
      const selector = collapseWhitespace(buffer);
      buffer = "";
      lines.push(INDENT.repeat(depth) + (selector.length ? selector + " {" : "{"));
      depth++;
      continue;
    }

    if (c === "}") {
      if (collapseWhitespace(buffer).length > 0) flushDeclaration();
      depth = Math.max(0, depth - 1);
      lines.push(INDENT.repeat(depth) + "}");
      continue;
    }

    if (c === ";") {
      flushDeclaration();
      continue;
    }

    buffer += c;
  }

  if (collapseWhitespace(buffer).length > 0) {
    // Последняя декларация без завершающей ";" в исходнике.
    flushDeclaration();
  }

  return lines;
}
