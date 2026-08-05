// Типограф: расстановка неразрывных пробелов, замена прямых кавычек на
// «ёлочки»/смарт-кавычки и дефиса-между-словами на тире — по правилам
// русской ИЛИ английской типографики, в зависимости от текста.
//
// Область применения: вызывающая сторона (formatter.ts) передаёт сюда
// только содержимое текстовых узлов (TextNode.value) — теги, атрибуты,
// содержимое <script>/<pre>/<style>, обычные комментарии сюда не
// попадают вовсе, им applyTypography не нужен.
//
// Язык: если во всём переданном фрагменте текста есть хоть одна
// кириллическая буква — применяются русские правила (см.
// applyTypographyToPlainText), английские слова внутри такого текста
// правилам не подчиняются, кроме кавычек вокруг них (см. applyQuotes —
// "лапки" для нерусской вставки). Если кириллицы нет вовсе, но есть
// латиница — применяются английские правила (applyTypographyToPlainTextEn).
// Текст без букв обоих алфавитов (только цифры/символы) не трогается.
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
const LATIN_RE = /[a-zA-Z]/;

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
  "до", "по", "из", "за", "на", "но", "не", "от", "что", "как", "для",
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

// ==========================================================
// Английская типографика — тот же набор категорий правил, что и у
// русской версии выше, адаптированный под английские конвенции (принято
// на этапе обсуждения):
// - короткие слова приклеиваются к СЛЕДУЮЩЕМУ слову неразрывным пробелом
//   (аналог русских предлогов) — расширенный список: a, an, the, to, of,
//   in, on, at, by, or, is, I. Аналога PARTICLES (слов, липнущих к
//   ПРЕДЫДУЩЕМУ) в английском нет.
// - тире между словами: "word - word" -> "word—word" — длинное тире БЕЗ
//   пробелов (американский стиль, Chicago Manual of Style), а не с
//   пробелами, как в русском варианте. Уже стоящее тире с пробелами
//   (короткое или длинное) тоже нормализуется в этот вид.
// - кавычки: двойные "..." — та же applyQuotes, что и у русского текста:
//   при отсутствии кириллицы ВЕЗДЕ в обрабатываемом фрагменте она уже
//   сама по себе выбирает "лапки" (те же смарт-кавычки “ ”, что нужны
//   английскому тексту) для каждой пары — отдельной функции не требуется.
//   Одинарные кавычки/апострофы — по стандартной эвристике "умных
//   кавычек": буква/цифра перед ' значит апостроф или закрывающая
//   кавычка (’), иначе — открывающая (‘).
const EN_NOT_WORD_BEFORE = NOT_WORD_BEFORE;
const EN_NOT_WORD_AFTER = NOT_WORD_AFTER;

// 1. Короткие слова — не отрываются от следующего слова.
const EN_SHORT_WORDS = ["a", "an", "the", "to", "of", "in", "on", "at", "by", "or", "is"];
const EN_SHORT_WORD_RE = new RegExp(
  `${EN_NOT_WORD_BEFORE}(${EN_SHORT_WORDS.slice().sort(byLengthDesc).join("|")})${EN_NOT_WORD_AFTER}[ \\t]+(?=\\S)`,
  "giu",
);
// "I" (местоимение) — только заглавная форма, регистрозависимо (в
// отличие от остальных коротких слов): строчная "i" почти всегда часть
// другого слова, а не самостоятельное местоимение.
const EN_I_RE = new RegExp(`${EN_NOT_WORD_BEFORE}(I)${EN_NOT_WORD_AFTER}[ \\t]+(?=\\S)`, "gu");

function applyEnShortWords(text: string, stats: TypografStats): string {
  return text
    .replace(EN_SHORT_WORD_RE, (_m, word: string) => {
      stats.nbsp++;
      return `${word}${NBSP}`;
    })
    .replace(EN_I_RE, (_m, word: string) => {
      stats.nbsp++;
      return `${word}${NBSP}`;
    });
}

// 2. Инициалы и фамилия: "J. R. R. Tolkien" — от 1 до 4 инициалов подряд
// (глухих или разделённых пробелом), затем фамилия с заглавной буквы.
// Известное упрощение (тот же класс, что и у русской версии, см. комментарий
// в начале файла): случайное совпадение вида "U.S.Steel" тоже подойдёт
// под шаблон "инициалы + слово с заглавной" — смыслового разбора нет.
const EN_INITIALS_BEFORE_SURNAME_RE = /((?:[A-Z]\.[ \t]*){1,4})([A-Z][a-z]+)/g;

