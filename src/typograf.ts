// Типограф: расстановка неразрывных пробелов, замена прямых кавычек на
// «ёлочки» и дефиса-между-словами на длинное тире — по правилам русской
// типографики.
//
// Область применения: вызывающая сторона (formatter.ts) передаёт сюда
// только содержимое текстовых узлов (TextNode.value) — теги, атрибуты,
// содержимое <script>/<pre>/<style>, обычные комментарии сюда не
// попадают вовсе, им applyTypography не нужен.
//
// Язык: если во всём переданном фрагменте текста нет ни одной
// кириллической буквы, текст возвращается без изменений — англоязычные
// куски не трогаем (см. обсуждение: "определять по кириллице рядом").
//
// Неразрывный пробел вставляется как HTML-сущность "&nbsp;", а не как
// сырой символ U+00A0: во-первых, это привычнее видеть в HTML-исходнике,
// во-вторых (что важнее) — сырой U+00A0 воспринимается регулярным
// выражением "\s" как пробел, и его случайно схлопнул бы дальнейший шаг
// схлопывания пробелов в formatter.ts. Сущность "&nbsp;" для "\s"
// обычным текстом не является, поэтому такого риска нет.
//
// Известные упрощения (сообщены и приняты на этапе обсуждения):
// - Каждый текстовый узел обрабатывается независимо. Если, например,
//   открывающая кавычка и закрывающая разделены инлайн-тегом
//   (<b>...</b> и т.п.), либо предлог — последнее слово в узле перед
//   таким тегом, пара/склейка не распознаётся.
// - Настоящую вложенность кавычек (кавычка внутри кавычки) отличить от
//   двух подряд идущих независимых пар автоматически нельзя без
//   смыслового анализа текста — считаем кавычки просто чередующимися
//   парами открытие/закрытие («…», «…», …), без вложенного стиля
//   „лапки“.

const NBSP = "&nbsp;";

const CYRILLIC_RE = /[а-яёА-ЯЁ]/;

// Счётчик того, что реально поменял типограф в документе — нужен только
// для сводной плашки "Типографика готова:" в веб-интерфейсе (см.
// applyTypography ниже/formatHtmlWithDiagnostics в formatter.ts), сам
// разбор текста от него никак не зависит. nbsp — общее число мест, где
// обычный пробел заменён на неразрывный (предлоги/частицы, инициалы,
// числа с единицами/№/§/годами/деньгами, "приклеивание" сокращений,
// пробел перед УЖЕ существующим длинным тире); dash — сколько дефисов
// между словами превращено в длинное тире (это отдельный, самостоятельно
// заметный эффект, поэтому не смешивается со счётчиком nbsp, хотя каждая
// такая замена попутно тоже вставляет неразрывный пробел); quotes —
// сколько ПАР прямых/типографских кавычек заменено на "ёлочки" (считается
// по закрывающей кавычке пары, не по каждому символу по отдельности).
export interface TypografStats {
  nbsp: number;
  dash: number;
  quotes: number;
}

// Границы "слова" для кириллицы: обычный \b в JS ориентирован на \w
// (латиница/цифры/подчёркивание) и не видит кириллицу, поэтому вместо
// него используются lookaround-проверки по \p{L}/\p{N} (юникод-классы
// "буква"/"цифра", требуют флag "u").
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}])";

// 1. Предлоги и союзы — не отрываются от следующего слова. Частица "не"
// грамматически не предлог, но ведёт себя точно так же (липнет к
// следующему слову: "не видел"), поэтому она тоже здесь, а не среди
// PARTICLES ниже (те, наоборот, липнут к ПРЕДЫДУЩЕМУ слову).
const PREPOSITIONS = [
  "в", "к", "с", "о", "у", "а", "и", "я",
  "до", "по", "из", "за", "на", "но", "не", "что", "как", "для",
  "при", "про", "над", "под", "без", "или",
];

// 2. Частицы — не отрываются от предыдущего слова.
const PARTICLES = ["бы", "б", "же", "ж", "ли", "ль"];

function byLengthDesc(a: string, b: string): number {
  return b.length - a.length;
}

const PREPOSITION_RE = new RegExp(
  `${NOT_WORD_BEFORE}(${PREPOSITIONS.slice().sort(byLengthDesc).join("|")})${NOT_WORD_AFTER}[ \\t]+(?=\\S)`,
  "giu",
);

const PARTICLE_RE = new RegExp(
  `(?<=[\\p{L}\\p{N}])[ \\t]+(${PARTICLES.slice().sort(byLengthDesc).join("|")})${NOT_WORD_AFTER}`,
  "giu",
);

