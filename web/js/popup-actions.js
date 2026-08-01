  // Текст подписи у "Парный тег" (см. addPopup) — какого именно вида тег
  // мы нашли/не нашли у ДРУГОГО конца этой связки. "Не найден" — когда
  // ЭТОТ попап стоит на РЕАЛЬНОМ, уже существующем в письме теге (сам
  // unclosed на месте открытия, сам extra на месте осиротевшего
  // закрывающего) — второй половины у него в письме действительно нет,
  // мы её только предлагаем. "Найден" — когда ЭТОТ попап, наоборот, сам
  // стоит на ПРЕДЛОЖЕННОМ (ещё не принятом) теге — а вот его пара уже
  // реально есть в письме, мы её и нашли.
  function pairLabelFor(u, isOpenSide) {
    if (u.kind === "unclosed") {
      return isOpenSide ? "Не найден закрывающий тег: " : "Найден открывающий тег: ";
    }
    if (u.kind === "unopened") return "Найден закрывающий тег: ";
    if (u.kind === "extra") return "Не найден открывающий тег: ";
    return "Парный тег: ";
  }

  // Номер строки (0-based, как в lastOpenFlags/lastCloseFlags) "парного"
  // тега для u — или null, если пары нет вовсе, или её строку не удалось
  // найти среди уже отрисованных флажков (см. buildDisplayHtml). Три
  // разных случая:
  // - unopened/extra (см. UnopenedTagInfo.pairId/ExtraTagInfo в
  //   src/formatter.ts) — это ДВЕ РАЗНЫЕ записи workingTags, связанные
  //   общим pairId; у "extra" парная строка — открывающая роль (red-
  //   флажок, см. lastOpenFlags) её "unopened"-половины, у "unopened" —
  //   строка серой вставленной подсказки (close-роль, lastCloseFlags) её
  //   "extra"-половины.
  // - unclosed — это ОДНА-ЕДИНСТВЕННАЯ запись без pairId вовсе, но у неё
  //   самой есть ДВЕ строки: где тег реально открылся (u.line, red-флажок
  //   в lastOpenFlags) и где предполагается вставить закрывающий (строка
  //   ЭТОГО ЖЕ попапа, close-роль). Показываем ссылку на первую — вторая
  //   и так уже прямо здесь, под самим попапом.
  function pairedRow(u) {
    if (u.kind === "unclosed") {
      const flag = lastOpenFlags.find((f) => f.uid === u.__uid);
      return flag ? flag.row : null;
    }
    if (u.pairId == null) return null;
    const paired = workingTags.find((e) => e.pairId === u.pairId && e.__uid !== u.__uid);
    if (!paired) return null;
    const flagList = paired.kind === "extra" ? lastOpenFlags : lastCloseFlags;
    const flag = flagList.find((f) => f.uid === paired.__uid);
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
  // Убирает запись uid из workingTags, а если у неё есть pairId (см.
  // UnopenedTagInfo.pairId/ExtraTagInfo в src/formatter.ts) — заодно и
  // парную запись с ТОЙ ЖЕ стороны: "Добавить?" (вставить пропущенный
  // открывающий тег) и "Удалить?" (убрать осиротевший закрывающий) — два
  // взаимоисключающих способа починить ОДИН и тот же дефект, решение по
  // одной из подсказок снимает предложение и по второй, кому бы из них
  // пользователь ни ответил и что бы ни выбрал (принять или отклонить).
  // Возвращает true, если парная запись действительно нашлась и была
  // убрана вместе с uid — нужно вызывающей стороне, чтобы понять, на
  // сколько увеличить rejectedCount (см. totalFlaggedCount в runFormat —
  // он тоже считает пару как ДВЕ записи, значит и "отклонили" должно
  // считать пару как два отклонения, иначе появится позже логика
  // "почему в TotalFlaggedCount 2, а мы всё отклонили якобы 1 кликом").
  function removeWithPair(uid, pairId) {
    const hadPair = pairId != null && workingTags.some((e) => e.pairId === pairId && e.__uid !== uid);
    workingTags = workingTags.filter((e) => e.__uid !== uid && !(pairId != null && e.pairId === pairId));
    return hadPair;
  }

  function acceptSuggestion(u) {
    const lines = lastCleanHtml.split("\n");
    const tagText = u.kind === "unopened" ? "<" + u.tagName + ">" : "</" + u.tagName + ">";
    const text = "  ".repeat(u.depth) + tagText;
    lines.splice(u.insertBeforeLine, 0, text);
    lastCleanHtml = lines.join("\n");

    removeWithPair(u.__uid, u.pairId);
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
    const hadPair = removeWithPair(u.__uid, u.pairId);
    rejectedCount += hadPair ? 2 : 1;
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

  // Пользователь подтвердил, что этот "лишний" закрывающий тег (kind ===
  // "extra", см. ExtraTagInfo в src/formatter.ts) — действительно лишний:
  // убираем его СТРОКУ ЦЕЛИКОМ из lastCleanHtml. В отличие от
  // acceptSuggestion (там текст ДОБАВЛЯЕТСЯ), здесь, наоборот, убирается
  // уже существующая строка — поэтому и сдвиг у остальных записей в
  // обратную сторону (-1, а не +1), и без деления на "тот же
  // insertBeforeLine, но глубже/не глубже" — тут удаляется РОВНО одна
  // строка, а не несколько в одной точке, той путаницы просто неоткуда
  // взяться. Если у записи есть пара (см. removeWithPair) — предложение
  // "Добавить?" на ней тоже снимается: пользователь уже выбрал другой
  // способ починить этот же дефект.
  function acceptDeletion(u) {
    const lines = lastCleanHtml.split("\n");
    lines.splice(u.line, 1);
    lastCleanHtml = lines.join("\n");

    removeWithPair(u.__uid, u.pairId);
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

  // Пользователь решил, что тег НЕ лишний — оставляем строку как есть в
  // lastCleanHtml, просто убираем подсказку/флажок. Симметрично
  // rejectSuggestion: пара (если есть) снимается тоже.
  function rejectDeletion(u) {
    const hadPair = removeWithPair(u.__uid, u.pairId);
    rejectedCount += hadPair ? 2 : 1;
    if (workingTags.length === 0) {
      reformatAfterAllResolved();
    } else {
      renderOutput();
    }
  }