function applyEnInitials(text: string, stats: TypografStats): string {
  return text.replace(EN_INITIALS_BEFORE_SURNAME_RE, (_m, initialsPart: string, surname: string) => {
    const initials = initialsPart.match(/[A-Z]\./g);
    if (!initials) return _m;
    stats.nbsp += initials.length;
    return initials.join(NBSP) + NBSP + surname;
  });
}

// 3. Числа: единицы измерения, валюта (в любом порядке символ/число, в
// отличие от русского — в английском знак валюты обычно идёт ПЕРЕД
// числом), время (a.m./p.m.), ссылочные сокращения перед числом.
const EN_UNITS = [
  "km", "cm", "mm", "m",
  "kg", "mg", "g", "lb", "oz",
  "mph", "ft", "in", "mi", "yd",
  "kWh", "MHz", "GHz", "Hz", "kW", "W", "V", "A",
  "°C", "°F",
  "%",
  "min", "hr", "sec", "s",
  "pt", "pc",
];
const EN_NUMBER_UNIT_RE = new RegExp(
  `(\\d)[ \\t]+(${EN_UNITS.slice().sort(byLengthDesc).join("|")})${EN_NOT_WORD_AFTER}`,
  "gu",
);

const EN_CURRENCY_RE = /(\d)[ \t]+(\$|€|£)|(\$|€|£)[ \t]+(\d)/g;

const EN_TIME_RE = /(\d)[ \t]+([ap]\.m\.|[AP]\.M\.|[ap]m|[AP]M)/g;

// Сокращения-ссылки перед числом ("p. 25", "pp. 10", "Vol. 2", "Fig. 3",
// "Ch. 4", "No. 5").
const EN_REF_ABBREV_RE = new RegExp(
  `${EN_NOT_WORD_BEFORE}(pp|p|Vol|Fig|Ch|No)\\.[ \\t]+(?=\\d)`,
  "gu",
);

function applyEnNumbers(text: string, stats: TypografStats): string {
  return text
    .replace(EN_NUMBER_UNIT_RE, (_m, num: string, unit: string) => {
      stats.nbsp++;
      return `${num}${NBSP}${unit}`;
    })
    .replace(EN_CURRENCY_RE, (_m, num: string | undefined, curAfter: string, curBefore: string, numAfter: string) => {
      stats.nbsp++;
      return num !== undefined ? `${num}${NBSP}${curAfter}` : `${curBefore}${NBSP}${numAfter}`;
    })
    .replace(EN_TIME_RE, (_m, num: string, period: string) => {
      stats.nbsp++;
      return `${num}${NBSP}${period}`;
    })
    .replace(EN_REF_ABBREV_RE, (_m, abbr: string) => {
      stats.nbsp++;
      return `${abbr}.${NBSP}`;
    });
}

// 4. Сокращения, склеиваемые между своими частями ("e. g." -> "e.&nbsp;g.").
const EN_ABBREV_GLUE_RES = [/e\.[ \t]*g\./gi, /i\.[ \t]*e\./gi];

function applyEnAbbreviations(text: string, stats: TypografStats): string {
  let result = text;
  for (const re of EN_ABBREV_GLUE_RES) {
    result = result.replace(re, (m) => {
      if (/[ \t]/.test(m)) stats.nbsp++;
      return m.replace(/[ \t]+/, NBSP);
    });
  }
  return result;
}

// 5. Дефис/короткое/длинное тире между словами -> длинное тире БЕЗ
// пробелов (в отличие от русского варианта — см. комментарий класса выше).
const EN_DASH_RE = /(\S)[ \t](?:-|–|—)[ \t](\S)/g;

function applyEnDash(text: string, stats: TypografStats): string {
  return text.replace(EN_DASH_RE, (_m, before: string, after: string) => {
    stats.dash++;
    return `${before}—${after}`;
  });
}

// 6. Апострофы/одинарные кавычки -> типографские ’/‘ по эвристике "умных
// кавычек": буква/цифра перед символом — апостроф или закрывающая
// кавычка (’), иначе — открывающая (‘). В отличие от applyQuotes (парные
// двойные кавычки), здесь пары не ищутся вовсе — апостроф в контексте
// английских сокращений ("don't", "it's") встречается на порядок чаще,
// чем настоящая одинарная кавычка, и не парный по своей природе.
function applyEnApostrophes(text: string, stats: TypografStats): string {
  let count = 0;
  const result = text.replace(/'/g, (_match: string, offset: number, full: string) => {
    const prev = offset > 0 ? full[offset - 1] : "";
    count++;
    return /[\p{L}\p{N}]/u.test(prev) ? "’" : "‘";
  });
  if (count > 0) stats.quotes += count;
  return result;
}
// === КОНЕЦ: английская типографика ===
// ==========================================================

