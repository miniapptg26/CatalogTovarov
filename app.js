
/* ===== Настройки ===== */
const CONFIG = {
  contactUsername: 'g179p' + '?text=Приветствую ', // Telegram-username продавца, без «@»

  // Админ-режим: запись товаров через GitHub REST API (commit в products.json)
  adminUsername: 'g179p',       // username или числовой id администратора
  repoOwner: '',                // владелец GitHub-репозитория (вводится в админ-панели)
  repoName: 'vape-catalog',     // репозиторий, куда пишутся товары
  jsonPath: 'products.json'     // файл каталога внутри репозитория
};

/* Эмодзи-заглушки по категориям (используются, если у товара нет image и emoji) */
const CATEGORY_EMOJI = {
  'Жидкости': '🧪',
  'Одноразки': '💨',
  'POD-системы': '🔋',
  'Аксессуары': '🧰'
};

const DEFAULT_EMOJI = '📦';

/* ===== Состояние ===== */
const state = {
  products: [],      // все товары из products.json
  search: '',        // текущий запрос
  category: 'Все',   // активная категория
  cart: new Map()    // id товара -> количество
};

/* ===== Telegram WebApp ===== */
const tg = window.Telegram ? window.Telegram.WebApp : null;

/* ===== Определение администратора ===== */
const tgUser = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe)
  ? window.Telegram.WebApp.initDataUnsafe.user
  : null;
const isAdmin = !!(tgUser && (tgUser.username === CONFIG.adminUsername || String(tgUser.id) === CONFIG.adminUsername));

