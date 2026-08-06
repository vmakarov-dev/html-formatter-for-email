  const input = document.getElementById("input");
  const inputHighlight = document.getElementById("inputHighlight");
  const inputLineNumbers = document.getElementById("inputLineNumbers");
  const output = document.getElementById("output");
  const outputEditor = document.getElementById("outputEditor");
  const outputLineNumbers = document.getElementById("outputLineNumbers");
  const scrollHintUp = document.getElementById("scrollHintUp");
  const scrollHintDown = document.getElementById("scrollHintDown");
  const outputPopups = document.getElementById("outputPopups");
  const lockedTooltip = document.getElementById("lockedTooltip");
  const popupConnectors = document.getElementById("popupConnectors");
  const outputStatus = document.getElementById("outputStatus");
  const quoteIssuesStatus = document.getElementById("quoteIssuesStatus");
  const emptyAttrsFillStatus = document.getElementById("emptyAttrsFillStatus");
  const emptyAttrsDeleteStatus = document.getElementById("emptyAttrsDeleteStatus");
  const serviceCleanupStatus = document.getElementById("serviceCleanupStatus");
  const typografyStatus = document.getElementById("typografyStatus");
  // Имя элемента #status (строка ошибки под чекбоксами) намеренно так
  // называется всюду в проекте; совпадение с window.status (устаревшее
  // API строки состояния браузера, тут никогда не используется) безобидно.
  // eslint-disable-next-line no-redeclare
  const status = document.getElementById("status");
  const formatBtn = document.getElementById("formatBtn");
  const copyBtn = document.getElementById("copyBtn");
  const formatResultBtn = document.getElementById("formatResultBtn");
  const compressModerateBtn = document.getElementById("compressModerateBtn");
  const compressMaxBtn = document.getElementById("compressMaxBtn");
  const compressSizeModerate = document.getElementById("compressSizeModerate");
  const compressSizeMax = document.getElementById("compressSizeMax");
  const collapseOutlookComments = document.getElementById("collapseOutlookComments");
  const typografy = document.getElementById("typografy");
  const checkUnclosedTags = document.getElementById("checkUnclosedTags");
  const cleanServiceAttrs = document.getElementById("cleanServiceAttrs");
  const checkEmptyAttrs = document.getElementById("checkEmptyAttrs");
  const advancedToggle = document.getElementById("advancedToggle");
  const advancedToggleLabel = document.getElementById("advancedToggleLabel");
  const advancedOptions = document.getElementById("advancedOptions");

  // "Дополнительно" — просто show/hide, ничего не запускает само по себе
  // (как и остальные чекбоксы этого ряда — см. комментарий у formatBtn
  // ниже): значение "Сжать комментарии для Outlook" читается в момент
  // запуска форматирования, не раньше. aria-expanded — и для доступности,
  // и как крючок для разворота стрелки в CSS (см. .advanced-toggle-arrow).
  advancedToggle.addEventListener("click", () => {
    const willShow = advancedOptions.hidden;
    advancedOptions.hidden = !willShow;
    advancedToggle.setAttribute("aria-expanded", String(willShow));
    advancedToggleLabel.textContent = willShow ? "Скрыть" : "Дополнительно";
  });

  // lastCleanHtml — настоящий результат formatHtml (то, что копирует
  // кнопка "Скопировать"). Обычно совпадает с тем, что вернул форматтер,
  // но пользователь может явно "принять" подсказанный закрывающий тег
  // через попап (см. acceptSuggestion) — тогда он дописывается сюда по-
  // настоящему, текстом, и это уже не отменить кнопкой "Отклонить".
  let lastCleanHtml = "";
  // Рабочая копия unclosedTags — можно мутировать (убрать запись при
  // принятии/отклонении подсказки, сдвинуть номера строк у остальных
  // записей после вставки), в отличие от исходного результата форматтера.
  // __uid — стабильный на всё время жизни записи идентификатор (не
  // индекс в массиве, который меняется при удалении элементов) — по нему
  // находим соответствующий <span class="suggested-tag"> в DOM и
  // связываем красный флажок с попапом.
  let workingTags = [];
  let uidCounter = 0;
  let lastOpenFlags = []; // [{row, tagName, uid}] — красные, строка открывающего тега
  let lastCloseFlags = []; // [{row, tagName, uid}] — серые, строка подсказки (пока не решена)
  // origToFinalRow[N] — на какой ФАКТИЧЕСКИ отображаемой строке (индекс в
  // #output после вставки строк-подсказок для reliable-тегов, см.
  // buildDisplayHtml) оказалась N-я строка исходного lastCleanHtml.
  // lastEmptyAttrsFill/Delete хранят номера строк именно в системе
  // lastCleanHtml (как и остальная диагностика), поэтому клику по ним
  // (см. handleEmptyAttrLineClick) нужен этот пересчёт в реальную строку
  // на экране.
  let lastOrigToFinalRow = [];
  // line -> attrName -> [{attrEl, valEl}] — где именно в текущем DOM
  // #output физически находится каждый пустой атрибут, чтобы клик по
  // номеру строки в плашке "Пустые атрибуты" мог проскроллить и мигнуть
  // ИМЕННО на нём, а не пересчитывать координаты вручную (см.
  // buildEmptyAttrDomIndex/handleEmptyAttrLineClick). Перестраивается
  // заново при каждом renderOutput — старые ссылки на DOM-узлы после
  // output.innerHTML = ... всё равно становятся недействительными.
  let emptyAttrDomIndex = new Map();
  // Сколько подсказок пользователь явно отклонил (✕ в попапе) за текущий
  // результат форматирования — сбрасывается при каждом новом runFormat,
  // растёт только через rejectSuggestion. Показывается в outputStatus.
  let rejectedCount = 0;
  // Сколько тегов форматтер изначально пометил как незакрытые за этот
  // прогон (до любых accept/reject) — нужно, чтобы отличить "отклонили
  // ВСЕ подряд" (реально ничего не исправлено, просто перестали
  // показывать) от обычного "сбалансировано" (что-то было принято по-
  // настоящему или незакрытых не было вовсе). См. updateOutputStatus.
  let totalFlaggedCount = 0;
  // true сразу после того, как пользователь начал печатать прямо в
  // #outputEditor (см. его "input"-listener ниже) — диагностика на этот
  // момент устарела (workingTags сброшен, ничего заново не пересчитано),
  // так что статус-плашка должна промолчать, а не соврать "сбалансировано"
  // только потому, что openCount формально стал 0. Сбрасывается обратно
  // в false при следующем реальном прогоне форматтера (см. applyFormatResult).
  let outputEditedManually = false;
  // Последний результат диагностики пустых атрибутов (см.
  // EmptyAttrGroup/categorizeEmptyAttr в src/formatter.ts) —
  // [{ attrName, lines }] по каждой из двух категорий, обновляются в
  // applyFormatResult (не трогаются при accept/reject подсказок по
  // тегам — независимая диагностика) и в deleteAllEmptyAttrs (только
  // Delete — после удаления атрибутов список пуст). См.
  // updateEmptyAttrsStatus.
  let lastEmptyAttrsFill = [];
  let lastEmptyAttrsDelete = [];
  // Одиночные (без пары) кавычки внутри значений атрибутов (см.
  // QuoteIssue/findQuoteIssues в src/formatter.ts) — та же форма и те же
  // правила обновления, что и у lastEmptyAttrsFill/Delete выше. См.
  // updateQuoteIssuesStatus.
  let lastUnclosedQuoteAttrs = [];
  let lastUnopenedQuoteAttrs = [];
  // Сводки "что удалила очистка служебных атрибутов" / "что поменял
  // типограф" (см. removedServiceItems/typografyItems в
  // src/formatter.ts) — [{ label, count }], уже без нулевых пунктов.
  // Те же правила обновления, что и у lastEmptyAttrsFill/Delete выше.
  // См. updateServiceCleanupStatus/updateTypografyStatus.
  let lastRemovedServiceItems = [];
  let lastTypografyItems = [];

