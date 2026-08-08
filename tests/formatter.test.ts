import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHtml, formatHtmlWithDiagnostics } from "../src/formatter.js";
import { parseHtml } from "../src/parser.js";

test("вложенность блочных элементов — 2 пробела на уровень", () => {
  const input = `<div><p>hello</p><ul><li>a</li><li>b</li></ul></div>`;
  const expected = [
    "<div>",
    "  <p>hello</p>",
    "  <ul>",
    "    <li>a</li>",
    "    <li>b</li>",
    "  </ul>",
    "</div>",
  ].join("\n");
  assert.equal(formatHtml(input), expected);
});

test("инлайн-элементы остаются в потоке текста", () => {
  const input = `<p>Hello <b>bold</b> and <a href="#">link</a> text.</p>`;
  // Всё содержимое <p> — поток (текст + инлайн-теги), поэтому весь
  // элемент схлопывается в одну строку.
  assert.equal(formatHtml(input), '<p>Hello <b>bold</b> and <a href="#">link</a> text.</p>');
});

test("инлайн-поток разрывается на отдельную строку, если рядом есть блочный элемент", () => {
  const input = `<div>Hello <b>bold</b> text.<p>separate block</p></div>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    ["<div>", "  Hello <b>bold</b> text.", "  <p>separate block</p>", "</div>"].join("\n"),
  );
});

test("<td> с текстом никогда не схлопывается в одну строку — в отличие от <p>", () => {
  const input = `<tr><td>Hello <b>bold</b> text</td></tr>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    ["<tr>", "  <td>", "    Hello <b>bold</b> text", "  </td>", "</tr>"].join("\n"),
  );
});

test("<td> без содержимого по-прежнему остаётся на одной строке", () => {
  const input = `<tr><td height="24" style="font-size: 0;"></td></tr>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    ["<tr>", '  <td height="24" style="font-size: 0;"></td>', "</tr>"].join("\n"),
  );
});

test("void-элементы без закрывающего тега", () => {
  const input = `<div><img src="a.png"><br><input type="text"></div>`;
  const out = formatHtml(input);
  // Все три тега — инлайн и void, между ними нет текста и пробелов в
  // исходнике, поэтому весь <div> схлопывается в одну "поточную" строку:
  // это не создаёт лишнего рендер-пробела между тегами и не разбивает
  // элемент без причины (см. правило "весь flow-контент — одна строка").
  assert.equal(out, '<div><img src="a.png"><br><input type="text"></div>');
});

test("void-элементы вперемешку с блочным содержимым переносятся на отдельные строки", () => {
  const input = `<div><hr><p>text</p></div>`;
  const out = formatHtml(input);
  assert.equal(out, ["<div>", "  <hr>", "  <p>text</p>", "</div>"].join("\n"));
});

test("исходный самозакрывающийся тег сохраняет слэш", () => {
  const input = `<svg><path d="M0 0" /></svg>`;
  const out = formatHtml(input);
  assert.equal(out, ["<svg>", '  <path d="M0 0" />', "</svg>"].join("\n"));
});

test("script и pre не переформатируются (byte-for-byte)", () => {
  const input = `<div><script>\n  const x = 1;\n\tif(x){console.log(  x )}\n</script><pre>  raw   text\n   here</pre></div>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    [
      "<div>",
      "  <script>\n  const x = 1;\n\tif(x){console.log(  x )}\n</script>",
      "  <pre>  raw   text\n   here</pre>",
      "</div>",
    ].join("\n"),
  );
});

test("инлайн style-атрибут не трогаем, но содержимое тега <style> форматируем", () => {
  const input = `<div style="color:  red;   margin:0"><style>.a{color:red;font-size:12px}.b   {  margin  : 0 ; }</style></div>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    [
      '<div style="color:  red;   margin:0">',
      "  <style>",
      "    .a {",
      "      color: red;",
      "      font-size: 12px;",
      "    }",
      "    .b {",
      "      margin: 0;",
      "    }",
      "  </style>",
      "</div>",
    ].join("\n"),
  );
});

test("обычный комментарий получает отступ текущего уровня, но не создаёт вложенность", () => {
  const input = `<div><!-- обычный комментарий --><p>text</p></div>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    ["<div>", "  <!-- обычный комментарий -->", "  <p>text</p>", "</div>"].join("\n"),
  );
});

test("условный комментарий участвует в иерархии как блок", () => {
  const input = `<!--[if lte IE 9]><div class="ie"><p>only IE</p></div><![endif]-->`;
  const out = formatHtml(input);
  assert.equal(
    out,
    [
      "<!--[if lte IE 9]>",
      '  <div class="ie">',
      "    <p>only IE</p>",
      "  </div>",
      "<![endif]-->",
    ].join("\n"),
  );
});

test("условный комментарий внутри обычной иерархии", () => {
  const input = `<head><!--[if lt IE 9]><script src="html5shiv.js"></script><![endif]--></head>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    [
      "<head>",
      "  <!--[if lt IE 9]>",
      '    <script src="html5shiv.js"></script>',
      "  <![endif]-->",
      "</head>",
    ].join("\n"),
  );
});

test("downlevel-revealed условный комментарий: маркеры разбиты переносами строк в исходнике, но схлопываются в одну строку", () => {
  const input = [
    "<body>",
    "<!--[if !mso]>",
    "\t\t\t\t\t<!-->",
    "<div>content</div>",
    "<!--",
    "\t\t\t\t\t<![endif]-->",
    "</body>",
  ].join("\n");
  const out = formatHtml(input);
  assert.equal(
    out,
    [
      "<body>",
      "  <!--[if !mso]><!-->",
      "    <div>content</div>",
      "  <!--<![endif]-->",
      "</body>",
    ].join("\n"),
  );
});

test("downlevel-revealed условный комментарий без разрывов (компактная запись) продолжает работать", () => {
  const input = `<body><!--[if !mso]><!--><div>content</div><!--<![endif]--></body>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    [
      "<body>",
      "  <!--[if !mso]><!-->",
      "    <div>content</div>",
      "  <!--<![endif]-->",
      "</body>",
    ].join("\n"),
  );
});

test("незакрытые теги внутри условного комментария (типичный MSO-приём) каскадно влияют на иерархию всего документа", () => {
  const input = [
    "<td>",
    "<!--[if mso]>",
    "<table><tr><td>",
    "<![endif]-->",
    "<p>Not Outlook</p>",
    "<!--[if mso]>",
    "</td></tr></table>",
    "<![endif]-->",
    "</td>",
  ].join("\n");
  const out = formatHtml(input);
  // <table>/<tr>/<td> внутри первого комментария намеренно не закрыты в
  // исходнике (парная пара тегов — во втором комментарии). Форматтер не
  // дорисовывает им закрывающие теги (это изменило бы содержимое), а
  // накопленная глубина "утекает" во всё, что идёт дальше по документу —
  // <p>, второй комментарий и его открывающий маркер — вплоть до места,
  // где "ничьи" </td></tr></table> резолвят table/tr/td. Дальше уровень
  // возвращается ПОЛНОСТЬЮ обратно — и закрывающий маркер второго
  // комментария, и всё, что идёт за ним, печатаются на том же уровне,
  // что и первый комментарий (а не на уровне table, куда они попали бы,
  // если бы возврат остановился на полпути).
  assert.equal(
    out,
    [
      "<td>",
      "  <!--[if mso]>",
      "    <table>",
      "      <tr>",
      "        <td>",
      "          <![endif]-->",
      "          <p>Not Outlook</p>",
      "          <!--[if mso]>",
      "        </td>",
      "      </tr>",
      "    </table>",
      "  <![endif]-->",
      "</td>",
    ].join("\n"),
  );
});

test("уровень вложенности после MSO-пары (table>tr>td, разрешённой через второй условный комментарий) совпадает с уровнем контента ДО неё", () => {
  // Регрессия на реальном письме: обычный комментарий перед парой
  // (<!-- main -->) и обычный комментарий после неё (<!-- main END -->)
  // — оба прямые дети <td> и по смыслу должны получить ОДИНАКОВЫЙ
  // отступ. Раньше комментарий после пары наследовал глубину table (на
  // уровень больше), потому что возврат уровня останавливался на
  // полпути — на глубине самого table, а не на глубине комментария,
  // внутри которого table в исходнике открылся.
  const input = [
    "<td>",
    "<!-- main -->",
    "<!--[if mso]>",
    "<table><tr><td>",
    "<![endif]-->",
    "<div>visible</div>",
    "<!--[if mso]>",
    "</td></tr></table>",
    "<![endif]-->",
    "<!-- main END -->",
    "</td>",
  ].join("\n");
  const out = formatHtml(input);
  assert.equal(
    out,
    [
      "<td>",
      "  <!-- main -->",
      "  <!--[if mso]>",
      "    <table>",
      "      <tr>",
      "        <td>",
      "          <![endif]-->",
      "          <div>visible</div>",
      "          <!--[if mso]>",
      "        </td>",
      "      </tr>",
      "    </table>",
      "  <![endif]-->",
      "  <!-- main END -->",
      "</td>",
    ].join("\n"),
  );
});

test("collapseOutlookComments: по умолчанию выключено, поведение не меняется", () => {
  const input = `<!--[if lte IE 9]><div class="ie"><p>only IE</p></div><![endif]-->`;
  const out = formatHtml(input);
  assert.equal(
    out,
    ["<!--[if lte IE 9]>", '  <div class="ie">', "    <p>only IE</p>", "  </div>", "<![endif]-->"].join(
      "\n",
    ),
  );
});

test("collapseOutlookComments: схлопывает условный комментарий в одну строку", () => {
  const input = `<body><!--[if lte IE 9]><div class="ie"><p>only IE</p></div><![endif]--></body>`;
  const out = formatHtml(input, { collapseOutlookComments: true });
  assert.equal(
    out,
    ["<body>", '  <!--[if lte IE 9]> <div class="ie"><p>only IE</p></div> <![endif]-->', "</body>"].join(
      "\n",
    ),
  );
});

