  function renderOutput() {
    const savedTop = outputEditor.scrollTop;
    const savedLeft = outputEditor.scrollLeft;
    const { displayHtml, openFlags, closeFlags, lineCount, origToFinalRow } = buildDisplayHtml(
      lastCleanHtml,
      workingTags,
    );
    output.innerHTML = withTrailingLineMarker(displayHtml);
    if (outputEditor.value !== lastCleanHtml) outputEditor.value = lastCleanHtml;
    // Серые строки-подсказки (см. buildDisplayHtml/insertions) — это
    // РЕАЛЬНЫЕ дополнительные строки в отображении (#output/
    // #outputLineNumbers), которых при этом physически НЕТ в
    // outputEditor.value (сама подсказка ещё не принята). Из-за этого
    // #output/#outputLineNumbers становятся выше (scrollHeight), чем
    // outputEditor — и его собственный максимум скролла НЕ ДОТЯГИВАЕТ до
    // самого низа подсказок: последняя вставленная строка навсегда
    // остаётся недокрученной на высоту этих подсказок. Добавляем
    // outputEditor немного "воздуха" снизу (padding-bottom), чтобы у него
    // хватало лишнего скроллируемого места дотянуться до того же самого
    // низа, что и у #output/#outputLineNumbers.
    //
    // 26px — фиксированное значение, подобранное опытным путём, а не
    // точный расчёт "по одной высоте строки на подсказку" (как было
    // раньше, calc(16px + N × lineHeight)). Тот точный расчёт при
    // большом N (несколько подсказок разом) провоцировал в браузере
    // эффект "резиновой" сверхпрокрутки (overscroll bounce) — скролл на
    // мгновение уезжал НИЖЕ реального максимума и потом отскакивал
    // обратно, из-за чего разметка визуально "съезжала" на время
    // анимации. Фиксированные 26px этого не вызывают и на практике
    // хватает, чтобы дотянуться до низа последней подсказки, — решение
    // не идеально строгое, но воспроизводимо чинит баг.
    const realLineCount = lastCleanHtml ? lastCleanHtml.split("\n").length : 1;
    const insertedCount = Math.max(0, lineCount - realLineCount);
    outputEditor.style.paddingBottom = insertedCount > 0 ? "26px" : "";
    outputEditor.scrollTop = savedTop;
    outputEditor.scrollLeft = savedLeft;
    output.scrollTop = savedTop;
    output.scrollLeft = savedLeft;
    outputLineNumbers.scrollTop = savedTop;
    // См. syncInputScroll/setOutputScrollTop про тот же приём.
    void output.offsetHeight;
    void outputLineNumbers.offsetHeight;
    lastOpenFlags = openFlags;
    lastCloseFlags = closeFlags;
    lastOrigToFinalRow = origToFinalRow;
    emptyAttrDomIndex = buildEmptyAttrDomIndex();
    // Флажки — часть содержимого колонки номеров (см. renderOutputLineNumbers),
    // так что перерисовываются вместе с ней, а не отдельным слоем поверх.
    renderOutputLineNumbers(lineCount);
    renderPopups();
    updateScrollHints();
    updateOutputStatus();
    updateEmptyAttrsStatus();
    updateServiceCleanupStatus();
    updateTypografyStatus();
    updateCompressStatus();
    updateOutputEditableState();
  }

  // Пока есть хоть один неразрешённый тег (workingTags не пуст) —
  // редактирование #outputEditor запрещено целиком (см. подробный
  // комментарий у .output-editor.locked в CSS: "призрачные" строки-
  // подсказки физически не существуют в его собственном value, и правка
  // вперемешку с ними ломает и разметку, и синхронизацию скролла).
  // readOnly — подстраховка на случай, если фокус всё же попадёт в поле
  // (например, через Tab) до того, как сработает обработчик focus ниже;
  // класс .locked только меняет курсор — само реальное блокирование
  // клика/фокуса делают mousedown/focus-обработчики (см. ниже), они же
  // показывают подсказку.
  function updateOutputEditableState() {
    const locked = workingTags.length > 0;
    outputEditor.readOnly = locked;
    outputEditor.classList.toggle("locked", locked);
  }

  let lockedTooltipTimer = null;

  // Позиционируем от того же элемента (.output-clip), что и попапы "Добавить?"
  // (см. wrapRect в renderPopups) — единая система координат для всего, что
  // лежит поверх #output.
  function showLockedTooltip(clientX, clientY) {
    const wrapRect = output.parentElement.getBoundingClientRect();
    lockedTooltip.textContent = "Обязательно сбалансируйте теги";
    lockedTooltip.style.left = clientX - wrapRect.left + 10 + "px";
    lockedTooltip.style.top = clientY - wrapRect.top - 30 + "px";
    lockedTooltip.classList.add("visible");
    clearTimeout(lockedTooltipTimer);
    lockedTooltipTimer = setTimeout(() => lockedTooltip.classList.remove("visible"), 3000);
  }

  // preventDefault на mousedown — стандартный приём, чтобы textarea НЕ
  // получила фокус и курсор вообще не появился (обычный readOnly сам по
  // себе фокус и позиционирование курсора не блокирует, только запрещает
  // менять текст). focus-обработчик — подстраховка на случай фокуса не
  // через клик (например, Tab с предыдущего элемента).
  outputEditor.addEventListener("mousedown", (e) => {
    if (workingTags.length === 0) return;
    e.preventDefault();
    showLockedTooltip(e.clientX, e.clientY);
  });
  outputEditor.addEventListener("focus", () => {
    if (workingTags.length > 0) outputEditor.blur();
  });
