'use strict';

/* Данные каталога изменяются только через products.json на GitHub */

/* ===== Настройки ===== */
const CONFIG = {
  contactUsername: 'g179p' // Telegram-username продавца, без «@»
};

/* ===== Размер порции «Показать ещё» (только в памяти сессии) ===== */
const PAGE_SIZE = 24;

/* Эмодзи-заглушки по категориям (используются, если у товара нет image и emoji) */
const CATEGORY_EMOJI = {
  'Жидкости': '🧪',
  'Одноразки': '💨',
  'POD-системы': '🔋',
  'Аксессуары': '🧰'
};

const DEFAULT_EMOJI = '📦';

/* ===== Медиа: изображение или эмодзи-заглушка ===== */
function buildEmojiEl(item, sizeClass) {
  const span = document.createElement('span');
  span.className = 'media-emoji' + (sizeClass ? ' ' + sizeClass : '');
  span.textContent = item.emoji || CATEGORY_EMOJI[item.category] || DEFAULT_EMOJI;
  return span;
}

/*
 * buildMediaEl(item, sizeClass):
 * - image — непустая строка: создаём <img> с lazy-загрузкой, без referrer,
 *   width/height = 80 (карточка) или 120 (модалка), alt = item.name.
 *   До загрузки — класс .img-loading (opacity 0), после 'load' — .img-loaded
 *   (opacity 1, переход 0.2s). При ошибке заменяет себя эмодзи-заглушкой
 *   с dataset.fallback='1' (повторно не грузим).
 * - 'http://' (не https) — сразу эмодзи-фолбэк, небезопасный контент не грузим.
 * - иначе — span.media-emoji.
 */
function buildMediaEl(item, sizeClass) {
  const rawImage = typeof item.image === 'string' ? item.image.trim() : '';
  const isModal = sizeClass && String(sizeClass).indexOf('modal') !== -1;
  const dim = isModal ? 120 : 80;

  // Небезопасный http:// — не грузим, сразу эмодзи-фолбэк
  if (rawImage.indexOf('http://') === 0) {
    return emojiFallback(item, sizeClass);
  }

  if (rawImage !== '') {
    const img = document.createElement('img');
    img.className = (sizeClass || '') + ' img-loading';
    img.src = rawImage;
    img.alt = item.name != null ? String(item.name) : '';
    img.width = dim;
    img.height = dim;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', function () {
      this.classList.remove('img-loading');
      this.classList.add('img-loaded');
    }, false);
    img.addEventListener('error', function () {
      img.replaceWith(emojiFallback(item, sizeClass));
    }, false);
    return img;
  }
  return buildEmojiEl(item, sizeClass);
}

/* Эмодзи-фолбэк с пометкой, что картинка не загружалась */
function emojiFallback(item, sizeClass) {
  const el = buildEmojiEl(item, sizeClass);
  el.dataset.fallback = '1';
  return el;
}

/* ===== Ключи localStorage (только личные настройки пользователя) ===== */
const FAVS_KEY = 'vape_favs';        // JSON-массив id избранных товаров
const THEME_KEY = 'vape_theme';      // 'dark' | 'light'

/* ===== Состояние ===== */
/* Всё, кроме favs и theme, живёт только в памяти текущей сессии */
const state = {
  products: [],        // все товары из products.json
  search: '',          // текущий запрос
  category: 'Все',     // активная категория
  brand: 'Все бренды', // активный бренд (второй ряд чипов)
  favOnly: false,      // чип «Избранное»
  inStockOnly: false,  // toggle-чип «В наличии»
  limit: PAGE_SIZE,    // сколько записей показано («Показать ещё»)
  sig: '',             // подпись фильтров: при смене лимит сбрасывается
  cart: new Map(),     // id товара -> количество
  favs: new Set(loadFavs())       // id избранных товаров
};

/* ===== Telegram WebApp ===== */
const tg = window.Telegram ? window.Telegram.WebApp : null;

/* ===== DOM ===== */
const catalogEl = document.getElementById('catalog');
const emptyStateEl = document.getElementById('emptyState');
const chipsEl = document.getElementById('chips');
const chips2El = document.getElementById('chips2');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const resetBtn = document.getElementById('resetBtn');
const countLabel = document.getElementById('countLabel');
const cartButton = document.getElementById('cartButton');
const cartCountEl = document.getElementById('cartCount');
const cartBarEl = document.getElementById('cartBar');
const cartItemsEl = document.getElementById('cartItems');
const cartTotalEl = document.getElementById('cartTotal');
const sendOrderButton = document.getElementById('sendOrderButton');
const clearCartButton = document.getElementById('clearCartButton');
const toastEl = document.getElementById('toast');
const luckyBtn = document.getElementById('luckyBtn');
const themeToggle = document.getElementById('themeToggle');
const statsBtn = document.getElementById('statsBtn');
const exportBtn = document.getElementById('exportBtn');

const toTopBtn = document.getElementById('toTop');
const loaderEl = document.getElementById('loader');
const skeletonEl = document.getElementById('skeleton');
const refreshBtn = document.getElementById('refreshBtn');
const shareBtn = document.getElementById('shareBtn');
const activeFiltersEl = document.getElementById('activeFilters');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const emptyResetBtn = document.getElementById('emptyResetBtn');
const detailModal = document.getElementById('detailModal');
const detailCloseBtn = document.getElementById('detailCloseBtn');
const detailBody = document.getElementById('detailBody');
const statsModal = document.getElementById('statsModal');
const statsCloseBtn = document.getElementById('statsCloseBtn');
const statsBody = document.getElementById('statsBody');

/* Данные каталога изменяются только через products.json на GitHub */

let detailItem = null; // текущий товар в модалке деталей

