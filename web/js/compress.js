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
  function renderCompressSize(el, beforeBytes, afterHtml) {
    const afterBytes = byteSize(afterHtml);
    el.innerHTML = "";
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
  function renderCompressPlaceholder(el) {
    el.innerHTML = "";
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
      renderCompressPlaceholder(compressSizeModerate);
      renderCompressPlaceholder(compressSizeMax);
      return;
    }
    const beforeBytes = byteSize(lastCleanHtml);
    renderCompressSize(compressSizeModerate, beforeBytes, compressHtmlModerate(lastCleanHtml));
    renderCompressSize(compressSizeMax, beforeBytes, compressHtmlMax(lastCleanHtml));
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