test("collapseOutlookComments: незакрытые теги внутри не сочиняются и не влияют на иерархию документа", () => {
  const input = [
    "<td>",
    "<!--[if mso]>",
    "<table><tr><td>",
    "<![endif]-->",
    "<p>Not Outlook</p>",
    "<!--[if mso]>",
    "</td></tr></table>",
    "<![endif]-->",
    "</td>",
  ].join("\n");
  const out = formatHtml(input, { collapseOutlookComments: true });
  // Каждый комментарий схлопнут в одну строку сам по себе и никак не
  // влияет на отступ окружающего документа — <p> остаётся на том же
  // уровне, что и оба комментария, а не "утекает" вглубь.
  assert.equal(
    out,
    [
      "<td>",
      "  <!--[if mso]> <table><tr><td> <![endif]-->",
      "  <p>Not Outlook</p>",
      "  <!--[if mso]> </td></tr></table> <![endif]-->",
      "</td>",
    ].join("\n"),
  );
});

test("collapseOutlookComments: пустой условный комментарий без лишних пробелов", () => {
  const input = `<body><!--[if IE]><![endif]--></body>`;
  const out = formatHtml(input, { collapseOutlookComments: true });
  assert.equal(out, ["<body>", "  <!--[if IE]><![endif]-->", "</body>"].join("\n"));
});

test("doctype и общая структура документа", () => {
  const input = `<!DOCTYPE html><html><head><title>T</title></head><body><p>Hi</p></body></html>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    [
      "<!DOCTYPE html>",
      "<html>",
      "  <head>",
      "    <title>T</title>",
      "  </head>",
      "  <body>",
      "    <p>Hi</p>",
      "  </body>",
      "</html>",
    ].join("\n"),
  );
});

test("уже разбитый на строки хаотично исходник приводится к единому отступу", () => {
  const input = `<div>
      <p>
    text
      </p>
</div>`;
  const out = formatHtml(input);
  assert.equal(out, ["<div>", "  <p>text</p>", "</div>"].join("\n"));
});

test("типограф: включён по умолчанию — кавычки, предлоги, тире в тексте", () => {
  const input = `<p>Он сказал "привет" А. С. Пушкину - и ушел в дом.</p>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    '<p>Он сказал «привет» А.&nbsp;С.&nbsp;Пушкину&nbsp;— и&nbsp;ушел в&nbsp;дом.</p>',
  );
});

test("типограф: частица 'не' не отрывается от следующего слова", () => {
  const input = `<p>Я не видел его вчера.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>Я&nbsp;не&nbsp;видел его вчера.</p>");
});

test("типограф: предлог 'от' не отрывается от следующего слова", () => {
  const input = `<p>Видеоурок от носителей языка.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>Видеоурок от&nbsp;носителей языка.</p>");
});

test("типограф: предлог 'со' не отрывается от следующего слова", () => {
  const input = `<p>Дружим со словарём каждый день.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>Дружим со&nbsp;словарём каждый день.</p>");
});

test("типограф: предлог — последнее слово текстового узла перед соседним инлайн-тегом — всё равно приклеивается неразрывным пробелом", () => {
  // Реальный случай: "Не путать с <b>catnip</b>" — предлог "с" физически
  // последнее слово ИМЕННО этого текстового узла (дальше идёт <b>), обычный
  // PREPOSITION_RE такое не ловит (ему нужен непробельный символ ПОСЛЕ
  // пробела в той же строке) — см. glueTrailingClingingWordBeforeInline в
  // typograf.ts.
  const input = `<p>Не путать с <b>catnip</b>.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>Не&nbsp;путать с&nbsp;<b>catnip</b>.</p>");
});

test("регрессия: предлог в конце текстового узла НЕ приклеивается, если следующий сосед — блочный тег, а не инлайн (это конец фразы, а не разрыв)", () => {
  const input = `<div>Смотри в</div><div>следующий блок.</div>`;
  const out = formatHtml(input);
  assert.equal(out, "<div>Смотри в</div>\n<div>следующий блок.</div>");
});

test("типограф: typografy: false отключает преобразование текста", () => {
  const input = `<p>Он сказал "привет" А. С. Пушкину - и ушел в дом.</p>`;
  const out = formatHtml(input, { typografy: false });
  assert.equal(out, input);
});

test("типограф (английский): короткие слова приклеиваются к следующему слову", () => {
  const input = `<p>I am a big fan of the new update.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>I&nbsp;am a&nbsp;big fan of&nbsp;the&nbsp;new update.</p>");
});

test("типограф (английский): 'for' приклеивается к следующему слову", () => {
  const input = `<p>This works for half a year.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>This works for&nbsp;half a&nbsp;year.</p>");
});

test("типограф (английский): короткое слово — последнее в текстовом узле перед соседним инлайн-тегом — тоже приклеивается", () => {
  const input = `<p>This works for <b>half</b> a year.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>This works for&nbsp;<b>half</b> a&nbsp;year.</p>");
});

test("типограф (английский): инициалы и фамилия", () => {
  const input = `<p>J. R. R. Tolkien wrote this.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>J.&nbsp;R.&nbsp;R.&nbsp;Tolkien wrote this.</p>");
});

test("типограф (английский): единицы измерения, валюта в обе стороны, время, ссылочные сокращения", () => {
  const input = `<p>Run 10 km in 20 min for $ 5, pay 5 $ later, open at 9 a.m., see p. 25.</p>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    "<p>Run 10&nbsp;km in&nbsp;20&nbsp;min for&nbsp;$&nbsp;5, pay 5&nbsp;$ later, open at&nbsp;9&nbsp;a.m., see p.&nbsp;25.</p>",
  );
});

test("типограф (английский): склеивание сокращений e.g./i.e.", () => {
  const input = `<p>e. g. this works, i. e. it is tested.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>e.&nbsp;g. this works, i.&nbsp;e. it is&nbsp;tested.</p>");
});

test("типограф (английский): дефис между словами -> длинное тире без пробелов", () => {
  const input = `<p>Save today - do not miss out.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>Save today—do not miss out.</p>");
});

test("типограф (английский): двойные кавычки -> смарт-кавычки “ ”", () => {
  const input = `<p>Do not go there, "friend" - trust me.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>Do not go there, “friend”—trust me.</p>");
});

test("типограф (английский): апострофы/одинарные кавычки по эвристике 'умных кавычек'", () => {
  const input = `<p>Do not miss it, it's huge. 'Quoted' word.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>Do not miss it, it’s huge. ‘Quoted’ word.</p>");
});

test("типограф (английский): ${...}-вставки защищены от английских правил (например, 'or' внутри выражения)", () => {
  const input = `<p>\${Order.Total > 100 or Order.HasDiscount} plain text or more.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>${Order.Total > 100 or Order.HasDiscount} plain text or&nbsp;more.</p>");
});

test("типограф: $(...)-вставки другого шаблонизатора (например, SendSay) тоже защищены — кавычки внутри не превращаются в «ёлочки»/лапки", () => {
  const input = `<p>Условие: $(if [Field: Tier] == "PLATINUM") текст на русском</p>`;
  const out = formatHtml(input);
  assert.equal(out, '<p>Условие: $(if [Field: Tier] == "PLATINUM") текст на&nbsp;русском</p>');
});

test("типограф: защита от порчи распространяется на ЛЮБОЙ $(...)/$[...] — например, ещё не встречавшийся вариант $[...]", () => {
  const input = `<p>Условие: $[if Tier == "GOLD"] текст на русском</p>`;
  const out = formatHtml(input);
  assert.equal(out, '<p>Условие: $[if Tier == "GOLD"] текст на&nbsp;русском</p>');
});

test("типограф: защита распространена на ЛЮБОЕ {...} и [...] без обязательного маркера $ — например, голые merge-теги вида [Field: Member_Id]", () => {
  const input = `<p>Метка: [Field: Member_Id] и текст. Значение: {price - 10} тоже.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>Метка: [Field: Member_Id] и&nbsp;текст. Значение: {price - 10} тоже.</p>");
});

test("типограф: круглые скобки БЕЗ маркера $ — это обычная человеческая пунктуация, типографика внутри них по-прежнему работает", () => {
  const input = `<p>Текст с пояснением (просто скобки - вот так) продолжается.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>Текст с&nbsp;пояснением (просто скобки&nbsp;— вот так) продолжается.</p>");
});

test("типограф: голый текст между двумя блочными тегами (реальный случай — условие стороннего шаблонизатора между двумя <table>) не трогается вовсе", () => {
  const input = `<div><table><tr><td>a</td></tr></table>$(if [Field: Tier] == "BASIC" - test)<table><tr><td>b</td></tr></table></div>`;
  const out = formatHtml(input);
  assert.match(out, /\$\(if \[Field: Tier\] == "BASIC" - test\)/);
});

test("типограф: тот же голый текст между <table> — счётчики типографа его не учитывают вовсе", () => {
  const input = `<div><table><tr><td>a</td></tr></table>Кириллица "проверка" - тест<table><tr><td>b</td></tr></table></div>`;
  const { typografyItems } = formatHtmlWithDiagnostics(input);
  assert.deepEqual(typografyItems, []);
});

test("типограф: текст — ЕДИНСТВЕННОЕ содержимое <p>/<span> (оба соседа отсутствуют) — не считается 'голым между блоками', типографика работает как обычно", () => {
  const input = `<div>before</div><p>Он сказал "привет" - и ушел.</p><div>after</div>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    ["<div>before</div>", '<p>Он сказал «привет»&nbsp;— и&nbsp;ушел.</p>', "<div>after</div>"].join("\n"),
  );
});

test("типограф: текст рядом с инлайн-элементом (span) — не считается 'голым между блоками', даже если с другой стороны блочный тег", () => {
  const input = `<div>before</div><span>Он сказал "привет" - и ушел.</span><div>after</div>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    ["<div>before</div>", '<span>Он сказал «привет»&nbsp;— и&nbsp;ушел.</span>', "<div>after</div>"].join("\n"),
  );
});

test("типограф: обычный текст — ЕДИНСТВЕННОЕ содержимое <td> — типографируется как раньше", () => {
  const input = `<table><tr><td>Итого: "сумма" - 100 рублей</td></tr></table>`;
  const out = formatHtml(input);
  assert.match(out, /«сумма»&nbsp;— 100 рублей/);
});

