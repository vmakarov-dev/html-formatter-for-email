
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

  // С какой стороны тега (left/right) ставить попап: слева — если там
  // достаточно места (не заходя за левый край .output-wrap), иначе —
  // справа от тега. Это и есть решение обеих исходных проблем: попап
  // либо помещается слева целиком, либо переставляется на сторону, где
  // места заведомо достаточно, а не "прижимается" туда же силой.
  function choosePopupSide(tagRect, wrapRect, popupWidth) {
    const availableLeft = tagRect.left - wrapRect.left;
    return availableLeft >= popupWidth + POPUP_GAP ? "left" : "right";
  }

  function naturalPlacement(tagRect, wrapRect, popupWidth, popupHeight, side) {
    const centerY = tagRect.top - wrapRect.top + tagRect.height / 2;
    const left =
      side === "left"
        ? tagRect.left - wrapRect.left - POPUP_GAP - popupWidth
        : tagRect.right - wrapRect.left + POPUP_GAP;
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

  // Линия-указатель от попапа до РЕАЛЬНОЙ точки на теге — считается
  // заново из уже финальных (после разводки коллизий) координат, поэтому
  // всегда бьёт точно в цель, даже если сам попап пришлось сдвинуть.
  // Отступ конца стрелки от самого тега — раньше указатель утыкался
  // прямо в край текста тега, теперь останавливается чуть раньше.
  const CONNECTOR_GAP = 2;
  function drawConnectors(entries, wrapRect) {
    popupConnectors.innerHTML = "";
    const svgNS = "http://www.w3.org/2000/svg";
    for (const entry of entries) {
      const { tagRect, side, top, left, width, height } = entry;
      const tagX =
        side === "left"
          ? tagRect.left - wrapRect.left - CONNECTOR_GAP
          : tagRect.right - wrapRect.left + CONNECTOR_GAP;
      const tagY = tagRect.top - wrapRect.top + tagRect.height / 2;
      const popupX = side === "left" ? left + width : left;
      const popupY = top + height / 2;

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

  // Точка входа: entries — уже созданные (label+кнопки), но ещё без
  // top/left попапы, каждый со своим tagRect. Все они уже должны быть в
  // DOM (outputPopups), иначе getBoundingClientRect ниже не даст верную
  // ширину/высоту.
  function positionSuggestPopups(entries, wrapRect) {
    for (const entry of entries) {
      const rect = entry.el.getBoundingClientRect();
      entry.width = rect.width;
      entry.height = rect.height;
      entry.side = choosePopupSide(entry.tagRect, wrapRect, entry.width);
      const placement = naturalPlacement(entry.tagRect, wrapRect, entry.width, entry.height, entry.side);
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

  // Попап "Добавить?"/"Удалить?" рядом с каждым отмеченным тегом.
  // Координаты берутся напрямую из реальных координат уже
  // отрендеренного якоря в DOM (getBoundingClientRect) — надёжнее и
  // точнее, чем пересчитывать ширину отступа вручную по количеству
  // символов. Для kind !== "extra" якорь — вставленная строка-подсказка
  // (<span class="suggested-tag">, только при insertConfidence ===
  // "reliable"); для kind === "extra" — обёрнутая существующая строка
  // (<span class="extra-tag-anchor">, см. buildDisplayHtml). Само
  // размещение попапов — отдельный изолированный блок выше
  // (positionSuggestPopups), эта функция только создаёт их содержимое.
  //
  // У kind==="unclosed" строится ДВА попапа на одну запись — один у
  // подсказки (как обычно), второй — дубликат у самого места открытия
  // тега (см. .unclosed-open-anchor/buildDisplayHtml): это единственный
  // вид диагностики, где "место проблемы" и "место починки" могут
  // оказаться далеко друг от друга по документу, и без дубликата на
  // экране в принципе не увидеть попап рядом с красным флажком, если
  // прокрутить именно к нему. У unopened/extra в этом нет нужды: у
  // одиночного unopened оба места совпадают, а у пары unopened+extra
  // каждая сторона — уже отдельная запись в workingTags и проходит этот
  // цикл сама по себе, каждая со своим попапом.
  function renderPopups() {
    outputPopups.innerHTML = "";
    const wrapRect = output.parentElement.getBoundingClientRect();
    const outputRect = output.getBoundingClientRect();
    const entries = [];

    // mode — "delete" или "add", определяет и текст вопроса, и что делает
    // ✓ (см. вызовы ниже): это не привязано жёстко к u.kind напрямую,
    // потому что у unclosed вопрос зависит ещё и от ТОГО, на какой из
    // двух её строк стоит именно этот попап (см. renderPopups ниже) —
    // "Удалить?" там, где тег РЕАЛЬНО существует в письме (сам незакрытый
    // открывающий, сам осиротевший закрывающий у extra), "Добавить?" там,
    // где стоит только ПРЕДЛОЖЕННЫЙ, ещё не принятый тег (unopened,
    // закрывающая половина unclosed) — его-то мы и добавили бы. Реальный
    // тег можно только удалить, предложенного можно только добавить —
    // никаких промежуточных вариантов.
    function addPopup(u, tagEl, mode, pairRowOverride, isOpenSide) {
      if (!tagEl) return;
      const tagRect = tagEl.getBoundingClientRect();
      // Тег прокручен за пределы видимой области #output по вертикали —
      // не показываем попап впустую поверх соседних, не относящихся к
      // нему строк.
      if (tagRect.bottom < outputRect.top || tagRect.top > outputRect.bottom) return;

      const isDelete = mode === "delete";

      const popup = document.createElement("div");
      popup.className = "suggest-popup";

      const main = document.createElement("div");
      main.className = "suggest-popup-main";

      const label = document.createElement("span");
      label.textContent = isDelete ? "Удалить?" : "Добавить?";
      main.appendChild(label);

      const acceptBtn = document.createElement("button");
      acceptBtn.className = "accept";
      acceptBtn.type = "button";
      acceptBtn.textContent = "✓";
      if (isDelete) {
        // extra — реальный ЗАКРЫВАЮЩИЙ тег (осиротевший), unclosed на
        // открывающей стороне — реальный ОТКРЫВАЮЩИЙ (либо, для Mindbox,
        // реально открывшаяся @{for ...}/@{if ...}, см. isMindboxConstruct
        // в diagnostics-view.js); удаляем именно ту строку, на которой стоим.
        const tagText =
          u.kind === "extra"
            ? `</${u.tagName}>`
            : isMindboxConstruct(u.tagName)
              ? mindboxOpenLabel(u.tagName)
              : `<${u.tagName}>`;
        acceptBtn.title = `Удалить ${tagText} из результата`;
        acceptBtn.addEventListener("click", () => acceptDeletion(u));
      } else {
        acceptBtn.title =
          u.kind === "unopened"
            ? `Добавить <${u.tagName}> в результат`
            : isMindboxConstruct(u.tagName)
              ? `Добавить ${mindboxCloseLabel(u.tagName)} в результат`
              : `Добавить </${u.tagName}> в результат`;
        acceptBtn.addEventListener("click", () => acceptSuggestion(u));
      }
      main.appendChild(acceptBtn);

      const rejectBtn = document.createElement("button");
      rejectBtn.className = "reject";
      rejectBtn.type = "button";
      rejectBtn.textContent = "✕";
      if (isDelete) {
        rejectBtn.title = "Не удалять";
        rejectBtn.addEventListener("click", () => rejectDeletion(u));
      } else {
        rejectBtn.title = "Не добавлять";
        rejectBtn.addEventListener("click", () => rejectSuggestion(u));
      }
      main.appendChild(rejectBtn);
      popup.appendChild(main);

      // Для парных unopened/extra (см. pairId в src/formatter.ts), а
      // также для unclosed (своя же собственная запись, просто её вторая,
      // открывающая, сторона) — ещё одна маленькая серая строка снизу со
      // ссылкой на строку ПАРНОГО тега, чтобы не искать её глазами по
      // всему выводу. Номер кликабелен — скроллит к этой строке (см.
      // .suggest-popup-pair-link/scrollRowIntoView), ничего не подсвечивая:
      // сам парный тег и так уже отмечен собственным флажком в колонке
      // номеров. Текст подписи — см. pairLabelFor: у попапа на РЕАЛЬНОМ,
      // уже существующем в письме теге (сам unclosed на своём месте
      // открытия, сам extra) парный тег ЕЩЁ НЕ существует — потому
      // "не найден"; у попапа на ПРЕДЛОЖЕННОМ (пока не принятом) теге
      // парный, наоборот, уже реально есть в письме — потому "найден".
      // pairRowOverride — только у дубликата на открывающей стороне (см.
      // pairedRowForOpenSide ниже): обычный pairedRow(u) для unclosed
      // всегда возвращает строку ОТКРЫТИЯ, а тут сам попап уже там стоит,
      // ссылаться нужно, наоборот, на строку подсказки.
      const pRow = pairRowOverride !== undefined ? pairRowOverride : pairedRow(u);
      if (pRow != null) {
        const pairInfo = document.createElement("div");
        pairInfo.className = "suggest-popup-pair";
        pairInfo.appendChild(document.createTextNode(pairLabelFor(u, isOpenSide)));
        const pairLink = document.createElement("span");
        pairLink.className = "suggest-popup-pair-link";
        pairLink.textContent = String(pRow + 1);
        pairLink.addEventListener("click", () => scrollRowIntoView(pRow));
        pairInfo.appendChild(pairLink);
        popup.appendChild(pairInfo);
      }

      outputPopups.appendChild(popup);
      entries.push({ el: popup, tagRect });
    }

    for (const u of workingTags) {
      const isExtra = u.kind === "extra";
      if (!isExtra && u.insertConfidence !== "reliable") continue;
      const selector = isExtra
        ? `.extra-tag-anchor[data-uid="${u.__uid}"]`
        : `.suggested-tag[data-uid="${u.__uid}"]`;
      addPopup(u, output.querySelector(selector), isExtra ? "delete" : "add", undefined, false);

      // Дубликат на открывающей стороне (см. .unclosed-open-anchor/
      // buildDisplayHtml) — единственный случай, где попап стоит на
      // РЕАЛЬНОМ, уже существующем в письме теге (не на предложенном), so
      // здесь именно "Удалить?", а не "Добавить?".
      if (u.kind === "unclosed") {
        const openEl = output.querySelector(`.unclosed-open-anchor[data-uid="${u.__uid}"]`);
        addPopup(u, openEl, "delete", pairedRowForOpenSide(u), true);
      }
    }
    positionSuggestPopups(entries, wrapRect);
  }

