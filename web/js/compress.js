  // ПРЕЖНИЙ вариант иконки "Сжать" ("кирпичики" стопкой — 2 для умеренного,
  // 1 для максимального, каждый раз с своей длиной стрелки) — сохранён по
  // просьбе пользователя "на всякий случай" (не понравился, пробуем
  // другой, см. buildCompressIcon ниже), нигде не вызывается. Чтобы
  // вернуть его — замените buildCompressIcon(2)/(1) ниже на вызовы этой
  // функции с тем же аргументом (2 или 1).
  function buildCompressIconStackedBricksArchived(brickCount) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");

    const cx = 12;
    const brickW = 14;
    const brickH = 3.6;
    const brickX = cx - brickW / 2;
    const gap = 1.2;
    const bottomY = 20;

    function addBrick(bottomEdge) {
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", brickX.toFixed(2));
      rect.setAttribute("y", (bottomEdge - brickH).toFixed(2));
      rect.setAttribute("width", brickW.toFixed(2));
      rect.setAttribute("height", brickH.toFixed(2));
      rect.setAttribute("rx", (brickH / 2).toFixed(2));
      rect.setAttribute("fill", "currentColor");
      svg.appendChild(rect);
    }
    function addLine(x1, y1, x2, y2) {
      const el = document.createElementNS(svgNS, "line");
      el.setAttribute("x1", x1.toFixed(2));
      el.setAttribute("y1", y1.toFixed(2));
      el.setAttribute("x2", x2.toFixed(2));
      el.setAttribute("y2", y2.toFixed(2));
      el.setAttribute("stroke", "currentColor");
      el.setAttribute("stroke-width", "1.6");
      el.setAttribute("stroke-linecap", "round");
      svg.appendChild(el);
    }

    let topBrickTop;
    if (brickCount >= 2) {
      addBrick(bottomY);
      const topBrickBottom = bottomY - brickH - gap;
      addBrick(topBrickBottom);
      topBrickTop = topBrickBottom - brickH;
    } else {
      addBrick(bottomY);
      topBrickTop = bottomY - brickH;
    }

    const tipY = topBrickTop - gap;
    const shaftTopY = brickCount >= 2 ? 2.5 : 4;
    addLine(cx, shaftTopY, cx, tipY);
    for (const sign of [-1, 1]) {
      addLine(cx, tipY, cx + sign * 2.6, tipY - 2.8);
    }

    return svg;
  }

  // Иконка кнопки "Сжать" (вариант 2, см. запрос пользователя) — ОДИН
  // кирпичик (строка кода), который прижимает стрелка сверху; у
  // максимального сжатия точно такой же кирпичик прижимают СРАЗУ ДВЕ
  // стрелки — вторая зеркально снизу, тем же кирпичиком, что и первая:
  // раз строка одна и та же, а сила сжатия больше, логично, что её
  // прижимает не более длинная стрелка, а сразу с двух сторон.
  // currentColor — красится вместе с текстом кнопки, заливка только у
  // сплошного кирпичика, у самих стрелок — линии (тот же язык, что у
  // iconCheck/iconTriangle в status-plates.js).
  function buildCompressIcon(mirrored) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");

    // Рамка КВАДРАТНАЯ и ОДНА И ТА ЖЕ у обеих кнопок — это принципиально.
    // Раньше у зеркального варианта она была выше (24×27 против 24×24),
    // чтобы вместить вторую стрелку, и обе иконки ужимались в свои 20×20px
    // с РАЗНЫМ коэффициентом (0.74 против 0.83). Из-за этого одни и те же
    // по координатам кирпичик и стрелка на левой кнопке рисовались на ~13%
    // крупнее, чем на правой (см. запрос пользователя: выровнять
    // визуально). Общая квадратная рамка даёт обеим один масштаб, а раз
    // она квадратная — поворот не меняет её размеров, и viewBox один для
    // обоих вариантов.
    const BOX = 26;
    const center = BOX / 2;
    svg.setAttribute("viewBox", `0 0 ${BOX} ${BOX}`);
    // Разворот на 90° против часовой стрелки (в SVG ось Y вниз, поэтому
    // угол отрицательный): сама геометрия ниже описана "вертикально" —
    // кирпичик лежит поперёк, стрелки давят сверху/снизу, — так её проще
    // читать и править.
    const shape = document.createElementNS(svgNS, "g");
    shape.setAttribute("transform", `rotate(-90 ${center} ${center})`);
    svg.appendChild(shape);

    const strokeWidth = 1.6;
    // Круглый колпачок линии (stroke-linecap="round") выступает за её
    // геометрический конец на половину толщины — без этого запаса кончик
    // стрелки упирался бы в край рамки.
    const cap = strokeWidth / 2;
    const brickW = 14;
    const brickH = 3.6;
    const gap = 2.7; // от кирпичика до острия стрелки
    // Длина древка ОДНА на обе кнопки (было 7.9 слева и 6.9 справа) —
    // теперь, когда масштаб общий, разная длина сразу читалась бы как
    // разный размер стрелок (см. запрос пользователя).
    const shaftLen = 7.4;
    const headDepth = 2.8;
    const headHalfWidth = 2.6;

    // Центрируем СОДЕРЖИМОЕ, а не рамку. У зеркальной иконки стрелки
    // симметричны, и центр содержимого совпадает с центром кирпичика; у
    // одиночной снизу стрелки нет, поэтому центр содержимого смещён вверх
    // — на столько же опускаем кирпичик, чтобы вся фигура встала ровно в
    // середину рамки. Раньше этого сдвига не было, и левая иконка
    // прижималась к краю кнопки (после поворота — к левому).
    const armSpan = brickH / 2 + gap + shaftLen + cap;
    const topExtent = armSpan;
    const bottomExtent = mirrored ? armSpan : brickH / 2;
    const brickCenterY = center + (topExtent - bottomExtent) / 2;
    const brickTop = brickCenterY - brickH / 2;
    const brickBottom = brickCenterY + brickH / 2;

    function addLine(x1, y1, x2, y2) {
      const el = document.createElementNS(svgNS, "line");
      el.setAttribute("x1", x1.toFixed(2));
      el.setAttribute("y1", y1.toFixed(2));
      el.setAttribute("x2", x2.toFixed(2));
      el.setAttribute("y2", y2.toFixed(2));
      el.setAttribute("stroke", "currentColor");
      el.setAttribute("stroke-width", String(strokeWidth));
      el.setAttribute("stroke-linecap", "round");
      shape.appendChild(el);
    }
    // down — стрелка сверху вниз (остриё внизу, у кирпичика), !down —
    // зеркальная снизу вверх (остриё вверху, у кирпичика, древко ниже).
    function addArrow(tipY, down) {
      const shaftEndY = down ? tipY - shaftLen : tipY + shaftLen;
      addLine(center, shaftEndY, center, tipY);
      const delta = down ? -headDepth : headDepth;
      for (const sign of [-1, 1]) {
        addLine(center, tipY, center + sign * headHalfWidth, tipY + delta);
      }
    }

    const rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("x", (center - brickW / 2).toFixed(2));
    rect.setAttribute("y", brickTop.toFixed(2));
    rect.setAttribute("width", brickW.toFixed(2));
    rect.setAttribute("height", brickH.toFixed(2));
    rect.setAttribute("rx", (brickH / 2).toFixed(2));
    rect.setAttribute("fill", "currentColor");
    shape.appendChild(rect);

    addArrow(brickTop - gap, true);
    if (mirrored) addArrow(brickBottom + gap, false);

    return svg;
  }

  // "?" перед "N кб → M кб" (см. .compress-info-wrap в CSS) — что именно
  // сделает конкретно эта кнопка: заголовок ("Умеренное сжатие"/
  // "Максимальное сжатие", см. .status-chip-popup-title) + короткое
  // описание, тот же вид попапа, что и у "Типографика готова"/"Артефакты
  // очищены" (см. .status-chip-popup в CSS). Реюзаем iconQuestion/
  // attachChipPopup из status-plates.js (та же механика — наведение+клик
  // на десктопе, тап на мобиле, см. её же комментарий) — они уже
  // загружены раньше этого файла (см. порядок <script> в index.html),
  // отдельно ничего заводить не нужно. Строится ОДИН РАЗ (не на каждый
  // renderOutput, в отличие от самих чисел) — заголовок и описание
  // статичны и не зависят от текущего веса, а попап и обработчики
  // пересоздавать на каждый рендер незачем.
  function buildCompressInfoIcon(title, description) {
    const infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.className = "status-chip-info";
    infoBtn.setAttribute("aria-label", `${title}: ${description}`);
    infoBtn.setAttribute("aria-expanded", "false");
    infoBtn.appendChild(iconQuestion());

    const popup = document.createElement("div");
    popup.className = "status-chip-popup compress-info-popup";
    popup.hidden = true;
    const titleEl = document.createElement("div");
    titleEl.className = "status-chip-popup-title";
    titleEl.textContent = title;
    popup.appendChild(titleEl);
    const descEl = document.createElement("div");
    descEl.textContent = description;
    popup.appendChild(descEl);

    attachChipPopup(infoBtn, popup);

    const wrap = document.createElement("span");
    wrap.className = "compress-info-wrap";
    wrap.appendChild(infoBtn);
    wrap.appendChild(popup);
    return wrap;
  }

  compressModerateBtn.appendChild(buildCompressIcon(false));
  compressMaxBtn.appendChild(buildCompressIcon(true));
  const compressInfoModerate = buildCompressInfoIcon(
    "Умеренное сжатие",
    "Убрать табуляцию, прижать код к левому краю",
  );
  const compressInfoMax = buildCompressInfoIcon(
    "Максимальное сжатие",
    "Полностью убрать деление на строки, табуляцию и переносы",
  );

  // "Сжать (умеренно)" (см. .compress-group в CSS) — убирает только
  // ведущие пробелы/табы каждой строки (отступ, всегда добавлен
  // форматтером — не часть содержимого письма), сами переносы строк не
  // трогает: количество строк остаётся тем же, что и до сжатия, просто
  // все они прижимаются к левому краю.
  function compressHtmlModerate(html) {
    return html
      .split("\n")
      .map((line) => line.replace(/^[ \t]+/, ""))
      .join("\n");
  }

  // "Сжать (максимально)" — то же самое плюс сами переносы строк тоже
  // убираются (вся разметка — в одну строку). Пробелы МЕЖДУ атрибутами и
  // ВНУТРИ текстового содержимого — они всегда стоят не в начале строки
  // — не трогаем ни там, ни там. Строки в этом форматтере никогда не
  // переносятся посреди текста (см. white-space:pre/no-wrap у #output в
  // CSS — длинные строки скроллятся горизонтально, а не переносятся), так
  // что склеивать соседние строки без разделителя после обрезки отступа
  // безопасно: не бывает случая, когда перенос строки — это на самом деле
  // "пробел посреди фразы".
  function compressHtmlMax(html) {
    return html
      .split("\n")
      .map((line) => line.replace(/^[ \t]+/, "").replace(/\t/g, ""))
      .join("");
  }

  // Вес в КБ (1024 байта) для сводки у "Сжать" — байты, а не JS .length:
  // .length считает UTF-16 code units, а не байты, и на кириллическом
  // тексте (почти весь контент реальных писем) сильно занижал бы вес
  // относительно того, сколько реально весит файл в UTF-8.
  function byteSize(str) {
    return new TextEncoder().encode(str).length;
  }
  function formatKb(bytes) {
    return Math.round(bytes / 1024) + " кб";
  }
  // 102 КБ — реальный практический порог: именно на нём Gmail обрезает
  // слишком тяжёлые HTML-письма ("Показать целиком письмо"), после чего
  // хвост вёрстки (a значит и её работоспособность) не гарантирован.
  const GMAIL_CLIP_BYTES = 102 * 1024;

  // Заполняет один "до → после" (см. .compress-size в CSS) — общий кусок
  // для обеих кнопок, у каждой свой afterHtml (результат ИМЕННО её
  // сжатия, см. updateCompressStatus), поэтому "после" у них закономерно
  // разное. Обе цифры красятся НЕЗАВИСИМО друг от друга по одному и тому
  // же порогу (см. GMAIL_CLIP_BYTES) — то, что "было" красное, а "стало"
  // зелёное, наглядно показывает, что именно это сжатие решает проблему
  // (и наоборот, если обе остались красными — этого сжатия недостаточно).
  // infoWrap — тот же самый персистентный узел (см. buildCompressInfoIcon
  // выше), не пересоздаётся на каждый вызов: el.innerHTML="" его убирает
  // из DOM вместе со всем остальным, но appendChild ниже возвращает ЕГО
  // ЖЕ обратно (с уже навешенными обработчиками), а не создаёт заново —
  // иначе на каждый renderOutput плодились бы новые попапы и новые
  // document-level обработчики клика "мимо" (см. attachChipPopup).
  function renderCompressSize(el, beforeBytes, afterHtml, infoWrap) {
    const afterBytes = byteSize(afterHtml);
    el.innerHTML = "";
    el.appendChild(infoWrap);
    const beforeSpan = document.createElement("span");
    beforeSpan.className = beforeBytes > GMAIL_CLIP_BYTES ? "compress-size-over" : "compress-size-ok";
    beforeSpan.textContent = formatKb(beforeBytes);
    const arrow = document.createElement("span");
    arrow.className = "compress-arrow";
    arrow.textContent = "→";
    const afterSpan = document.createElement("span");
    afterSpan.className = afterBytes > GMAIL_CLIP_BYTES ? "compress-size-over" : "compress-size-ok";
    afterSpan.textContent = formatKb(afterBytes);
    el.appendChild(beforeSpan);
    el.appendChild(arrow);
    el.appendChild(afterSpan);
  }

  // Заглушка "0 кб → 0 кб" (см. .compress-size-placeholder в CSS) — пока
  // ещё нет ни одного реального форматирования (пустой lastCleanHtml, то
  // есть только что открытая страница или пустое поле ввода): кнопки
  // остаются на месте (клик по ним и так безвредный no-op, см. guard
  // "if (!lastCleanHtml) return" ниже), просто цифры пока не настоящие.
  // "?" показываем и здесь — он объясняет, что делает кнопка, это не
  // зависит от того, появился ли уже настоящий результат форматирования.
  function renderCompressPlaceholder(el, infoWrap) {
    el.innerHTML = "";
    el.appendChild(infoWrap);
    const beforeSpan = document.createElement("span");
    beforeSpan.className = "compress-size-placeholder";
    beforeSpan.textContent = "0 кб";
    const arrow = document.createElement("span");
    arrow.className = "compress-arrow";
    arrow.textContent = "→";
    const afterSpan = document.createElement("span");
    afterSpan.className = "compress-size-placeholder";
    afterSpan.textContent = "0 кб";
    el.appendChild(beforeSpan);
    el.appendChild(arrow);
    el.appendChild(afterSpan);
  }

  // Сводки "было → станет" рядом с каждой кнопкой "Сжать" — живые,
  // пересчитываются при каждом renderOutput (как и остальные
  // status-плашки), а не только по клику: пользователь должен видеть,
  // сколько сожмётся, ДО того, как решит нажимать.
  function updateCompressStatus() {
    if (!lastCleanHtml) {
      renderCompressPlaceholder(compressSizeModerate, compressInfoModerate);
      renderCompressPlaceholder(compressSizeMax, compressInfoMax);
      return;
    }
    const beforeBytes = byteSize(lastCleanHtml);
    renderCompressSize(compressSizeModerate, beforeBytes, compressHtmlModerate(lastCleanHtml), compressInfoModerate);
    renderCompressSize(compressSizeMax, beforeBytes, compressHtmlMax(lastCleanHtml), compressInfoMax);
  }
  // Заглушка видна сразу при открытии страницы — до этого момента
  // updateCompressStatus вызывается только изнутри renderOutput, а тот
  // сам по себе на старте не запускается (нет форматирования без клика
  // на "Форматировать").
  updateCompressStatus();

  // Общий сброс состояния после сжатия (обеими кнопками) — тот же приём,
  // что и у ручной правки #outputEditor (см. его "input"-listener выше):
  // прежние построчные диагностики (workingTags) после сжатия теряют
  // смысл как позиции (у "максимально" строк вообще не остаётся, у
  // "умеренно" строки те же, но сама диагностика уже успела устареть —
  // подтверждать её заново придётся полным форматированием).
  function applyCompressed(compressed) {
    lastCleanHtml = compressed;
    workingTags = [];
    rejectedCount = 0;
    totalFlaggedCount = 0;
    outputEditedManually = true;
    renderOutput();
  }

  // Заменяют вывод сжатой версией НАПРЯМУЮ (не через
  // formatHtmlWithDiagnostics: повторный прогон форматтера заново
  // расставил бы отступы, полностью отменив сжатие).
  compressModerateBtn.addEventListener("click", () => {
    if (!lastCleanHtml) return;
    applyCompressed(compressHtmlModerate(lastCleanHtml));
  });
  compressMaxBtn.addEventListener("click", () => {
    if (!lastCleanHtml) return;
    applyCompressed(compressHtmlMax(lastCleanHtml));
  });

  input.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runFormat();
    }
  });