test("типограф: двуязычный узел (английское определение + русский перевод) — оба конвейера срабатывают в одном тексте", () => {
  const input = `<p>Compliment is a remark that expresses approval, admiration, or respect. Ремарка, которая выражает одобрение, восхищение или уважение.</p>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    "<p>Compliment is&nbsp;a&nbsp;remark that expresses approval, admiration, or&nbsp;respect. Ремарка, которая выражает одобрение, восхищение или&nbsp;уважение.</p>",
  );
});

test("типограф: не трогает атрибуты, содержимое script/style и обычные комментарии", () => {
  const input =
    `<div title="привет - пока" data-x="в доме">` +
    `<script>const s = "привет - пока";</script>` +
    `<style>.a::before{content:"в доме"}</style>` +
    `<!-- привет - пока -->` +
    `</div>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    [
      '<div title="привет - пока" data-x="в доме">',
      '  <script>const s = "привет - пока";</script>',
      "  <style>",
      '    .a::before {',
      '      content: "в доме";',
      "    }",
      "  </style>",
      "  <!-- привет - пока -->",
      "</div>",
    ].join("\n"),
  );
});

test("типограф: чисто латинский текст обрабатывается английскими правилами (нет кириллицы рядом)", () => {
  const input = `<p>This is "pure" English - text, no changes here.</p>`;
  const out = formatHtml(input);
  assert.equal(out, "<p>This is&nbsp;“pure” English—text, no changes here.</p>");
});

test("диагностика незакрытых тегов: простой случай — <span> внутри не закрыт", () => {
  const input = `<div><span>text</div>`;
  const { unclosedTags } = formatHtmlWithDiagnostics(input);
  // "</div>" в источнике реально есть — он просто "проглочен" незакрытым
  // <span> как чужой тег, и при рендере матчится с записью <div> (та же
  // строка текста, что и есть в файле), поэтому сам <div> не флагуется.
  // <span> остаётся незакрытым; предполагаемое место для </span> — перед
  // строкой с </div> (строка 3), на отступе span (depth 1).
  assert.deepEqual(unclosedTags, [
    { line: 1, tagName: "span", insertBeforeLine: 3, depth: 1, insertConfidence: "reliable" },
  ]);
});

test("диагностика незакрытых тегов: в норме пустой список", () => {
  const input = `<div><p>hello</p></div>`;
  const { unclosedTags } = formatHtmlWithDiagnostics(input);
  assert.deepEqual(unclosedTags, []);
});

test("диагностика незакрытых тегов: MSO-пара, резолвящаяся через другой условный комментарий — не флагуется", () => {
  const input = [
    "<td>",
    "<!--[if mso]>",
    "<table><tr><td>",
    "<![endif]-->",
    "<p>Not Outlook</p>",
    "<!--[if mso]>",
    "</td></tr></table>",
    "<![endif]-->",
    "</td>",
  ].join("\n");
  const { unclosedTags } = formatHtmlWithDiagnostics(input);
  assert.deepEqual(unclosedTags, []);
});

test("диагностика незакрытых тегов: MSO-открытие без парного закрытия нигде — флагуется каждый тег на своей строке", () => {
  const input = [
    "<td>",
    "<!--[if mso]>",
    "<table><tr><td>",
    "<![endif]-->",
    "<p>Not Outlook</p>",
    "</td>",
  ].join("\n");
  const { unclosedTags } = formatHtmlWithDiagnostics(input);
  // Все три вытесняются попутно, в момент закрытия внешнего <td> (строка
  // 7 в выводе) — предполагаемое место для всех трёх закрывающих тегов
  // одно и то же (перед строкой 7), но на разных отступах.
  assert.deepEqual(unclosedTags, [
    { line: 2, tagName: "table", insertBeforeLine: 7, depth: 2, insertConfidence: "reliable" },
    { line: 3, tagName: "tr", insertBeforeLine: 7, depth: 3, insertConfidence: "reliable" },
    { line: 4, tagName: "td", insertBeforeLine: 7, depth: 4, insertConfidence: "reliable" },
  ]);
});

test("группировка незакрытых тегов: цепочка table>tr>td, целиком открытая в незакрытом outlook-комментарии, объединяется в одну группу с предложением обернуть в новую [if mso]-конструкцию", () => {
  const input = [
    "<td>",
    "<!--[if mso]>",
    "<table><tr><td>",
    "<![endif]-->",
    "<p>Not Outlook</p>",
    "</td>",
  ].join("\n");
  const { unclosedTagGroups } = formatHtmlWithDiagnostics(input);
  assert.equal(unclosedTagGroups.length, 1);
  const group = unclosedTagGroups[0];
  assert.deepEqual(
    group.tags.map((t) => t.tagName),
    ["table", "tr", "td"],
  );
  assert.equal(group.insertBeforeLine, 7);
  assert.equal(group.insertConfidence, "reliable");
  assert.equal(group.needsConditionalCommentWrap, true);
  assert.equal(group.conditionalCommentText, "<!--[if mso]>");
});

test("группировка незакрытых тегов: обычная (не-outlook) цепочка table>tr>td объединяется в одну группу без обёртки", () => {
  const input = "<table><tr><td>text</div>";
  const { unclosedTagGroups } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.equal(unclosedTagGroups.length, 1);
  const group = unclosedTagGroups[0];
  assert.deepEqual(
    group.tags.map((t) => t.tagName),
    ["table", "tr", "td"],
  );
  assert.equal(group.needsConditionalCommentWrap, false);
  assert.equal(group.conditionalCommentText, null);
});

test("группировка незакрытых тегов: если точка вставки и так ещё внутри исходного условного комментария — обёртка не нужна", () => {
  const input = ["<!--[if mso]>", "<span>", "<table><tr><td>text", "</span>", "<![endif]-->"].join("\n");
  const { unclosedTagGroups } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.equal(unclosedTagGroups.length, 1);
  assert.equal(unclosedTagGroups[0].needsConditionalCommentWrap, false);
});

test("группировка незакрытых тегов: два НЕ связанных родством незакрытых тега, случайно вытесненные в одну и ту же точку, НЕ объединяются в одну цепочку", () => {
  // <b> и <c> — оба прямые дети уже по-настоящему ЗАКРЫТОГО <a> (значит, у
  // самого <a> нет своей записи в leak-стеке, и parentEntry у b/c — null у
  // обоих, а не друг у друга) — оба вытесняются одной и той же </a> в одну
  // и ту же точку вставки, но родства между собой не имеют. Простое
  // совпадение insertBeforeLine само по себе не должно их объединять — см.
  // подтверждённое пользователем правило ("цепочка ВЛОЖЕННЫХ предков", а
  // не "любые совпавшие по точке вставки").
  const input = ["<a>", "<!--[if mso]><b><![endif]-->", "<!--[if mso]><c><![endif]-->", "</a>"].join("\n");
  const { unclosedTagGroups } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.equal(unclosedTagGroups.length, 2);
  assert.deepEqual(
    unclosedTagGroups.map((g) => g.tags.length),
    [1, 1],
  );
  assert.deepEqual(
    unclosedTagGroups.map((g) => g.tags[0].tagName),
    ["b", "c"],
  );
});

test("insertConfidence: остаётся uncertain, когда родства не видно ни по дереву, ни по ghost-таблице", () => {
  // Обе стороны открыты ВНУТРИ условных комментариев и при этом не связаны
  // родством — приём ghost-таблиц тут ни при чём (см.
  // isWrappedByOutlookBridge: он про случай "обёртка в комментарии, а
  // содержимое снаружи"). Гадать о точной позиции вставки в такой
  // путанице по-прежнему нельзя.
  const input = [
    "<div>",
    "<!--[if mso]></div><![endif]-->",
    "<!--[if mso]>",
    "<!--[if mso]><div><![endif]-->",
    "<!--[if mso]><div><![endif]-->",
    "<span>",
    "<!--[if mso]></div><![endif]-->",
    "<!--[if mso]>",
    "text",
  ].join("\n");
  const { unclosedTagGroups } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
    typografy: false,
  });
  const span = unclosedTagGroups.find((g) => g.tags[0].tagName === "span");
  assert.ok(span, "тег <span> должен попасть в диагностику");
  assert.equal(span.insertConfidence, "uncertain");
});

test("формат: formatHtml по-прежнему возвращает просто строку (обратная совместимость)", () => {
  const input = `<div><p>hello</p></div>`;
  assert.equal(typeof formatHtml(input), "string");
});

test("не падает на сильно перепутанной разметке (регрессия): 'ничей' закрывающий тег может резолвить запись предка, из-за которой стек незакрытых тегов раньше портился", () => {
  // Минимальный воспроизводящий пример реального краша: <c> не находит
  // "</c>" сразу и по пути проглатывает "</a>" и "</b>" как чужие
  // закрывающие теги; "</a>" резолвит запись <a> (предка на несколько
  // уровней выше), из-за чего стек на момент закрытия <b>/<c> оказывается
  // короче, чем они "помнят" по своей отметке (leakMark) — раньше
  // попытка обрезать стек до этой отметки НАРАЩИВАЛА массив пустыми
  // дырами (array.length = N больше текущей длины — стандартное для JS,
  // но неожиданное здесь поведение), и следующий же "ничей" тег падал на
  // чтении .tagName у дыры.
  const input = "<a><b><c>text</a></b></c></b></dummy>";
  assert.doesNotThrow(() => formatHtmlWithDiagnostics(input));
});