/* ===== Вибро-отклик (Telegram Haptics; безопасно в браузере) ===== */
function haptic(type) {
  try {
    const wa = window.Telegram && window.Telegram.WebApp;
    const hf = wa && wa.HapticFeedback;
    if (!hf) return;

    if (type === 'success' || type === 'warning' || type === 'error') {
      if (typeof hf.notificationOccurred === 'function') {
        hf.notificationOccurred(type);
      }
      return;
    }

    if (typeof hf.selectionChanged === 'function') hf.selectionChanged();
    if (typeof hf.impactOccurred === 'function') hf.impactOccurred('light');
  } catch (e) {}
}

/* ===== Сохранение позиции скролла при открытии/закрытии модалок ===== */
let savedScrollY = 0;

function rememberScroll() {
  try { savedScrollY = window.scrollY || 0; } catch (e) { savedScrollY = 0; }
}

function restoreScroll() {
  if (!savedScrollY) return;
  try {
    window.scrollTo({ top: savedScrollY, behavior: 'auto' });
  } catch (e) {
    try { window.scrollTo(0, savedScrollY); } catch (e2) {}
  }
}

/* Возвращает массив активных фильтров: { label, clear } */
function activeFilterTags() {
  const tags = [];
  const q = state.search.trim();

  if (q) {
    tags.push({ label: 'Поиск: ' + q, clear: () => { clearSearch(); } });
  }
  if (state.category !== 'Все') {
    tags.push({ label: 'Категория: ' + state.category, clear: () => { state.category = 'Все'; } });
  }
  if (state.brand !== 'Все бренды') {
    tags.push({ label: 'Бренд: ' + state.brand, clear: () => { state.brand = 'Все бренды'; } });
  }
  if (state.inStockOnly) {
    tags.push({ label: 'В наличии', clear: () => { state.inStockOnly = false; } });
  }
  if (state.favOnly) {
    tags.push({ label: 'Избранное', clear: () => { state.favOnly = false; } });
  }
  return tags;
}

/* ===== Панель активных фильтров ===== */
function renderActiveFilters() {
  if (!activeFiltersEl) return;

  activeFiltersEl.replaceChildren();
  const tags = activeFilterTags();

  if (tags.length === 0) {
    activeFiltersEl.hidden = true;
    return;
  }
  activeFiltersEl.hidden = false;

  tags.forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'af-chip';

    const label = document.createElement('span');
    label.className = 'af-label';
    label.textContent = tag.label;

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'af-x';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Снять фильтр: ' + tag.label);
    x.addEventListener('click', () => {
      haptic('light');
      tag.clear();
      renderChips();
      renderChips2();
      renderCatalog();
    });

    chip.append(label, x);
    activeFiltersEl.appendChild(chip);
  });

  const resetAll = document.createElement('button');
  resetAll.type = 'button';
  resetAll.className = 'af-reset';
  resetAll.textContent = 'Сбросить всё';
  resetAll.addEventListener('click', () => {
    haptic('light');
    resetFilters();
  });
  activeFiltersEl.appendChild(resetAll);
}

/* ===== Пагинация «Показать ещё» ===== */
function filtersSignature() {
  return [
    state.search.trim(),
    state.category,
    state.brand,
    state.favOnly ? '1' : '0',
    state.inStockOnly ? '1' : '0'
  ].join('|');
}

function renderLoadMore(shown, total) {
  if (!loadMoreBtn) return;
  const rest = total - shown;
  if (rest > 0) {
    loadMoreBtn.hidden = false;
    loadMoreBtn.textContent = 'Показать ещё (осталось ' + rest + ')';
  } else {
    loadMoreBtn.hidden = true;
  }
}

/* ===== Скелетон первой загрузки ===== */
function hideSkeleton() {
  if (skeletonEl) skeletonEl.hidden = true;
}

/* ===== Прокрутка к каталогу (с учётом липкой шапки) ===== */
function scrollToCatalog() {
  try {
    if (!catalogEl || typeof catalogEl.getBoundingClientRect !== 'function') return;

    const header = (typeof document.querySelector === 'function') ? document.querySelector('.header') : null;
    const headerH = (header && typeof header.getBoundingClientRect === 'function')
      ? header.getBoundingClientRect().height : 0;
    const current = window.scrollY || 0;
    const target = catalogEl.getBoundingClientRect().top + current - headerH - 10;

    if (current < target) {
      catalogEl.style.scrollMarginTop = (headerH + 10) + 'px';
      if (typeof catalogEl.scrollIntoView === 'function') {
        catalogEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo({ top: target, behavior: 'smooth' });
      }
    }
  } catch (e) {}
}

/* ===== Горячие клавиши (десктоп) ===== */
function closeTopModal() {
  if (detailModal && detailModal.classList.contains('open')) { closeDetail(); return true; }
  if (statsModal && statsModal.classList.contains('open')) { closeStats(); return true; }
  return false;
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName ? String(el.tagName).toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

function handleHotkey(event) {
  if (!event) return;
  const key = event.key;
  if (!key) return;

  const typing = isTypingTarget(event.target);

  if ((key === '/' && !typing) || ((key === 'k' || key === 'K') && (event.ctrlKey || event.metaKey))) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (searchInput && typeof searchInput.focus === 'function') searchInput.focus();
    return;
  }

  if (key === 'Escape') {
    if (closeTopModal()) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      return;
    }
    if (searchInput && searchInput.value !== '') {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      clearSearch();
    }
    return;
  }

  if (typing) return;

  if (key === 't' || key === 'T') { haptic('light'); toggleTheme(); return; }
}

/* ===== Поделиться ссылкой на каталог ===== */
async function shareCatalog() {
  const ok = await copyText(location.href);
  showToast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать ссылку');
}

/* ===== Обновление каталога (🔄) ===== */
async function refreshCatalog() {
  if (!refreshBtn || refreshBtn.disabled) return;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');
  showLoader(true);

  try {
    const response = await fetch('products.json');
    if (!response.ok) {
      throw new Error('Ошибка HTTP ' + response.status);
    }
    const parsed = parseJsonFile(await response.text(), 'products.json');
    if (!parsed.ok) {
      showToast('Не удалось обновить: ошибка в файле products.json');
      return;
    }
    state.products = parsed.data;
    renderChips();
    renderChips2();
    renderCatalog();
    showToast('Каталог обновлён: ' + state.products.length + ' ' +
      plural(state.products.length, 'запись', 'записи', 'записей'));
  } catch (err) {
    showToast('Не удалось обновить: ' + (err && err.message ? err.message : 'неизвестная ошибка'));
  } finally {
    showLoader(false);
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('spinning');
  }
}

