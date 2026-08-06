
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
    lastUnclosedQuoteAttrs = [];
    lastUnopenedQuoteAttrs = [];
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
        unclosedTagGroups,
        emptyAttrsToFill,
        emptyAttrsToDelete,
        unclosedQuoteAttrs,
        unopenedQuoteAttrs,
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
      lastUnclosedQuoteAttrs = unclosedQuoteAttrs;
      lastUnopenedQuoteAttrs = unopenedQuoteAttrs;
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
      //
      // workingTags — теперь список ГРУПП (см. UnclosedTagGroup в
      // src/formatter.ts), а не отдельных тегов: цепочка вложенных
      // незакрытых предков, вытесненных в одну точку вставки, приходит от
      // форматтера уже одной группой (tags.length > 1) — веб-интерфейс
      // показывает такую группу одним общим попапом вместо кучи отдельных
      // (см. renderPopups/buildDisplayHtml). Одиночный незакрытый тег без
      // цепочки — просто группа из одного элемента, ведёт себя как раньше.
      // __uid на самой группе — для попапа "Добавить?" (общий на всю
      // группу) и серых строк-подсказок; __uid на каждом теге внутри —
      // для попапа "Удалить?" (у каждого тега свой, см. renderPopups) и
      // связанного с ним флажка в колонке номеров строк.
      workingTags = checkUnclosedTags.checked
        ? unclosedTagGroups.map((g) =>
            Object.assign({ __uid: uidCounter++, kind: "unclosed" }, g, {
              tags: g.tags.map((t) => Object.assign({ __uid: uidCounter++ }, t)),
            }),
          )
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

  // Вызывается из acceptGroupSuggestion/acceptTagDeletion (см.
  // popup-actions.js) — КАЖДЫЙ раз, когда содержимое lastCleanHtml реально
  // поменялось принятием подсказки (не только когда workingTags опустел
  // до нуля). reject* сюда никогда не попадает — ВСЕГДА зовёт
  // renderOutput() напрямую (см. их же комментарии): если содержимое не
  // менялось, переформатировать нечего, а повторный разбор без памяти об
  // отклонении тут же нашёл бы тот же дефект заново и "воскресил" бы
  // только что отклонённую подсказку — реальный баг, из-за которого клик
  // по "✕" на последней подсказке выглядел так, будто ничего не
  // произошло.
  //
  // Полный повторный прогон форматтера на КАЖДОЕ принятие (а не ручной
  // сдвиг line/insertBeforeLine "на глаз", как было раньше для одиночных
  // тегов) — осознанный выбор: с группами (см. UnclosedTagGroup) и
  // возможной обёрткой в условный комментарий ручной пересчёт стал бы
  // отдельным источником багов, а полный прогон даёт гарантированно
  // верные новые группы "бесплатно" и заодно вскрывает проблемы, которые
  // могли обнаружиться только ПОСЛЕ принятия (например, вложенный дальше
  // тег, чей родитель появился только что). scrollToBottom=false — не
  // прыгает скроллом, для пользователя разница с прежним "точечным"
  // подходом практически не заметна.
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
  //
  // Исключение — плашка кавычек (см. updateQuoteIssuesStatus): у неё нет
  // попапа принять/отклонить (осознанное решение — см. запрос
  // пользователя), значит нет и другого способа узнать, что пользователь
  // дописал недостающую кавычку прямо тут, в выводе, кроме как проверить
  // это самим. С debounce (см. scheduleQuoteFixCheck) — гонять полный
  // разбор дерева на КАЖДОЕ нажатие клавиши на большом письме заметно
  // тормозило бы курсор.
  outputEditor.addEventListener("input", () => {
    const hadQuoteIssues =
      checkUnclosedTags.checked && (lastUnclosedQuoteAttrs.length > 0 || lastUnopenedQuoteAttrs.length > 0);
    lastCleanHtml = outputEditor.value;
    workingTags = [];
    rejectedCount = 0;
    totalFlaggedCount = 0;
    outputEditedManually = true;
    renderOutput();
    if (hadQuoteIssues) scheduleQuoteFixCheck();
  });

  // Если правка в #outputEditor устранила ВСЕ кавычковые проблемы (см.
  // hadQuoteIssues выше) — автоматически переформатировать целиком, не
  // дожидаясь, пока пользователь сам нажмёт "Форматировать": и структура,
  // и остальная диагностика могли поменяться теперь, когда кавычки
  // настоящие, а approximate-правка построчно (как у accept*, см.
  // reformatAfterAllResolved) тут не подходит — для кавычек нет попапа,
  // который знал бы, ЧТО именно поменялось и где. 400мс — та же идея
  // дебаунса, что и у scheduleInputHighlight (см. highlight-input.js):
  // ждём паузы в наборе текста, а не гоняем полный разбор на каждую
  // нажатую клавишу.
  let quoteFixCheckTimer = null;
  function scheduleQuoteFixCheck() {
    clearTimeout(quoteFixCheckTimer);
    quoteFixCheckTimer = setTimeout(checkQuoteIssuesResolvedAndReformat, 400);
  }
  function checkQuoteIssuesResolvedAndReformat() {
    // outputEditor.value мог уйти дальше за эти 400мс (пользователь всё
    // ещё печатает) — lastCleanHtml к этому моменту уже синхронизирован
    // с ним самим же input-обработчиком выше, так что просто перепроверяем
    // актуальное состояние, а не то, что было на момент планирования.
    if (!lastCleanHtml.trim()) return;
    const { unclosedQuoteAttrs, unopenedQuoteAttrs } = window.HtmlFormatter.formatHtmlWithDiagnostics(
      lastCleanHtml,
      {
        collapseOutlookComments: collapseOutlookComments.checked,
        typografy: typografy.checked,
        cleanServiceAttrs: cleanServiceAttrs.checked,
      },
    );
    if (unclosedQuoteAttrs.length === 0 && unopenedQuoteAttrs.length === 0) {
      reformatAfterAllResolved();
    }
  }
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

  // "Форматировать результат" — та же логика, что у главной кнопки
  // "Форматировать", только источник — ТЕКУЩЕЕ содержимое #outputEditor
  // (lastCleanHtml), а не #input: пригождается, когда пользователь
  // накопил правки прямо в выводе (см. outputEditedManually) и хочет
  // честный полный прогон форматтера по НИМ, не трогая исходный инпут.
  function formatResultAgain() {
    applyFormatResult(lastCleanHtml, true);
  }
  formatResultBtn.addEventListener("click", formatResultAgain);