test("insertConfidence: тег внутри ghost-таблицы Outlook получает reliable — обёртка ему настоящий предок, просто не по дереву", () => {
  // Приём ghost-таблиц: <a> открыт ВНУТРИ условного комментария, а
  // видимое содержимое (<c>) лежит СНАРУЖИ него. По дереву разбора они
  // соседи (комментарий — отдельный узел), поэтому обычная проверка
  // "потомок ли" родства не видит. Но в отрисованном письме <c> находится
  // именно внутри <a>, и точка, где <a> закрывается, — ровно то место,
  // где закрылся бы и <c>. Раньше такой тег получал uncertain: ни серой
  // строки-подсказки, ни кнопки "Добавить?" — хотя позиция вычислялась
  // верная (реальный случай из письма: единственный незакрытый <div>
  // внутри ghost-колонки). См. isWrappedByOutlookBridge.
  const input = [
    "<!--[if mso]>",
    "<a>",
    "<![endif]-->",
    "<c>sibling never closed",
    "<!--[if mso]>",
    "</a>",
    "<![endif]-->",
  ].join("\n");
  const { html, unclosedTags } = formatHtmlWithDiagnostics(input);
  assert.deepEqual(unclosedTags, [
    { line: 3, tagName: "c", insertBeforeLine: 5, depth: 2, insertConfidence: "reliable" },
  ]);
  // Точка вставки — ПЕРЕД открывающим маркером outlook-конструкции, а не
  // внутри неё: сам <c> живёт в обычном контенте, видимом всем почтовым
  // клиентам, и закрывающий тег для него обязан быть виден им же. Раньше
  // сюда подставлялась строка </a> ВНУТРИ <!--[if mso]>...<![endif]-->:
  // после такой "починки" <c> оставался незакрытым везде, кроме Outlook,
  // а диагностика при этом показывала, что всё чисто (см. insertLineFor).
  assert.match(html.split("\n")[5], /^\s*<!--\[if mso\]>$/);
});

test("пропущенный </tr> глубоко внутри обычного контента не флагует попутно закрывающиеся ancestor-теги (регрессия по реальному MSO-письму)", () => {
  // Внешний <tr> не закрыт (как если бы в реальной вёрстке кто-то забыл
  // </tr>), но внутри него — полностью корректная вложенная table>tr>td
  // структура с двумя строками, каждая честно закрыта. Раньше парсер,
  // ища "</tr>" для ВНЕШНЕГО tr, продолжал сканирование сквозь "ничьи"
  // закрывающие теги предков (</table> потом </td> — оба принадлежат
  // объемлющим table/td, а не текущему tr) и по ошибке хватал первый
  // попавшийся "</tr>" дальше по документу — даже если тот на самом деле
  // не имеет никакого отношения к сломанному tr. matchesAncestorClose
  // останавливает разбор текущего тега, как только встречен закрывающий
  // тег, совпадающий с каким-то НАСТОЯЩИМ предком выше — тогда все
  // вложенные table/tr/td резолвятся нормально, и флагуется только
  // единственный реально сломанный внешний <tr>.
  const input = [
    "<table>",
    "<tr>",
    "<td>",
    "<table><tr><td>a</td></tr><tr><td>b</td></tr></table>",
    "</td>",
    "</table>",
  ].join("\n");
  const { unclosedTags } = formatHtmlWithDiagnostics(input);
  assert.deepEqual(unclosedTags, [
    { line: 1, tagName: "tr", insertBeforeLine: 16, depth: 1, insertConfidence: "reliable" },
  ]);
});

test("незакрытый <tr>/<td> неявно закрывается следующим соседним <tr> — поломка не расползается на весь документ", () => {
  // Пропущен </tr> у первой строки — как в реальной вёрстке под Outlook,
  // где таких строк сотни. Раньше это заставляло парсер "проглотить" всё,
  // что идёт дальше (включая второй <tr> и его настоящий </tr>), как
  // детей сломанного тега. Теперь новый <tr> сам по себе неявно закрывает
  // предыдущий — как и в настоящих браузерах — и второй <tr> остаётся
  // отдельным, правильно вложенным соседом, а не потомком первого.
  const input = ["<table>", "<tr><td>row1</td>", "<tr><td>row2</td></tr>", "</table>"].join(
    "\n",
  );
  const { html, unclosedTags } = formatHtmlWithDiagnostics(input);
  assert.deepEqual(unclosedTags, [
    { line: 1, tagName: "tr", insertBeforeLine: 10, depth: 1, insertConfidence: "reliable" },
  ]);
  assert.equal(
    html,
    [
      "<table>",
      "  <tr>",
      "    <td>",
      "      row1",
      "    </td>",
      "    <tr>",
      "      <td>",
      "        row2",
      "      </td>",
      "    </tr>",
      "</table>",
    ].join("\n"),
  );
});

