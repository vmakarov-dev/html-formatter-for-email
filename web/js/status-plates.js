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
  // То же самое склонение, что и unclosedAdjective ("-ый"/"-ых" по тем же
  // правилам), но для другого прилагательного — "неоткрытый" (не хватает
  // родителя-обёртки, см. checkUnopenedChild в src/formatter.ts).
  function unopenedAdjective(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    return mod10 === 1 && mod100 !== 11 ? "неоткрытый" : "неоткрытых";
  }
  // "Лишний"/"лишних" — то же правило (-ий/-их вместо -ый/-ых, но та же
  // логика единственного числа при n===1, кроме *11) — для kind==="extra"
  // (осиротевший закрывающий тег без пары, см. ExtraTagInfo).
  function extraAdjective(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    return mod10 === 1 && mod100 !== 11 ? "лишний" : "лишних";
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
  function unclosedConstructAdjective(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    return mod10 === 1 && mod100 !== 11 ? "незакрытая" : "незакрытых";
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
  // workingTags — общий список ВСЕХ трёх видов диагностики (kind:
  // "unclosed" | "unopened" | "extra", см. runFormat) — считаем их
  // раздельными числительными ("N незакрытых, M неоткрытых, K лишних"),
  // а не одной обезличенной суммой: конкретика важнее краткости, а
  // составить фразу из трёх частей не сложнее, чем из двух.
  function updateOutputStatus() {
    if (!checkUnclosedTags.checked || outputEditedManually) {
      outputStatus.textContent = "";
      outputStatus.className = "status-plate";
      return;
    }
    const openCount = workingTags.length;
    // unclosed делится на две грамматически разные подкатегории — обычные
    // HTML-теги ("N незакрытых тегов") и Mindbox-конструкции @{for ...}/
    // @{if ...} ("N незакрытых конструкций", см. isMindboxConstruct) —
    // само число проблемных мест (workingTags.length) и вся механика
    // принятия/отклонения при этом не меняются вовсе, различается только
    // формулировка сводки.
    const unclosedTagCount = workingTags.filter(
      (e) => e.kind === "unclosed" && !isMindboxConstruct(e.tagName),
    ).length;
    const unclosedConstructCount = workingTags.filter(
      (e) => e.kind === "unclosed" && isMindboxConstruct(e.tagName),
    ).length;
    // Спаренный "неоткрытый" (kind==="unopened" с pairId) — это то же
    // самое, что и его пара в "лишних" (см. checkUnopenedChild/pairId в
    // src/formatter.ts): одна и та же строка-подсказка "Добавить?" всё
    // ещё показывается (это по-прежнему рабочий способ починить), но в
    // СЧЁТЕ участвует только один раз, под именем "лишний" — нет смысла
    // сообщать об одном и том же дефекте дважды под разными словами.
    // Несвязанный ("сирота") unopened, без пары — считается отдельно,
    // там правда нечего удалять, только добавить недостающий родитель.
    const unopenedCount = workingTags.filter((e) => e.kind === "unopened" && e.pairId == null).length;
    const extraCount = workingTags.filter((e) => e.kind === "extra").length;
    const allRejected =
      openCount === 0 && rejectedCount > 0 && rejectedCount === totalFlaggedCount;
    let text;
    let cls;
    if (openCount > 0) {
      const clauses = [];
      if (unclosedTagCount > 0) {
        clauses.push(`${unclosedTagCount} ${unclosedAdjective(unclosedTagCount)} ${pluralizeTag(unclosedTagCount)}`);
      }
      if (unclosedConstructCount > 0) {
        clauses.push(
          `${unclosedConstructCount} ${unclosedConstructAdjective(unclosedConstructCount)} ${pluralizeConstruct(unclosedConstructCount)}`,
        );
      }
      if (unopenedCount > 0) {
        clauses.push(`${unopenedCount} ${unopenedAdjective(unopenedCount)} ${pluralizeTag(unopenedCount)}`);
      }
      if (extraCount > 0) {
        clauses.push(`${extraCount} ${extraAdjective(extraCount)} ${pluralizeTag(extraCount)}`);
      }
      text = `Возможно: ${clauses.join(", ")}`;
      cls = "status-alert";
    } else if (allRejected) {
      text = "Возможны проблемы с тегами";
      cls = "status-alert";
    } else {
      text = "Теги сбалансированы";
      cls = "status-ok";
    }
    if (rejectedCount > 0) {
      text += ` (отклонённые - ${rejectedCount})`;
    }
    outputStatus.innerHTML = "";
    outputStatus.className = "status-plate " + cls;
    outputStatus.appendChild(document.createTextNode(text));
    // Список тегов под сводкой — тот же приём, что и у "Пустые атрибуты"
    // (см. renderEmptyAttrsPlate): имя тега, через двоеточие — строки, где
    // он отмечен, номер строки кликабелен. Только КРАСНЫЕ флажки
    // (lastOpenFlags — строка самой проблемы), серые строки-подсказки
    // (lastCloseFlags) в список не попадают — они не место самого
    // дефекта, а лишь предполагаемое место починки, и уже видны как
    // отдельная серая строка прямо в выводе.
    if (openCount > 0) outputStatus.appendChild(buildTagFlagList());
  }

  // Группирует lastOpenFlags по имени тега — [{ tagName, rows }], rows в
  // порядке появления в документе (тот же порядок, что и у lastOpenFlags
  // самого, см. buildDisplayHtml/workingTags).
  function buildTagFlagList() {
    const byTag = new Map();
    for (const f of lastOpenFlags) {
      if (!byTag.has(f.tagName)) byTag.set(f.tagName, []);
      byTag.get(f.tagName).push(f.row);
    }
    const list = document.createElement("ul");
    list.className = "empty-attrs-list";
    for (const [tagName, rows] of byTag) {
      const li = document.createElement("li");
      const label = isMindboxConstruct(tagName) ? mindboxOpenLabel(tagName) : `<${tagName}>`;
      li.appendChild(document.createTextNode(`${label}: `));
      rows.forEach((row, i) => {
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
      el.className = "status-plate";
      return;
    }
    el.innerHTML = "";
    el.className = "status-plate " + cls;
    const titleEl = document.createElement("div");
    titleEl.className = "empty-attrs-title";
    titleEl.textContent = title;
    el.appendChild(titleEl);
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
    el.appendChild(list);
    if (withDeleteButton) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "empty-attrs-delete-all";
      btn.textContent = "Удалить все";
      btn.addEventListener("click", deleteAllEmptyAttrs);
      el.appendChild(btn);
    }
  }

  // Плашка "заголовок + bullet-список" для сводок, где вместо номеров
  // строк — просто количество (см. CountedItem в src/formatter.ts):
  // удалённые уже удалены, менять/находить их в выводе больше незачем,
  // в отличие от renderEmptyAttrsPlate выше, ссылки на строки тут нет.
  // items — уже без нулевых пунктов (см. removedServiceItems/
  // typografyItems), пустой массив просто гасит плашку целиком.
  function renderCountPlate(el, items, title, cls) {
    if (items.length === 0) {
      el.textContent = "";
      el.className = "status-plate";
      return;
    }
    el.innerHTML = "";
    el.className = "status-plate " + cls;
    const titleEl = document.createElement("div");
    titleEl.className = "empty-attrs-title";
    titleEl.textContent = title;
    el.appendChild(titleEl);
    const list = document.createElement("ul");
    list.className = "empty-attrs-list";
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = `${item.label}: ${item.count} ${pluralizeShtuka(item.count)}`;
      list.appendChild(li);
    }
    el.appendChild(list);
  }

  // Плашка "Удалены (не влияет на вёрстку):" — что убрала "Очистка от
  // служебных атрибутов" (class="esd-text", <tbody>, см.
  // removedServiceItems/src/serviceCleanup.ts). Выключенный чекбокс или
  // ручная правка вывода — молчим, как и остальные сводки; если чекбокс
  // включён, но убирать было нечего — тоже молчим (пользователь просил
  // не упоминать нулевые пункты, а не выводить плашку с пустым списком).
  function updateServiceCleanupStatus() {
    const active = cleanServiceAttrs.checked && !outputEditedManually;
    renderCountPlate(
      serviceCleanupStatus,
      active ? lastRemovedServiceItems : [],
      "Удалены (не влияет на вёрстку):",
      "status-muted",
    );
  }

  // Плашка "Типографика готова:" — что поменял типограф (неразрывные
  // пробелы/тире/кавычки, см. typografyItems/src/typograf.ts). Те же
  // правила показа/молчания, что и у updateServiceCleanupStatus.
  function updateTypografyStatus() {
    const active = typografy.checked && !outputEditedManually;
    renderCountPlate(
      typografyStatus,
      active ? lastTypografyItems : [],
      "Типографика готова:",
      "status-ok",
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
      emptyAttrsFillStatus.textContent = "Значимых пустых атрибутов нет";
      emptyAttrsFillStatus.className = "status-plate status-ok";
      emptyAttrsDeleteStatus.textContent = "";
      emptyAttrsDeleteStatus.className = "status-plate";
      return;
    }
    renderEmptyAttrsPlate(
      emptyAttrsFillStatus,
      showFill,
      "Пустые атрибуты (надо заполнить):",
      "status-warning",
      false,
    );
    renderEmptyAttrsPlate(
      emptyAttrsDeleteStatus,
      showDelete,
      "Пустые атрибуты (можно удалить):",
      "status-warning-light",
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

