  // Текст подписи у "Парный тег" (см. addPopup) — какого именно вида тег
  // мы нашли/не нашли у ДРУГОГО конца этой связки. "Не найден" — когда
  // ЭТОТ попап стоит на РЕАЛЬНОМ, уже существующем в письме теге (сам
  // unclosed на месте открытия) — второй половины у него в письме
  // действительно нет, мы её только предлагаем. "Найден" — когда ЭТОТ
  // попап, наоборот, сам стоит на ПРЕДЛОЖЕННОМ (ещё не принятом) теге —
  // а вот его пара уже реально есть в письме, мы её и нашли. t — один
  // тег (см. UnclosedTagGroup.tags в src/formatter.ts), а не целая группа:
  // "парная строка" — понятие для ОДНОГО тега, у группы из нескольких
  // тегов их сразу несколько (см. renderPopups — там для таких попап
  // просто не показывает эту подпись).
  function pairLabelFor(t, isOpenSide) {
    if (isMindboxConstruct(t.tagName)) {
      return isOpenSide
        ? `Не найдена закрывающая конструкция ${mindboxCloseLabel(t.tagName)}: `
        : `Найдена открывающая конструкция ${mindboxOpenLabel(t.tagName)}: `;
    }
    return isOpenSide ? "Не найден закрывающий тег: " : "Найден открывающий тег: ";
  }

  // Номер строки (0-based, как в lastOpenFlags) "парного" тега для t —
  // или null, если её строку не удалось найти среди уже отрисованных
  // флажков (см. buildDisplayHtml). У тега есть ДВЕ строки: где он реально
  // открылся (t.line, red-флажок в lastOpenFlags) и где предполагается
  // вставить закрывающий (строка ЭТОГО ЖЕ попапа, close-роль). Показываем
  // ссылку на первую — вторая и так уже прямо здесь, под самим попапом.
  function pairedRow(t) {
    const flag = lastOpenFlags.find((f) => f.uid === t.__uid);
    return flag ? flag.row : null;
  }

  // Зеркало pairedRow специально для дубликата попапа на открывающей
  // стороне unclosed (см. renderPopups/.unclosed-open-anchor) — обычный
  // pairedRow(t) для unclosed всегда указывает на строку ОТКРЫТИЯ (это
  // то, что нужно попапу у подсказки), а этому дубликату, наоборот, нужна
  // ссылка на строку подсказки (close-роль, lastCloseFlags) — попап и так
  // уже стоит у открытия.
  function pairedRowForOpenSide(t) {
    const flag = lastCloseFlags.find((f) => f.uid === t.__uid);
    return flag ? flag.row : null;
  }

  // Готовые строки текста (без HTML-разметки — то, что реально уходит в
  // lastCleanHtml, в отличие от подсвеченной версии в buildDisplayHtml) —
  // закрывающие теги группы от самого внутреннего к самому внешнему,
  // при needsConditionalCommentWrap ещё и обёрнутые в новую
  // <!--[if ...]-->...<![endif]-->. Тот же порядок и тот же принцип
  // отступов, что и у серых строк-подсказок в diagnostics-view.js —
  // сознательно НЕ переиспользует один код с ней, потому что там нужна
  // HTML-экранированная/подсвеченная версия для отображения, а здесь —
  // сырой текст для вставки.
  function buildGroupInsertLines(g) {
    const lines = [];
    if (g.needsConditionalCommentWrap) {
      lines.push("  ".repeat(g.tags[0].depth) + g.conditionalCommentText);
    }
    for (let ti = g.tags.length - 1; ti >= 0; ti--) {
      const t = g.tags[ti];
      const tagText = isMindboxConstruct(t.tagName) ? mindboxCloseLabel(t.tagName) : "</" + t.tagName + ">";
      lines.push("  ".repeat(t.depth) + tagText);
    }
    if (g.needsConditionalCommentWrap) {
      lines.push("  ".repeat(g.tags[0].depth) + "<![endif]-->");
    }
    return lines;
  }

  // Пользователь подтвердил ОБЩУЮ подсказку группы: ВСЕ закрывающие теги
  // группы (и обёртка в outlook-конструкцию, если нужна — см.
  // buildGroupInsertLines) дописываются ПО-НАСТОЯЩЕМУ, разом, одним
  // куском текста, прямо в lastCleanHtml — единое действие для всей
  // группы, а не по одному тегу (см. запрос пользователя: "один общий
  // попап и одно общее предложение").
  //
  // В отличие от старой версии (один тег — ручной сдвиг line/insertBeforeLine
  // у остальных записей) здесь всегда полный reformatAfterAllResolved():
  // ручной сдвиг с группами и обёрткой в условный комментарий стал бы
  // отдельным источником багов (нужно было бы аккуратно двигать номера
  // строк ВНУТРИ группы, пересчитывать глубины и т.п.), а полный повторный
  // прогон форматтера даёт гарантированно верные новые группы "бесплатно" —
  // сам reformatAfterAllResolved не прыгает скроллом (см. applyFormatResult
  // с scrollToBottom=false), так что для пользователя разница не заметна.
  function acceptGroupSuggestion(g) {
    const lines = lastCleanHtml.split("\n");
    lines.splice(g.insertBeforeLine, 0, ...buildGroupInsertLines(g));
    lastCleanHtml = lines.join("\n");
    reformatAfterAllResolved();
  }

  // Пользователь отклонил подсказку целиком для ВСЕЙ группы: убираем
  // группу из workingTags — серые строки-подсказки и оба вида попапов для
  // ВСЕХ её тегов исчезают разом. lastCleanHtml не трогаем: этих строк там
  // никогда и не было, это было только предложение. rejectedCount растёт
  // на число тегов в группе — общий счётчик считается в тегах, а не в
  // группах (см. totalFlaggedCount/updateOutputStatus).
  //
  // ВСЕГДА renderOutput(), НИКОГДА reformatAfterAllResolved() — раньше
  // (баг, найден пользователем) "последний отклонённый" запускал полный
  // повторный прогон форматтера, а тот, не имея памяти об отклонении, тут
  // же находил ТОТ ЖЕ дефект заново и создавал новую подсказку — с точки
  // зрения пользователя клик по "✕" визуально не делал вообще ничего.
  // lastCleanHtml при отклонении не меняется, значит и переформатировать
  // заново нечего.
  function rejectGroupSuggestion(g) {
    workingTags = workingTags.filter((e) => e.__uid !== g.__uid);
    rejectedCount += g.tags.length;
    renderOutput();
  }

  // Пользователь подтвердил удаление реально открывшегося, но так и не
  // закрытого тега (попап на открывающей стороне, см. renderPopups) —
  // убираем его СТРОКУ ЦЕЛИКОМ из lastCleanHtml. В отличие от
  // acceptGroupSuggestion (та — единое действие на всю группу), удаление
  // остаётся независимым ПО ОДНОМУ тегу (см. запрос пользователя — про
  // объединение сказано только для добавления закрывающих тегов). Полный
  // reformatAfterAllResolved() по той же причине, что и у
  // acceptGroupSuggestion — гарантированно верные новые группы вместо
  // ручного пересчёта.
  function acceptTagDeletion(t) {
    const lines = lastCleanHtml.split("\n");
    lines.splice(t.line, 1);
    lastCleanHtml = lines.join("\n");
    reformatAfterAllResolved();
  }

  // Пользователь решил оставить этот ОДИН тег как есть — убираем его из
  // group.tags (оба его попапа — "Удалить?" здесь и его собственная
  // закрывающая строка внутри общей подсказки группы — исчезают вместе),
  // не трогая остальные теги той же группы: они по-прежнему предлагаются
  // группой как раньше. Если тег был единственным в группе — вся группа
  // исчезает вместе с ним. lastCleanHtml не меняется (симметрично
  // rejectGroupSuggestion, см. её же комментарий про ВСЕГДА renderOutput()).
  function rejectTagDeletion(t, g) {
    g.tags = g.tags.filter((x) => x.__uid !== t.__uid);
    if (g.tags.length === 0) {
      workingTags = workingTags.filter((e) => e.__uid !== g.__uid);
    }
    rejectedCount += 1;
    renderOutput();
  }