test("очистка от служебных атрибутов: <tbody> разворачивается, дети остаются на его месте", () => {
  const input = `<table><tbody><tr><td>a</td></tr></tbody></table>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    [
      "<table>",
      "  <tr>",
      "    <td>",
      "      a",
      "    </td>",
      "  </tr>",
      "</table>",
    ].join("\n"),
  );
});

test("очистка от служебных атрибутов: class=\"esd-text\" убирается целиком, а из списка классов — только сам токен", () => {
  const input =
    `<div class="esd-text">hi</div><p class="esd-text foo">bar</p>` +
    `<span class="foo esd-text bar">baz</span>`;
  const out = formatHtml(input);
  assert.equal(
    out,
    [
      '<div>hi</div>',
      '<p class="foo">bar</p>',
      '<span class="foo bar">baz</span>',
    ].join("\n"),
  );
});

test("очистка от служебных атрибутов: класс, только СОДЕРЖАЩИЙ esd-text как подстроку (не токен), не трогаем", () => {
  const input = `<div class="notesd-text-related">keep me</div>`;
  const out = formatHtml(input);
  assert.equal(out, '<div class="notesd-text-related">keep me</div>');
});

test("очистка от служебных атрибутов: cleanServiceAttrs:false отключает обе очистки", () => {
  const input = `<table><tbody><tr><td>a</td></tr></tbody></table><div class="esd-text">hi</div>`;
  const out = formatHtml(input, { cleanServiceAttrs: false });
  assert.equal(
    out,
    [
      "<table>",
      "  <tbody>",
      "    <tr>",
      "      <td>",
      "        a",
      "      </td>",
      "    </tr>",
      "  </tbody>",
      "</table>",
      '<div class="esd-text">hi</div>',
    ].join("\n"),
  );
});

test("атрибут, вручную перенесённый на следующую строку в исходнике, остаётся частью тега", () => {
  // Реальный случай из вёрстки под Outlook: у VML-тега <v:fill> атрибуты
  // разбиты на две строки вручную. attrsRaw раньше сохранял "сырой"
  // перенос строки как есть — при печати (см. openTagString) он ломал
  // допущение "один this.out.push — одна строка вывода": src визуально
  // выглядел отдельным тегом, а закрывающий </v:fill> оставался
  // приклеенным к этому обрывку без нормального переноса. Перенос
  // строки/лишние пробелы МЕЖДУ атрибутами теперь схлопываются в один
  // пробел при СБОРКЕ строки для вывода (см. normalizeAttrsWhitespace в
  // parser.ts и её использование в formatter.ts — не при разборе, см.
  // тест ниже про живую подсветку исходника).
  const input = [
    '<v:rect fill="true" stroke="false" style="width:135px;height:135px;">',
    '  <v:fill type="frame" sizes="135px,135px" aspect="atleast"',
    '    src="https://example.com/item.png"></v:fill>',
    "</v:rect>",
  ].join("\n");
  const out = formatHtml(input);
  assert.equal(
    out,
    [
      '<v:rect fill="true" stroke="false" style="width:135px;height:135px;">',
      '  <v:fill type="frame" sizes="135px,135px" aspect="atleast" src="https://example.com/item.png"></v:fill>',
      "</v:rect>",
    ].join("\n"),
  );
});

test("регрессия: parseHtml сам по себе НЕ схлопывает перенос строки внутри атрибутов (нужно живой подсветке исходника в веб-интерфейсе)", () => {
  // web/index.html подсвечивает textarea "как есть" через
  // window.HtmlFormatter.parseHtml — БЕЗ полного formatHtml — прямо поверх
  // прозрачного textarea, чтобы курсор совпадал с местом редактирования.
  // Раньше normalizeAttrsWhitespace вызывалась прямо в parseElement — и у
  // подсвеченного слоя оказывалось МЕНЬШЕ строк, чем в самом textarea, как
  // только в документе попадался тег с атрибутами, перенесёнными на
  // несколько строк вручную (реальный случай — см. тест выше про
  // <v:fill>): дальше по документу курсор на экране переставал совпадать
  // с реальным местом редактирования. attrsRaw в дереве должен оставаться
  // сырым — схлопывание нужно только при сборке строки для ВЫВОДА (см.
  // openTagString в formatter.ts).
  const input = [
    '<v:rect fill="true">',
    '  <v:fill type="frame"',
    '    src="https://example.com/item.png"></v:fill>',
    "</v:rect>",
  ].join("\n");
  const doc = parseHtml(input);
  const fillNode = doc.children[0].children.find(
    (c) => c.type === "element" && c.tagName === "v:fill",
  );
  assert.equal(fillNode.attrsRaw.includes("\n"), true);
});

test("регрессия: схлопывание пробелов в inline-потоке не трогает содержимое кавычек внутри атрибутов", () => {
  // Раньше .replace(/\s+/g, " ") применялся к УЖЕ СКЛЕЕННОЙ строке всего
  // инлайн-сегмента (текст + сериализованные инлайн-теги вместе), не
  // отличая пробелы МЕЖДУ узлами от пробелов ВНУТРИ значения атрибута —
  // несколько пробелов подряд в alt/title инлайн-тега (img, a, ...)
  // ошибочно схлопывались в один. См. collapseFlowWhitespace.
  assert.equal(
    formatHtml('<img alt="hello   world" src="x.png">'),
    '<img alt="hello   world" src="x.png">',
  );
  assert.equal(
    formatHtml('<p>Click <a href="a" title="x   y">here</a> now</p>'),
    '<p>Click <a href="a" title="x   y">here</a> now</p>',
  );
  // При этом обычное схлопывание пробелов МЕЖДУ узлами (не внутри
  // атрибутов) по-прежнему работает как раньше.
  assert.equal(
    formatHtml("<p>hello\n\n   world <b>bold</b>  end</p>"),
    "<p>hello world <b>bold</b> end</p>",
  );
});

test("диагностика тегов: пропущенный родитель НЕ предлагается вставить (тег, которого нет в вёрстке вообще) — просто не флагуется", () => {
  // По явному решению: форматтер больше не выдумывает тег, у которого нет
  // ни открывающей, ни закрывающей части в исходнике вообще — слишком
  // много тонкостей, остаётся на усмотрение пользователя. <td> оказался
  // прямым ребёнком <tbody> (родного <tr> нет вовсе) — это НЕ считается
  // незакрытым тегом (unclosedTags пуст), просто молча пропускается.
  const input = `<table><tbody><td>x</td></tbody></table>`;
  const { unclosedTags } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.deepEqual(unclosedTags, []);
});

test("диагностика тегов: несколько одинаковых пропущенных родителей подряд — тоже не флагуются", () => {
  const input = `<table><tbody><td>a</td><td>b</td></tbody></table>`;
  const { unclosedTags } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.deepEqual(unclosedTags, []);
});

test("регрессия: два отдельных вырезанных <tr> подряд (одноимённые 'подозрения') не путают друг друга и не портят вложенность", () => {
  // Внутренний предохранитель resolveStrayClose (см.
  // suspectedMissingParentCounts/checkMissingParentGuard в
  // src/formatter.ts) — просто счётчик по имени тега, а не очередь пар,
  // как раньше у публичной диагностики. Два НЕЗАВИСИМЫХ дефекта с ОДНИМ
  // и тем же именем тега ("tr") должны оба остаться на своём месте, не
  // перепутавшись и не утащив друг друга не туда.
  const input = [
    "<table>",
    "<tbody>",
    "<td>row1</td>",
    "</tr>",
    "<tr><td>mid</td></tr>",
    "<td>row2</td>",
    "</tr>",
    "</tbody>",
    "</table>",
  ].join("\n");
  const { html, unclosedTags } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.deepEqual(unclosedTags, []);
  assert.equal(
    html,
    [
      "<table>",
      "  <tbody>",
      "    <td>",
      "      row1",
      "    </td>",
      "    </tr>",
      "    <tr>",
      "      <td>",
      "        mid",
      "      </td>",
      "    </tr>",
      "    <td>",
      "      row2",
      "    </td>",
      "    </tr>",
      "  </tbody>",
      "</table>",
    ].join("\n"),
  );
});

test("регрессия: вырезанный <tr> внутри вложенной таблицы с несколькими строками не ломает вложенность внешних tr/td (matchesAncestorClose больше не хватает repeatable-предка)", () => {
  // Реальный случай из письма: во ВЛОЖЕННОЙ таблице (сама лежит внутри
  // <table><tr><td>) вырезали первый <tr> из нескольких строк. Раньше
  // matchesAncestorClose, наткнувшись на "ничей" </tr> (принадлежащий
  // вырезанной строке), находил СОВПАДАЮЩЕГО ПО ИМЕНИ внешнего <tr>
  // (двумя уровнями выше) и ошибочно считал его закрытым ЭТИМ тегом —
  // внешний <tr> закрывался слишком рано, а вторая строка вложенной
  // таблицы (<tr><td>b</td></tr>) оказывалась вынесена НАРУЖУ, как сосед
  // внешнего tr, а не его настоящий потомок. Теперь repeatable-теги
  // (tr/td/th/li/option/optgroup/dt/dd) не участвуют в этом сопоставлении
  // — тег просто остаётся "ничьим", а вложенность остального документа
  // не страдает.
  const input = [
    "<table>",
    "<tr>",
    "<td>",
    "<table>",
    "<td>a</td>",
    "</tr>",
    "<tr>",
    "<td>b</td>",
    "</tr>",
    "</table>",
    "</td>",
    "</tr>",
    "</table>",
  ].join("\n");
  const { html, unclosedTags } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(unclosedTags, []);
  // Вторая строка вложенной таблицы должна остаться ЕЁ потомком (глубина
  // 4 — как и td "a" рядом), а не всплыть на глубину внешнего tr (1).
  assert.equal(
    html,
    [
      "<table>",
      "  <tr>",
      "    <td>",
      "      <table>",
      "        <td>",
      "          a",
      "        </td>",
      "        </tr>",
      "        <tr>",
      "          <td>",
      "            b",
      "          </td>",
      "        </tr>",
      "      </table>",
      "    </td>",
      "  </tr>",
      "</table>",
    ].join("\n"),
  );
});

test("регрессия: MSO-приём (<tr> открыт в условном комментарии, <td> снаружи) — не ломает вложенность и не флагуется как незакрытый", () => {
  // Реальный приём вёрстки под Outlook: <tr> открывается внутри
  // <!--[if mso]--> и намеренно не закрывается там же, а видимый <td>
  // идёт уже СНАРУЖИ комментария (комментарий "прозрачен" для родителя,
  // так что структурный родитель <td> — <table>, а не <tr>). Раз <tr> всё
  // ещё "утёк" (висит в leakStack), внутренний предохранитель
  // checkMissingParentGuard считает его логически открытым и не портит
  // ложным "подозрением" resolveStrayClose — иначе парная "</tr>" внутри
  // второго MSO-комментария могла бы не найти пару и всё дальше по
  // документу съехало бы по отступу.
  const input = [
    "<table>",
    "<!--[if mso]>",
    "<tr>",
    "<![endif]-->",
    "<td>content</td>",
    "<!--[if mso]>",
    "</tr>",
    "<![endif]-->",
    "</table>",
  ].join("\n");
  const { html, unclosedTags } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.deepEqual(unclosedTags, []);
  assert.equal(
    html,
    [
      "<table>",
      "  <!--[if mso]>",
      "    <tr>",
      "      <![endif]-->",
      "      <td>",
      "        content",
      "      </td>",
      "      <!--[if mso]>",
      "    </tr>",
      "  <![endif]-->",
      "</table>",
    ].join("\n"),
  );
});

test("диагностика пустых атрибутов: базовые случаи (src/class/href) флагуются, alt — нет; src/href в 'надо заполнить', class — в 'можно удалить'", () => {
  const input = `<div><img src="" class="" alt=""><a href="">link</a></div>`;
  const { emptyAttrsToFill, emptyAttrsToDelete } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(emptyAttrsToFill, [
    { attrName: "src", lines: [0] },
    { attrName: "href", lines: [0] },
  ]);
  assert.deepEqual(emptyAttrsToDelete, [{ attrName: "class", lines: [0] }]);
});

test("диагностика пустых атрибутов: остальные из списка (background — 'заполнить', style/id/height — 'удалить')", () => {
  const input = `<table height="" background="" style="" id="">x</table>`;
  const { emptyAttrsToFill, emptyAttrsToDelete } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(emptyAttrsToFill, [{ attrName: "background", lines: [0] }]);
  assert.deepEqual(emptyAttrsToDelete, [
    { attrName: "height", lines: [0] },
    { attrName: "style", lines: [0] },
    { attrName: "id", lines: [0] },
  ]);
});

test("диагностика пустых атрибутов: новые target/bgcolor/align — target в 'заполнить', bgcolor/align в 'удалить'", () => {
  const input = `<a href="x" target=""><table bgcolor="" align="">x</table></a>`;
  const { emptyAttrsToFill, emptyAttrsToDelete } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(emptyAttrsToFill, [{ attrName: "target", lines: [0] }]);
  assert.deepEqual(emptyAttrsToDelete, [
    { attrName: "bgcolor", lines: [1] },
    { attrName: "align", lines: [1] },
  ]);
});

test("диагностика пустых атрибутов: width — 'заполнить' только у <img>, у остальных тегов — 'удалить'", () => {
  const input = ['<img src="x.png" width="">', '<table width=""><tr><td>x</td></tr></table>'].join(
    "\n",
  );
  const { emptyAttrsToFill, emptyAttrsToDelete } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(emptyAttrsToFill, [{ attrName: "width", lines: [0] }]);
  assert.deepEqual(emptyAttrsToDelete, [{ attrName: "width", lines: [1] }]);
});

test("диагностика пустых атрибутов: несколько вхождений одного атрибута группируются в один список строк", () => {
  const input = ["<table>", '<tr><td id="">a</td></tr>', '<tr><td id="">b</td></tr>', "</table>"].join(
    "\n",
  );
  const { emptyAttrsToDelete } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.deepEqual(emptyAttrsToDelete, [{ attrName: "id", lines: [2, 7] }]);
});

test("диагностика пустых атрибутов: находит внутри инлайн-потока, схлопнутого в одну строку", () => {
  // <a href=""> — инлайн-элемент внутри <p>, вся строка схлопывается в
  // одну (см. hasOnlyInlineFlowContent в src/formatter.ts) — сам <a> не
  // проходит через обычную построчную рекурсию, проверка должна найти
  // его атрибут отдельно (см. checkEmptyAttrsDeep).
  const input = `<p>Click <a href="" class="btn">here</a> now</p>`;
  const { emptyAttrsToFill, emptyAttrsToDelete } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(emptyAttrsToFill, [{ attrName: "href", lines: [0] }]);
  assert.deepEqual(emptyAttrsToDelete, []);
});

test("диагностика пустых атрибутов: не путает вложенные кавычки в ЧУЖОМ атрибуте с собственным именем=значением тега", () => {
  // data-config хранит JSON-подобную строку, буквально содержащую
  // текст 'src":""' — простой regex по всей строке attrsRaw мог бы
  // ошибочно распознать это как src="", посимвольный разбор — нет.
  const input = `<div data-config='{"src":""}' class="real">x</div>`;
  const { emptyAttrsToFill, emptyAttrsToDelete } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(emptyAttrsToFill, []);
  assert.deepEqual(emptyAttrsToDelete, []);
});

test("диагностика пустых атрибутов: в норме пустые списки", () => {
  const input = `<img src="x.png" class="y">`;
  const { emptyAttrsToFill, emptyAttrsToDelete } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(emptyAttrsToFill, []);
  assert.deepEqual(emptyAttrsToDelete, []);
});

test("регрессия: непарная кавычка в href НЕ ломает структуру дерева (реальный случай — 31 ложный 'незакрытый тег' из-за одной опечатки)", () => {
  // До фикса: наивное отслеживание кавычек (переключение на КАЖДОЙ,
  // без привязки к "=") принимало следующую случайно попавшуюся кавычку
  // (та, что должна была закрыть target="_blank") за закрытие href,
  // расшатывая границу самого тега <a> и утаскивая за собой разбор всего
  // остального документа. Теперь кавычка открывает "цитируемое" значение
  // ТОЛЬКО сразу после "=" (см. justSawEquals в src/parser.ts) — граница
  // тега находится верно, а остаток документа (в том числе <div>after)
  // разбирается как обычно.
  const input =
    '<table><tr><td><a href="https://samolet.ru/flats/kvartaldomashniikorpus3/ target="_blank" style="text-decoration: none; outline: none"><img alt="x" src="y.png"></a></td></tr></table><div>after</div>';
  const { html, unclosedTags } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.deepEqual(unclosedTags, []);
  assert.equal(
    html,
    [
      "<table>",
      "  <tr>",
      "    <td>",
      '      <a href="https://samolet.ru/flats/kvartaldomashniikorpus3/ target="_blank" style="text-decoration: none; outline: none"><img alt="x" src="y.png"></a>',
      "    </td>",
      "  </tr>",
      "</table>",
      "<div>after</div>",
    ].join("\n"),
  );
});

test("регрессия: если непарная кавычка так и не находит вообще никакой пары, предохранитель обрывает разбор тега на границе следующего тега, а не глотает остаток документа", () => {
  const input = `<div><a href="never closes<span>real content</span></div>`;
  const { html, unclosedTags } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  // ">" у оборванного тега НЕ дорисовывается (см. ElementNode.unterminated
  // и openTagString): в исходнике его не было вовсе, и форматтер не
  // выдумывает символы — он меняет только отступы.
  assert.equal(
    html,
    ["<div>", '  <a href="never closes', "    <span>real content</span>", "</div>"].join("\n"),
  );
  // <a> сам по себе честно остаётся незакрытым (в этом примере у него и
  // впрямь нет закрывающего тега) — это уже штатная, доверенная
  // диагностика, а не 31 посторонний ложный тег где-то дальше по письму.
  assert.equal(unclosedTags.length, 1);
  assert.equal(unclosedTags[0].tagName, "a");
});