/* ===== Избранное ===== */
function loadFavs() {
  try {
    const raw = localStorage.getItem(FAVS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
  } catch (e) {
    return [];
  }
}

function saveFavs() {
  try {
    localStorage.setItem(FAVS_KEY, JSON.stringify([...state.favs]));
  } catch (e) {}
}

function toggleFav(id) {
  const wasFav = state.favs.has(id);
  if (wasFav) state.favs.delete(id);
  else state.favs.add(id);
  saveFavs();
  haptic('light');
  renderChips();
  renderCatalog();
  // Анимация «сердечко наполнилось» (0.3s)
  if (!wasFav) {
    const card = catalogEl.querySelector('.card[data-id="' + id + '"]');
    if (card) {
      const btn = card.querySelector('.fav-btn');
      if (btn) {
        btn.classList.add('pop');
        setTimeout(function () { btn.classList.remove('pop'); }, 320);
      }
    }
  }
}

/* ===== Инициализация Telegram ===== */
function initTelegram() {
  if (!tg) return;

  tg.ready();
  if (typeof tg.expand === 'function') tg.expand();

  // Применяем тему Telegram через CSS-переменные (фоллбэки уже в style.css)
  const tp = tg.themeParams || {};
  const themeMap = {
    '--tg-theme-bg-color': tp.bg_color,
    '--tg-theme-text-color': tp.text_color,
    '--tg-theme-hint-color': tp.hint_color,
    '--tg-theme-link-color': tp.link_color,
    '--tg-theme-button-color': tp.button_color,
    '--tg-theme-button-text-color': tp.button_text_color,
    '--tg-theme-secondary-bg-color': tp.secondary_bg_color
  };
  Object.entries(themeMap).forEach(([cssVar, value]) => {
    if (value) document.documentElement.style.setProperty(cssVar, value);
  });

  // BackButton: модалки по очереди, иначе корзина / закрытие приложения
  if (tg.BackButton) {
    tg.BackButton.onClick(() => {
      if (detailModal.classList.contains('open')) {
        closeDetail();
        return;
      }
      if (statsModal.classList.contains('open')) {
        closeStats();
        return;
      }
      if (state.cart.size > 0) {
        state.cart.clear();
        renderAll();
        showToast('Корзина очищена');
      } else if (typeof tg.close === 'function') {
        tg.close();
      }
    });
  }
}

/* ===== Тема ===== */
function applyTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
  document.documentElement.classList.toggle('light', saved === 'light');
  updateThemeIcon();
}

function toggleTheme() {
  const light = document.documentElement.classList.toggle('light');
  try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch (e) {}
  updateThemeIcon();
}

function updateThemeIcon() {
  if (!themeToggle) return;
  themeToggle.textContent = document.documentElement.classList.contains('light') ? '☀️' : '🌙';
}

/* ===== Прелоадер ===== */
function showLoader(visible) {
  if (!loaderEl) return;
  loaderEl.classList.toggle('hide', !visible);
  loaderEl.setAttribute('aria-hidden', String(!visible));
}

/* ===== Нормализация данных (устойчивость к ручной правке JSON) ===== */
function normalizeItems(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return;
    const numId = Number(item.id);
    const id = (Number.isFinite(numId) && !Number.isNaN(numId)) ? numId : index + 1;
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    out.push({
      id: id,
      name: (typeof item.name === 'string' && item.name.trim() !== '') ? item.name : 'Без названия',
      brand: typeof item.brand === 'string' ? item.brand : '',
      category: (typeof item.category === 'string' && item.category.trim() !== '') ? item.category : 'Другое',
      price: num(item.price),
      oldPrice: num(item.oldPrice),
      description: typeof item.description === 'string' ? item.description : '',
      image: typeof item.image === 'string' ? item.image : '',
      badge: typeof item.badge === 'string' ? item.badge : '',
      emoji: typeof item.emoji === 'string' ? item.emoji : '',
      available: item.available !== false
    });
  });
  return out;
}

/*
 * parseJsonFile(text, filename):
 * возвращает { ok: true, data } или { ok: false, message } —
 * при невалидном JSON интерфейс не падает, а показывает понятное сообщение.
 */
function parseJsonFile(text, filename) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    const msg = err && err.message ? err.message : 'неизвестная ошибка';
    return { ok: false, message: 'Ошибка в файле ' + filename + ': ' + msg + '. Проверьте запятые, кавычки и скобки.' };
  }
  if (!Array.isArray(data)) {
    return { ok: false, message: 'Ошибка в файле ' + filename + ': ожидался массив записей. Проверьте запятые, кавычки и скобки.' };
  }
  return { ok: true, data: normalizeItems(data) };
}

/* ===== Загрузка товаров ===== */
async function loadProducts() {
  showLoader(true);
  try {
    const response = await fetch('products.json');
    if (!response.ok) {
      throw new Error('Ошибка HTTP ' + response.status);
    }
    const parsed = parseJsonFile(await response.text(), 'products.json');
    if (!parsed.ok) {
      showLoader(false);
      showLoadError(parsed.message, true);
      return;
    }
    state.products = parsed.data;
  } catch (err) {
    showLoader(false);
    showLoadError(err && err.message ? err.message : 'неизвестная ошибка', false);
    return;
  }
  showLoader(false);
  hideSkeleton();
  renderChips();
  renderChips2();
  renderCatalog();
}

