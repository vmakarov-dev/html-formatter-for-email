  // Renderer (src/formatter.ts) хранит незакрытые Mindbox-конструкции
  // @{for ...}/@{if ...} в той же leak-механике, что и незакрытые
  // HTML-теги (см. UnclosedTagInfo), но под "именами" "@for"/"@if" —
  // префикс "@" невозможен в имени настоящего HTML-тега, поэтому это
  // безопасный сигнал "это не тег, а конструкция шаблонизатора" для
  // всего UI ниже (buildDisplayHtml/flagTitle/popups.js/popup-actions.js/
  // status-plates.js). mindboxOpenLabel/mindboxCloseLabel восстанавливают
  // из этого имени короткую подпись конструкции для текста подсказок —
  // без самого выражения (аналогично тому, как и обычные HTML-подсказки
  // показывают голое "<div>", без атрибутов).
  function isMindboxConstruct(tagName) {
    return typeof tagName === "string" && tagName.charAt(0) === "@";
  }
  function mindboxOpenLabel(tagName) {
    return `@{${tagName.slice(1)}}`;
  }
  function mindboxCloseLabel(tagName) {
    return `@{end ${tagName.slice(1)}}`;
  }

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
  // Если несколько ГРУПП вытесняются в одну и ту же точку — сортируем по
  // глубине самого вложенного тега группы по убыванию, чтобы более
  // вложенные закрывались первыми (как и положено при обычной
  // вложенности тегов).
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
  // только с красным флажком, без предложения. Группа "reliable" только
  // если ВСЕ её теги reliable (см. Renderer.getUnclosedTagGroups).
  //
  // groups — список групп незакрытых тегов/конструкций (см.
  // UnclosedTagGroup в src/formatter.ts и applyFormatResult) — каждая
  // группа даёт ОДНУ серую вставку из нескольких строк: закрывающие теги
  // всех членов группы (от самого внутреннего к самому внешнему — как
  // они закрывались бы по-настоящему), при needsConditionalCommentWrap
  // ещё и обёрнутые в новую <!--[if ...]-->...<![endif]-->. Все строки
  // группы помечены общим data-group-uid (нужен renderPopups — один
  // общий попап "Добавить?" на всю группу, а не по одному на строку), а
  // строки с закрывающим тегом ЕЩЁ и своим собственным data-uid (нужен
  // для попапа "Удалить?" у соответствующего тега и его же флажка в
  // колонке номеров). "Место открытия" каждого тега (t.line) и "место
  // починки" (group.insertBeforeLine) — РАЗНЫЕ строки документа, порой
  // очень далеко друг от друга (см. renderPopups — там у этой же строки
  // будет ещё один, дублирующий попап).
  function unclosedGroupLabel(group) {
    if (group.needsConditionalCommentWrap) return "Outlook-комментарий";
    if (group.tags.length > 1) {
      const first = group.tags[0];
      const last = group.tags[group.tags.length - 1];
      const firstLabel = isMindboxConstruct(first.tagName) ? mindboxOpenLabel(first.tagName) : `<${first.tagName}>`;
      const lastLabel = isMindboxConstruct(last.tagName) ? mindboxOpenLabel(last.tagName) : `<${last.tagName}>`;
      return `${firstLabel}...${lastLabel}`;
    }
    return null;
  }

  function buildDisplayHtml(html, groups) {
    const highlightedLines = highlightHtml(html).split("\n");
    const insertions = groups
      .filter((g) => g.insertConfidence === "reliable")
      .slice()
      .sort(
        (a, b) =>
          a.insertBeforeLine - b.insertBeforeLine ||
          b.tags[b.tags.length - 1].depth - a.tags[a.tags.length - 1].depth,
      );
    const unclosedOpenByLine = new Map();
    for (const g of groups) {
      if (g.insertConfidence !== "reliable") continue;
      for (const t of g.tags) unclosedOpenByLine.set(t.line, t);
    }

    const resultLines = [];
    const origToFinalRow = new Array(highlightedLines.length);
    const closeFlags = [];
    let insIdx = 0;

    for (let orig = 0; orig <= highlightedLines.length; orig++) {
      while (insIdx < insertions.length && insertions[insIdx].insertBeforeLine === orig) {
        const g = insertions[insIdx];
        const label = unclosedGroupLabel(g);
        const groupSpecial = label !== null;
        if (g.needsConditionalCommentWrap) {
          const indent = "  ".repeat(g.tags[0].depth);
          resultLines.push(
            `<span class="suggested-line" data-group-uid="${g.__uid}">` +
              `${escapeHtml(indent + g.conditionalCommentText)}</span>`,
          );
        }
        // От самого внутреннего к самому внешнему — как теги закрывались
        // бы по-настоящему (см. комментарий у buildDisplayHtml выше).
        for (let ti = g.tags.length - 1; ti >= 0; ti--) {
          const t = g.tags[ti];
          const indent = "  ".repeat(t.depth);
          const tagText = isMindboxConstruct(t.tagName) ? mindboxCloseLabel(t.tagName) : "</" + t.tagName + ">";
          resultLines.push(
            `<span class="suggested-line" data-group-uid="${g.__uid}">${escapeHtml(indent)}` +
              `<span class="suggested-tag" data-uid="${t.__uid}">${escapeHtml(tagText)}</span></span>`,
          );
          closeFlags.push({
            row: resultLines.length - 1,
            tagName: t.tagName,
            uid: t.__uid,
            kind: g.kind,
            groupUid: g.__uid,
            groupSpecial,
            groupLabel: label,
          });
        }
        if (g.needsConditionalCommentWrap) {
          const indent = "  ".repeat(g.tags[0].depth);
          resultLines.push(
            `<span class="suggested-line" data-group-uid="${g.__uid}">${escapeHtml(indent + "<![endif]-->")}</span>`,
          );
        }
        insIdx++;
      }
      if (orig < highlightedLines.length) {
        origToFinalRow[orig] = resultLines.length;
        const unclosedOpen = unclosedOpenByLine.get(orig);
        if (unclosedOpen) {
          // Якорь для ДУБЛИКАТА попапа у места открытия (см.
          // unclosedOpenByLine выше и renderPopups) — по нему renderPopups
          // находит реальные координаты в DOM. Отступ оставляем СНАРУЖИ
          // якоря (как и у .suggested-tag — см. вставку строк-подсказок
          // выше): иначе его ширина попадает в getBoundingClientRect и
          // computePopupSide начинает считать тег шире, чем он есть на
          // самом деле, из-за чего попап иногда без нужды уезжает
          // направо. Отступ у ЛЮБОЙ строки — чистые пробелы (this.indent()
          // в src/formatter.ts), без тегов внутри, так что вырезать его
          // простым regex по началу строки безопасно.
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

    const openFlags = [];
    for (const g of groups) {
      const label = unclosedGroupLabel(g);
      const groupSpecial = label !== null;
      for (const t of g.tags) {
        openFlags.push({
          row: origToFinalRow[t.line],
          tagName: t.tagName,
          uid: t.__uid,
          kind: g.kind,
          groupUid: g.__uid,
          groupSpecial,
          groupLabel: label,
        });
      }
    }

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

  // role — "open" (красный, на строке самой проблемы, где тег реально
  // открылся) или "close" (серый, на строке ещё не решённой подсказки —
  // предполагаемое место закрывающего тега/конструкции).
  function flagTitle(kind, role, tagName) {
    if (isMindboxConstruct(tagName)) {
      return role === "open"
        ? `Конструкция ${mindboxOpenLabel(tagName)} может быть не закрыта`
        : `Вероятно, здесь пропущена конструкция ${mindboxCloseLabel(tagName)}`;
    }
    return role === "open" ? `Тег <${tagName}> может быть не закрыт` : "Вероятно, здесь пропущен тег";
  }

  // Клик по видимому флажку — переход к ПАРНОМУ месту (реальные
  // координаты через .suggested-tag); клик по серому — обратно к
  // красному (по row, у открывающего тега нет своего DOM-маркера). Общая
  // для флажков внутри номеров строк (см. renderOutputLineNumbers) и для
  // клика по ним же — подсказки за пределами экрана (.scroll-hint)
  // используют ДРУГую логику — прыгают к себе самим, а не к парному, см.
  // setScrollHint.
  function handleFlagClick(role, kind, uid) {
    if (role === "open") {
      const tagEl = output.querySelector(`.suggested-tag[data-uid="${uid}"]`);
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