test("регрессия: оборванный тег без ">" не отращивает по лишнему ">" на каждом повторном форматировании (порча содержимого письма)", () => {
  // Реальный дефект: форматтер безусловно дописывал ">" в конец
  // открывающего тега, даже когда в исходнике его не было (разбор
  // атрибутов оборвался предохранителем на незакрытой кавычке). Каждый
  // следующий прогон брал этот дописанный ">" уже как часть значения
  // атрибута и дописывал ещё один: broken> -> broken>> -> broken>>> ...
  // Текст письма тихо рос при каждом нажатии "Переформатировать".
  const input = `<table><tr><td><a href="broken><img></a></td></tr></table>`;
  const once = formatHtml(input, { cleanServiceAttrs: false });
  const twice = formatHtml(once, { cleanServiceAttrs: false });
  const thrice = formatHtml(twice, { cleanServiceAttrs: false });
  assert.equal(once, twice);
  assert.equal(twice, thrice);
  // И сам символ не размножился: ровно столько же ">", сколько в исходнике.
  assert.equal((once.match(/>/g) || []).length, (input.match(/>/g) || []).length);
});

test("диагностика кавычек: незакрытая (значение начинается с кавычки, но не находит пары — 'проглотило' соседний атрибут)", () => {
  const input =
    '<a href="https://samolet.ru/flats/kvartaldomashniikorpus3/ target="_blank">x</a>';
  const { unclosedQuoteAttrs, unopenedQuoteAttrs } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(unclosedQuoteAttrs, [{ attrName: "href", locations: [{ line: 0, occurrence: 1 }] }]);
  assert.deepEqual(unopenedQuoteAttrs, []);
});

test("диагностика кавычек: неоткрытая (значение без кавычек, но внутри затесалась кавычка — забыли открывающую пару)", () => {
  const input = `<a href=https://example.com" target="_blank">link</a>`;
  const { unclosedQuoteAttrs, unopenedQuoteAttrs } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(unclosedQuoteAttrs, []);
  assert.deepEqual(unopenedQuoteAttrs, [{ attrName: "href", locations: [{ line: 0, occurrence: 1 }] }]);
});

test("регрессия: неоткрытая кавычка находится, даже если потерянное значение растянуто на много 'слов' (CSS-подобные декларации через '; ')", () => {
  // Реальный случай: у атрибута style потеряна открывающая кавычка, а
  // значение внутри — это несколько CSS-деклараций через "; ", так что
  // затесавшаяся кавычка обнаруживается только далеко впереди, перед самым
  // закрытием тега — первое "слово" до пробела ("display:") кавычки не
  // содержит вовсе. Без NEXT_ATTR_START_RE поиск останавливался на первом
  // пробеле и такой случай пропускался целиком.
  const input =
    '<img src="a.png" style=display: block; height: auto; outline: none; border: 0">';
  const { unclosedQuoteAttrs, unopenedQuoteAttrs } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(unclosedQuoteAttrs, []);
  assert.deepEqual(unopenedQuoteAttrs, [{ attrName: "style", locations: [{ line: 0, occurrence: 1 }] }]);
});

test("диагностика кавычек: несколько вхождений одного атрибута группируются в один список строк", () => {
  const input =
    '<div><a href="a.com/ target="_blank">1</a></div><div><a href="b.com/ target="_blank">2</a></div>';
  const { unclosedQuoteAttrs } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.deepEqual(unclosedQuoteAttrs, [
    { attrName: "href", locations: [{ line: 0, occurrence: 1 }, { line: 1, occurrence: 1 }] },
  ]);
});

test("регрессия: валидное и сломанное вхождение ОДНОГО И ТОГО ЖЕ имени атрибута на одной строке вывода не путаются между собой (occurrence)", () => {
  // Реальный случай: два соседних инлайн-тега схлопываются в одну строку
  // вывода (см. isFlowNode) — у ПЕРВОГО style полностью валиден (обе
  // кавычки на месте), у ВТОРОГО style потерял открывающую кавычку. Без
  // occurrence (см. QuoteIssueLocation) фронтенд находил бы в DOM ПЕРВОЕ
  // попавшееся вхождение "style" на строке — то есть ВАЛИДНОЕ — и ошибочно
  // подсвечивал бы его вместо настоящего виновника.
  const input =
    '<a href="https://ok.com/" style="color:red">one</a>' +
    '<img src="a.png" style=display: block; border: 0">';
  const { unclosedQuoteAttrs, unopenedQuoteAttrs } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(unclosedQuoteAttrs, []);
  // occurrence: 2 — второе (не первое!) вхождение "style" на строке 0.
  assert.deepEqual(unopenedQuoteAttrs, [
    { attrName: "style", locations: [{ line: 0, occurrence: 2 }] },
  ]);
});

test("диагностика кавычек: в норме (валидные атрибуты) — пустые списки, ложных срабатываний нет", () => {
  const input = `<a href="https://example.com" target="_blank" style="color:red">ok</a><img src="a.png" alt="">`;
  const { unclosedQuoteAttrs, unopenedQuoteAttrs } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(unclosedQuoteAttrs, []);
  assert.deepEqual(unopenedQuoteAttrs, []);
});

test("регрессия: диагностика кавычек не путает легитимное 'слово=значение' ВНУТРИ значения (meta content, реальный случай) с проглоченным соседним атрибутом", () => {
  // SWALLOWED_ATTR_RE обязан различать "content='text/html; charset=utf-8'"
  // (после '=' ещё есть настоящее содержимое значения перед закрывающей
  // кавычкой — это НОРМА, а не опечатка) от "href='...corpus3/ target='"
  // (после '=' сразу кавычка — она ЧУЖАЯ, украдена у соседнего атрибута).
  const input =
    '<meta content="text/html; charset=utf-8" http-equiv="Content-Type">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  const { unclosedQuoteAttrs, unopenedQuoteAttrs } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(unclosedQuoteAttrs, []);
  assert.deepEqual(unopenedQuoteAttrs, []);
});

test("регрессия: незакрытая кавычка в атрибуте одного инлайн-тега не ломает перенос строк у соседних инлайн-тегов в том же потоке (collapseFlowWhitespace)", () => {
  // Тот же класс бага, что уже чинили в parseElement/normalizeAttrsWhitespace
  // (src/parser.ts) — только на этот раз в отдельной копии похожей логики
  // подсчёта кавычек внутри collapseFlowWhitespace. Без justSawEquals там
  // реальный перенос строки МЕЖДУ двумя соседними <a> в потоке ошибочно
  // считался "внутри тега" (из-за нечётного числа кавычек у первого <a> с
  // незакрытым href) и просачивался в результат буквально, вместо того
  // чтобы схлопнуться в пробел — оба <a> оказывались на одной строке
  // вывода, но с сырым "\n" внутри неё.
  const input =
    '<a href="https://samolet.ru/flats/x/ target="_blank">one</a>\n' +
    '<a href="https://example.com/">two</a>';
  const { html, unclosedQuoteAttrs } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.equal(html.includes("\n"), false);
  assert.equal(
    html,
    '<a href="https://samolet.ru/flats/x/ target="_blank">one</a> <a href="https://example.com/">two</a>',
  );
  assert.deepEqual(unclosedQuoteAttrs, [{ attrName: "href", locations: [{ line: 0, occurrence: 1 }] }]);
});

test("регрессия: вырезанный <table> в многоуровневой вложенности таблиц не ломает вложенность всего документа (matchesAncestorClose не хватает table-предка)", () => {
  // Тот же класс бага, что и раньше был у <tr> (см. соседний тест про
  // repeatable-предка), только теперь для <table>: вложенные таблицы —
  // норма для вёрстки email, и "ничей" </table> раньше мог ошибочно
  // "утащить" совпадающего по имени предка на несколько уровней выше как
  // СВОЙ закрывающий тег, преждевременно закрывая его и разрывая
  // вложенность всего, что шло дальше в документе. Реальный случай:
  // вырезали <table> в разметке в 20+ уровней вложенности — внешняя
  // таблица закрывалась на сотни строк раньше, утаскивая за собой всё
  // письмо (18 "незакрытых" тегов вместо одного настоящего дефекта).
  const input = [
    "<table>",
    "<tr><td>",
    "<div>",
    "<tr><td>",
    "<table><tr><td>a</td></tr></table>",
    "</td></tr>",
    "</table>",
    "</div>",
    "</td></tr>",
    "<tr><td>after</td></tr>",
    "</table>",
  ].join("\n");
  const { html, unclosedTags } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.deepEqual(unclosedTags, []);
  // Строка "after" должна остаться ВНУТРИ внешней таблицы (второй <tr>
  // той же таблицы), а не всплыть наружу как отдельный, не связанный с
  // ней элемент.
  assert.match(html, /after/);
  const afterLine = html.split("\n").find((l) => l.includes("after"));
  assert.ok(afterLine.startsWith("    "), "строка 'after' должна остаться на глубине вложенного <td>");
});

