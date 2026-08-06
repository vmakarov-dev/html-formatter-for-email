
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
  // строится:
  // - ОДИН попап "Добавить?" у серой подсказки (общий на всю группу, даже
  //   если тегов в ней несколько) — с линиями-указателями сразу к
  //   ПЕРВОМУ и ПОСЛЕДНЕМУ тегу группы (см. запрос пользователя), а не к
  //   самой подсказке: "место проблемы" и "место починки" могут оказаться
  //   далеко друг от друга по документу.
  // - По ОДНОМУ попапу "Удалить?" на КАЖДЫЙ тег группы, у самого места
  //   его открытия (см. .unclosed-open-anchor/buildDisplayHtml) — в
  //   отличие от "Добавить?" эта сторона осталась независимой по тегам:
  //   удалить можно любой из открывающих тегов по отдельности, это не
  //   единое действие (в отличие от вставки закрывающих — см. запрос
  //   пользователя, который явно про ОДНО общее предложение добавления).
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

    // Маленькая серая строка снизу попапа со ссылкой на строку ПАРНОГО
    // тега, чтобы не искать её глазами по всему выводу — см. pairLabelFor:
    // у попапа на РЕАЛЬНОМ, уже существующем в письме теге (сам unclosed
    // на своём месте открытия) парный тег ЕЩЁ НЕ существует — потому "не
    // найден"; у попапа на ПРЕДЛОЖЕННОМ (пока не принятом) теге парный,
    // наоборот, уже реально есть в письме — потому "найден".
    function appendPairInfo(popup, row, label) {
      if (row == null) return;
      const pairInfo = document.createElement("div");
      pairInfo.className = "suggest-popup-pair";
      pairInfo.appendChild(document.createTextNode(label));
      const pairLink = document.createElement("span");
      pairLink.className = "suggest-popup-pair-link";
      pairLink.textContent = String(row + 1);
      pairLink.addEventListener("click", () => scrollRowIntoView(row));
      pairInfo.appendChild(pairLink);
      popup.appendChild(pairInfo);
    }

    for (const g of workingTags) {
      if (g.insertConfidence !== "reliable") continue;

      // === "Добавить?" — один общий попап на всю группу ===
      const suggestEls = output.querySelectorAll(`[data-group-uid="${g.__uid}"]`);
      if (suggestEls.length > 0) {
        const placementRects = [...suggestEls].map((el) => el.getBoundingClientRect());
        if (placementRects.some(isRectVisible)) {
          const first = g.tags[0];
          const last = g.tags[g.tags.length - 1];
          const openEls = [first, last === first ? null : last]
            .filter(Boolean)
            .map((t) => output.querySelector(`.unclosed-open-anchor[data-uid="${t.__uid}"]`))
            .filter(Boolean);
          const tagRects = openEls.length > 0 ? openEls.map((el) => el.getBoundingClientRect()) : placementRects;

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
          // Ссылку на парную строку показываем только для одиночного тега
          // (как и раньше) — у группы из нескольких тегов "парных" строк
          // сразу несколько, а обе цели и так уже видны по линиям-
          // указателям на сам попап.
          if (g.tags.length === 1) {
            appendPairInfo(popup, pairedRow(first), pairLabelFor(first, false));
          }
          outputPopups.appendChild(popup);
          entries.push({ el: popup, placementRects, tagRects });
        }
      }

      // === "Удалить?" — по одному попапу на каждый тег группы ===
      for (const t of g.tags) {
        const openEl = output.querySelector(`.unclosed-open-anchor[data-uid="${t.__uid}"]`);
        if (!openEl) continue;
        const tagRect = openEl.getBoundingClientRect();
        if (!isRectVisible(tagRect)) continue;

        const tagText = isMindboxConstruct(t.tagName) ? mindboxOpenLabel(t.tagName) : `<${t.tagName}>`;
        const popup = buildPopupShell(
          "Удалить?",
          `Удалить ${tagText} из результата`,
          () => acceptTagDeletion(t, g),
          () => rejectTagDeletion(t, g),
        );
        appendPairInfo(popup, pairedRowForOpenSide(t), pairLabelFor(t, true));
        outputPopups.appendChild(popup);
        entries.push({ el: popup, placementRects: [tagRect], tagRects: [tagRect] });
      }
    }
    positionSuggestPopups(entries, wrapRect);
  }