// 3. Инициалы и фамилии: "А. С. Пушкин" / "А.С. Пушкин" и обратный
// порядок "Пушкин А. С.".
const INITIALS_BEFORE_SURNAME_RE =
  /([А-ЯЁ]\.)[ \t]*([А-ЯЁ]\.)?[ \t]+([А-ЯЁ][а-яё]+)/gu;
const SURNAME_BEFORE_INITIALS_RE =
  /([А-ЯЁ][а-яё]+)[ \t]+([А-ЯЁ]\.)[ \t]*([А-ЯЁ]\.)?/gu;

// 4. Числа: единицы измерения, №, §, годы/века, деньги.
const UNITS = [
  "мм", "см", "дм", "км", "м",
  "мг", "кг", "г", "т", "ц",
  "мл", "л",
  "мин", "ч", "с",
  "кГц", "МГц", "Гц",
  "кВт", "Вт",
  "В", "А",
  "°C", "°F", "°",
  "%",
  "руб", "коп", "шт", "чел", "стр",
];
const NUMBER_UNIT_RE = new RegExp(
  `(\\d)[ \\t]+(${UNITS.slice().sort(byLengthDesc).join("|")})${NOT_WORD_AFTER}`,
  "gu",
);

const NUMBER_SIGN_RE = /(№|§)[ \t]+(?=\d)/g;

const YEAR_CENTURY_RE = new RegExp(
  `(\\d{1,4}|[MDCLXVI]{1,7})[ \\t]+(гг?\\.|вв?\\.)${NOT_WORD_AFTER}`,
  "giu",
);

const CURRENCY_RE = /(\d)[ \t]+(\$|€|₽)/g;

// 5. Сокращения, склеиваемые между своими частями.
const ABBREV_GLUE_RES = [
  /т\.[ \t]*д\./gi,
  /т\.[ \t]*п\./gi,
  /т\.[ \t]*е\./gi,
  /т\.[ \t]*к\./gi,
  /н\.[ \t]*э\./gi,
];

// Сокращения-ссылки перед числом ("с. 25", "рис. 3", "табл. 1", "гл. 2").
const REF_ABBREV_RE = new RegExp(
  `${NOT_WORD_BEFORE}(с|рис|табл|гл)\\.[ \\t]+(?=\\d)`,
  "giu",
);

// 6. Дефис между словами -> длинное тире, пробел перед ним неразрывный.
const DASH_RE = /(\S)[ \t]-[ \t](\S)/g;

// 7. Пробел перед уже существующим длинным тире делаем неразрывным.
const EXISTING_EM_DASH_RE = /(\S)[ \t]—/g;

function applyPrepositionsAndParticles(text: string, stats: TypografStats): string {
  return text
    .replace(PREPOSITION_RE, (_m, word: string) => {
      stats.nbsp++;
      return `${word}${NBSP}`;
    })
    .replace(PARTICLE_RE, (_m, word: string) => {
      stats.nbsp++;
      return `${NBSP}${word}`;
    });
}

function applyInitials(text: string, stats: TypografStats): string {
  return text
    .replace(INITIALS_BEFORE_SURNAME_RE, (_m, i1: string, i2: string | undefined, surname: string) => {
      stats.nbsp += i2 ? 2 : 1;
      return i2 ? `${i1}${NBSP}${i2}${NBSP}${surname}` : `${i1}${NBSP}${surname}`;
    })
    .replace(
      SURNAME_BEFORE_INITIALS_RE,
      (_m, surname: string, i1: string, i2: string | undefined) => {
        stats.nbsp += i2 ? 2 : 1;
        return i2 ? `${surname}${NBSP}${i1}${NBSP}${i2}` : `${surname}${NBSP}${i1}`;
      },
    );
}

function applyNumbers(text: string, stats: TypografStats): string {
  return text
    .replace(NUMBER_UNIT_RE, (_m, num: string, unit: string) => {
      stats.nbsp++;
      return `${num}${NBSP}${unit}`;
    })
    .replace(NUMBER_SIGN_RE, (_m, sign: string) => {
      stats.nbsp++;
      return `${sign}${NBSP}`;
    })
    .replace(YEAR_CENTURY_RE, (_m, num: string, abbr: string) => {
      stats.nbsp++;
      return `${num}${NBSP}${abbr}`;
    })
    .replace(CURRENCY_RE, (_m, num: string, cur: string) => {
      stats.nbsp++;
      return `${num}${NBSP}${cur}`;
    });
}