test("регрессия: вырезанный <table> в MSO-колонке — 'ничей' </table> не утаскивает чужой MSO table за собой (реальный дефект из письма)", () => {
  // Реальный случай: в MSO-колонке (<!--[if mso]><table><tr><td><![endif]-->)
  // видимый <div>-контент рядом ДОЛЖЕН иметь СВОЙ отдельный <table>,
  // оборачивающий <tr> — но его вырезали. Стрей "</table>" внутри <div>
  // не находит совпадения в "своём мире" (MSO table открыт ВНУТРИ
  // условного комментария, а этот </table> — снаружи) — раньше без
  // suspectedMissingParentCounts общий фолбэк-поиск resolveStrayClose
  // ошибочно утаскивал ДАЛЁКИЙ MSO table за собой, ломая отступ всего,
  // что шло дальше по документу (см. checkMissingParentGuard).
  const input = [
    "<!--[if mso]>",
    "<table><tr><td>",
    "<![endif]-->",
    "<div>",
    "<tr><td>content</td></tr>",
    "</table>",
    "</div>",
    "<!--[if mso]>",
    "</td></tr></table>",
    "<![endif]-->",
  ].join("\n");
  const { html, unclosedTags } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
  });
  assert.deepEqual(unclosedTags, []);
  assert.equal(
    html,
    [
      "<!--[if mso]>",
      "  <table>",
      "    <tr>",
      "      <td>",
      "        <![endif]-->",
      "        <div>",
      "          <tr>",
      "            <td>",
      "              content",
      "            </td>",
      "          </tr>",
      "          </table>",
      "        </div>",
      "        <!--[if mso]>",
      "      </td>",
      "    </tr>",
      "  </table>",
      "<![endif]-->",
    ].join("\n"),
  );
});

test("регрессия: многострочный HTML-комментарий не сдвигает номера строк в диагностике для всего, что идёт после него", () => {
  // this.out хранит ОДИН элемент на ОДНУ визуальную строку — это
  // инвариант, на который опирается вся диагностика (line/insertBeforeLine
  // — индексы this.out). Обычные комментарии сохраняются "как есть",
  // включая любые переносы строк из исходника — раньше многострочный
  // комментарий попадал в this.out ОДНИМ элементом с "\n" ВНУТРИ строки,
  // и this.out.length переставал совпадать с количеством строк в
  // итоговом html.split("\n") начиная с этой точки — из-за чего вся
  // диагностика после такого комментария указывала на строки со сдвигом
  // (см. реальный случай — многострочный комментарий про rating-блок в
  // письме, из-за которого номера строк дальше по документу были на 2
  // меньше настоящих).
  const input = [
    "<div>",
    "<!-- a comment",
    "   that spans",
    "   three lines -->",
    "<span>unclosed",
    "</div>",
  ].join("\n");
  const { html, unclosedTags } = formatHtmlWithDiagnostics(input, { cleanServiceAttrs: false });
  assert.deepEqual(unclosedTags, [
    { line: 4, tagName: "span", insertBeforeLine: 6, depth: 1, insertConfidence: "reliable" },
  ]);
  // insertBeforeLine должен указывать РОВНО на "</div>", а не на что-то
  // случайное со сдвигом из-за многострочного комментария выше.
  assert.equal(html.split("\n")[6], "</div>");
});

test("подсчёт типографа: неразрывный пробел после предлога 'в'", () => {
  const { typografyItems } = formatHtmlWithDiagnostics("<p>Он живёт в доме.</p>");
  assert.deepEqual(typografyItems, [{ label: "Неразрывные пробелы", count: 1 }]);
});

test("подсчёт типографа: дефис между словами становится длинным тире", () => {
  const { typografyItems } = formatHtmlWithDiagnostics("<p>Слово - слово.</p>");
  assert.deepEqual(typografyItems, [{ label: "Тире вместо дефиса", count: 1 }]);
});

test("подсчёт типографа: прямые кавычки становятся «ёлочками», считается по парам", () => {
  const { typografyItems } = formatHtmlWithDiagnostics('<p>Он сказал "привет".</p>');
  assert.deepEqual(typografyItems, [{ label: "Кавычки «ёлочки» вместо «лапок»", count: 1 }]);
});

test("подсчёт типографа: несколько срабатываний разных правил суммируются в отдельные пункты", () => {
  const { typografyItems } = formatHtmlWithDiagnostics('<p>Он сказал "привет" и "пока".</p>');
  assert.deepEqual(typografyItems, [
    { label: "Неразрывные пробелы", count: 1 },
    { label: "Кавычки «ёлочки» вместо «лапок»", count: 2 },
  ]);
});

test("подсчёт типографа: выключенная опция typografy — пустой список, даже если в тексте есть дефис", () => {
  const { typografyItems } = formatHtmlWithDiagnostics("<p>Слово - слово.</p>", { typografy: false });
  assert.deepEqual(typografyItems, []);
});

test("подсчёт типографа: текст без кириллицы, но с латиницей — тоже считается (английские правила)", () => {
  const { typografyItems } = formatHtmlWithDiagnostics('<p>Hello - world "quote".</p>');
  assert.deepEqual(typografyItems, [
    { label: "Тире вместо дефиса", count: 1 },
    { label: "Кавычки «ёлочки» вместо «лапок»", count: 1 },
  ]);
});

test("подсчёт типографа: текст без букв (только цифры/символы) не считается вовсе", () => {
  const { typografyItems } = formatHtmlWithDiagnostics("<p>123 - 456.</p>");
  assert.deepEqual(typografyItems, []);
});

test("подсчёт типографа (английский): несколько правил сразу — тире и кавычки суммируются в отдельные пункты", () => {
  const { typografyItems } = formatHtmlWithDiagnostics('<p>Do not go there, "friend" - trust me.</p>');
  assert.deepEqual(typografyItems, [
    { label: "Тире вместо дефиса", count: 1 },
    { label: "Кавычки «ёлочки» вместо «лапок»", count: 1 },
  ]);
});

test("подсчёт очистки служебных атрибутов: class=\"esd-text\" и <tbody> считаются отдельно", () => {
  const input = '<table class="esd-text"><tbody><tr><td class="esd-text foo">x</td></tr></tbody></table>';
  const { removedServiceItems, html } = formatHtmlWithDiagnostics(input, { typografy: false });
  assert.deepEqual(removedServiceItems, [
    { label: 'class="esd-text"', count: 2 },
    { label: "<tbody>", count: 1 },
  ]);
  // Сам класс убран целиком у table (был единственным), у td остался
  // только "foo", <tbody> развёрнут — <tr> теперь прямой ребёнок <table>.
  assert.equal(
    html,
    ["<table>", "  <tr>", '    <td class="foo">', "      x", "    </td>", "  </tr>", "</table>"].join("\n"),
  );
});

test("очистка служебного кода: &#39; заменяется на апостроф и в тексте, и в двойных кавычках атрибута", () => {
  const input =
    '<td style="font-family: Arial,&#39;Helvetica Neue&#39;,Helvetica">It&#39;s here</td>';
  const { html, removedServiceItems } = formatHtmlWithDiagnostics(input, { typografy: false });
  assert.equal(
    html,
    ['<td style="font-family: Arial,\'Helvetica Neue\',Helvetica">', "  It's here", "</td>"].join("\n"),
  );
  assert.deepEqual(removedServiceItems, [{ label: "&#39; заменено на апостроф", count: 3 }]);
});

test("регрессия: &#39; НЕ заменяется внутри значения атрибута в ОДИНАРНЫХ кавычках (буквальный апостроф сломал бы границу значения)", () => {
  const input = `<div title='dont&#39;t touch'><span>x</span></div>`;
  const { html, removedServiceItems } = formatHtmlWithDiagnostics(input, { typografy: false });
  assert.equal(html, `<div title='dont&#39;t touch'><span>x</span></div>`);
  assert.deepEqual(removedServiceItems, []);
});

test("подсчёт очистки служебных атрибутов: выключенная опция cleanServiceAttrs — пустой список", () => {
  const input = '<table class="esd-text"><tbody><tr><td>x</td></tr></tbody></table>';
  const { removedServiceItems } = formatHtmlWithDiagnostics(input, {
    typografy: false,
    cleanServiceAttrs: false,
  });
  assert.deepEqual(removedServiceItems, []);
});

test("подсчёт очистки служебных атрибутов: нечего убирать — пустой список", () => {
  const { removedServiceItems } = formatHtmlWithDiagnostics("<table><tr><td>x</td></tr></table>", {
    typografy: false,
  });
  assert.deepEqual(removedServiceItems, []);
});

// ===================================================================
// Калибровка движка диагностики незакрытых тегов. Каждый тест ниже —
// РЕАЛЬНЫЙ дефект, найденный на письмах пользователя и на сплошном
// прогоне инвариантов (см. tests/invariants.test.ts): ложные "незакрытые
// теги", вина не на том теге, неверная точка вставки и тихая порча
// содержимого письма при повторном форматировании.
// ===================================================================

test("незакрытый <a> не проглатывает соседний <td>: поломка остаётся на месте дефекта", () => {
  // Реальный дефект из письма (блок иконок соцсетей): у одной иконки
  // потеряли </a> и </td>. Инлайн-элемент не может содержать <td> ни при
  // каких условиях (см. matchesInlineTableBoundary в parser.ts) — раньше
  // незакрытый <a> забирал следующий <td> себе в дети, а за ним и чужие
  // </tr>/</table> на сотни строк вперёд.
  const input = [
    "<table><tr>",
    '<td><a href="u1">',
    "<img>",
    '<td><a href="u2"><img></a></td>',
    "</tr></table>",
  ].join("\n");
  const { unclosedTagGroups } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
    typografy: false,
  });
  // Ровно одна группа — сам дефект: незакрытые <td> и вложенный в него <a>.
  assert.equal(unclosedTagGroups.length, 1);
  assert.deepEqual(
    unclosedTagGroups[0].tags.map((t) => t.tagName),
    ["td", "a"],
  );
});