// Инлайн-вставки шаблонизаторов внутри текстовых узлов ("${item.Name}" у
// Mindbox, "$(if [Field: Tier] == "PLATINUM")" у SendSay — реальный
// случай, встречается в письмах с доменом sendsay.ru, "[Field:
// Member_Id]"/"[*Trackable URL: lk]" — там же, уже без "$"). В отличие от
// блочных Mindbox-конструкций @{...}, эти вставки нигде не разбираются в
// отдельные узлы дерева (парсер видит их как обычный текст), поэтому
// единственная защита от порчи — исключить сам текст вставки из
// обработки типографом: это код, а не человеческий текст, кавычки/
// дефисы/пробелы внутри не должны превращаться в «ёлочки»/тире/
// неразрывные пробелы.
//
// Решили не гнаться за каждым конкретным шаблонизатором отдельно (сегодня
// Mindbox и SendSay, завтра — кто-то ещё), а защитить весь класс сразу:
// ЛЮБОЕ содержимое в фигурных {...} и квадратных [...] скобках — в
// обычном человеческом тексте (и русском, и английском) они практически
// не встречаются, в отличие от круглых (...) — те как раз обычное дело в
// прозе (вводные фразы, пояснения), поэтому их защищаем ТОЛЬКО вместе с
// маркером "$" перед ними (см. "$(...)" у SendSay), а не вообще все
// круглые скобки подряд — иначе типограф переставал бы работать внутри
// любого пояснения в скобках. Известное упрощение (тот же класс, что и у
// остальных правил типографа, см. комментарий в начале файла): вложенные
// скобки того же типа не поддерживаются, самая первая закрывающая скобка
// того же вида считается концом вставки.
const INTERPOLATION_RE = /\$\([^)]*\)|\{[^}]*\}|\[[^\]]*\]/g;

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

function applyTypographyToPlainTextEn(text: string, stats: TypografStats): string {
  let result = text;
  result = applyQuotes(result, stats);
  result = applyEnApostrophes(result, stats);
  result = applyEnDash(result, stats);
  result = applyEnAbbreviations(result, stats);
  result = applyEnInitials(result, stats);
  result = applyEnNumbers(result, stats);
  result = applyEnShortWords(result, stats);
  return result;
}

// Общая обёртка вокруг любого из двух "плоских" конвейеров выше — вырезает
// вставки шаблонизаторов перед обработкой и возвращает их на место без
// изменений (см. комментарий у INTERPOLATION_RE): риск одинаковый что
// для русского, что для английского текста (например, "${Order.Total >
// 100 or ...}" — "or" внутри выражения не должно склеиваться неразрывным
// пробелом).
function applyWithInterpolationGuard(
  text: string,
  stats: TypografStats,
  processPlain: (segment: string, stats: TypografStats) => string,
): string {
  if (!text.includes("{") && !text.includes("[") && !text.includes("$")) {
    return processPlain(text, stats);
  }
  let result = "";
  let lastIndex = 0;
  INTERPOLATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INTERPOLATION_RE.exec(text)) !== null) {
    result += processPlain(text.slice(lastIndex, match.index), stats);
    result += match[0];
    lastIndex = match.index + match[0].length;
  }
  result += processPlain(text.slice(lastIndex), stats);
  return result;
}

// Оба конвейера ловят слова только "своего" алфавита (русские regex'ы
// собраны из кириллических литералов, английские — из латинских), поэтому
// они не мешают друг другу и МОГУТ применяться к одному и тому же тексту
// оба сразу — реальный случай: двуязычный узел вида "...or respect.
// Ремарка... или уважение." (английское определение + русский перевод в
// одном <span>). Раньше применялся только ОДИН конвейер целиком (по факту
// "есть ли в узле кириллица ВООБЩЕ"), из-за чего английская часть такого
// смешанного узла типографику не получала вовсе — "or" перед последним
// словом не приклеивался неразрывным пробелом. applyQuotes вызывается в
// обоих конвейерах — если сработают оба прохода, второй пройдёт по уже
// обработанному тексту, где прямых кавычек больше нет, и ничего не
// сделает (см. ранний выход в начале applyQuotes), повторного счёта не
// будет.
export function applyTypography(text: string, stats: TypografStats): string {
  let result = text;
  if (CYRILLIC_RE.test(result)) {
    result = applyWithInterpolationGuard(result, stats, applyTypographyToPlainText);
  }
  if (LATIN_RE.test(result)) {
    result = applyWithInterpolationGuard(result, stats, applyTypographyToPlainTextEn);
  }
  return result;
}
