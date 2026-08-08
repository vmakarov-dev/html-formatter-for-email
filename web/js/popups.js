
  // ==========================================================
  // === НАЧАЛО: изолированный блок "умного" позиционирования попапов ===
  // Вся геометрия (с какой стороны от тега вставать, как разводить
  // столкновения по вертикали, как рисовать линию-указатель) собрана
  // здесь, в одной функции positionSuggestPopups и её приватных
  // помощниках — renderPopups ниже только создаёт DOM-содержимое попапов
  // (текст/кнопки) и передаёт готовые элементы сюда одним вызовом.
  //
  // ОТКАТ: чтобы вернуться к прежней простой версии (попап всегда слева
  // от тега, статичный CSS-хвостик, разведение по вертикали без
  // пересчёта указателя) — удалить этот блок целиком, в renderPopups
  // вернуть простое позиционирование popup.style.top/left сразу при
  // создании (без вызова positionSuggestPopups), убрать <svg
  // id="popupConnectors"> из HTML и .popup-connectors из CSS.
  const POPUP_GAP = 15; // отступ между попапом и точкой на теге

  // Объединяющий прямоугольник нескольких DOMRect — нужен, когда у попапа
  // НЕСКОЛЬКО целей сразу (см. запрос пользователя про группу незакрытых
  // тегов: один попап "Добавить?", но линии-указатели ведут сразу к
  // первому И последнему тегу группы). Позиционирование (с какой стороны
  // встать, на какой высоте) считается по этому объединению — попап
  // получается по центру между всеми целями, а не наезжает на одну из них.
  function unionRect(rects) {
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  // С какой стороны цели (left/right) ставить попап: слева — если там
  // достаточно места (не заходя за левый край .output-wrap), иначе —
  // справа от цели. Это и есть решение обеих исходных проблем: попап
  // либо помещается слева целиком, либо переставляется на сторону, где
  // места заведомо достаточно, а не "прижимается" туда же силой.
  function choosePopupSide(targetRect, wrapRect, popupWidth) {
    const availableLeft = targetRect.left - wrapRect.left;
    return availableLeft >= popupWidth + POPUP_GAP ? "left" : "right";
  }

  function naturalPlacement(targetRect, wrapRect, popupWidth, popupHeight, side) {
    const centerY = targetRect.top - wrapRect.top + targetRect.height / 2;
    const left =
      side === "left"
        ? targetRect.left - wrapRect.left - POPUP_GAP - popupWidth
        : targetRect.right - wrapRect.left + POPUP_GAP;
    return { top: centerY - popupHeight / 2, left };
  }

  // Разводит по вертикали попапы, которые пересекались бы друг с другом
  // — отдельно для каждой стороны (left/right), потому что попапы с
  // разных сторон от своих тегов практически никогда не претендуют на
  // одно и то же место. Мутирует entry.top.
  function resolveVerticalCollisions(entries) {
    const GAP_BETWEEN = 4;
    for (const side of ["left", "right"]) {
      const group = entries.filter((e) => e.side === side).sort((a, b) => a.top - b.top);
      let minTop = -Infinity;
      for (const entry of group) {
        if (entry.top < minTop) entry.top = minTop;
        minTop = entry.top + entry.height + GAP_BETWEEN;
      }
    }
  }

  // Линия(-и)-указатель(и) от попапа до РЕАЛЬНЫХ точек-целей — считаются
  // заново из уже финальных (после разводки коллизий) координат, поэтому
  // всегда бьют точно в цель, даже если сам попап пришлось сдвинуть.
  // Отступ конца стрелки от самой цели — раньше указатель утыкался прямо
  // в край текста тега, теперь останавливается чуть раньше. entry.tagRects
  // — МАССИВ (обычно один элемент, но для общего попапа группы незакрытых
  // тегов — см. renderPopups — два: к первому и последнему тегу группы,
  // см. запрос пользователя), рисуем по одной линии+точке на каждый.
  const CONNECTOR_GAP = 2;
  function drawConnectors(entries, wrapRect) {
    popupConnectors.innerHTML = "";
    const svgNS = "http://www.w3.org/2000/svg";
    for (const entry of entries) {
      const { tagRects, side, top, left, width, height } = entry;
      const popupX = side === "left" ? left + width : left;
      const popupY = top + height / 2;
      for (const tagRect of tagRects) {
        const tagX =
          side === "left"
            ? tagRect.left - wrapRect.left - CONNECTOR_GAP
            : tagRect.right - wrapRect.left + CONNECTOR_GAP;
        const tagY = tagRect.top - wrapRect.top + tagRect.height / 2;

        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", popupX);
        line.setAttribute("y1", popupY);
        line.setAttribute("x2", tagX);
        line.setAttribute("y2", tagY);
        popupConnectors.appendChild(line);

        const dot = document.createElementNS(svgNS, "circle");
        dot.setAttribute("cx", tagX);
        dot.setAttribute("cy", tagY);
        dot.setAttribute("r", 2.5);
        popupConnectors.appendChild(dot);
      }
    }
  }

  // Точка входа: entries — уже созданные (label+кнопки), но ещё без
  // top/left попапы. Каждый — с entry.placementRects (по чему считать
  // ПОЛОЖЕНИЕ самого попапа — обычно совпадает с целями линий, но для
  // общего попапа группы незакрытых тегов это прямоугольники серых строк-
  // подсказок, а НЕ реальные теги — попап должен стоять рядом со своей же
  // подсказкой, а не посередине между далёким первым и последним тегом
  // группы) и entry.tagRects (собственно цели линий-указателей, см.
  // drawConnectors). Все нужные элементы уже должны быть в DOM
  // (outputPopups), иначе getBoundingClientRect ниже не даст верную
  // ширину/высоту.
  function positionSuggestPopups(entries, wrapRect) {
    for (const entry of entries) {
      const rect = entry.el.getBoundingClientRect();
      entry.width = rect.width;
      entry.height = rect.height;
      const placementRect = unionRect(entry.placementRects);
      entry.side = choosePopupSide(placementRect, wrapRect, entry.width);
      const placement = naturalPlacement(placementRect, wrapRect, entry.width, entry.height, entry.side);
      entry.top = placement.top;
      entry.left = placement.left;
    }
    resolveVerticalCollisions(entries);
    for (const entry of entries) {
      entry.el.style.top = entry.top + "px";
      entry.el.style.left = entry.left + "px";
    }
    drawConnectors(entries, wrapRect);
  }
  // === КОНЕЦ: изолированный блок "умного" позиционирования попапов ===
  // ==========================================================

  // Попап "Добавить?"/"Удалить?". Координаты берутся напрямую из реальных
  // координат уже отрендеренного якоря в DOM (getBoundingClientRect) —
  // надёжнее и точнее, чем пересчитывать ширину отступа вручную по
  // количеству символов. Само размещение попапов — отдельный
  // изолированный блок выше (positionSuggestPopups), эта функция только
  // создаёт их содержимое.
  //
  // На каждую ГРУППУ (см. workingTags/UnclosedTagGroup в src/formatter.ts)
  // строится ровно ДВА попапа — симметрично, один на каждое возможное
  // действие, и у ОБОИХ линии-указатели идут к ПЕРВОМУ и ПОСЛЕДНЕМУ
  // элементу, актуальному именно для ЭТОГО действия (реальный баг,
  // найденный пользователем: раньше "Удалить?" был по одному попапу НА
  // КАЖДЫЙ тег группы вместо одного общего, а "Добавить?" указывал на
  // реальные открывающие теги вместо предлагаемых закрывающих строк):
  // - "Добавить?" — рядом с серой подсказкой (там же, где предложенные
  //   закрывающие теги физически появятся), указатели — на ПЕРВУЮ и
  //   ПОСЛЕДНЮЮ из ПРЕДЛОЖЕННЫХ (серых) строк группы: это и есть то, что
  //   добавится, если нажать "✓".
  // - "Удалить?" — рядом с местом, где реально открылся первый тег
  //   группы, указатели — на ПЕРВЫЙ и ПОСЛЕДНИЙ РЕАЛЬНЫЙ открывающий тег
  //   группы (.unclosed-open-anchor): это и есть то, что удалится.
  // Оба попапа принимают/отклоняют ВСЮ группу целиком, единым действием
  // (см. acceptGroupSuggestion/acceptGroupDeletion/rejectGroupSuggestion в
  // popup-actions.js) — не по одному тегу за раз.
  function renderPopups() {
    outputPopups.innerHTML = "";
    const wrapRect = output.parentElement.getBoundingClientRect();
    const outputRect = output.getBoundingClientRect();
    const entries = [];

    function isRectVisible(rect) {
      return rect.bottom >= outputRect.top && rect.top <= outputRect.bottom;
    }

    // Общий "корпус" попапа (текст вопроса + кнопки ✓/✕) — используется и
    // для группового "Добавить?", и для индивидуального "Удалить?".
    function buildPopupShell(labelText, acceptTitle, onAccept, onReject) {
      const popup = document.createElement("div");
      popup.className = "suggest-popup";

      const main = document.createElement("div");
      main.className = "suggest-popup-main";

      const label = document.createElement("span");
      label.textContent = labelText;
      main.appendChild(label);

      const acceptBtn = document.createElement("button");
      acceptBtn.className = "accept";
      acceptBtn.type = "button";
      acceptBtn.textContent = "✓";
      acceptBtn.title = acceptTitle;
      acceptBtn.addEventListener("click", onAccept);
      main.appendChild(acceptBtn);

      const rejectBtn = document.createElement("button");
      rejectBtn.className = "reject";
      rejectBtn.type = "button";
      rejectBtn.textContent = "✕";
      rejectBtn.title = labelText === "Удалить?" ? "Не удалять" : "Не добавлять";
      rejectBtn.addEventListener("click", onReject);
      main.appendChild(rejectBtn);

      popup.appendChild(main);
      return popup;
    }

    // Маленькая серая строка снизу попапа со ссылками на строку(-и)
    // ПАРНОГО тега (или, для группы из нескольких тегов — первого И
    // последнего сразу, см. вызовы ниже), чтобы не искать их глазами по
    // всему выводу, особенно в плотной разметке, где сами линии-
    // указатели на попапе разглядеть трудно (см. запрос пользователя —
    // реальный случай, когда рядом много вложенных тегов подряд). rows —
    // МАССИВ (0..2 элемента, null-значения пропускаются) — см.
    // pairLabelFor: у попапа на РЕАЛЬНОМ, уже существующем в письме теге
    // (сам unclosed на своём месте открытия) парный тег ЕЩЁ НЕ существует
    // — потому "не найден"; у попапа на ПРЕДЛОЖЕННОМ (пока не принятом)
    // теге парный, наоборот, уже реально есть в письме — потому "найден".
    // showWhenEmpty — показывать строку, даже если ссылаться не на что.
    // Так бывает ровно в одном случае: попап "Удалить?" у группы с
    // insertConfidence === "uncertain". Серую строку-подсказку для таких
    // групп мы сознательно не рисуем (см. buildDisplayHtml), значит нет и
    // её флажка, а значит и номера строки, на который можно сослаться.
    // Раньше строка в этом случае просто НЕ появлялась, и такой тег
    // выглядел "беднее" соседей без всякого объяснения (реальный запрос
    // пользователя: "у незакрытого div не предлагается подсказка с его
    // парным тегом"). Теперь вместо молчания честно пишем, что пары нет
    // вовсе — это и есть ответ на вопрос "а где она?".
    function appendPairInfo(popup, rows, label, showWhenEmpty) {
      // По возрастанию номера строки, а не в порядке следования тегов
      // группы — у "Удалить?" второй (внутренний) тег группы закрывается
      // в предложении РАНЬШЕ первого (внешнего) — см. buildGroupInsertLines
      // в popup-actions.js, закрывающие теги идут от внутреннего к
      // внешнему — так что "первый тег, последний тег" в document order
      // может дать номера строк в обратном порядке. Без сортировки это
      // выглядело бы как опечатка (например, "1320, 1319").
      const validRows = rows.filter((row) => row != null).sort((a, b) => a - b);
      if (validRows.length === 0 && !showWhenEmpty) return;
      const pairInfo = document.createElement("div");
      pairInfo.className = "suggest-popup-pair";
      if (validRows.length === 0) {
        // Тот же текст, что и обычно, только без хвостового ": " — без
        // номеров он читается как законченная фраза ("Не найден
        // закрывающий тег").
        pairInfo.textContent = label.replace(/:\s*$/, "");
        popup.appendChild(pairInfo);
        return;
      }
      pairInfo.appendChild(document.createTextNode(label));
      validRows.forEach((row, i) => {
        if (i > 0) pairInfo.appendChild(document.createTextNode(", "));
        const pairLink = document.createElement("span");
        pairLink.className = "suggest-popup-pair-link";
        pairLink.textContent = String(row + 1);
        pairLink.addEventListener("click", () => scrollRowIntoView(row));
        pairInfo.appendChild(pairLink);
      });
      popup.appendChild(pairInfo);
    }

    // Первый/последний элемент массива (уже в DOM-порядке — оба
    // источника, .querySelectorAll и g.tags, идут в порядке появления в
    // документе) — если их всего один (группа из одного тега), вторая
    // цель попросту совпадает с первой, вызывающая сторона сама это
    // учитывает (см. firstAndLastRects/firstAndLastOf).
    function firstAndLastRects(rects) {
      if (rects.length === 0) return [];
      const first = rects[0];
      const last = rects[rects.length - 1];
      return first === last ? [first] : [first, last];
    }
    // То же самое, но для ЛЮБОГО массива (см. g.tags) — используется,
    // чтобы получить ровно те же "граничные" элементы, к которым ведут
    // линии-указатели (см. firstAndLastRects выше), и для них же
    // построить ссылки в appendPairInfo.
    function firstAndLastOf(arr) {
      if (arr.length === 0) return [];
      const first = arr[0];
      const last = arr[arr.length - 1];
      return first === last ? [first] : [first, last];
    }

    for (const g of workingTags) {
      const first = g.tags[0];

      // === "Добавить?" — один общий попап, указатели на ПРЕДЛОЖЕННЫЕ (серые) строки ===
      // Только для insertConfidence === "reliable" — как и у самой серой
      // подсказки (см. buildDisplayHtml/insertions): предлагать КОНКРЕТНОЕ
      // место вставки, в котором мы не уверены, вводит в заблуждение.
      // "Удалить?" ниже НЕ зависит от этого — у него другая, объективная
      // и всегда точно известная цель (см. её же комментарий).
      const suggestEls = g.insertConfidence === "reliable" ? [...output.querySelectorAll(`[data-group-uid="${g.__uid}"]`)] : [];
      if (suggestEls.length > 0) {
        const suggestRects = suggestEls.map((el) => el.getBoundingClientRect());
        if (suggestRects.some(isRectVisible)) {
          const acceptTitle =
            g.tags.length > 1
              ? "Добавить все закрывающие теги группы в результат"
              : isMindboxConstruct(first.tagName)
                ? `Добавить ${mindboxCloseLabel(first.tagName)} в результат`
                : `Добавить </${first.tagName}> в результат`;
          const popup = buildPopupShell(
            "Добавить?",
            acceptTitle,
            () => acceptGroupSuggestion(g),
            () => rejectGroupSuggestion(g),
          );
          // У группы из нескольких тегов — сразу ДВЕ ссылки (первый и
          // последний тег группы, те же границы, к которым ведут линии-
          // указатели), а не одна: обе цели и так видны по указателям, но
          // в плотной разметке проследить линию глазами трудно (реальный
          // случай, см. запрос пользователя), а кликабельный номер строки
          // — нет.
          const boundary = firstAndLastOf(g.tags);
          appendPairInfo(
            popup,
            boundary.map((t) => pairedRow(t)),
            pairLabelFor(first, false, boundary.length > 1),
          );
          outputPopups.appendChild(popup);
          entries.push({ el: popup, placementRects: suggestRects, tagRects: firstAndLastRects(suggestRects) });
        }
      }

      // === "Удалить?" — тоже один общий попап на группу, указатели на РЕАЛЬНЫЕ открывающие теги ===
      const openEls = g.tags
        .map((t) => output.querySelector(`.unclosed-open-anchor[data-uid="${t.__uid}"]`))
        .filter(Boolean);
      if (openEls.length > 0) {
        const openRects = openEls.map((el) => el.getBoundingClientRect());
        if (openRects.some(isRectVisible)) {
          const acceptTitle =
            g.tags.length > 1
              ? "Удалить все открывающие теги группы из результата"
              : isMindboxConstruct(first.tagName)
                ? `Удалить ${mindboxOpenLabel(first.tagName)} из результата`
                : `Удалить <${first.tagName}> из результата`;
          const popup = buildPopupShell(
            "Удалить?",
            acceptTitle,
            () => acceptGroupDeletion(g),
            () => rejectGroupSuggestion(g),
          );
          const boundary = firstAndLastOf(g.tags);
          appendPairInfo(
            popup,
            boundary.map((t) => pairedRowForOpenSide(t)),
            pairLabelFor(first, true, boundary.length > 1),
            true,
          );
          outputPopups.appendChild(popup);
          entries.push({ el: popup, placementRects: openRects, tagRects: firstAndLastRects(openRects) });
        }
      }
    }
    positionSuggestPopups(entries, wrapRect);
  }