test("незакрытый тег ВНУТРИ ячейки не забирает себе </div> внешнего контейнера (виноват правильный тег, точка вставки — рядом)", () => {
  // Раньше matchesAncestorClose безусловно пропускал td/tr/table как
  // "неоднозначные" предки, поэтому незакрытый <div> внутри ячейки
  // пробегал мимо </td></tr></table> и присваивал себе </div> ВНЕШНЕГО
  // контейнера: виноватым объявлялся внешний div, а вставить закрывающий
  // тег предлагалось в противоположном конце документа.
  const input = [
    '<div class="outer">',
    "<table><tr><td>",
    '<div class="btn">Click',
    "</td></tr></table>",
    "</div>",
    "<p>footer</p>",
  ].join("\n");
  const { html, unclosedTagGroups } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
    typografy: false,
  });
  const lines = html.split("\n");
  assert.equal(unclosedTagGroups.length, 1);
  assert.equal(unclosedTagGroups[0].tags.length, 1);
  const flagged = unclosedTagGroups[0].tags[0];
  assert.equal(flagged.tagName, "div");
  // Виноват именно ВНУТРЕННИЙ div, а не внешний из строки 0.
  assert.match(lines[flagged.line], /class="btn"/);
  // И закрыть его предлагается прямо перед </td>, а не в конце документа.
  assert.match(lines[unclosedTagGroups[0].insertBeforeLine], /^\s*<\/td>$/);
  // Внешний контейнер при этом остался закрытым, а футер — на нулевой
  // глубине, а не уехал внутрь таблицы.
  assert.ok(lines.includes("<p>footer</p>"), "футер должен остаться на верхнем уровне");
});

test("незакрытый <style> внутри условного комментария не дублирует хвост документа на каждом прогоне", () => {
  // Критический дефект: findClosingTagIndex искал </style> по ВСЕМУ
  // остатку исходника, не замечая границу "<![endif]-->". Разбор уезжал
  // за конец условного комментария, parseComment откатывал позицию
  // НАЗАД — и весь хвост письма разбирался и печатался второй раз. При
  // каждом следующем форматировании — ещё раз (64 -> 144 -> 196 -> ...).
  const input = `<!--[if mso]><style>a{}<![endif]--><p>tail</p><style>b{}</style>`;
  const once = formatHtml(input, { cleanServiceAttrs: false, typografy: false });
  const twice = formatHtml(once, { cleanServiceAttrs: false, typografy: false });
  assert.equal(once, twice);
  // "tail" встречается ровно один раз, а не размножился.
  assert.equal(once.split("tail").length - 1, 1);
});

test("вложенный revealed-комментарий не обрывает внешний условный комментарий (и не дублирует хвост)", () => {
  // Шаблон "<![endif]-->" — подстрока закрывающей конструкции
  // revealed-варианта "<!--<![endif]-->". Без отдельной проверки внешний
  // комментарий "заканчивался" на закрывающей конструкции ВЛОЖЕННОГО
  // revealed-комментария, и всё, что после неё, разбиралось дважды.
  const input = `<!--[if mso]><div><!--[if !mso]><!--><p>x</p><!--<![endif]--></div><![endif]--><p>tail</p>`;
  const once = formatHtml(input, { cleanServiceAttrs: false, typografy: false });
  const twice = formatHtml(once, { cleanServiceAttrs: false, typografy: false });
  assert.equal(once, twice);
  assert.equal(once.split("tail").length - 1, 1);
});

test("незакрытый обычный комментарий внутри условного не выходит за его границу", () => {
  const input = `<!--[if mso]><p><!-- note <![endif]--><p>tail</p>`;
  const once = formatHtml(input, { cleanServiceAttrs: false, typografy: false });
  const twice = formatHtml(once, { cleanServiceAttrs: false, typografy: false });
  assert.equal(once, twice);
  assert.equal(once.split("tail").length - 1, 1);
});

test("символ '<' внутри закавыченного значения атрибута — законный: ни фантомных тегов, ни правки текста", () => {
  // Раньше предохранитель "<" + буква срабатывал на ЛЮБОМ "<" внутри
  // кавычек, даже когда кавычка спокойно закрывается в этом же теге:
  // валидный HTML переписывался, а в диагностике появлялся фантомный
  // тег <y>. Теперь предохранитель срабатывает только если пара у
  // кавычки находится уже ЗА концом тега (см. quoteClosesInsideThisTag).
  for (const input of [
    `<div onclick="if(x<y)f()">z</div>`,
    `<div title='a<b'>x</div>`,
    `<div title="a < 5">x</div>`,
  ]) {
    const { html, unclosedTagGroups } = formatHtmlWithDiagnostics(input, {
      cleanServiceAttrs: false,
      typografy: false,
    });
    assert.deepEqual(unclosedTagGroups, [], `ложная диагностика на ${input}`);
    assert.equal(html, input, `валидный HTML не должен переписываться: ${input}`);
  }
});

test("предохранитель по-прежнему срабатывает на ПО-НАСТОЯЩЕМУ убежавшей кавычке", () => {
  // Контроль к предыдущему тесту: исходная защита (ради которой
  // предохранитель и появился) обязана продолжать работать.
  const input = `<div title="a><span>y</span></div>`;
  const { html } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
    typografy: false,
  });
  // Разбор оборвался на границе следующего тега, а не проглотил остаток.
  assert.match(html, /<span>/);
  const twice = formatHtml(html, { cleanServiceAttrs: false, typografy: false });
  assert.equal(html, twice);
});

test("осиротевшая ячейка в начале письма не отключает разрешение исправных конструкций дальше", () => {
  // Вето suspectedMissingParents раньше считалось ГЛОБАЛЬНО, по одному
  // имени тега: один <table><td>x</td></table> (потерян <tr>) гасил
  // ПЕРВЫЙ ЖЕ встреченный дальше "</tr>" — включая совершенно исправный
  // MSO-мост в другом конце документа. Ложные срабатывания множились
  // один к одному: N сирот — N испорченных конструкций.
  const block = ["<table>", "<tr>", "<td>b</td>", "<!--[if mso]></tr></table><![endif]-->"].join("\n");
  for (const orphans of [0, 1, 2, 3]) {
    const input = "<table><td>x</td></table>\n".repeat(orphans) + block;
    const { unclosedTagGroups } = formatHtmlWithDiagnostics(input, {
      cleanServiceAttrs: false,
      typografy: false,
    });
    assert.deepEqual(
      unclosedTagGroups,
      [],
      `${orphans} осиротевших ячеек не должны ломать исправный MSO-мост`,
    );
  }
});

test("вето по пропущенному родителю всё ещё защищает вырезанный <table> (контроль к предыдущему тесту)", () => {
  // Обратная сторона: подозрение обязано продолжать гасить совпадение с
  // тегом, который лежал в стеке ЕЩЁ ДО его возникновения — иначе
  // осиротевший </table> снова начнёт утаскивать чужую MSO-таблицу.
  const input = [
    "<!--[if mso]>",
    "<table><tr><td>",
    "<![endif]-->",
    "<div>",
    "<tr><td>content</td></tr>",
    "</table>",
    "</div>",
    "<!--[if mso]>",
    "</td></tr></table>",
    "<![endif]-->",
  ].join("\n");
  const { unclosedTagGroups } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
    typografy: false,
  });
  assert.deepEqual(unclosedTagGroups, []);
});

test("точка вставки закрывающего тега не попадает внутрь outlook-конструкции", () => {
  // Тег живёт в обычном контенте, а вытесняется из стека уже внутри
  // <!--[if mso]>...<![endif]-->. Раньше закрывающий тег предлагалось
  // дописать ПРЯМО ТУДА — для всех клиентов, кроме Outlook, тег оставался
  // незакрытым, а диагностика после принятия подсказки показывала, что
  // документ чист.
  const input = [
    "<!--[if mso]><table><tr><td><![endif]-->",
    "<div>",
    "<p>x</p>",
    "<!--[if mso]></td></tr></table><![endif]-->",
  ].join("\n");
  const { html, unclosedTagGroups } = formatHtmlWithDiagnostics(input, {
    cleanServiceAttrs: false,
    typografy: false,
  });
  assert.equal(unclosedTagGroups.length, 1);
  const lines = html.split("\n");
  const at = unclosedTagGroups[0].insertBeforeLine;
  // Строка вставки — сам открывающий маркер условного комментария, то
  // есть закрывающий тег встанет ПЕРЕД ним, в обычном контенте.
  assert.match(lines[at], /^\s*<!--\[if mso\]>$/);
  // И подсказка не предлагает заворачивать его в новую MSO-обёртку.
  assert.equal(unclosedTagGroups[0].needsConditionalCommentWrap, false);
});

test("<![endif]--> не размножается при вложенных условных комментариях", () => {
  // Поиск закрывающего маркера не считал вложенность: внешний комментарий
  // "заканчивался" на маркере ВЛОЖЕННОГО, потреблял его, и всё равно
  // дописывал свой — маркеров на выходе становилось больше, чем на входе,
  // и с каждым форматированием ещё больше (93 -> 174 -> 195 -> 216 ...).
  // Ломалась при этом совершенно законная вёрстка.
  const cases = [
    `<!--[if mso]><!--[if mso]><![endif]-->`,
    `<!--[if mso]><table><tr><td> <!--[if lte mso 11]>x<![endif]--> </td></tr></table><![endif]-->`,
    `<!--[if mso]><table><tr><td>\n<div>a</div>\n<!--[if mso]></td></tr></table><![endif]-->\n<p>tail</p>`,
  ];
  for (const input of cases) {
    const once = formatHtml(input, { cleanServiceAttrs: false, typografy: false });
    const twice = formatHtml(once, { cleanServiceAttrs: false, typografy: false });
    const thrice = formatHtml(twice, { cleanServiceAttrs: false, typografy: false });
    assert.equal(once, twice, `неидемпотентно: ${input}`);
    assert.equal(twice, thrice, `неидемпотентно: ${input}`);
    // Маркеров на выходе ровно столько же, сколько на входе.
    assert.equal(
      (once.match(/<!\[endif\]-->/g) || []).length,
      (input.match(/<!\[endif\]-->/g) || []).length,
      `число <![endif]--> изменилось: ${input}`,
    );
  }
});
