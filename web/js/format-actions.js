
  // Общая часть runFormat/reformatAfterAllResolved — прогоняет source
  // через сам форматтер и раскладывает результат по lastCleanHtml/
  // workingTags. scrollToBottom — только для форматирования "с нуля" (по
  // кнопке/чекбоксам): переход к свежему коду ожидаем. Для повторного
  // прохода после разбора всех подсказок (см. reformatAfterAllResolved)
  // пользователь уже смотрит в нужное место — прыгать вниз незачем,
  // позицию скролла сохраняет сам renderOutput.
  function applyFormatResult(source, scrollToBottom) {
    status.textContent = "";
    rejectedCount = 0;
    totalFlaggedCount = 0;
    outputEditedManually = false;
    lastEmptyAttrsFill = [];
    lastEmptyAttrsDelete = [];
    lastRemovedServiceItems = [];
    lastTypografyItems = [];
    if (!source.trim()) {
      lastCleanHtml = "";
      workingTags = [];
      renderOutput();
      return;
    }
    try {
      const {
        html,
        unclosedTags,
        emptyAttrsToFill,
        emptyAttrsToDelete,
        removedServiceItems,
        typografyItems,
      } = window.HtmlFormatter.formatHtmlWithDiagnostics(source, {
        collapseOutlookComments: collapseOutlookComments.checked,
        typografy: typografy.checked,
        cleanServiceAttrs: cleanServiceAttrs.checked,
      });
      lastCleanHtml = html;
      lastEmptyAttrsFill = emptyAttrsToFill;
      lastEmptyAttrsDelete = emptyAttrsToDelete;
      lastRemovedServiceItems = removedServiceItems;
      lastTypografyItems = typografyItems;
      totalFlaggedCount = unclosedTags.length;
      // При выключенной опции просто не показываем ни одной подсказки —
      // сам formatHtmlWithDiagnostics всё равно считает диагностику (это
      // недорого), но веб-интерфейс полностью игнорирует результат: ни
      // флажков, ни попапов, ни серых строк-подсказок. kind:"unclosed" —
      // единственный вид диагностики тегов: тег реально есть в исходнике
      // (открывающий), просто не нашёл пары. Мы намеренно НЕ предлагаем
      // вставить тег, которого в вёрстке вообще нет ни в каком виде
      // (ни открывающего, ни закрывающего) — таких случаев слишком много
      // тонкостей, это на усмотрение пользователя.
      workingTags = checkUnclosedTags.checked
        ? unclosedTags.map((u) => Object.assign({ __uid: uidCounter++, kind: "unclosed" }, u))
        : [];
      renderOutput();
      if (scrollToBottom) {
        // После свежего форматирования скроллим к самому низу нового кода
        // (уже устоявшееся поведение) — это единственное место, где
        // renderOutput не должен сохранять прежнюю позицию скролла.
        setOutputScrollTop(outputEditor.scrollHeight);
        updateScrollHints();
        renderPopups();
      }
    } catch (err) {
      status.textContent = "Ошибка: " + (err && err.message ? err.message : String(err));
    }
  }

  function runFormat() {
    enforceNoEdgeBlankLines();
    applyFormatResult(input.value, true);
  }

  // Пользователь разобрал ВСЕ подсказки текущего прогона (каждую либо
  // подтвердил, либо отклонил — см. acceptSuggestion/rejectSuggestion).
  // Строчечная вставка/сдвиг номеров строк там — расчёт "на глаз", без
  // полного повторного разбора дерева; как только решать больше нечего,
  // прогоняем накопленный lastCleanHtml через форматтер ещё раз с нуля —
  // это даёт настоящий, а не приближённый отступ по всему документу и
  // заодно вскрывает проблемы, которые могли обнаружиться только ПОСЛЕ
  // принятия предыдущих подсказок (например, вложенный дальше тег, чей
  // родитель появился только что).
  //
  // Важно: если пользователь отклонил подсказку, сам HTML не менялся —
  // значит, при повторном разборе тот же дефект будет найден заново, и
  // соответствующий флажок/попап появится снова. Это осознанное
  // поведение, а не забытая утечка "не спрашивать повторно": "не
  // спрашивать" гарантируется только в рамках уже показанного набора
  // подсказок, а не навсегда — сам документ как был не в порядке в этом
  // месте, так и остался.
  function reformatAfterAllResolved() {
    applyFormatResult(lastCleanHtml, false);
  }

  // Чекбоксы больше НЕ запускают форматирование сами по себе — щелчок
  // только меняет настройку для СЛЕДУЮЩЕГО запуска (runFormat читает их
  // .checked в момент вызова). Старый результат в #output остаётся как
  // есть, пока пользователь явно не нажмёт "Форматировать" (или
  // Cmd/Ctrl+Enter) снова.
  formatBtn.addEventListener("click", runFormat);

  // Прямое редактирование в поле вывода (см. .output-editor в CSS) —
  // тот же приём, что и у поля ввода: пользователь печатает в прозрачный
  // textarea поверх подсвеченного #output, а мы читаем его .value как
  // новый lastCleanHtml. Все текущие подсказки (workingTags) при этом
  // сбрасываются — их позиции (номера строк) считаны для СТАРОГО текста
  // и после ручной правки уже ничего не гарантируют; просто перестаём
  // предлагать и молчим в статус-плашке (см. outputEditedManually в
  // updateOutputStatus), пока пользователь не запустит новый прогон
  // форматтера явно.
  outputEditor.addEventListener("input", () => {
    lastCleanHtml = outputEditor.value;
    workingTags = [];
    rejectedCount = 0;
    totalFlaggedCount = 0;
    outputEditedManually = true;
    renderOutput();
  });
  outputEditor.addEventListener("scroll", () => {
    output.scrollTop = outputEditor.scrollTop;
    output.scrollLeft = outputEditor.scrollLeft;
    outputLineNumbers.scrollTop = outputEditor.scrollTop;
    // См. syncInputScroll про тот же приём.
    void output.offsetHeight;
    void outputLineNumbers.offsetHeight;
    updateScrollHints();
    renderPopups();
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastCleanHtml);
      const old = copyBtn.textContent;
      copyBtn.textContent = "Скопировано";
      setTimeout(() => (copyBtn.textContent = old), 1200);
    } catch {
      status.textContent = "Не удалось скопировать в буфер обмена.";
    }
  });