function showLoadError(message, isParseError) {
  hideSkeleton();
  catalogEl.replaceChildren();
  emptyStateEl.hidden = true;

  const box = document.createElement('div');
  box.className = 'error-box';

  const emoji = document.createElement('div');
  emoji.className = 'error-emoji';
  emoji.textContent = '⚠️';
  box.appendChild(emoji);

  if (isParseError) {
    const p = document.createElement('p');
    p.textContent = message;
    box.appendChild(p);
  } else {
    const title = document.createElement('p');
    title.textContent = 'Не удалось загрузить товары';

    const sub = document.createElement('p');
    sub.className = 'error-sub';
    sub.textContent = message + '. Проверьте, что файл products.json лежит рядом с index.html.';
    box.append(title, sub);
  }

  catalogEl.appendChild(box);
}

/* ===== Чипы категорий (+ счётчики на весь каталог) ===== */
function renderChips() {
  chipsEl.replaceChildren();

  // Чип «❤ Избранное» — в начале списка, счётчик = число избранных
  const favChip = document.createElement('button');
  favChip.type = 'button';
  favChip.className = 'chip fav-chip' + (state.favOnly ? ' active' : '');
  favChip.dataset.fav = '';
  favChip.setAttribute('aria-pressed', String(state.favOnly));
  const favLabel = document.createElement('span');
  favLabel.textContent = '❤ Избранное';
  favChip.appendChild(favLabel);
  const favBadge = document.createElement('span');
  favBadge.className = 'chip-badge';
  favBadge.textContent = state.favs.size;
  favChip.appendChild(favBadge);
  chipsEl.appendChild(favChip);

  const categories = ['Все', ...new Set(
    state.products.map((p) => p.category).filter(Boolean)
  )];

  categories.forEach((category) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + ((category === state.category && !state.favOnly) ? ' active' : '');
    chip.dataset.category = category;
    const label = document.createElement('span');
    label.textContent = category;
    chip.appendChild(label);
    // Счётчик: сколько записей в этой категории во ВСЁМ каталоге
    if (category !== 'Все') {
      const count = state.products.filter((p) => p.category === category).length;
      const counter = document.createElement('span');
      counter.className = 'chip-count';
      counter.textContent = count;
      chip.appendChild(counter);
    }
    chipsEl.appendChild(chip);
  });

  // Тоггл-чип «✓ В наличии»
  const stockChip = document.createElement('button');
  stockChip.type = 'button';
  stockChip.className = 'chip toggle-chip' + (state.inStockOnly ? ' active' : '');
  stockChip.dataset.toggle = 'stock';
  stockChip.setAttribute('aria-pressed', String(state.inStockOnly));
  stockChip.textContent = state.inStockOnly ? '✓ В наличии' : 'В наличии';
  chipsEl.appendChild(stockChip);
}

/* ===== Второй ряд чипов: бренды (максимум 8) ===== */
function renderChips2() {
  if (!chips2El) return;
  chips2El.replaceChildren();

  const brands = [...new Set(
    state.products.map((p) => p.brand).filter(Boolean)
  )].slice(0, 8);

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'chip' + (state.brand === 'Все бренды' ? ' active' : '');
  allChip.dataset.brand = 'Все бренды';
  allChip.textContent = 'Все бренды';
  chips2El.appendChild(allChip);

  brands.forEach((brand) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.brand === brand ? ' active' : '');
    chip.dataset.brand = brand;
    chip.textContent = brand;
    chips2El.appendChild(chip);
  });
}

/* ===== Фильтры ===== */
/* Порядок вывода — как в products.json (порядок массива), без сортировки */
function getFiltered() {
  const query = state.search.trim().toLowerCase();

  return state.products.filter((product) => {
    const byCategory = state.category === 'Все' || product.category === state.category;
    const byBrand = state.brand === 'Все бренды' || product.brand === state.brand;
    const byFav = !state.favOnly || state.favs.has(product.id);
    const byStock = !state.inStockOnly || product.available !== false;
    const haystack = String(product.name + ' ' + (product.brand || '')).toLowerCase();
    const bySearch = !query || haystack.includes(query);
    return byCategory && byBrand && byFav && byStock && bySearch;
  });
}

/* Актуальная цена со скидкой: учитывается oldPrice (берём минимальную из price/oldPrice) */
function effectivePrice(product) {
  const price = Number(product.price) || 0;
  const old = Number(product.oldPrice) || 0;
  return (old > 0 && old < price) ? old : price;
}

/* ===== Сброс фильтров ===== */
function hasActiveFilters() {
  return Boolean(state.search.trim()) ||
    state.category !== 'Все' ||
    state.favOnly ||
    state.inStockOnly ||
    state.brand !== 'Все бренды';
}

function updateResetBtn() {
  if (!resetBtn) return;
  resetBtn.classList.toggle('hidden', !hasActiveFilters());
}

function resetFilters() {
  state.search = '';
  if (searchInput) searchInput.value = '';
  state.category = 'Все';
  state.brand = 'Все бренды';
  state.favOnly = false;
  state.inStockOnly = false;
  updateSearchClear();
  updateResetBtn();
  renderChips();
  renderChips2();
  renderCatalog();
}

/* Данные каталога изменяются только через products.json на GitHub */

/* ===== Поиск: очистка «✕» + дебаунс ===== */
function updateSearchClear(value) {
  if (!searchClear) return;
  const hasText = value !== undefined ? String(value).length > 0 : Boolean(searchInput && searchInput.value.length > 0);
  searchClear.classList.toggle('hidden', !hasText);
}

let searchTimer = null;

/* Полная очистка поиска (используется кнопкой ✕, Esc и тегами фильтров) */
function clearSearch() {
  clearTimeout(searchTimer);
  state.search = '';
  if (searchInput) searchInput.value = '';
  updateSearchClear('');
  renderCatalog();
}

