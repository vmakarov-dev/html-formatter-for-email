  // Клики по ключевым кнопкам — отдельные события GoatCounter (см.
  // <script data-goatcounter> в <head> index.html). window.goatcounter
  // может быть не определён (adblock/DNT блокирует count.js) — тогда
  // просто ничего не отправляем, на работу самого форматтера это никак
  // не влияет. path — короткий машиночитаемый слаг события, title — то,
  // что реально видно в дашборде GoatCounter.
  function trackClick(path, title) {
    if (window.goatcounter && typeof window.goatcounter.count === "function") {
      window.goatcounter.count({ path, title, event: true });
    }
  }

  formatBtn.addEventListener("click", () => trackClick("click-format", "Форматировать"));
  copyBtn.addEventListener("click", () => trackClick("click-copy", "Скопировать"));
  compressModerateBtn.addEventListener("click", () =>
    trackClick("click-compress-moderate", "Сжать (умеренно)"),
  );
  compressMaxBtn.addEventListener("click", () =>
    trackClick("click-compress-max", "Сжать (максимально)"),
  );
