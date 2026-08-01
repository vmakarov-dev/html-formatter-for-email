  // Строит отображаемый HTML для #output: подсвеченный результат
  // (highlightHtml) плюс вставленные "строки-подсказки" с предполагаемым
  // закрывающим тегом для каждого элемента из workingTags — серым
  // цветом (см. .suggested-line). Место вставки (insertBeforeLine/depth)
  // уже вычислено в самом форматтере — это точка, где ближайший предок с
  // настоящим закрывающим тегом неявно "утащил" незакрытый тег за собой
  // (см. explicitlyClosed/leakMark в src/formatter.ts). Пока пользователь
  // явно не нажал "Добавить" в попапе — эта строка есть только в
  // ОТОБРАЖЕНИИ, в lastCleanHtml (то, что копирует кнопка "Скопировать")
  // её нет.
  //
  // Сам текст предполагаемого тега обёрнут в отдельный <span
  // class="suggested-tag" data-uid="..."> — по нему renderPopups находит
  // его реальные координаты в DOM (getBoundingClientRect), чтобы попап
  // "Добавить?" встал вплотную к тегу, без ручного подсчёта ширины
  // отступа в пикселях.
  //
  // Если несколько тегов вытесняются в одной и той же точке — сортируем
  // по глубине по убыванию, чтобы более вложенные закрывались первыми
  // (как и положено при обычной вложенности тегов).
  //
  // Серую строку-подсказку, серый флажок и попап показываем ТОЛЬКО для
  // insertConfidence === "reliable" — когда insertBeforeLine и правда
  // указывает на то самое место, где браузер закрыл бы тег (закрытием
  // его собственного предка либо концом документа). Для "uncertain"
  // (тег вытеснен попутно чужим "ничьим" совпадением из совсем другой
  // ветки документа) показывать конкретное место — вводить в
  // заблуждение: например, там уже может стоять настоящий закрывающий
  // тег для СОВСЕМ ДРУГОГО элемента, и предложенный серый тег рядом с
  // ним выглядел бы как явно некорректный дубль. Такие теги остаются
  // только с красным флажком, без предложения.
  //
  // tags — общий список ВСЕХ трёх видов диагностики (u.kind ===
  // "unclosed" | "unopened" | "extra", см. runFormat): для незакрытых и
  // "неоткрытых" тегов подсказка — это одна вставленная серая строка
  // перед insertBeforeLine на глубине depth, различается только текст
  // самого тега (закрывающий тег для unclosed, открывающий — для
  // unopened) и то, что unopenedTags.insertConfidence всегда "reliable"
  // по построению (см. checkUnopenedChild в src/formatter.ts — там уже
  // отфильтрованы неоднозначные случаи через leakStack).
  //
  // "extra" — принципиально другое: это не вставка НОВОЙ строки, а
  // пометка УЖЕ СУЩЕСТВУЮЩЕЙ (осиротевший закрывающий тег без пары, см.
  // ExtraTagInfo) — предложение "Удалить?" её целиком. Поэтому такие
  // записи не участвуют в insertions вовсе (см. фильтр kind !== "extra"
  // ниже), а вместо этого их существующая строка оборачивается в
  // <span class="extra-tag-anchor" data-uid="..."> — тот же приём для
  // поиска реальных координат в DOM, что и .suggested-tag у вставленных
  // строк, только оборачивает не новый, а уже существующий текст.
  function buildDisplayHtml(html, tags) {
    const highlightedLines = highlightHtml(html).split("\n");
    const insertions = tags
      .filter((u) => u.kind !== "extra" && u.insertConfidence === "reliable")
      .slice()
      .sort((a, b) => a.insertBeforeLine - b.insertBeforeLine || b.depth - a.depth);
    const extraByLine = new Map();
    for (const u of tags) {
      if (u.kind === "extra") extraByLine.set(u.line, u);
    }
    // Только для kind==="unclosed": единственный случай, где "место
    // открытия" (u.line) и "место предполагаемой починки"
    // (u.insertBeforeLine) — РАЗНЫЕ строки документа, порой очень далеко
    // друг от друга (см. renderPopups — там у этой же строки будет ещё
    // один, дублирующий попап). У unopened line===insertBeforeLine всегда
    // (см. присвоение line ниже, в applyFormatResult), так что для него
    // отдельный якорь не нужен.
    const unclosedOpenByLine = new Map();
    for (const u of tags) {
      if (u.kind === "unclosed" && u.insertConfidence === "reliable") unclosedOpenByLine.set(u.line, u);
    }

    const resultLines = [];
    const origToFinalRow = new Array(highlightedLines.length);
    const closeFlags = [];
    let insIdx = 0;

    for (let orig = 0; orig <= highlightedLines.length; orig++) {
      while (insIdx < insertions.length && insertions[insIdx].insertBeforeLine === orig) {
        const u = insertions[insIdx];
        const indent = "  ".repeat(u.depth);
        const tagText = u.kind === "unopened" ? "<" + u.tagName + ">" : "</" + u.tagName + ">";
        resultLines.push(
          `<span class="suggested-line">${escapeHtml(indent)}` +
            `<span class="suggested-tag" data-uid="${u.__uid}">${escapeHtml(tagText)}</span></span>`,
        );
        closeFlags.push({ row: resultLines.length - 1, tagName: u.tagName, uid: u.__uid, kind: u.kind });
        insIdx++;
      }
      if (orig < highlightedLines.length) {
        origToFinalRow[orig] = resultLines.length;
        const extra = extraByLine.get(orig);
        const unclosedOpen = unclosedOpenByLine.get(orig);
        if (extra) {
          // Отступ оставляем СНАРУЖИ якоря (как и у .suggested-tag —
          // см. вставку строк-подсказок выше): иначе его ширина попадает
          // в getBoundingClientRect и computePopupSide начинает считать
          // тег шире, чем он есть на самом деле, из-за чего попап иногда
          // без нужды уезжает направо. Отступ у "ничьего" закрывающего
          // тега — всегда ЧИСТЫЕ пробелы (this.indent() в
          // src/formatter.ts), без тегов внутри, так что вырезать его
          // простым regex по началу строки безопасно.
          const line = highlightedLines[orig];
          const leadingWs = /^ */.exec(line)[0];
          resultLines.push(
            leadingWs +
              `<span class="extra-tag-anchor" data-uid="${extra.__uid}">${line.slice(leadingWs.length)}</span>`,
          );
        } else if (unclosedOpen) {
          // Тот же приём — якорь для ДУБЛИКАТА попапа у места открытия
          // (см. unclosedOpenByLine выше и renderPopups). Отступ у ЛЮБОЙ
          // строки — те же чистые пробелы this.indent(), приём безопасен
          // не только для "ничьих" закрывающих тегов.
          const line = highlightedLines[orig];
          const leadingWs = /^ */.exec(line)[0];
          resultLines.push(
            leadingWs +
              `<span class="unclosed-open-anchor" data-uid="${unclosedOpen.__uid}">${line.slice(leadingWs.length)}</span>`,
          );
        } else {
          resultLines.push(highlightedLines[orig]);
        }
      }
    }

    // Красный флажок на СВОЕЙ строке пропускаем для "неоткрытых", у
    // которых есть пара (pairId) — сама пара уже ЯВЛЯЕТСЯ "лишним" тегом
    // (kind==="extra") у себя на строке, и он получит СВОЙ красный
    // флажок ниже по этому же tags.map (та запись присутствует в общем
    // списке). Показывать два флажка на два конца одной и той же связки
    // избыточно — источник проблемы нагляднее там, где стоит сам лишний
    // тег, а не там, где просто заметили нехватку родителя.
    const openFlags = tags
      .filter((u) => !(u.kind === "unopened" && u.pairId != null))
      .map((u) => ({
        row: origToFinalRow[u.line],
        tagName: u.tagName,
        uid: u.__uid,
        kind: u.kind,
      }));

    return {
      displayHtml: resultLines.join("\n"),
      openFlags,
      closeFlags,
      lineCount: resultLines.length,
      origToFinalRow,
    };
  }

  // Скроллит #output так, чтобы указанный элемент (реальный DOM-узел,
  // не номер строки — координаты берём через getBoundingClientRect, это
  // надёжнее ручного подсчёта row*lineHeight) оказался примерно по
  // центру видимой области.
  function scrollElementIntoView(el) {
    const outputRect = output.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta = elRect.top - outputRect.top;
    setOutputScrollTop(
      Math.max(0, outputEditor.scrollTop + delta - outputEditor.clientHeight / 2 + elRect.height / 2),
    );
    updateScrollHints();
    renderPopups();
  }

  // То же самое, но по номеру строки — нужно для клика по серому флажку:
  // у открывающего тега нет своего span-маркера в DOM (в отличие от
  // предполагаемого закрывающего — см. .suggested-tag), поэтому для него
  // используем уже известную по lastOpenFlags строку напрямую.
  function scrollRowIntoView(row) {
    const cs = getComputedStyle(output);
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const lineHeight = parseFloat(cs.lineHeight) || 0;
    const target = paddingTop + row * lineHeight;
    setOutputScrollTop(Math.max(0, target - outputEditor.clientHeight / 2 + lineHeight / 2));
    updateScrollHints();
    renderPopups();
  }

  // role — "open" (красный, на строке самой проблемы) или "close" (серый,
  // на строке ещё не решённой подсказки — для kind="extra" такой роли не
  // бывает вовсе, у неё нет отдельной "вставленной" строки, только сама
  // проблемная); kind — "unclosed" (не хватает закрывающего тега),
  // "unopened" (не хватает родителя-обёртки, см. checkUnopenedChild в
  // src/formatter.ts) или "extra" (сам этот тег — осиротевший закрывающий
  // без пары, см. ExtraTagInfo, предлагается удалить). tagName для
  // kind="unopened"/"extra" — это имя тега-СВЯЗИ (пропущенного родителя
  // или лишнего закрывающего), а не самого узла на этой строке — так и
  // формулируются заголовки ниже.
  function flagTitle(kind, role, tagName) {
    if (kind === "unopened") {
      return role === "open"
        ? `Похоже, здесь пропущен родительский тег <${tagName}>`
        : `Добавить открывающий тег <${tagName}>?`;
    }
    if (kind === "extra") {
      return `Похоже, этот тег лишний — нет пары <${tagName}>`;
    }
    return role === "open" ? `Тег <${tagName}> может быть не закрыт` : "Вероятно, здесь пропущен тег";
  }

  // Клик по видимому флажку — переход к ПАРНОМУ месту (реальные
  // координаты через .suggested-tag, либо через .extra-tag-anchor для
  // kind="extra" — там это не вставленная строка, а помеченная
  // существующая); клик по серому — обратно к красному (по row, у
  // открывающего тега нет своего DOM-маркера). Общая для флажков внутри
  // номеров строк (см. renderOutputLineNumbers) и для клика по ним же —
  // подсказки за пределами экрана (.scroll-hint) используют ДРУГую
  // логику — прыгают к себе самим, а не к парному, см. setScrollHint.
  function handleFlagClick(role, kind, uid) {
    if (role === "open") {
      const selector =
        kind === "extra" ? `.extra-tag-anchor[data-uid="${uid}"]` : `.suggested-tag[data-uid="${uid}"]`;
      const tagEl = output.querySelector(selector);
      if (tagEl) scrollElementIntoView(tagEl);
    } else {
      const paired = lastOpenFlags.find((f) => f.uid === uid);
      if (paired) scrollRowIntoView(paired.row);
    }
  }

  // Флажков больше нет в отдельном гаттере — каждый печатается ПРЯМО
  // ВМЕСТО номера своей строки (см. .line-flag в CSS): один список
  // строк, просто на части из них вместо цифры — эмодзи. Позиция флажка
  // при скролле не пересчитывается отдельно — он часть текстового
  // содержимого .line-numbers, скроллится вместе с ним через
  // обычный scrollTop, без ручной раскладки.
  function renderOutputLineNumbers(lineCount) {
    const byRow = new Map();
    for (const f of lastOpenFlags) byRow.set(f.row, { ...f, role: "open" });
    for (const f of lastCloseFlags) byRow.set(f.row, { ...f, role: "close" });
    let html = "";
    for (let i = 0; i < lineCount; i++) {
      if (i > 0) html += "\n";
      const f = byRow.get(i);
      if (!f) {
        html += i + 1;
        continue;
      }
      const cls = "line-flag" + (f.role === "close" ? " line-flag-close" : "");
      html +=
        `<span class="${cls}" data-role="${f.role}" data-kind="${f.kind}" data-uid="${f.uid}" ` +
        `title="${escapeHtml(flagTitle(f.kind, f.role, f.tagName))}">🚩</span>`;
    }
    outputLineNumbers.innerHTML = html;
  }
  outputLineNumbers.addEventListener("click", (e) => {
    const el = e.target.closest(".line-flag");
    if (!el) return;
    handleFlagClick(el.dataset.role, el.dataset.kind, el.dataset.uid);
  });

  // Подсказка "ближайший флажок сейчас за пределами экрана" (см.
  // .scroll-hint в CSS) — вызывается и при перерисовке (renderOutput), и
  // при скролле (флажок мог войти/выйти из видимой области). Ищет среди
  // ВСЕХ флажков (открывающих и подсказок-вставок вперемешку — тут не
  // важно, какой это тип, важно только "выше/ниже экрана и насколько
  // близко") ближайший НАД видимой областью и ближайший ПОД ней —
  // каждый в свою подсказку.
  function updateScrollHints() {
    const cs = getComputedStyle(output);
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const lineHeight = parseFloat(cs.lineHeight) || 0;
    const all = [
      ...lastOpenFlags.map((f) => ({ ...f, role: "open" })),
      ...lastCloseFlags.map((f) => ({ ...f, role: "close" })),
    ];
    const viewTop = outputEditor.scrollTop;
    const viewBottom = viewTop + outputEditor.clientHeight;
    let nearestAbove = null;
    let nearestBelow = null;
    for (const f of all) {
      const y = paddingTop + f.row * lineHeight;
      if (y < viewTop) {
        if (!nearestAbove || f.row > nearestAbove.row) nearestAbove = f;
      } else if (y + lineHeight > viewBottom) {
        if (!nearestBelow || f.row < nearestBelow.row) nearestBelow = f;
      }
    }
    setScrollHint(scrollHintUp, "up", nearestAbove);
    setScrollHint(scrollHintDown, "down", nearestBelow);
  }

  // Клик по самой подсказке (в отличие от клика по видимому флажку,
  // см. handleFlagClick) — просто скроллит к СВОЕЙ ЖЕ строке (flag.row):
  // цель подсказки — показать флажок, который сейчас не виден, а не
  // перейти к его паре.
  function setScrollHint(el, direction, flag) {
    if (!flag) {
      el.classList.remove("visible");
      el.onclick = null;
      el.title = "";
      return;
    }
    el.classList.add("visible");
    const flagSpan = `<span class="line-flag${flag.role === "close" ? " line-flag-close" : ""}">🚩</span>`;
    const arrowSpan = `<span class="arrow">${direction === "up" ? "▲" : "▼"}</span>`;
    el.innerHTML = direction === "up" ? arrowSpan + flagSpan : flagSpan + arrowSpan;
    el.title = flagTitle(flag.kind, flag.role, flag.tagName);
    el.onclick = () => scrollRowIntoView(flag.row);
  }