/* ===== Рендер ===== */
function renderCount() {
  if (!countLabel) return;
  const total = state.products.length;
  const shown = getFiltered().length;
  if (!hasActiveFilters()) {
    countLabel.textContent = total + ' ' + plural(total, 'запись', 'записи', 'записей');
  } else {
    countLabel.textContent = 'Показано ' + shown + ' из ' + total;
  }
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function renderCatalog() {
  renderCount();
  renderActiveFilters();
  const query = state.search.trim().toLowerCase();

  // Всегда рендерим отфильтрованный список из state.products
  const filtered = getFiltered();

  // Лимит «Показать ещё» сбрасывается в 24 при смене фильтров/поиска/сортировки
  const sig = filtersSignature();
  if (state.sig !== sig) {
    state.sig = sig;
    state.limit = PAGE_SIZE;
  }
  const visible = filtered.slice(0, state.limit);

  catalogEl.replaceChildren();

  if (filtered.length === 0) {
    hideSkeleton();
    emptyStateEl.hidden = false;
    renderLoadMore(0, 0);
    renderCartBar();
    updateResetBtn();
    return;
  }
  emptyStateEl.hidden = true;
  hideSkeleton();

  visible.forEach((product, i) => {
    const card = createCard(product);
    // Стаггер-анимация: порядковый номер в --i
    card.style.setProperty('--i', String(i));
    // Подсветка поиска: только в названии и бренде, безопасно (без innerHTML)
    if (query) {
      const nameEl = card.querySelector('.card-name');
      const brandEl = card.querySelector('.card-brand');
      if (nameEl) markText(nameEl, query);
      if (brandEl && brandEl.textContent.trim()) markText(brandEl, query);
    }
    catalogEl.appendChild(card);
  });
  renderLoadMore(visible.length, filtered.length);
  renderCartBar();
  updateResetBtn();
}

/* ===== Подсветка поиска (безопасно: обход текстовых узлов, без innerHTML) ===== */
function markText(element, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach((node) => {
    const text = node.nodeValue || '';
    if (!text.toLowerCase().includes(q)) return;

    const fragment = document.createDocumentFragment();
    let rest = text;
    let index = rest.toLowerCase().indexOf(q);

    while (index !== -1) {
      if (index > 0) fragment.appendChild(document.createTextNode(rest.slice(0, index)));
      const mark = document.createElement('mark');
      mark.textContent = rest.slice(index, index + q.length);
      fragment.appendChild(mark);
      rest = rest.slice(index + q.length);
      index = rest.toLowerCase().indexOf(q);
    }
    if (rest) fragment.appendChild(document.createTextNode(rest));
    node.parentNode.replaceChild(fragment, node);
  });
}

/* ===== Карточка товара ===== */
function createCard(product) {
  const card = document.createElement('article');
  card.className = 'card' + (product.available === false ? ' unavailable' : '');
  card.dataset.id = product.id;
  if (product.description) card.title = product.description;

  // Сердечко избранного (top-right, поверх подложки)
  const favBtn = document.createElement('button');
  const isFav = state.favs.has(product.id);
  favBtn.type = 'button';
  favBtn.className = 'fav-btn' + (isFav ? ' active' : '');
  favBtn.dataset.id = product.id;
  favBtn.setAttribute('aria-label', isFav ? 'Убрать из избранного' : 'Добавить в избранное');
  favBtn.setAttribute('aria-pressed', String(isFav));
  favBtn.textContent = isFav ? '❤' : '🤍';
  card.appendChild(favBtn);

  const media = document.createElement('div');
  media.className = 'card-media';
  media.appendChild(buildMediaEl(product, 'card-img'));

  if (product.badge) {
    const badge = document.createElement('span');
    let badgeClass = 'badge';
    if (product.badge === '-20%') badgeClass += ' badge-sale';
    else if (product.badge === 'хит') badgeClass += ' badge-hot';
    badge.className = badgeClass;
    badge.textContent = product.badge;
    media.appendChild(badge);
  }

  const name = document.createElement('h3');
  name.className = 'card-name';
  name.textContent = product.name || 'Без названия';

  const brand = document.createElement('p');
  brand.className = 'card-brand';
  brand.textContent = product.brand || '\u00A0';

  const priceRow = document.createElement('div');
  priceRow.className = 'card-price-row';

  const price = document.createElement('span');
  price.className = 'card-price';
  price.textContent = formatPrice(product.price);
  priceRow.appendChild(price);

  if (product.oldPrice && product.oldPrice > product.price) {
    const oldPrice = document.createElement('span');
    oldPrice.className = 'card-old-price';
    oldPrice.textContent = formatPrice(product.oldPrice);
    priceRow.appendChild(oldPrice);
  }

  // Обёртка «имя + бренд + цена» — центр карточки (сетка)
  const infoWrap = document.createElement('div');
  infoWrap.className = 'card-row-info';
  infoWrap.append(name, brand, priceRow);

  card.append(media, infoWrap, createControls(product));

  // Оверлей «Нет в наличии» поверх приглушённой карточки
  if (product.available === false) {
    const overlay = document.createElement('div');
    overlay.className = 'sold-out-overlay';
    overlay.textContent = 'Нет в наличии';
    card.appendChild(overlay);
  }

  return card;
}

function createControls(product) {
  const controls = document.createElement('div');
  controls.className = 'card-controls';

  if (product.available === false) {
    const holder = document.createElement('div');
    holder.className = 'qty-row holder';
    controls.appendChild(holder);
  } else {
    const qty = state.cart.get(product.id) || 0;
    const wrap = document.createElement('div');
    wrap.className = 'qty-row';

    if (qty > 0) {
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'qty-btn';
      minus.textContent = '−';
      minus.dataset.action = 'minus';
      minus.dataset.id = product.id;
      minus.setAttribute('aria-label', 'Убрать одну штуку');

      const count = document.createElement('span');
      count.className = 'qty-count';
      count.textContent = qty;

      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'qty-btn plus';
      plus.textContent = '+';
      plus.dataset.action = 'plus';
      plus.dataset.id = product.id;
      plus.setAttribute('aria-label', 'Добавить ещё одну штуку');

      wrap.append(minus, count, plus);
    } else {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'add-btn';
      add.textContent = '+';
      add.dataset.action = 'plus';
      add.dataset.id = product.id;
      add.setAttribute('aria-label', 'Добавить в корзину');
      wrap.appendChild(add);
    }

    controls.appendChild(wrap);
  }
  return controls;
}

/* ===== Корзина ===== */
function formatPrice(value) {
  return Number(value || 0).toLocaleString('ru-RU') + ' ₽';
}

function cartQty() {
  let n = 0;
  state.cart.forEach((qty) => { n += qty; });
  return n;
}

function cartTotal() {
  let sum = 0;
  state.cart.forEach((qty, id) => {
    const product = state.products.find((p) => p.id === id);
    if (product) sum += (product.price || 0) * qty;
  });
  return sum;
}

function updateBackButton() {
  if (!tg || !tg.BackButton) return;
  const anyOpen = detailModal.classList.contains('open') ||
    statsModal.classList.contains('open');
  if (anyOpen || state.cart.size > 0) {
    tg.BackButton.show();
  } else {
    tg.BackButton.hide();
  }
}

function renderCartBar() {
  const count = cartQty();
  cartCountEl.textContent = count;

  cartItemsEl.replaceChildren();
  let lineIndex = 0;
  state.cart.forEach((qty, id) => {
    const product = state.products.find((p) => p.id === id);
    if (!product) return;
    lineIndex += 1;
    const emoji = product.emoji || CATEGORY_EMOJI[product.category] || DEFAULT_EMOJI;

    const li = document.createElement('li');
    li.className = 'cart-item';

    const label = document.createElement('span');
    label.textContent = lineIndex + ') ' + emoji + ' ' + (product.name || 'Товар') +
      ' — ' + qty + ' шт — ' + formatPrice((product.price || 0) * qty);

    li.appendChild(label);
    cartItemsEl.appendChild(li);
  });

  cartTotalEl.textContent = formatPrice(cartTotal());

  const hasItems = count > 0;
  cartBarEl.classList.toggle('open', hasItems);
  document.body.classList.toggle('has-cart', hasItems);

  updateBackButton();
}

function addToCart(id) {
  state.cart.set(id, (state.cart.get(id) || 0) + 1);
  haptic('success');
  renderAll();
}

function removeFromCart(id) {
  const next = (state.cart.get(id) || 0) - 1;
  if (next <= 0) state.cart.delete(id);
  else state.cart.set(id, next);
  renderAll();
}

function renderAll() {
  renderCatalog(); // внутри renderCatalog() обновляется и панель заказа
}

/* ===== Отправка заказа ===== */

/* Лимит длины готовой ссылки: Telegram ограничивает размер предзаполненного текста */
const ORDER_LINK_LIMIT = 3800;

/* Позиции корзины для заказа: [{ name, qty, sum }, ...] */
function cartItemsForOrder() {
  const items = [];
  state.cart.forEach((qty, id) => {
    const product = state.products.find((p) => p.id === id);
    if (!product) return;
    items.push({
      name: product.name || 'Товар',
      qty: qty,
      sum: (product.price || 0) * qty
    });
  });
  return items;
}

/* Чистая функция: текст заказа в прежнем формате */
function buildOrderText(cartItems, total) {
  const lines = ['Заказ:'];
  (cartItems || []).forEach((item, i) => {
    lines.push(
      (i + 1) + ') ' + ((item && item.name) || 'Товар') +
      ' — ' + ((item && item.qty) || 0) + ' шт — ' + ((item && item.sum) || 0) + ' ₽'
    );
  });
  lines.push('Итого: ' + (Number(total) || 0) + ' ₽');
  return lines.join('\n');
}

/* Чистая функция: ссылка на чат с предзаполненным текстом заказа */
function buildOrderLink(username, text) {
  return 'https://t.me/' + username + '?text=' + encodeURIComponent(text);
}

/* Чистая функция: обрезает список позиций, чтобы ссылка влезла в лимит */
function fitOrderText(items, total, username, limit) {
  const user = username || CONFIG.contactUsername;
  const maxUrl = Number(limit) || ORDER_LINK_LIMIT;
  const list = Array.isArray(items) ? items : [];

  const full = buildOrderText(list, total);
  if (buildOrderLink(user, full).length <= maxUrl) return full;

  // Режем только целые позиции (не посреди строки), добавляем «…и ещё N позиций»
  for (let keep = list.length - 1; keep >= 0; keep -= 1) {
    const omitted = list.length - keep;
    const text = buildOrderText(list.slice(0, keep), total) +
      '\n…и ещё ' + omitted + ' позиций';
    if (buildOrderLink(user, text).length <= maxUrl) return text;
  }

  return 'Заказ:\nИтого: ' + (Number(total) || 0) + ' ₽';
}

/* Открытие ссылки: Telegram Mini App, иначе обычное окно */
function openTelegramLink(url) {
  const wa = window.Telegram && window.Telegram.WebApp;
  if (wa && typeof wa.openTelegramLink === 'function') {
    wa.openTelegramLink(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // переходим к fallback ниже
    }
  }
  // Fallback для сред без Clipboard API
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (err) {
    ok = false;
  }
  textarea.remove();
  return ok;
}

function sendOrder() {
  if (state.cart.size === 0) {
    showToast('Корзина пуста');
    return;
  }

  const text = fitOrderText(cartItemsForOrder(), cartTotal());
  const link = buildOrderLink(CONFIG.contactUsername, text);

  haptic('success');
  openTelegramLink(link);
  showToast('Открываю чат с продавцом — нажмите «Отправить» в Telegram');
  // Корзину намеренно не очищаем: заказ можно поправить и отправить повторно
}

/* ===== Тост ===== */
let toastTimer = null;

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

/* ===== Модалка деталей ===== */
function openDetail(item) {
  detailItem = item;
  renderDetail(item);
  rememberScroll();
  detailModal.classList.add('open');
  detailModal.setAttribute('aria-hidden', 'false');
  updateBackButton();
}

function closeDetail() {
  detailModal.classList.remove('open');
  detailModal.setAttribute('aria-hidden', 'true');
  detailItem = null;
  updateBackButton();
  restoreScroll();
}

function renderDetail(item) {
  detailBody.replaceChildren();

  // Медиа-шапка: фото или эмодзи-заглушка (buildMediaEl, 120px)
  const media = document.createElement('div');
  media.className = 'detail-media';
  media.appendChild(buildMediaEl(item, 'modal-media'));

  if (item.badge) {
    const badge = document.createElement('span');
    let badgeClass = 'badge detail-badge';
    if (item.badge === '-20%') badgeClass += ' badge-sale';
    else if (item.badge === 'хит') badgeClass += ' badge-hot';
    badge.className = badgeClass;
    badge.textContent = item.badge;
    media.appendChild(badge);
  }
  detailBody.appendChild(media);

  // Название
  const name = document.createElement('h2');
  name.className = 'detail-name';
  name.textContent = item.name || 'Без названия';
  detailBody.appendChild(name);

  // Бренд-бейдж
  if (item.brand) {
    const brand = document.createElement('span');
    brand.className = 'detail-brand';
    brand.textContent = item.brand;
    detailBody.appendChild(brand);
  }

  // Цена
  const priceRow = document.createElement('div');
  priceRow.className = 'detail-price-row';

  const price = document.createElement('span');
  price.className = 'detail-price';
  price.textContent = formatPrice(item.price);
  priceRow.appendChild(price);

  if (item.oldPrice && item.oldPrice > item.price) {
    const old = document.createElement('span');
    old.className = 'detail-old-price';
    old.textContent = formatPrice(item.oldPrice);
    priceRow.appendChild(old);
  }
  detailBody.appendChild(priceRow);

  // Кликабельная категория: «📁 <категория>»
  if (item.category) {
    const catBtn = document.createElement('button');
    catBtn.type = 'button';
    catBtn.className = 'detail-category-btn';
    catBtn.textContent = '📁 ' + item.category;
    detailBody.appendChild(catBtn);
  }

  // Наличие
  const stock = document.createElement('p');
  stock.className = 'detail-stock' + (item.available === false ? ' out' : '');
  stock.textContent = item.available === false ? 'Нет в наличии' : 'В наличии';
  detailBody.appendChild(stock);

  // Описание — полное, без clamp
  if (item.description) {
    const desc = document.createElement('p');
    desc.className = 'detail-desc';
    desc.textContent = item.description;
    detailBody.appendChild(desc);
  }

  // Кнопки CTA
  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'detail-add-btn';
  addBtn.textContent = '+ В корзину';
  addBtn.disabled = item.available === false;
  actions.appendChild(addBtn);

  const shareBtn = document.createElement('button');
  shareBtn.type = 'button';
  shareBtn.className = 'detail-share-btn';
  shareBtn.textContent = 'Поделиться';
  actions.appendChild(shareBtn);

  detailBody.appendChild(actions);
}

async function shareProduct() {
  const item = detailItem;
  if (!item) return;
  const text = '🔞 ' + (item.name || '') + ' ' + (item.brand || '') +
    ' — ' + formatPrice(item.price) + '\nПодробнее в VapeCatalog';
  const ok = await copyText(text);
  showToast(ok ? 'Скопировано' : 'Не удалось скопировать');
}

/* ===== Статистика ===== */
function openStats() {
  renderStats();
  rememberScroll();
  statsModal.classList.add('open');
  statsModal.setAttribute('aria-hidden', 'false');
  updateBackButton();
}

function closeStats() {
  statsModal.classList.remove('open');
  statsModal.setAttribute('aria-hidden', 'true');
  updateBackButton();
  restoreScroll();
}

function makeStatRow(label, value, cls) {
  const row = document.createElement('div');
  row.className = 'stat-row';
  const lab = document.createElement('span');
  lab.className = 'stat-label';
  lab.textContent = label;
  const val = document.createElement('span');
  val.className = 'stat-value' + (cls ? ' ' + cls : '');
  val.textContent = value;
  row.append(lab, val);
  return row;
}

function renderStats() {
  statsBody.replaceChildren();

  const all = state.products;
  const available = all.filter((p) => p.available !== false);
  const categoriesCount = new Set(all.map((p) => p.category).filter(Boolean)).size;

  const sumPrices = available.reduce((s, p) => s + effectivePrice(p), 0);
  const avgPrice = available.length > 0 ? sumPrices / available.length : 0;

  const promos = all.filter((p) =>
    (Number(p.oldPrice) || 0) > (Number(p.price) || 0) ||
    (p.badge && String(p.badge).trim().length > 0)
  ).length;

  const sortedByPrice = available.slice().sort((a, b) => effectivePrice(a) - effectivePrice(b));
  const cheapest = sortedByPrice[0];
  const mostExpensive = sortedByPrice[sortedByPrice.length - 1];

  statsBody.appendChild(makeStatRow('Всего товаров', String(all.length)));
  statsBody.appendChild(makeStatRow('В наличии', String(available.length)));
  statsBody.appendChild(makeStatRow('Категорий', String(categoriesCount)));
  statsBody.appendChild(makeStatRow('Средняя цена (в наличии)', formatPrice(avgPrice), 'accent'));
  statsBody.appendChild(makeStatRow('Акций', String(promos), 'accent'));
  statsBody.appendChild(makeStatRow('Самый дорогой',
    mostExpensive ? (mostExpensive.name + ' — ' + formatPrice(effectivePrice(mostExpensive))) : '—'));
  statsBody.appendChild(makeStatRow('Самый дешёвый',
    cheapest ? (cheapest.name + ' — ' + formatPrice(effectivePrice(cheapest))) : '—'));

  // «Написать продавцу» — личный чат через openTelegramLink / window.open
  if (CONFIG.contactUsername) {
    const writeBtn = document.createElement('button');
    writeBtn.type = 'button';
    writeBtn.className = 'stat-action-btn';
    writeBtn.textContent = '✉️ Написать продавцу';
    writeBtn.addEventListener('click', () => {
      haptic('light');
      openTelegramLink('https://t.me/' + CONFIG.contactUsername);
    });
    statsBody.appendChild(writeBtn);
  }
}

/* ===== Экспорт выборки ===== */
function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return dd + '.' + mm + '.' + date.getFullYear();
}

