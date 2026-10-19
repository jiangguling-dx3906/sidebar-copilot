import { loadSettings } from './lib/settings.js';
import { setLocale, applyI18n } from './lib/i18n.js';

document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('closeTab').addEventListener('click', () => {
  window.close();
});

loadSettings()
  .then((settings) => {
    setLocale(settings.locale);
    applyI18n();
  })
  .catch(() => {});
