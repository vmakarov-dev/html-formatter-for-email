  // Текст подписи у "Парный тег" (см. addPopup) — какого именно вида тег
  // мы нашли/не нашли у ДРУГОГО конца этой связки. "Не найден" — когда
  // ЭТОТ попап стоит на РЕАЛЬНОМ, уже существующем в письме теге (сам
  // unclosed на месте открытия) — второй половины у него в письме
  // действительно нет, мы её только предлагаем. "Найден" — когда ЭТОТ
  // попап, наоборот, сам стоит на ПРЕДЛОЖЕННОМ (ещё не принятом) теге —
  // а вот его пара уже реально есть в письме, мы её и нашли.
  function pairLabelFor(u, isOpenSide) {
    if (isMindboxConstruct(u.tagName)) {
      return isOpenSide
        ? `Не найдена закрывающая конструкция ${mindboxCloseLabel(u.tagName)}: `
        : `Найдена открывающая конструкция ${mindboxOpenLabel(u.tagName)}: `;
    }
    return isOpenSide ? "Не найден закрывающий тег: " : "Найден открывающий тег: ";
  }

  // Номер строки (0-based, как в lastOpenFlags) "парного" тега для u —
  // или null, если её строку не удалось найти среди уже отрисованных
  // флажков (см. buildDisplayHtml). У записи есть ДВЕ строки: где тег
  // реально открылся (u.line, red-флажок в lastOpenFlags) и где
  // предполагается вставить закрывающий (строка ЭТОГО ЖЕ попапа,
  // close-роль). Показываем ссылку на первую — вторая и так уже прямо
  // здесь, под самим попапом.
  function pairedRow(u) {
    const flag = lastOpenFlags.find((f) => f.uid === u.__uid);
    return flag ? flag.row : null;
  }

  // Зеркало pairedRow специально для дубликата попапа на открывающей
  // стороне unclosed (см. renderPopups/.unclosed-open-anchor) — обычный
  // pairedRow(u) для unclosed всегда указывает на строку ОТКРЫТИЯ (это
  // то, что нужно попапу у подсказки), а этому дубликату, наоборот, нужна
  // ссылка на строку подсказки (close-роль, lastCloseFlags) — попап и так
  // уже стоит у открытия.
  function pairedRowForOpenSide(u) {
    const flag = lastCloseFlags.find((f) => f.uid === u.__uid);
    return flag ? flag.row : null;
  }

  // Пользователь подтвердил подсказку: закрывающий тег дописывается
  // ПО-НАСТОЯЩЕМУ, текстом, прямо в lastCleanHtml (тот же индекс строки,
  // что и insertBeforeLine, — так и определён этот параметр в
  // src/formatter.ts, см. UnclosedTagInfo). Это первый и единственный
  // путь в интерфейсе, где мы САМИ дописываем содержимое, а не просто
  // показываем предположение, — только по явному действию пользователя.
  //
  // У остальных ещё не решённых записей, чьи line/insertBeforeLine лежат
  // на этой вставленной строке или ниже, сдвигаем номер на +1 — иначе
  // они будут указывать на строку, которая после вставки уже сдвинулась.
  //
  // Для insertBeforeLine это НЕ простое ">=": несколько подсказок часто
  // вытесняются в ОДНУ и ту же точку (см. buildDisplayHtml — там при
  // равенстве insertBeforeLine они сортируются по убыванию depth, чтобы
  // более вложенный тег закрывался первым, то есть визуально стоял ВЫШЕ).
  // Если подтвердить именно менее вложенную запись из такой пары раньше
  // (например, кликнуть на подсказку снизу вверх), наивный сдвиг "у всех
  // с insertBeforeLine >= сдвигаем" утащит следом и более вложенную,
  // которая должна была остаться на месте, — и порядок на экране
  // перевернётся. Поэтому при равенстве insertBeforeLine сдвигаем только
  // записи НЕ глубже подтверждённой (e.depth <= u.depth) — те, что
  // должны были остаться после неё; более вложенные (e.depth > u.depth)
  // оставляем как есть — они по-прежнему должны рендериться перед только
  // что подтверждённым текстом, а не после.
  // Убирает запись uid из workingTags.
  function removeByUid(uid) {
    workingTags = workingTags.filter((e) => e.__uid !== uid);
  }

  function acceptSuggestion(u) {
    const lines = lastCleanHtml.split("\n");
    const tagText = isMindboxConstruct(u.tagName) ? mindboxCloseLabel(u.tagName) : "</" + u.tagName + ">";
    const text = "  ".repeat(u.depth) + tagText;
    lines.splice(u.insertBeforeLine, 0, text);
    lastCleanHtml = lines.join("\n");

    removeByUid(u.__uid);
    for (const e of workingTags) {
      if (e.line !== undefined && e.line >= u.insertBeforeLine) e.line += 1;
      const samePoint = e.insertBeforeLine === u.insertBeforeLine;
      if (e.insertBeforeLine !== undefined && (e.insertBeforeLine > u.insertBeforeLine || (samePoint && e.depth <= u.depth))) {
        e.insertBeforeLine += 1;
      }
    }
    if (workingTags.length === 0) {
      reformatAfterAllResolved();
    } else {
      renderOutput();
    }
  }

  // Пользователь отклонил подсказку: убираем запись целиком, вместе с
  // красным флажком — раз пользователь явно отказался добавлять тег,
  // значит он уверен в своём выборе и это не ошибка, дальше нагонять на
  // этот тег незачем. Серая строка/попап исчезают, соседние строки
  // "схлопываются" на её место сами собой. lastCleanHtml не трогаем:
  // этой строки там никогда и не было, это было только предложение.
  function rejectSuggestion(u) {
    removeByUid(u.__uid);
    rejectedCount += 1;
    if (workingTags.length === 0) {
      // reformatAfterAllResolved сбрасывает totalFlaggedCount/rejectedCount
      // и считает диагностику заново — если отклонённый дефект и правда
      // остался в HTML, он найдётся опять и покажется снова (см. коммент
      // у reformatAfterAllResolved). Здесь rejectedCount++выше по факту
      // тут же обнуляется — это нормально, статус всё равно пересчитает
      // updateOutputStatus уже по итогам нового прохода.
      reformatAfterAllResolved();
    } else {
      renderOutput();
    }
  }

  // Пользователь подтвердил удаление реально открывшегося, но так и не
  // закрытого тега (дубликат попапа на открывающей стороне unclosed, см.
  // renderPopups) — убираем его СТРОКУ ЦЕЛИКОМ из lastCleanHtml. В
  // отличие от acceptSuggestion (там текст ДОБАВЛЯЕТСЯ), здесь, наоборот,
  // убирается уже существующая строка — поэтому и сдвиг у остальных
  // записей в обратную сторону (-1, а не +1), и без деления на "тот же
  // insertBeforeLine, но глубже/не глубже" — тут удаляется РОВНО одна
  // строка, а не несколько в одной точке, той путаницы просто неоткуда
  // взяться.
  function acceptDeletion(u) {
    const lines = lastCleanHtml.split("\n");
    lines.splice(u.line, 1);
    lastCleanHtml = lines.join("\n");

    removeByUid(u.__uid);
    for (const e of workingTags) {
      if (e.line !== undefined && e.line > u.line) e.line -= 1;
      if (e.insertBeforeLine !== undefined && e.insertBeforeLine > u.line) e.insertBeforeLine -= 1;
    }
    if (workingTags.length === 0) {
      reformatAfterAllResolved();
    } else {
      renderOutput();
    }
  }

  // Пользователь решил оставить тег как есть — оставляем строку как есть
  // в lastCleanHtml, просто убираем подсказку/флажок. Симметрично
  // rejectSuggestion.
  function rejectDeletion(u) {
    removeByUid(u.__uid);
    rejectedCount += 1;
    if (workingTags.length === 0) {
      reformatAfterAllResolved();
    } else {
      renderOutput();
    }
  }