function exportSelection() {
  const items = getFiltered();
  if (items.length === 0) {
    showToast('Нет записей для экспорта');
    return;
  }

  const lines = ['Прайс VapeCatalog ' + formatDate(new Date()), ''];
  items.forEach((p, i) => {
    const price = Number(p.price || 0).toLocaleString('ru-RU');
    lines.push((i + 1) + ') ' + (p.name || 'Без названия') +
      ' (' + (p.brand || '') + ') — ' + price + ' ₽');
  });

  const text = lines.join('\n');
  copyText(text).then((ok) => {
    showToast(ok ? 'Прайс скопирован (' + items.length + ')' : 'Не удалось скопировать прайс');
  });
}

/* ===== «Мне повезёт» ===== */
function spinLucky(items) {
  const icons = ['🎲', '🎰', '⭐', '🎯', '🍀'];
  let step = 0;
  const total = 4; // 3-4 прокрутки эмодзи

  luckyBtn.classList.add('spinning');
  const timer = setInterval(() => {
    luckyBtn.textContent = icons[step % icons.length];
    step += 1;
    if (step >= total) {
      clearInterval(timer);
      luckyBtn.classList.remove('spinning');
      luckyBtn.textContent = '🎲';
      const picked = items[Math.floor(Math.random() * items.length)];
      openDetail(picked);
    }
  }, 120);
}