// ABBREV_GLUE_RES допускают и НУЛЕВОЙ пробел между частями сокращения
// (уже стоит "т.д." вплотную) — в этом случае матч есть, а реально
// заменять нечего, /[ \t]+/ внутри не находит совпадения, и m.replace
// возвращает строку без изменений. Считаем только те случаи, где пробел
// в исходнике правда был (и правда стал неразрывным).
function applyAbbreviations(text: string, stats: TypografStats): string {
  let result = text;
  for (const re of ABBREV_GLUE_RES) {
    result = result.replace(re, (m) => {
      if (/[ \t]/.test(m)) stats.nbsp++;
      return m.replace(/[ \t]+/, NBSP);
    });
  }
  return result.replace(REF_ABBREV_RE, (_m, abbr: string) => {
    stats.nbsp++;
    return `${abbr}.${NBSP}`;
  });
}

// DASH_RE — дефис между словами реально становится длинным тире, это
// самостоятельный, заметный глазу эффект (stats.dash), а не просто ещё
// одна неразрывность. EXISTING_EM_DASH_RE — тире уже было длинным,
// меняется только пробел перед ним (stats.nbsp), сам символ тире не
// трогаем.
function applyDash(text: string, stats: TypografStats): string {
  return text
    .replace(DASH_RE, (_m, before: string, after: string) => {
      stats.dash++;
      return `${before}${NBSP}— ${after}`;
    })
    .replace(EXISTING_EM_DASH_RE, (_m, before: string) => {
      stats.nbsp++;
      return `${before}${NBSP}—`;
    });
}

// Прямые/типографские двойные кавычки -> «ёлочки» — но если содержимое
// САМОЙ пары кавычек не содержит ни одной кириллической буквы (то есть
// это вставка английского текста внутри русского предложения, например
// Он сказал "hello" мне), по правилам русской типографики вокруг такой
// иноязычной вставки положены "лапки" (обычные типографские двойные
// кавычки), а не «ёлочки». Пары по-прежнему чередуются строго по порядку
// появления (открытие/закрытие) — см. известное упрощение про
// вложенность в комментарии выше; стиль конкретной пары выбирается уже
// ПОСЛЕ того, как пара найдена, по её содержимому.
function applyQuotes(text: string, stats: TypografStats): string {
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "“" || ch === "”" || ch === "„") {
      positions.push(i);
    }
  }
  if (positions.length === 0) return text;

  const replacement = new Map<number, string>();
  for (let p = 0; p + 1 < positions.length; p += 2) {
    const openIdx = positions[p];
    const closeIdx = positions[p + 1];
    const isForeign = !CYRILLIC_RE.test(text.slice(openIdx + 1, closeIdx));
    replacement.set(openIdx, isForeign ? "“" : "«");
    replacement.set(closeIdx, isForeign ? "”" : "»");
    stats.quotes++;
  }

  let result = "";
  for (let i = 0; i < text.length; i++) {
    // Непарная кавычка (нечётный "хвост" без закрытия) в replacement не
    // попадает — оставляем как есть, менять её не на что.
    result += replacement.get(i) ?? text[i];
  }
  return result;
}

// ${...} — инлайн-подстановка значения в шаблонизаторе Mindbox (например
// "${item.Product.Name}"), встречается прямо внутри текстовых узлов
// вперемешку с обычным текстом. Это код, а не человеческий текст:
// кавычки/дефисы/пробелы внутри выражения не должны превращаться в
// «ёлочки»/тире/неразрывные пробелы — см. согласованные правила
// форматирования Mindbox-конструкций. Поэтому такие участки вырезаются
// перед обработкой и возвращаются на место без изменений.
const INTERPOLATION_RE = /\$\{[^}]*\}/g;

function applyTypographyToPlainText(text: string, stats: TypografStats): string {
  let result = text;
  result = applyQuotes(result, stats);
  result = applyDash(result, stats);
  result = applyAbbreviations(result, stats);
  result = applyInitials(result, stats);
  result = applyNumbers(result, stats);
  result = applyPrepositionsAndParticles(result, stats);
  return result;
}

export function applyTypography(text: string, stats: TypografStats): string {
  if (!CYRILLIC_RE.test(text)) {
    return text;
  }
  if (!text.includes("${")) {
    return applyTypographyToPlainText(text, stats);
  }
  let result = "";
  let lastIndex = 0;
  INTERPOLATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INTERPOLATION_RE.exec(text)) !== null) {
    result += applyTypographyToPlainText(text.slice(lastIndex, match.index), stats);
    result += match[0];
    lastIndex = match.index + match[0].length;
  }
  result += applyTypographyToPlainText(text.slice(lastIndex), stats);
  return result;
}
