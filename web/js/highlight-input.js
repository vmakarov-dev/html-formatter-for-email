  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Подсветка типографских вставок (см. .tok-typography в CSS) прямо в
  // тексте текстовых узлов: "&nbsp;" (типограф вставляет её как ЛИТЕРАЛЬНУЮ
  // строку из шести символов — см. NBSP в src/typograf.ts, а не как символ
  // U+00A0), длинное тире "—" и кавычки-«ёлочки». Разбирается по СЫРОМУ
  // (неэкранированному) node.value, а не поверх уже готового escapeHtml —
  // иначе "&" из "&nbsp;" сам превратился бы в "&amp;" ДО того, как regex
  // успел бы его найти. Обычный (не типографский) текст между совпадениями
  // экранируется как обычно, найденные куски — оборачиваются в span поверх
  // уже экранированного (safe) содержимого.
  const TYPOGRAPHY_RE = /&nbsp;|—|«|»/g;

  function highlightTypographyText(raw) {
    let out = "";
    let last = 0;
    TYPOGRAPHY_RE.lastIndex = 0;
    let m;
    while ((m = TYPOGRAPHY_RE.exec(raw))) {
      out += escapeHtml(raw.slice(last, m.index));
      out += `<span class="tok-typography">${escapeHtml(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    out += escapeHtml(raw.slice(last));
    return out;
  }

  // Заполняет колонку номеров строк (см. .line-numbers) — просто список
  // "1..count", по одному числу на строку, без какой-либо связи с
  // содержимым (номер строки — это её порядковый номер в ОТОБРАЖЕНИИ, то
  // есть считая и серые строки-подсказки в #output — так же, как если бы
  // считали строки на глаз сверху вниз).
  function updateLineNumbers(el, count) {
    el.textContent = Array.from({ length: count }, (_, i) => i + 1).join("\n");
  }

  // Все места, что двигают вертикальный скролл программно (не через
  // пользовательский скролл мышью/тачпадом/клавиатурой — для того есть
  // отдельный "scroll"-listener на #outputEditor ниже), выставляют его
  // именно на #outputEditor: это теперь основной интерактивный слой
  // (см. .output-editor в CSS — прозрачный textarea поверх #output,
  // как и у поля ввода), #output и #outputLineNumbers — только
  // визуальные слои под ним, синхронизируются от него же.
  function setOutputScrollTop(value) {
    outputEditor.scrollTop = value;
    output.scrollTop = outputEditor.scrollTop;
    outputLineNumbers.scrollTop = outputEditor.scrollTop;
    // void ... .offsetHeight — форсирует синхронный reflow сразу после
    // программного scrollTop (см. .line-numbers/.editor-highlight/#output
    // в CSS про то же самое) — подстраховка на случай, если одного
    // только translateZ(0)-слоя браузеру не хватит, чтобы честно
    // перерисовать содержимое вслед за уже обновившимся scrollTop.
    void output.offsetHeight;
    void outputLineNumbers.offsetHeight;
  }

  // Раскрашивает атрибуты тега: имя одним цветом, значение (в кавычках
  // или без) — другим. Разбор нестрогий (только для подсветки, сама
  // строка атрибутов нигде не меняется и не переформатируется).
  function highlightAttrs(attrsRaw) {
    let out = "";
    const re = /(\s+)|([^\s=]+)(=("[^"]*"|'[^']*'|[^\s]*))?/g;
    let m;
    while ((m = re.exec(attrsRaw))) {
      if (m[1] !== undefined) {
        out += escapeHtml(m[1]);
        continue;
      }
      out += `<span class="tok-attr">${escapeHtml(m[2])}</span>`;
      if (m[3] !== undefined) {
        out += "=";
        out += `<span class="tok-val">${escapeHtml(m[4])}</span>`;
      }
    }
    return out;
  }

  function highlightOpenTag(node) {
    const attrsHtml = node.attrsRaw ? " " + highlightAttrs(node.attrsRaw) : "";
    const closer = node.selfClosed ? " /&gt;" : "&gt;";
    return (
      `<span class="tok-tag">&lt;${escapeHtml(node.tagName)}</span>` +
      attrsHtml +
      `<span class="tok-tag">${closer}</span>`
    );
  }

  function highlightCloseTag(tagName) {
    return `<span class="tok-tag">&lt;/${escapeHtml(tagName)}&gt;</span>`;
  }

  // "Плоская" версия highlightOpenTag/highlightCloseTag/highlightNode —
  // без раскраски по типам токенов (тег/атрибут/значение), просто
  // экранированный текст. Нужна только для содержимого условных
  // ("outlook") комментариев: снаружи их целиком красит один общий серый
  // span (см. tok-outlook-comment в highlightNode ниже) — красить теги
  // внутри ещё и по отдельности не нужно и только мешало бы читать.
  function plainOpenTag(node) {
    const attrs = node.attrsRaw ? " " + node.attrsRaw : "";
    const closer = node.selfClosed ? " />" : ">";
    return escapeHtml(`<${node.tagName}${attrs}${closer}`);
  }

  function plainCloseTag(tagName) {
    return escapeHtml(`</${tagName}>`);
  }

  function plainNode(node) {
    switch (node.type) {
      case "text":
        return escapeHtml(node.value);
      case "doctype":
        return escapeHtml(node.raw);
      case "comment":
        return escapeHtml(`<!--${node.raw}-->`);
      case "stray-close-tag":
        return escapeHtml(node.raw);
      case "conditional-comment": {
        const inner = node.children.map(plainNode).join("");
        return escapeHtml(node.openRaw) + inner + escapeHtml(node.closeRaw);
      }
      case "raw-text":
      case "style":
        return plainOpenTag(node) + escapeHtml(node.rawContent) + plainCloseTag(node.tagName);
      case "element": {
        const open = plainOpenTag(node);
        if (node.voidElement || node.selfClosed) return open;
        const inner = node.children.map(plainNode).join("");
        if (!node.explicitlyClosed) return open + inner;
        return open + inner + plainCloseTag(node.tagName);
      }
      default:
        return "";
    }
  }

  // Подсветка строится по тому же AST, что использует сам форматтер
  // (window.HtmlFormatter.parseHtml — тот же парсер, что и в CLI/Node), а
  // не отдельным regex-разбором "на глаз": так гарантированно не
  // перепутать, например, "<" внутри атрибута или комментария с началом
  // настоящего тега.
  function highlightNode(node) {
    switch (node.type) {
      case "text":
        return highlightTypographyText(node.value);
      case "doctype":
        return `<span class="tok-doctype">${escapeHtml(node.raw)}</span>`;
      case "comment":
        return `<span class="tok-comment">&lt;!--${escapeHtml(node.raw)}--&gt;</span>`;
      case "stray-close-tag":
        return `<span class="tok-tag">${escapeHtml(node.raw)}</span>`;
      case "conditional-comment": {
        // Условный комментарий целиком (маркеры + всё содержимое, включая
        // вложенные теги) — один сплошной серый блок, без раскраски по
        // типам токенов внутри, см. plainNode.
        return `<span class="tok-outlook-comment">${plainNode(node)}</span>`;
      }
      case "raw-text":
      case "style":
        return (
          highlightOpenTag(node) + escapeHtml(node.rawContent) + highlightCloseTag(node.tagName)
        );
      case "element": {
        const open = highlightOpenTag(node);
        if (node.voidElement || node.selfClosed) return open;
        const inner = node.children.map(highlightNode).join("");
        if (!node.explicitlyClosed) return open + inner;
        return open + inner + highlightCloseTag(node.tagName);
      }
      default:
        return "";
    }
  }

  function highlightHtml(formatted) {
    const doc = window.HtmlFormatter.parseHtml(formatted);
    return doc.children.map(highlightNode).join("");
  }

  // <textarea> и <pre> расходятся в том, как считают высоту содержимого,
  // если оно заканчивается "голым" переносом строки (\n без чего-либо
  // после): textarea резервирует под ним ещё одну (пустую) строку высоты,
  // а pre — нет, попросту не рисуя эту строку вовсе. #inputHighlight/
  // #output — как раз pre поверх/под настоящим textarea (#input/
  // #outputEditor) с ТЕМ ЖЕ текстом — из-за этого расхождения их
  // scrollHeight отличается ровно на одну строку, и синхронизация скролла
  // (простое копирование scrollTop) у более короткого из них "залипает"
  // при подходе к концу документа: браузер молча приравнивает scrollTop
  // к своему максимуму, который у pre меньше. Внешне это выглядит как
  // рассинхрон номеров строк и текста в самом низу — реальный курсor
  // (внутри настоящего textarea) при этом стоит верно, просто видимый
  // подсвеченный слой отстаёт на 21px. Невидимый zero-width space в конце
  // — стандартный приём: он не меняет отображаемый текст ни на пиксель по
  // ширине, но заставляет браузер выделить место под "фантомную" последнюю
  // строку, той же высоты, что и у textarea, — синхронизация снова точная.
  const TRAILING_LINE_MARKER = "​";

  function withTrailingLineMarker(renderedHtml) {
    return renderedHtml.endsWith("\n") ? renderedHtml + TRAILING_LINE_MARKER : renderedHtml;
  }

  // Подсветка исходника — та же самая функция, что и для результата,
  // просто применённая к текущему значению textarea "вживую", на каждое
  // изменение. Парсер терпим к незакрытым/битым тегам (то же самое
  // прощение недописанной разметки, что используется при форматировании)
  // и не должен падать по ходу набора текста, но на всякий случай — если
  // что-то пойдёт не так, просто показываем текст без подсветки, а не
  // ломаем ввод.
  function updateInputHighlight() {
    // Пустое поле — всё равно "строка 1" (как в большинстве редакторов),
    // а не пустая колонка номеров.
    updateLineNumbers(inputLineNumbers, input.value ? input.value.split("\n").length : 1);
    if (!input.value) {
      inputHighlight.innerHTML = "";
      return;
    }
    try {
      inputHighlight.innerHTML = withTrailingLineMarker(highlightHtml(input.value));
    } catch {
      inputHighlight.textContent = input.value;
      if (input.value.endsWith("\n")) inputHighlight.append(TRAILING_LINE_MARKER);
    }
  }

  function syncInputScroll() {
    inputHighlight.scrollTop = input.scrollTop;
    inputHighlight.scrollLeft = input.scrollLeft;
    // Только вертикально — колонка номеров не скроллится по горизонтали
    // вместе с длинными строками, она должна оставаться "прибитой" слева.
    inputLineNumbers.scrollTop = input.scrollTop;
    // См. тот же приём в setOutputScrollTop — форсирует синхронный reflow
    // сразу после программного scrollTop, подстраховка к translateZ(0) в
    // CSS против отставания ОТРИСОВКИ (не разметки) этих слоёв от уже
    // обновившегося scrollTop при частых событиях скролла.
    void inputHighlight.offsetHeight;
    void inputLineNumbers.offsetHeight;
  }

  // Пустая строка в самом начале или в самом конце вставленного/введённого
  // HTML реально ломает форматирование (пользователь проверил на реальном
  // письме) — проще не пускать её в поле ввода вовсе, чем чинить её
  // последствия в парсере. НЕ делаем это на КАЖДОЕ нажатие клавиши в
  // updateInputHighlight — иначе Enter в самом конце документа (обычный
  // способ начать новую строку контента) тут же "схлопывался" бы обратно,
  // и дописать что-то новой строкой в конце стало бы физически невозможно.
  // Вместо этого чистим в трёх безопасных точках, где пользователь уже
  // закончил (или вот-вот закончит) редактировать именно этот кусок: сразу
  // после вставки (paste), при уходе фокуса с поля (blur) и прямо перед
  // запуском форматирования (runFormat, см. ниже) — на выходе результат
  // тот же ("физически" в поле ввода пустая строка с краю не задерживается
  // дольше одного клика/вставки), но набор текста ничем не мешает.
  function stripEdgeBlankLines(text) {
    return text.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
  }

  function enforceNoEdgeBlankLines() {
    const original = input.value;
    const trimmed = stripEdgeBlankLines(original);
    if (trimmed === original) return;
    const removedFromStart = original.length - original.replace(/^(?:[ \t]*\r?\n)+/, "").length;
    const selStart = input.selectionStart;
    const selEnd = input.selectionEnd;
    input.value = trimmed;
    input.setSelectionRange(
      Math.max(0, Math.min(trimmed.length, selStart - removedFromStart)),
      Math.max(0, Math.min(trimmed.length, selEnd - removedFromStart)),
    );
    // Отменяем ещё не сработавший отложенный вызов (см. scheduleInputHighlight
    // ниже) — иначе он выполнится чуть позже поверх уже готового результата
    // тем же самым обновлением, просто вхолостую.
    clearTimeout(inputHighlightTimer);
    updateInputHighlight();
  }

  // Дебаунс — без него КАЖДОЕ нажатие клавиши в поле ввода гоняет полный
  // parseHtml + построение подсветки заново (см. updateInputHighlight
  // выше). На больших письмах (сотни КБ, обычное дело для реальных email-
  // шаблонов) один только parseHtml занимает несколько десятков
  // миллисекунд — при быстром наборе текста это ощутимо подтормаживает
  // курсор. 120мс короче, чем человек воспринимает как заметную задержку
  // подсветки, но достаточно, чтобы схлопнуть целую серию быстрых нажатий
  // в один вызов вместо одного на символ. Сам textarea (#input) при этом
  // не отстаёт ни на миллисекунду — лагает только НИЖНИЙ, чисто визуальный
  // слой подсветки/номеров строк под ним.
  let inputHighlightTimer = null;
  function scheduleInputHighlight() {
    clearTimeout(inputHighlightTimer);
    inputHighlightTimer = setTimeout(updateInputHighlight, 120);
  }

  input.addEventListener("input", scheduleInputHighlight);
  input.addEventListener("scroll", syncInputScroll);
  // setTimeout — вставка (paste) должна сначала реально примениться к
  // input.value браузером, самого события paste для этого недостаточно
  // (оно летит ДО того, как значение поля обновится).
  input.addEventListener("paste", () => setTimeout(enforceNoEdgeBlankLines, 0));
  input.addEventListener("blur", enforceNoEdgeBlankLines);
  updateInputHighlight();