/* ===== События ===== */
document.addEventListener('scroll', function () {
  if (!toTopBtn) return;
  toTopBtn.classList.toggle('show', window.scrollY > 600);
}, { passive: true });

toTopBtn.addEventListener('click', function () {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

chipsEl.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  let isCategoryChip = false;
  if (chip.hasAttribute('data-fav')) {
    state.favOnly = !state.favOnly;
    if (state.favOnly) {
      state.category = 'Все';
    }
  } else if (chip.hasAttribute('data-toggle')) {
    state.inStockOnly = !state.inStockOnly;
  } else if (chip.dataset.category !== undefined) {
    state.category = chip.dataset.category;
    state.favOnly = false;
    isCategoryChip = true;
  }
  haptic('light');
  renderChips();
  renderCatalog();
  if (isCategoryChip) scrollToCatalog();
});

chips2El.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  if (chip.dataset.brand === undefined) return;
  state.brand = chip.dataset.brand;
  haptic('light');
  renderChips2();
  renderCatalog();
});

searchInput.addEventListener('input', (event) => {
  const value = event.target.value;
  updateSearchClear(value);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = value;
    renderCatalog();
  }, 250);
});

searchClear.addEventListener('click', () => {
  clearSearch();
  searchInput.focus();
});

resetBtn.addEventListener('click', resetFilters);

