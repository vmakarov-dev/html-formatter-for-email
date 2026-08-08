  // Согласование числительного с существительным "тег" (1 тег, 2 тега,
  // 5 тегов, 11 тегов, 21 тег, ...) и с прилагательным "незакрытый"
  // (форма на -ый только при n=1, кроме чисел вида *11 — иначе "-ых").
  function pluralizeTag(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return "тегов";
    if (mod10 === 1) return "тег";
    if (mod10 >= 2 && mod10 <= 4) return "тега";
    return "тегов";
  }
  // Согласование числительного со словом "штука" ("1 штука, 2 штуки,
  // 5 штук, 11 штук, 21 штука, ...") — те же mod10/mod100 правила, что и
  // у pluralizeTag выше, просто другое существительное. Используется в
  // сводных плашках "Удалены (не влияет на вёрстку):"/"Типографика
  // готова:" (см. renderCountPlate).
  function pluralizeShtuka(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return "штук";
    if (mod10 === 1) return "штука";
    if (mod10 >= 2 && mod10 <= 4) return "штуки";
    return "штук";
  }
  function unclosedAdjective(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    return mod10 === 1 && mod100 !== 11 ? "незакрытый" : "незакрытых";
  }
  // Согласование числительного со словом "конструкция" (1 конструкция,
  // 2 конструкции, 5 конструкций, ...) — для незакрытых @{for ...}/
  // @{if ...} (см. isMindboxConstruct в diagnostics-view.js), отдельно от
  // pluralizeTag/unclosedAdjective выше: "конструкция" — существительное
  // женского рода, склоняется иначе, чем "тег".
  function pluralizeConstruct(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return "конструкций";
    if (mod10 === 1) return "конструкция";
    if (mod10 >= 2 && mod10 <= 4) return "конструкции";
    return "конструкций";
  }
  // Общее для любого существительного женского рода, требующего формы
  // "-ая"/"-ых" (сейчас — "конструкция" и "кавычка", см. вызовы ниже) —
  // само прилагательное склоняется одинаково независимо от конкретного
  // существительного, только числительное+существительное у каждого свои.
  function unclosedFeminineAdjective(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    return mod10 === 1 && mod100 !== 11 ? "незакрытая" : "незакрытых";
  }
  // Зеркало unclosedFeminineAdjective для "неоткрытая"/"неоткрытых" (см.
  // QuoteIssue в src/formatter.ts — "unopened": кавычка затесалась внутрь
  // значения БЕЗ открывающей пары).
  function unopenedFeminineAdjective(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    return mod10 === 1 && mod100 !== 11 ? "неоткрытая" : "неоткрытых";
  }
  // Согласование числительного со словом "кавычка" (1 кавычка, 2 кавычки,
  // 5 кавычек, 11 кавычек, 21 кавычка, ...) — для плашки "N незакрытых
  // кавычек..." (см. updateQuoteIssuesStatus).
  function pluralizeQuote(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return "кавычек";
    if (mod10 === 1) return "кавычка";
    if (mod10 >= 2 && mod10 <= 4) return "кавычки";
    return "кавычек";
  }

  // ==========================================================
  // Статус-дэшборд: чипы (.status-chip, минималистичные — "всё ок" или
  // статистика без действия) и карточки (.status-card — требуют внимания).
  // См. .status-dashboard/.status-chip/.status-card в CSS. Иконки — общий
  // визуальный язык между обоими ярусами: галочка (всегда зелёная, даже у
  // серого по смыслу "просто статистика" чипа — см. запрос пользователя)
  // и цветной треугольник у карточек (тот же цвет, что раньше был у рамки
  // всей плашки целиком).

  function svgIcon(inner, size) {
    const span = document.createElement("span");
    span.innerHTML =
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${inner}</svg>`;
    return span.firstChild;
  }
  function iconCheck() {
    const el = svgIcon(
      '<path d="M4 12.5L9.5 18L20 6" stroke="var(--ok-text)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
      16,
    );
    el.className = "status-chip-icon";
    return el;
  }
  const TRIANGLE_COLOR_VAR = {
    alert: "var(--error)",
    warning: "var(--warning-text)",
    "warning-light": "var(--warning-text-light)",
  };
  function iconTriangle(cls) {
    const c = TRIANGLE_COLOR_VAR[cls] || "var(--error)";
    const el = svgIcon(
      `<path d="M12 3L22 20H2L12 3Z" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"/>` +
        `<path d="M12 9.5V14" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>` +
        `<circle cx="12" cy="16.8" r="1.2" fill="${c}"/>`,
      15,
    );
    el.className = "status-card-icon";
    return el;
  }
  // Голубой "?" — та же пастельная гамма, что и у отмеченного чекбокса
  // (--checkbox-fill), намеренно НЕ красный/жёлтый: это не статус, а
  // нейтральное "здесь есть подробности", не должен читаться как тревога.
  // Чуть крупнее галочки (см. iconCheck) — по запросу пользователя.
  function iconQuestion() {
    return svgIcon(
      '<circle cx="12" cy="12" r="9.5" stroke="var(--checkbox-fill)" stroke-width="2"/>' +
        '<path d="M9.2 9.5C9.2 7.9 10.5 7 12 7C13.5 7 14.8 7.9 14.8 9.3C14.8 10.9 13 11.2 12.3 12.4C12.1 12.75 12 13.15 12 13.6" ' +
        'stroke="var(--checkbox-fill)" stroke-width="1.8" stroke-linecap="round"/>' +
        '<circle cx="12" cy="16.6" r="1.1" fill="var(--checkbox-fill)"/>',
      18,
    );
  }

  // Минималистичный чип "всё в порядке" — просто галочка и короткий текст,
  // без деталей и без попапа (см. запрос пользователя: "Теги
  // сбалансированы"/"Значимых пустых атрибутов нет" достаточно оставить
  // как есть).
  function renderOkChip(el, text) {
    el.innerHTML = "";
    el.className = "status-chip status-chip-ok";
    el.appendChild(iconCheck());
    const label = document.createElement("span");
    label.className = "status-chip-label";
    label.textContent = text;
    el.appendChild(label);
    reparentStatusEl(el, statusChipRow);
  }

  // Наведение (десктоп) ИЛИ клик по "?" открывают попап; клик ещё и
  // "закрепляет" его открытым (pinned) — без этого на мобильном (нет
  // наведения вовсе) кнопку было бы нечем открыть, а на десктопе не было
  // бы способа удержать его открытым без мыши на месте. Клик вне чипа —
  // снимает закрепление. Именно так пользователь и попросил: "на десктопе
  // и при наведении, и при нажатии — на мобиле при нажатии".
  //
  // Наведение нарочно навешено ТОЛЬКО на саму иконку "?" и сам попап (не
  // на весь чип целиком, см. запрос пользователя) — иначе попап открывался
  // бы просто от наведения на галочку/текст, а не только на "?". Небольшая
  // задержка перед скрытием (hideTimer) — чисто техническая: между иконкой
  // и попапом есть зазор (см. top: calc(100% + 8px) в CSS), без задержки
  // мышь успевала бы "выйти" из иконки раньше, чем "войти" в попап, и он
  // мигал бы закрытым на пути к себе самому.
  function attachChipPopup(infoBtn, popupEl) {
    let pinned = false;
    let hideTimer = null;
    function show() {
      clearTimeout(hideTimer);
      popupEl.hidden = false;
      infoBtn.setAttribute("aria-expanded", "true");
    }
    function hideNow() {
      popupEl.hidden = true;
      infoBtn.setAttribute("aria-expanded", "false");
    }
    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!pinned) hideNow();
      }, 150);
    }
    infoBtn.addEventListener("mouseenter", show);
    infoBtn.addEventListener("mouseleave", scheduleHide);
    popupEl.addEventListener("mouseenter", show);
    popupEl.addEventListener("mouseleave", scheduleHide);
    infoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      pinned = !pinned;
      if (pinned) show();
      else {
        clearTimeout(hideTimer);
        hideNow();
      }
    });
    document.addEventListener("click", (e) => {
      if (pinned && e.target !== infoBtn && !popupEl.contains(e.target)) {
        pinned = false;
        clearTimeout(hideTimer);
        hideNow();
      }
    });
  }

  // Чип "статистика без действия" (типограф, очистка лишнего кода) — та же
  // галочка (см. renderOkChip), но ЕЩЁ и голубой "?" рядом: сама
  // статистика (что именно поменяли и сколько раз) спрятана в попап,
  // чтобы плашка не разбухала от списка на узком экране (см. запрос
  // пользователя). items — уже без нулевых пунктов (см. CountedItem в
  // src/formatter.ts), пустой массив просто гасит чип целиком (проверка
  // выключена или менять было нечего).
  function renderStatsChip(el, items, shortLabel, popupTitle) {
    if (items.length === 0) {
      el.textContent = "";
      el.className = "status-chip";
      return;
    }
    el.innerHTML = "";
    el.className = "status-chip status-chip-ok";
    el.appendChild(iconCheck());

    // "?" сразу после галочки, ПЕРЕД текстом (см. запрос пользователя) —
    // не в конце подписи.
    const infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.className = "status-chip-info";
    infoBtn.setAttribute("aria-label", "Подробнее: " + shortLabel);
    infoBtn.setAttribute("aria-expanded", "false");
    infoBtn.appendChild(iconQuestion());
    el.appendChild(infoBtn);

    const label = document.createElement("span");
    label.className = "status-chip-label";
    label.textContent = shortLabel;
    el.appendChild(label);

    const popup = document.createElement("div");
    popup.className = "status-chip-popup";
    popup.hidden = true;
    const popupTitleEl = document.createElement("div");
    popupTitleEl.className = "status-chip-popup-title";
    popupTitleEl.textContent = popupTitle;
    popup.appendChild(popupTitleEl);
    const list = document.createElement("ul");
    list.className = "empty-attrs-list";
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = `${item.label}: ${item.count} ${pluralizeShtuka(item.count)}`;
      list.appendChild(li);
    }
    popup.appendChild(list);
    el.appendChild(popup);

    attachChipPopup(infoBtn, popup);
    reparentStatusEl(el, statusChipRow);
  }

  // Карточка "требует внимания" — цветной треугольник + заголовок в
  // #status-card-head, дальше вызывающая сторона дополняет содержимым
  // (список строк, кнопка "Удалить все" и т.п.) через buildContent.
  function renderActionCard(el, titleText, cls, buildContent) {
    el.innerHTML = "";
    el.className = "status-card status-" + cls;
    const head = document.createElement("div");
    head.className = "status-card-head";
    head.appendChild(iconTriangle(cls));
    const titleEl = document.createElement("span");
    titleEl.className = "status-card-title";
    titleEl.textContent = titleText;
    head.appendChild(titleEl);
    el.appendChild(head);
    if (buildContent) buildContent(el);
    reparentStatusEl(el, statusCardGrid);
  }

  // outputStatus/emptyAttrsFillStatus — единственные два элемента, у
  // которых состояние "всё ок" (чип) и "есть проблема" (карточка)
  // взаимоисключающие и меняются от прогона к прогону: вместо двух
  // фиксированных DOM-узлов на каждое состояние — один и тот же элемент
  // физически переезжает между .status-chip-row и .status-card-grid (см.
  // разметку в web/index.html). appendChild на уже присоединённый к DOM
  // узел — стандартное поведение браузера, просто перемещает его, без
  // клонирования и без потери навешенных на дочерние элементы обработчиков.
  function reparentStatusEl(el, container) {
    if (el.parentElement !== container) container.appendChild(el);
  }

  // Сводка справа от заголовка "Результат": сколько тегов сейчас реально
  // помечены красным флажком (workingTags.length — уменьшается и при
  // принятии, и при отклонении подсказки), плюс отдельно — сколько из
  // них пользователь осознанно отклонил (rejectedCount, только он растёт
  // от rejectSuggestion, отдельно от общего количества). Если проверка
  // выключена чекбоксом — ничего не показываем: мы её не проводили.
  //
  // Особый случай: если проблемных тегов вообще не осталось (openCount
  // === 0), но это получилось ТОЛЬКО за счёт того, что пользователь
  // отклонил вообще все подсказки подряд (rejectedCount === изначальному
  // количеству, ни одна не была принята по-настоящему) — это НЕ то же
  // самое, что "сбалансировано": теги как были не в порядке в исходнике,
  // так и остались, мы просто перестали про них напоминать. Показываем
  // это отдельным красным сообщением, а не зелёным "сбалансированы".
  //
  // workingTags — теперь список ГРУПП (см. UnclosedTagGroup в
  // src/formatter.ts), каждая с одним или несколькими тегами внутри (kind
  // на самой группе всегда "unclosed", см. applyFormatResult) — считаем
  // раздельно для HTML-тегов и Mindbox-конструкций ("N незакрытых, M
  // незакрытых конструкций"), а не одной обезличенной суммой: конкретика
  // важнее краткости. Счёт — в ТЕГАХ (см. flatWorkingTags), а не группах:
  // totalFlaggedCount/rejectedCount тоже считаются в тегах (см.
  // applyFormatResult/rejectGroupSuggestion/rejectTagDeletion), единицы
  // должны совпадать, иначе allRejected ниже никогда не сойдётся.
  function flatWorkingTags() {
    const flat = [];
    for (const g of workingTags) for (const t of g.tags) flat.push(t);
    return flat;
  }
  function updateOutputStatus() {
    if (!checkUnclosedTags.checked || outputEditedManually) {
      outputStatus.textContent = "";
      outputStatus.className = "status-chip";
      return;
    }
    const flatTags = flatWorkingTags();
    const openCount = flatTags.length;
    const allRejected =
      openCount === 0 && rejectedCount > 0 && rejectedCount === totalFlaggedCount;
    // "Всё ок" (и никто ничего не отклонял) — минималистичный чип, без
    // карточки (см. renderOkChip/запрос пользователя). Как только есть
    // хоть один незакрытый тег ИЛИ пользователь отклонил вообще все
    // подряд (allRejected — реальная проблема осталась, просто про неё
    // перестали напоминать) — переезжает в карточку среди "требует
    // внимания" (см. renderActionCard).
    if (openCount === 0 && !allRejected) {
      let text = "Теги сбалансированы";
      if (rejectedCount > 0) text += ` (отклонённые - ${rejectedCount})`;
      renderOkChip(outputStatus, text);
      return;
    }
    let title;
    if (openCount > 0) {
      // unclosed делится на две грамматически разные подкатегории —
      // обычные HTML-теги ("N незакрытых тегов") и Mindbox-конструкции
      // @{for ...}/@{if ...} ("N незакрытых конструкций", см.
      // isMindboxConstruct) — само число проблемных мест и вся механика
      // принятия/отклонения при этом не меняются вовсе, различается
      // только формулировка сводки.
      const unclosedTagCount = flatTags.filter((t) => !isMindboxConstruct(t.tagName)).length;
      const unclosedConstructCount = flatTags.filter((t) => isMindboxConstruct(t.tagName)).length;
      const clauses = [];
      if (unclosedTagCount > 0) {
        clauses.push(`${unclosedTagCount} ${unclosedAdjective(unclosedTagCount)} ${pluralizeTag(unclosedTagCount)}`);
      }
      if (unclosedConstructCount > 0) {
        clauses.push(
          `${unclosedConstructCount} ${unclosedFeminineAdjective(unclosedConstructCount)} ${pluralizeConstruct(unclosedConstructCount)}`,
        );
      }
      title = clauses.join(", ");
    } else {
      title = "Возможны проблемы с тегами";
    }
    if (rejectedCount > 0) {
      title += ` (отклонённые - ${rejectedCount})`;
    }
    renderActionCard(outputStatus, title, "alert", (el) => {
      // Список тегов под заголовком — тот же приём, что и у "Пустые
      // атрибуты" (см. renderEmptyAttrsPlate): имя тега, через двоеточие
      // — строки, где он отмечен, номер строки кликабелен. Только
      // КРАСНЫЕ флажки (lastOpenFlags — строка самой проблемы), серые
      // строки-подсказки (lastCloseFlags) в список не попадают — они не
      // место самого дефекта, а лишь предполагаемое место починки, и уже
      // видны как отдельная серая строка прямо в выводе.
      if (openCount > 0) el.appendChild(buildTagFlagList());
    });
  }

  // Группирует lastOpenFlags — обычные (не входящие ни в цепочку, ни в
  // outlook-обёртку) теги по имени, как и раньше ("table: 12, 44, ...") —
  // группы из НЕСКОЛЬКИХ вложенных тегов (f.groupSpecial, см.
  // unclosedGroupLabel/buildDisplayHtml в diagnostics-view.js) получают
  // ОДНУ общую запись на всю группу с готовой подписью (f.groupLabel —
  // либо "<первый>...<последний>", либо "Outlook-комментарий", см. запрос
  // пользователя) вместо обычного имени тега, а её строки — это строки
  // ОТКРЫТИЯ каждого тега группы по порядку. Порядок записей в списке —
  // порядок первого появления в документе (тот же порядок, что и у
  // lastOpenFlags самого, см. buildDisplayHtml/workingTags).
  function buildTagFlagList() {
    const entries = [];
    const byKey = new Map();
    for (const f of lastOpenFlags) {
      const key = f.groupSpecial ? "group:" + f.groupUid : "tag:" + f.tagName;
      let entry = byKey.get(key);
      if (!entry) {
        const label = f.groupSpecial
          ? f.groupLabel
          : isMindboxConstruct(f.tagName)
            ? mindboxOpenLabel(f.tagName)
            : `<${f.tagName}>`;
        entry = { label, rows: [] };
        byKey.set(key, entry);
        entries.push(entry);
      }
      entry.rows.push(f.row);
    }
    const list = document.createElement("ul");
    list.className = "empty-attrs-list";
    for (const entry of entries) {
      const li = document.createElement("li");
      li.appendChild(document.createTextNode(`${entry.label}: `));
      entry.rows.forEach((row, i) => {
        if (i > 0) li.appendChild(document.createTextNode(", "));
        const link = document.createElement("span");
        link.className = "empty-attrs-line-link";
        link.textContent = String(row + 1);
        link.addEventListener("click", () => scrollRowIntoView(row));
        li.appendChild(link);
      });
      list.appendChild(li);
    }
    return list;
  }

  // Плашка "N незакрытых кавычек, M неоткрытых кавычек:" (см.
  // QuoteIssue/findQuoteIssues в src/formatter.ts) — часть той же
  // проверки "Проверить целостность тегов" (тот же чекбокс, что и у
  // outputStatus/workingTags), но чисто информационная: в отличие от
  // незакрытых тегов, тут нет ни попапа, ни возможности принять/
  // отклонить конкретное вхождение — кавычка уже не может сломать
  // структуру дерева/тегов (см. justSawEquals в src/parser.ts), только
  // предупреждаем о подозрительном месте. lastUnclosedQuoteAttrs/
  // lastUnopenedQuoteAttrs обновляются в applyFormatResult, а при ручной
  // правке вывода — ещё и в checkQuoteIssuesResolvedAndReformat.
  //
  // В отличие от остальных сводок, ручная правка вывода эту плашку НЕ
  // заглушает. У других плашек молчание оправдано: их данные (номера
  // строк подсказок) после правки уже ничем не подкреплены, а обновить их
  // нечем — попап знает только про своё вхождение. У кавычек же есть
  // отдельная перепроверка по таймеру (см. scheduleQuoteFixCheck), которая
  // пересчитывает диагностику целиком и держит эти два списка свежими, —
  // значит и заглушать нечего.
  //
  // Реальный баг, найденный пользователем: пользователь чинит ОДНУ из
  // двух кавычек прямо в выводе, а плашка пропадает ЦЕЛИКОМ — вместе с
  // предупреждением о второй, ещё не исправленной. Приходилось жать
  // "Переформатировать", чтобы вернуть его.
  function updateQuoteIssuesStatus() {
    const active = checkUnclosedTags.checked;
    const unclosed = active ? lastUnclosedQuoteAttrs : [];
    const unopened = active ? lastUnopenedQuoteAttrs : [];
    const unclosedCount = unclosed.reduce((sum, g) => sum + g.locations.length, 0);
    const unopenedCount = unopened.reduce((sum, g) => sum + g.locations.length, 0);
    if (unclosedCount === 0 && unopenedCount === 0) {
      quoteIssuesStatus.textContent = "";
      quoteIssuesStatus.className = "status-card";
      return;
    }
    const clauses = [];
    if (unclosedCount > 0) {
      clauses.push(
        `${unclosedCount} ${unclosedFeminineAdjective(unclosedCount)} ${pluralizeQuote(unclosedCount)}`,
      );
    }
    if (unopenedCount > 0) {
      clauses.push(
        `${unopenedCount} ${unopenedFeminineAdjective(unopenedCount)} ${pluralizeQuote(unopenedCount)}`,
      );
    }
    renderActionCard(quoteIssuesStatus, clauses.join(", "), "alert", (el) => {
      const list = document.createElement("ul");
      list.className = "empty-attrs-list";
      for (const group of [...unclosed, ...unopened]) {
        const li = document.createElement("li");
        li.appendChild(document.createTextNode(`${group.attrName}: `));
        group.locations.forEach(({ line }, i) => {
          if (i > 0) li.appendChild(document.createTextNode(", "));
          const link = document.createElement("span");
          link.className = "empty-attrs-line-link";
          link.textContent = String(line + 1);
          link.addEventListener("click", () => handleQuoteIssueLineClick(line));
          li.appendChild(link);
        });
        list.appendChild(li);
      }
      el.appendChild(list);
    });
  }

  // Клик по номеру строки в плашке кавычек — просто скроллит к ней. В
  // отличие от handleEmptyAttrLineClick (пустые атрибуты) мигать нечем:
  // надёжно найти в подсветке именно ТУ подстроку, что стала значением
  // атрибута из-за пропавшей кавычки, нельзя — четкой границы для неё в
  // разметке часто просто нет.
  function handleQuoteIssueLineClick(line) {
    const row = lastOrigToFinalRow[line];
    if (row === undefined) return;
    scrollRowIntoView(row);
  }

  // Общий рендер плашки "Пустые атрибуты (...):" — используется и для
  // "надо заполнить" (el/groups/title = emptyAttrsFillStatus/
  // lastEmptyAttrsFill/"надо заполнить", класс status-alert, без кнопки
  // — самим не вывести значение, решение только за человеком), и для
  // "можно удалить" (muted-класс + кнопка "Удалить все", см.
  // deleteAllEmptyAttrs). См. checkEmptyAttrsOwn/categorizeEmptyAttr в
  // src/formatter.ts. Подсветки в самом коде по умолчанию нет — только
  // список "имя атрибута: строки, где встречен", но каждый номер строки
  // кликабелен (см. handleEmptyAttrLineClick) и по клику подскажет,
  // мигнув самим атрибутом прямо в #output.
  function renderEmptyAttrsPlate(el, groups, title, cls, withDeleteButton) {
    if (groups.length === 0) {
      el.textContent = "";
      el.className = "status-card";
      return;
    }
    renderActionCard(el, title, cls, (cardEl) => {
      const list = document.createElement("ul");
      list.className = "empty-attrs-list";
      for (const group of groups) {
        const li = document.createElement("li");
        li.appendChild(document.createTextNode(`${group.attrName}: `));
        group.lines.forEach((line, i) => {
          if (i > 0) li.appendChild(document.createTextNode(", "));
          const link = document.createElement("span");
          link.className = "empty-attrs-line-link";
          link.textContent = String(line + 1);
          link.addEventListener("click", () => handleEmptyAttrLineClick(group.attrName, line));
          li.appendChild(link);
        });
        list.appendChild(li);
      }
      cardEl.appendChild(list);
      if (withDeleteButton) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "empty-attrs-delete-all";
        btn.textContent = "Удалить все";
        btn.addEventListener("click", deleteAllEmptyAttrs);
        cardEl.appendChild(btn);
      }
    });
  }

  // Плашка "Артефакты очищены" — что поменяла "Очистка лишнего кода"
  // (class="esd-text", <tbody>, &#39; → апостроф, см. removedServiceItems/
  // src/serviceCleanup.ts). Чисто информационная статистика без действия
  // — минималистичный чип с попапом (см. renderStatsChip/запрос
  // пользователя), а не отдельная карточка. Выключенный чекбокс или
  // ручная правка вывода — молчим, как и остальные сводки; если чекбокс
  // включён, но убирать было нечего — тоже молчим (пользователь просил
  // не упоминать нулевые пункты, а не выводить пустой чип).
  function updateServiceCleanupStatus() {
    const active = cleanServiceAttrs.checked && !outputEditedManually;
    renderStatsChip(
      serviceCleanupStatus,
      active ? lastRemovedServiceItems : [],
      "Артефакты очищены",
      "Очищено (не влияет на вёрстку):",
    );
  }

  // Чип "Типографика готова" — что поменял типограф (неразрывные пробелы/
  // тире/кавычки, см. typografyItems/src/typograf.ts). Те же правила
  // показа/молчания и тот же принцип (статистика без действия — чип с
  // попапом), что и у updateServiceCleanupStatus.
  function updateTypografyStatus() {
    const active = typografy.checked && !outputEditedManually;
    renderStatsChip(
      typografyStatus,
      active ? lastTypografyItems : [],
      "Типографика готова",
      "Типографика готова:",
    );
  }

  // lastEmptyAttrsFill/Delete обновляются только в applyFormatResult (не
  // трогаются при accept/reject подсказок по тегам — независимая
  // диагностика), но функция вызывается и из renderOutput — чтобы сразу
  // погаснуть, как только пользователь начинает редактировать вывод
  // вручную (см. outputEditedManually).
  function updateEmptyAttrsStatus() {
    const active = checkEmptyAttrs.checked && !outputEditedManually;
    const showFill = active ? lastEmptyAttrsFill : [];
    const showDelete = active ? lastEmptyAttrsDelete : [];
    // Проверка включена, прогон свежий, и ничего не нашлось — явно
    // сообщаем об этом зелёной плашкой (та же роль, что у "Теги
    // сбалансированы" у outputStatus), а не молча оставляем обе плашки
    // пустыми: иначе не отличить "всё чисто" от "проверка выключена".
    if (active && showFill.length === 0 && showDelete.length === 0) {
      renderOkChip(emptyAttrsFillStatus, "Значимых пустых атрибутов нет");
      emptyAttrsDeleteStatus.textContent = "";
      emptyAttrsDeleteStatus.className = "status-card";
      return;
    }
    renderEmptyAttrsPlate(
      emptyAttrsFillStatus,
      showFill,
      "Пустые атрибуты (надо заполнить):",
      "warning",
      false,
    );
    renderEmptyAttrsPlate(
      emptyAttrsDeleteStatus,
      showDelete,
      "Пустые атрибуты (можно удалить):",
      "warning-light",
      true,
    );
  }

  // Пользователь нажал "Удалить все" на плашке "можно удалить" — убирает
  // САМ АТРИБУТ (например, class="") из соответствующих строк
  // lastCleanHtml целиком, не трогая ничего вокруг. На каждой затронутой
  // строке могут быть НЕСКОЛЬКО таких атрибутов сразу (например,
  // class="" и style="" у одного тега) — собираем их по строкам и чистим
  // все разом за один проход по этой строке, а не по одному через
  // повторные split/join (иначе пришлось бы отдельно следить за сдвигом
  // индексов внутри строки).
  function deleteAllEmptyAttrs() {
    const byLine = new Map();
    for (const group of lastEmptyAttrsDelete) {
      for (const line of group.lines) {
        if (!byLine.has(line)) byLine.set(line, new Set());
        byLine.get(line).add(group.attrName);
      }
    }
    const lines = lastCleanHtml.split("\n");
    for (const [lineIndex, attrNames] of byLine) {
      let text = lines[lineIndex];
      for (const attrName of attrNames) {
        const re = new RegExp("\\s*\\b" + attrName + "\\b\\s*=\\s*(\"\"|'')", "gi");
        text = text.replace(re, "");
      }
      lines[lineIndex] = text;
    }
    lastCleanHtml = lines.join("\n");
    // Полный повторный прогон форматтера — тот же приём, что и
    // reformatAfterAllResolved у тегов: гарантированно верно
    // пересчитывает и пустые атрибуты (список "можно удалить" должен
    // опустеть), и остальную диагностику по свежему тексту.
    applyFormatResult(lastCleanHtml, false);
  }

  // Общая точка перерисовки #output из текущих lastCleanHtml/workingTags
  // — используется и после форматирования, и после принятия/отклонения
  // подсказки в попапе, и после прямого редактирования в #outputEditor.
  // Позиция скролла сохраняется (сброс к началу при замене innerHTML —
  // стандартное поведение браузера, здесь оно не нужно: пользователь
  // кликает попап/печатает именно там, где сейчас смотрит).
  //
  // outputEditor.value обновляем ТОЛЬКО если он реально отличается от
  // lastCleanHtml — если правка началась С НЕГО (см. его же "input"-
  // listener ниже), на этот момент они УЖЕ совпадают, и присваивание
  // .value заново без необходимости сбросило бы позицию курсора/выделения
  // ровно того типа бага, который отдельно чинили для поля ввода (см.
  // комментарий у normalizeAttrsWhitespace в parser.ts).
  // Строит emptyAttrDomIndex (см. объявление выше) — обходит DOM #output
  // ПОСЛЕ того, как innerHTML уже выставлен, считая перенесённые строки
  // ровно так же, как они попали в саму разметку (join("\n") в
  // buildDisplayHtml), чтобы индекс совпадал с системой координат
  // origToFinalRow/resultLines. Пустой атрибут в подсветке — это всегда
  // пара соседних span.tok-attr + span.tok-val, где textContent значения
  // — буквально "" или '' (см. highlightAttrs).
  function buildEmptyAttrDomIndex() {
    const index = new Map();
    let row = 0;
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        for (const ch of node.textContent) if (ch === "\n") row++;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.classList.contains("tok-attr")) {
        const valEl = node.nextElementSibling;
        if (valEl && valEl.classList.contains("tok-val")) {
          const val = valEl.textContent;
          if (val === '""' || val === "''") {
            if (!index.has(row)) index.set(row, new Map());
            const byAttr = index.get(row);
            const attrName = node.textContent;
            if (!byAttr.has(attrName)) byAttr.set(attrName, []);
            byAttr.get(attrName).push({ attrEl: node, valEl });
          }
        }
      }
      for (const child of node.childNodes) visit(child);
    }
    for (const child of output.childNodes) visit(child);
    return index;
  }

  // Индекс "номер строки -> имя атрибута (нижний регистр) -> [{attrEl,
  // valEl}, ...]" для ВСЕХ атрибутов на строке (не только пустых, как у
  // buildEmptyAttrDomIndex выше) — нужен applyQuoteIssueHighlights, чтобы
  // найти ровно тот атрибут по имени, на который указывает диагностика
  // кавычек (см. QuoteIssue в src/formatter.ts). МАССИВ, а не одна
  // запись — несколько простых инлайн-тегов подряд (например, два <a>
  // только с текстом внутри) сворачиваются в ОДНУ строку вывода (см.
  // isFlowNode в src/formatter.ts), так что один и тот же атрибут (тот же
  // "href") на одной строке вполне может встретиться больше одного раза.
  function buildAttrDomIndexByRow() {
    const index = new Map();
    let row = 0;
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        for (const ch of node.textContent) if (ch === "\n") row++;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.classList.contains("tok-attr")) {
        const valEl = node.nextElementSibling;
        if (!index.has(row)) index.set(row, new Map());
        const byAttr = index.get(row);
        const key = node.textContent.toLowerCase();
        const entry = { attrEl: node, valEl: valEl && valEl.classList.contains("tok-val") ? valEl : null };
        if (byAttr.has(key)) byAttr.get(key).push(entry);
        else byAttr.set(key, [entry]);
      }
      for (const child of node.childNodes) visit(child);
    }
    for (const child of output.childNodes) visit(child);
    return index;
  }

  // Оборачивает РОВНО ОДИН символ-кавычку внутри значения атрибута в
  // отдельный <span class="quote-issue-mark"> — не всё значение целиком
  // (см. запрос пользователя: подсветить "атрибут... и одну существующую
  // кавычку", а не всё значение и не место вставки). mode:
  // - "opening" — незакрытая (QuoteIssue.kind "unclosed"): значение само
  //   НАЧИНАЕТСЯ с настоящей открывающей кавычки (иначе оно не попало бы
  //   в эту категорию, см. findQuoteIssues) — берём именно её, самый
  //   первый символ.
  // - "stray" — неоткрытая ("unopened"): кавычки в начале нет (значение
  //   без кавычек по правилам HTML), но где-то внутри затесалась одна
  //   лишняя — берём первую попавшуюся.
  function wrapQuoteCharAt(el, idx) {
    const text = el.textContent;
    const before = text.slice(0, idx);
    const quoteChar = text[idx];
    const after = text.slice(idx + 1);
    el.textContent = "";
    if (before) el.appendChild(document.createTextNode(before));
    const mark = document.createElement("span");
    // Зелёный (см. .quote-issue-found-mark в CSS), а не красный, как у
    // имени атрибута: сама кавычка реально есть в коде и стоит правильно —
    // мы никогда не рисуем кавычку, которой нет, только отмечаем уже
    // существующую (см. запрос пользователя).
    mark.className = "quote-issue-found-mark";
    mark.textContent = quoteChar;
    el.appendChild(mark);
    if (after) el.appendChild(document.createTextNode(after));
  }

  function markOneQuoteChar(valEl, mode) {
    if (mode === "opening") {
      // Незакрытая — сама кавычка всегда буквально первый символ значения
      // (findQuoteIssues заходит в ветку "unclosed" только когда значение
      // НАЧАЛОСЬ с настоящей кавычки сразу после "=").
      if (/^["']/.test(valEl.textContent)) wrapQuoteCharAt(valEl, 0);
      return;
    }
    // "stray" (неоткрытая) — потерявшее кавычки значение может занимать
    // НЕСКОЛЬКО "слов" (см. NEXT_ATTR_START_RE в src/formatter.ts), а сама
    // подсветка синтаксиса токенизирует его тем же наивным способом (по
    // пробелам), так что затесавшаяся кавычка нередко попадает не в
    // непосредственный .tok-val, а в один из следующих псевдо-атрибутных
    // .tok-attr рядом. Идём по соседям, пока не упрёмся в границу тега
    // (.tok-tag) — findQuoteIssues уже гарантирует, что настоящий
    // следующий атрибут раньше найденной кавычки не встретится, иначе
    // диагностика вообще не сработала бы.
    let el = valEl;
    while (el && (el.classList.contains("tok-val") || el.classList.contains("tok-attr"))) {
      const idx = el.textContent.search(/["']/);
      if (idx !== -1) {
        wrapQuoteCharAt(el, idx);
        return;
      }
      el = el.nextElementSibling;
    }
  }

  // Подсказка "проверьте кавычку" прямо в подсветке #output (см.
  // QuoteIssue/findQuoteIssues в src/formatter.ts) — без попапа и без
  // предложенного места вставки (осознанное решение — слишком много
  // тонкостей, где именно должна была быть кавычка), просто фоновая
  // подсветка (см. .quote-issue-mark в CSS — НЕ перекрашивает сам текст,
  // золотой .tok-attr и голубой .tok-val остаются как есть) на имени
  // атрибута и на одной уже существующей кавычке.
  //
  // Условия показа ровно те же, что и у updateQuoteIssuesStatus, и это
  // ВАЖНО держать в паре: подсветка и плашка — две половины одной
  // диагностики, и если одна из них замолчит без другой, пользователь
  // увидит запись в дэшборде без подсветки в тексте (или наоборот).
  // Именно так и было: ручная правка вывода глушила подсветку, хотя
  // плашка уже умела обновляться (реальный баг — пользователь чинит одну
  // из двух кавычек, вторая остаётся в списке, но подсветка у неё
  // пропадает). Свежесть обоих списков поддерживает перепроверка по
  // таймеру, см. scheduleQuoteFixCheck.
  function applyQuoteIssueHighlights() {
    const active = checkUnclosedTags.checked;
    if (!active) return;
    if (lastUnclosedQuoteAttrs.length === 0 && lastUnopenedQuoteAttrs.length === 0) return;
    const index = buildAttrDomIndexByRow();
    // occurrence (см. QuoteIssueLocation в src/formatter.ts) — порядковый
    // номер (1-based) этого имени атрибута СРЕДИ ВСЕХ узлов на строке,
    // посчитанный на бэкенде теми же правилами обхода документа, что и
    // порядок появления в DOM здесь — так что entries[occurrence-1]
    // указывает ровно на нужное вхождение, даже если на строке вперемешку
    // есть и валидные, и сломанные вхождения одного и того же имени.
    const apply = (groups, mode) => {
      for (const group of groups) {
        for (const { line, occurrence } of group.locations) {
          const row = lastOrigToFinalRow[line];
          if (row === undefined) continue;
          const entries = index.get(row)?.get(group.attrName);
          if (!entries) continue;
          const entry = entries[occurrence - 1];
          if (!entry) continue;
          entry.attrEl.classList.add("quote-issue-mark");
          if (entry.valEl) markOneQuoteChar(entry.valEl, mode);
        }
      }
    };
    apply(lastUnclosedQuoteAttrs, "opening");
    apply(lastUnopenedQuoteAttrs, "stray");
  }

  // Клик по номеру строки в плашке "Пустые атрибуты" (см.
  // renderEmptyAttrsPlate) — скроллит #output к найденному атрибуту и
  // дважды мигает им красным. line — номер строки в системе lastCleanHtml
  // (как в group.lines), пересчитывается в реально отображаемую строку
  // через lastOrigToFinalRow (строки-подсказки о недостающих тегах могли
  // сдвинуть нумерацию).
  function handleEmptyAttrLineClick(attrName, line) {
    const row = lastOrigToFinalRow[line];
    if (row === undefined) return;
    const pairs = emptyAttrDomIndex.get(row)?.get(attrName);
    if (!pairs || pairs.length === 0) return;
    scrollElementIntoView(pairs[0].attrEl);
    for (const { attrEl, valEl } of pairs) {
      // Перезапуск анимации, если по той же строке кликнули повторно, пока
      // предыдущее мигание ещё не закончилось: снять класс, форсировать
      // reflow (чтение offsetWidth), навесить заново — иначе браузер просто
      // проигнорирует повторное добавление того же класса.
      attrEl.classList.remove("flash-empty-attr");
      valEl.classList.remove("flash-empty-attr");
      void attrEl.offsetWidth;
      attrEl.classList.add("flash-empty-attr");
      valEl.classList.add("flash-empty-attr");
      setTimeout(() => {
        attrEl.classList.remove("flash-empty-attr");
        valEl.classList.remove("flash-empty-attr");
      }, 2000);
    }
  }