/* ===== DOM ===== */
const catalogEl = document.getElementById('catalog');
const emptyStateEl = document.getElementById('emptyState');
const chipsEl = document.getElementById('chips');
const searchInput = document.getElementById('searchInput');
const cartButton = document.getElementById('cartButton');
const cartCountEl = document.getElementById('cartCount');
const cartBarEl = document.getElementById('cartBar');
const cartItemsEl = document.getElementById('cartItems');
const cartTotalEl = document.getElementById('cartTotal');
const sendOrderButton = document.getElementById('sendOrderButton');
const clearCartButton = document.getElementById('clearCartButton');
const toastEl = document.getElementById('toast');

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

  // BackButton: сначала закрывает админ-модалку, иначе — если корзина не пуста,
  // очищает её, а если пуста — закрывает приложение
  if (tg.BackButton) {
    tg.BackButton.onClick(() => {
      if (adminModal && adminModal.classList.contains('open')) {
        closeAdmin();
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

/* ===== Загрузка товаров ===== */
async function loadProducts() {
  try {
    const response = await fetch('products.json');
    if (!response.ok) {
      throw new Error('Ошибка HTTP ' + response.status);
    }
    const data = await response.json();
    state.products = Array.isArray(data) ? data : [];
  } catch (err) {
    showLoadError(err && err.message ? err.message : 'неизвестная ошибка');
    return;
  }
  renderChips();
  renderCatalog();
  fillCategoryList();
}

function showLoadError(message) {
  catalogEl.replaceChildren();
  emptyStateEl.hidden = true;

  const box = document.createElement('div');
  box.className = 'error-box';

  const emoji = document.createElement('div');
  emoji.className = 'error-emoji';
  emoji.textContent = '⚠️';

  const title = document.createElement('p');
  title.textContent = 'Не удалось загрузить товары';

  const sub = document.createElement('p');
  sub.className = 'error-sub';
  sub.textContent = message + '. Проверьте, что файл products.json лежит рядом с index.html.';

  box.append(emoji, title, sub);
  catalogEl.appendChild(box);
}

/* ===== Чипы категорий ===== */
function renderChips() {
  chipsEl.replaceChildren();

  const categories = ['Все', ...new Set(
    state.products.map((p) => p.category).filter(Boolean)
  )];

  categories.forEach((category) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (category === state.category ? ' active' : '');
    chip.textContent = category;
    chip.dataset.category = category;
    chipsEl.appendChild(chip);
  });
}

/* ===== Рендер каталога ===== */
function renderCatalog() {
  const query = state.search.trim().toLowerCase();

  const filtered = state.products.filter((product) => {
    const byCategory = state.category === 'Все' || product.category === state.category;
    const haystack = String(product.name + ' ' + (product.brand || '')).toLowerCase();
    const bySearch = !query || haystack.includes(query);
    return byCategory && bySearch;
  });

  catalogEl.replaceChildren();

  if (filtered.length === 0) {
    emptyStateEl.hidden = false;
    renderCartBar();
    return;
  }
  emptyStateEl.hidden = true;

  filtered.forEach((product) => catalogEl.appendChild(createCard(product)));
  renderCartBar();
}

function createCard(product) {
  const card = document.createElement('article');
  card.className = 'card' + (product.available === false ? ' unavailable' : '');
  card.dataset.id = product.id;
  if (product.description) card.title = product.description;

  // Эмодзи берётся только из внутренних источников (никогда из пользовательского HTML)
  const emoji = product.emoji || CATEGORY_EMOJI[product.category] || DEFAULT_EMOJI;

  const media = document.createElement('div');
  media.className = 'card-media';

  const emojiBox = document.createElement('div');
  emojiBox.className = 'card-emoji';
  emojiBox.textContent = emoji;

  if (product.image) {
    const img = document.createElement('img');
    img.className = 'card-img';
    img.alt = product.name || 'Товар';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = product.image;
    img.addEventListener('error', () => img.replaceWith(emojiBox));
    media.appendChild(img);
  } else {
    media.appendChild(emojiBox);
  }

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

  card.append(media, name, brand, priceRow, createControls(product));

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
    // Заблокированная карточка: оверлей уже добавлен в createCard,
    // в зоне контролов просто оставляем заглушку по высоте
    const holder = document.createElement('div');
    holder.className = 'qty-row holder';
    controls.appendChild(holder);
    return controls;
  }

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

  if (tg && tg.BackButton) {
    if (adminModal && adminModal.classList.contains('open')) tg.BackButton.show();
    else if (hasItems) tg.BackButton.show();
    else tg.BackButton.hide();
  }
}

function addToCart(id) {
  state.cart.set(id, (state.cart.get(id) || 0) + 1);
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
function buildOrderText() {
  const lines = ['Заказ:'];
  let index = 0;
  state.cart.forEach((qty, id) => {
    const product = state.products.find((p) => p.id === id);
    if (!product) return;
    index += 1;
    lines.push(
      index + ') ' + (product.name || 'Товар') +
      ' — ' + qty + ' шт — ' + ((product.price || 0) * qty) + ' ₽'
    );
  });
  lines.push('Итого: ' + cartTotal() + ' ₽');
  return lines.join('\n');
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

async function sendOrder() {
  if (state.cart.size === 0) {
    showToast('Корзина пуста');
    return;
  }

  const text = buildOrderText();
  const copied = await copyText(text);
  showToast(copied ? 'Заказ скопирован! Отправьте его в чат' : 'Не удалось скопировать заказ');

  const url = 'https://t.me/' + CONFIG.contactUsername;
  if (tg && typeof tg.openTelegramLink === 'function') {
    tg.openTelegramLink(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/* ===== Тост ===== */
let toastTimer = null;

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

/* ===== События ===== */
chipsEl.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  state.category = chip.dataset.category;
  renderChips();
  renderCatalog();
});

searchInput.addEventListener('input', (event) => {
  state.search = event.target.value;
  renderCatalog();
});

catalogEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'plus') addToCart(id);
  else if (btn.dataset.action === 'minus') removeFromCart(id);
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

/* ===== Админ-режим: добавление товаров через GitHub API ===== */

/* DOM админ-панели */
const adminOpenBtn = document.getElementById('adminOpenBtn');
const adminModal = document.getElementById('adminModal');
const adminCloseBtn = document.getElementById('adminCloseBtn');
const checkGitHubBtn = document.getElementById('checkGitHubBtn');
const saveBtn = document.getElementById('saveBtn');
const githubStatusEl = document.getElementById('githubStatus');
const ghTokenInput = document.getElementById('ghToken');
const ghOwnerInput = document.getElementById('ghOwner');
const ghRepoInput = document.getElementById('ghRepo');

/* DOM секции «Записи в каталоге» */
const loadItemsBtn = document.getElementById('loadItemsBtn');
const itemsStatusEl = document.getElementById('itemsStatus');
const itemsListEl = document.getElementById('itemsList');
let adminItemsCache = []; // последний список, загруженный из GitHub

/* Показываем кнопку ➕ только администратору */
function setAdminVisible() {
  if (isAdmin && adminOpenBtn) adminOpenBtn.classList.remove('hidden');
}

function openAdmin() {
  if (!isAdmin) return;
  if (ghTokenInput) ghTokenInput.value = localStorage.getItem('gh_token') || '';
  if (ghOwnerInput) ghOwnerInput.value = localStorage.getItem('gh_owner') || '';
  if (ghRepoInput) ghRepoInput.value = localStorage.getItem('gh_repo') || CONFIG.repoName;
  if (githubStatusEl) {
    githubStatusEl.textContent = '';
    githubStatusEl.classList.remove('ok', 'err');
  }
  adminModal.classList.add('open');
  adminModal.setAttribute('aria-hidden', 'false');
  if (tg && tg.BackButton) tg.BackButton.show();
}

function closeAdmin() {
  adminModal.classList.remove('open');
  adminModal.setAttribute('aria-hidden', 'true');
  if (tg && tg.BackButton) {
    if (state.cart.size > 0) tg.BackButton.show();
    else tg.BackButton.hide();
  }
}

/* UTF-8-safe base64: кириллица и эмодзи */
function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodeBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function setGithubStatus(message, kind) {
  if (!githubStatusEl) return;
  githubStatusEl.textContent = message;
  githubStatusEl.classList.remove('ok', 'err');
  if (kind === 'ok') githubStatusEl.classList.add('ok');
  else if (kind === 'err') githubStatusEl.classList.add('err');
}

function getRepoInputs() {
  return {
    token: (ghTokenInput && ghTokenInput.value || '').trim(),
    owner: (ghOwnerInput && ghOwnerInput.value || '').trim(),
    repo: (ghRepoInput && ghRepoInput.value || '').trim()
  };
}

function saveRepoToLocalStorage() {
  const r = getRepoInputs();
  localStorage.setItem('gh_token', r.token);
  localStorage.setItem('gh_owner', r.owner);
  localStorage.setItem('gh_repo', r.repo);
}

function githubHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function githubErrorMessage(response) {
  let message = '';
  try {
    const data = await response.json();
    if (data && data.message) message = data.message;
  } catch (e) {
    // ответ не JSON
  }
  const text = message ? (response.status + ' ' + message) : ('HTTP ' + response.status);
  if (response.status === 401) return text + ' — проверьте токен';
  return text;
}

const API_LIST_NOUN = CONFIG.jsonPath === 'bloggers.json' ? 'блогеров' : 'товаров';

/* Чтение текущего JSON из репозитория: 200 → массив + sha, 404 → [] + null */
async function fetchCatalog(owner, repo, token, allowMissing) {
  const url = 'https://api.github.com/repos/' + encodeURIComponent(owner) +
    '/' + encodeURIComponent(repo) + '/contents/' + encodeURIComponent(CONFIG.jsonPath) + '?ref=main';
  const response = await fetch(url, { headers: githubHeaders(token) });
  if (response.ok) {
    const meta = await response.json();
    const arr = JSON.parse(decodeBase64(meta.content));
    return { items: Array.isArray(arr) ? arr : [], sha: meta.sha };
  }
  if (response.status === 404) {
    if (allowMissing) return { items: [], sha: null };
    throw new Error(await githubErrorMessage(response));
  }
  throw new Error(await githubErrorMessage(response));
}

async function checkGitHubConnection() {
  const { token, owner, repo } = getRepoInputs();
  if (!token || !owner || !repo) {
    setGithubStatus('Заполните token, owner и repo', 'err');
    return;
  }
  setGithubStatus('Проверяем связь…');
  try {
    const { items } = await fetchCatalog(owner, repo, token, false);
    setGithubStatus('Связь OK: ' + items.length + ' ' + API_LIST_NOUN, 'ok');
  } catch (err) {
    setGithubStatus((err && err.message) || 'Ошибка соединения', 'err');
  }
}

function collectNewProduct() {
  const val = (id) => (document.getElementById(id).value || '').trim();
  const name = val('adminName');
  const price = Number(document.getElementById('adminPrice').value);
  if (!name) {
    setGithubStatus('Укажите название товара', 'err');
    return null;
  }
  if (!Number.isFinite(price) || price < 0) {
    setGithubStatus('Укажите корректную цену', 'err');
    return null;
  }

  const item = {
    name: name,
    brand: val('adminBrand'),
    category: val('adminCategory'),
    price: price
  };
  const oldPrice = Number(document.getElementById('adminOldPrice').value);
  if (Number.isFinite(oldPrice) && oldPrice > 0) item.oldPrice = oldPrice;
  const description = val('adminDescription');
  if (description) item.description = description;
  const badge = document.getElementById('adminBadge').value;
  if (badge) item.badge = badge;
  const emoji = val('adminEmoji');
  if (emoji) item.emoji = emoji;
  item.available = document.getElementById('adminAvailable').checked;
  return item;
}

async function publishToGitHub(newItem) {
  const { token, owner, repo } = getRepoInputs();
  if (!token || !owner || !repo) {
    setGithubStatus('Заполните token, owner и repo', 'err');
    return;
  }
  saveRepoToLocalStorage();

  let catalog;
  try {
    catalog = await fetchCatalog(owner, repo, token, true);
  } catch (err) {
    setGithubStatus('Ошибка чтения каталога: ' + ((err && err.message) || 'нет соединения'), 'err');
    return;
  }

  const items = catalog.items;
  newItem.id = items.reduce((maxId, item) => Math.max(maxId, Number(item.id) || 0), 0) + 1;
  if (newItem.available === undefined) newItem.available = true;
  items.push(newItem);

  const content = encodeBase64(JSON.stringify(items, null, 2));
  const putBody = { message: 'Add item via Mini App', content: content };
  if (catalog.sha) putBody.sha = catalog.sha;

  try {
    const response = await fetch(
      'https://api.github.com/repos/' + encodeURIComponent(owner) +
        '/' + encodeURIComponent(repo) + '/contents/' + encodeURIComponent(CONFIG.jsonPath),
      {
        method: 'PUT',
        headers: Object.assign(githubHeaders(token), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(putBody)
      }
    );
    if (response.ok) {
      setGithubStatus('✅ Сохранено! Каталог обновится…', 'ok');
      showToast('Сохранено!');
      setTimeout(function () { location.reload(); }, 1800);
    } else {
      setGithubStatus('Ошибка: ' + await githubErrorMessage(response), 'err');
    }
  } catch (err) {
    setGithubStatus('Ошибка: ' + ((err && err.message) || 'нет соединения'), 'err');
  }
}

/* datalist с существующими категориями */
function fillCategoryList() {
  const list = document.getElementById('categoryList');
  if (!list) return;
  list.replaceChildren();
  const categories = [...new Set(state.products.map((p) => p.category).filter(Boolean))];
  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    list.appendChild(option);
  });
}

/* ===== Админ: записи в каталоге (загрузка списка и удаление) ===== */

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function itemsCountLabel(n) {
  if (n === 0) return 'Каталог пуст';
  if (CONFIG.jsonPath === 'bloggers.json') {
    return n + ' ' + plural(n, 'блогер', 'блогера', 'блогеров');
  }
  return n + ' ' + plural(n, 'товар', 'товара', 'товаров');
}

function setItemsStatus(message, kind) {
  if (!itemsStatusEl) return;
  itemsStatusEl.textContent = message;
  itemsStatusEl.classList.remove('ok', 'err');
  if (kind === 'ok') itemsStatusEl.classList.add('ok');
  else if (kind === 'err') itemsStatusEl.classList.add('err');
}

/* Имя записи для строки списка и подтверждения удаления */
function adminItemName(item) {
  if (!item) return 'Без названия';
  const name = item.name || 'Без названия';
  const brand = item.brand || '';
  return brand ? name + ' · ' + brand : name;
}

/* Дополнительный контекст: категория + цена */
function adminItemMeta(item) {
  if (!item) return '';
  const parts = [];
  if (item.category) parts.push(item.category);
  if (item.price !== undefined && item.price !== null && item.price !== '') {
    parts.push(formatPrice(item.price));
  }
  return parts.join(' · ');
}

/* Загрузка списка записей: token/owner/repo берём из localStorage */
async function loadItems() {
  const token = localStorage.getItem('gh_token') || '';
  const owner = localStorage.getItem('gh_owner') || '';
  const repo = localStorage.getItem('gh_repo') || '';
  if (!token || !owner || !repo) {
    setItemsStatus('Сначала подключите GitHub', 'err');
    renderItems([]);
    return;
  }
  if (loadItemsBtn) loadItemsBtn.disabled = true;
  setItemsStatus('Загружаем список…');
  try {
    const url = 'https://api.github.com/repos/' + encodeURIComponent(owner) +
      '/' + encodeURIComponent(repo) + '/contents/' + encodeURIComponent(CONFIG.jsonPath) + '?ref=main';
    const response = await fetch(url, { headers: githubHeaders(token) });
    if (response.status === 404) {
      setItemsStatus('Файл не найден', 'err');
      renderItems([]);
      return;
    }
    if (response.status === 401 || response.status === 403) {
      setItemsStatus('Проверьте токен и права (нужно Contents: Read and write)', 'err');
      renderItems([]);
      return;
    }
    if (!response.ok) {
      setItemsStatus('Ошибка загрузки: ' + await githubErrorMessage(response), 'err');
      renderItems([]);
      return;
    }
    const meta = await response.json();
    const arr = JSON.parse(decodeBase64(meta.content));
    const items = Array.isArray(arr) ? arr : [];
    adminItemsCache = items;
    setItemsStatus(itemsCountLabel(items.length), 'ok');
    renderItems(items);
  } catch (err) {
    setItemsStatus('Ошибка загрузки: ' + ((err && err.message) || 'нет соединения'), 'err');
  } finally {
    if (loadItemsBtn) loadItemsBtn.disabled = false;
  }
}

/* Рендер строк списка: новые сверху (по убыванию id) */
function renderItems(items) {
  if (!itemsListEl) return;
  itemsListEl.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'items-empty';
    empty.textContent = 'Каталог пуст';
    itemsListEl.appendChild(empty);
    return;
  }

  const sorted = items.slice().sort((a, b) => Number(b.id) - Number(a.id));
  let index = 0;
  sorted.forEach((item) => {
    index += 1;
    const row = document.createElement('div');
    row.className = 'items-row';

    const num = document.createElement('span');
    num.className = 'items-num';
    num.textContent = '#' + ((item.id !== undefined && item.id !== null) ? item.id : index);

    const info = document.createElement('div');
    info.className = 'items-info';

    const name = document.createElement('span');
    name.className = 'items-name';
    name.textContent = adminItemName(item);

    const meta = document.createElement('span');
    meta.className = 'items-sub';
    meta.textContent = adminItemMeta(item);

    info.append(name, meta);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'items-del';
    del.title = 'Удалить';
    del.setAttribute('aria-label', 'Удалить запись');
    del.textContent = '🗑';
    del.dataset.id = String(item.id);

    row.append(num, info, del);
    itemsListEl.appendChild(row);
  });
}

/* Подтверждение: нативный confirm есть и в браузере, и в Telegram WebView */
function askDeleteConfirm(itemName) {
  const message = 'Удалить запись «' + itemName + '»? Это действие нельзя отменить.';
  if (typeof window.confirm === 'function') return window.confirm(message);
  return false; // без нативного confirm удаление не выполняем (безопасный фолбэк)
}

/* Удаление записи через Contents API (commit 'Remove item via Mini App') */
async function removeItem(id) {
  const target = adminItemsCache.find((item) => Number(item.id) === Number(id));
  if (!target) {
    setItemsStatus('Запись не найдена в списке', 'err');
    return;
  }
  if (!askDeleteConfirm(adminItemName(target))) return;

  const { token, owner, repo } = getRepoInputs();
  if (!token || !owner || !repo) {
    setItemsStatus('Сначала подключите GitHub', 'err');
    return;
  }
  saveRepoToLocalStorage();
  setItemsStatus('Удаляем…');

  let catalog;
  try {
    catalog = await fetchCatalog(owner, repo, token, false);
  } catch (err) {
    setItemsStatus('Ошибка чтения каталога: ' + ((err && err.message) || 'нет соединения'), 'err');
    return;
  }

  const nextItems = catalog.items.filter((item) => Number(item.id) !== Number(id));
  if (nextItems.length === catalog.items.length) {
    setItemsStatus('Запись #' + id + ' не найдена в репозитории', 'err');
    return;
  }

  const content = encodeBase64(JSON.stringify(nextItems, null, 2));
  const putBody = { message: 'Remove item via Mini App', content: content, sha: catalog.sha };

  try {
    const response = await fetch(
      'https://api.github.com/repos/' + encodeURIComponent(owner) +
        '/' + encodeURIComponent(repo) + '/contents/' + encodeURIComponent(CONFIG.jsonPath),
      {
        method: 'PUT',
        headers: Object.assign(githubHeaders(token), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(putBody)
      }
    );
    if (response.ok) {
      setItemsStatus('✅ Запись удалена', 'ok');
      showToast('Удалено');
      setTimeout(loadItems, 1500);
    } else {
      setItemsStatus('Ошибка: ' + await githubErrorMessage(response), 'err');
    }
  } catch (err) {
    setItemsStatus('Ошибка: ' + ((err && err.message) || 'нет соединения'), 'err');
  }
}

/* События админ-панели */
if (adminOpenBtn) adminOpenBtn.addEventListener('click', openAdmin);
if (adminCloseBtn) adminCloseBtn.addEventListener('click', closeAdmin);
if (adminModal) adminModal.addEventListener('click', (event) => {
  if (event.target && event.target.hasAttribute('data-admin-close')) closeAdmin();
});
if (checkGitHubBtn) checkGitHubBtn.addEventListener('click', checkGitHubConnection);
if (saveBtn) {
  saveBtn.addEventListener('click', async () => {
    if (saveBtn.disabled) return;
    saveRepoToLocalStorage();
    const item = collectNewProduct();
    if (!item) return;
    saveBtn.disabled = true;
    try {
      await publishToGitHub(item);
    } finally {
      saveBtn.disabled = false;
    }
  });
}
if (loadItemsBtn) loadItemsBtn.addEventListener('click', loadItems);
if (itemsListEl) {
  itemsListEl.addEventListener('click', (event) => {
    const btn = event.target.closest ? event.target.closest('.items-del') : null;
    if (btn && btn.dataset && btn.dataset.id) removeItem(btn.dataset.id);
  });
}

/* ===== Старт ===== */
initTelegram();
setAdminVisible();
loadProducts();