catalogEl.addEventListener('click', (event) => {
  const favBtn = event.target.closest('.fav-btn');
  if (favBtn) {
    toggleFav(Number(favBtn.dataset.id));
    return;
  }

  const btn = event.target.closest('button[data-action]');
  if (btn) {
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === 'plus') addToCart(id);
    else if (btn.dataset.action === 'minus') removeFromCart(id);
    return;
  }

  const card = event.target.closest('.card');
  if (card && card.dataset.id) {
    const product = state.products.find((p) => Number(p.id) === Number(card.dataset.id));
    if (product) openDetail(product);
  }
});

detailBody.addEventListener('click', (event) => {
  const addBtn = event.target.closest('.detail-add-btn');
  if (addBtn) {
    if (detailItem) {
      addToCart(detailItem.id);
      showToast('Добавлено в корзину');
    }
    return;
  }
  const catBtn = event.target.closest('.detail-category-btn');
  if (catBtn) {
    if (detailItem && detailItem.category) {
      const cat = detailItem.category;
      closeDetail();
      state.search = '';
      searchInput.value = '';
      state.favOnly = false;
      state.category = cat;
      updateSearchClear();
      renderChips();
      renderCatalog();
      showToast('Категория: ' + cat);
    }
    return;
  }
  const shareBtn = event.target.closest('.detail-share-btn');
  if (shareBtn) {
    shareProduct();
  }
});

detailCloseBtn.addEventListener('click', closeDetail);
detailModal.addEventListener('click', (event) => {
  if (event.target && event.target.hasAttribute('data-close-detail')) closeDetail();
});

statsBtn.addEventListener('click', openStats);
statsCloseBtn.addEventListener('click', closeStats);
statsModal.addEventListener('click', (event) => {
  if (event.target && event.target.hasAttribute('data-close-stats')) closeStats();
});

exportBtn.addEventListener('click', exportSelection);

luckyBtn.addEventListener('click', () => {
  const items = getFiltered();
  if (items.length === 0) {
    showToast('Нет записей для выбора');
    return;
  }
  spinLucky(items);
});

themeToggle.addEventListener('click', () => {
  haptic('light');
  toggleTheme();
});

sendOrderButton.addEventListener('click', sendOrder);

clearCartButton.addEventListener('click', () => {
  state.cart.clear();
  renderAll();
  showToast('Корзина очищена');
});

cartButton.addEventListener('click', () => {
  if (!cartBarEl.classList.contains('open')) return;
  cartBarEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

/* Новые кнопки удобства */
refreshBtn.addEventListener('click', refreshCatalog);
shareBtn.addEventListener('click', shareCatalog);

loadMoreBtn.addEventListener('click', () => {
  state.limit += PAGE_SIZE;
  haptic('light');
  renderCatalog();
});

emptyResetBtn.addEventListener('click', () => {
  haptic('light');
  resetFilters();
});

/* Горячие клавиши (десктоп) */
document.addEventListener('keydown', handleHotkey);

/* ===== Старт ===== */
applyTheme();
initTelegram();
updateSearchClear();
updateResetBtn();
loadProducts();