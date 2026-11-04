'use strict';

/* ===== Настройки ===== */
const CONFIG = {
  contactUsername: 'vape_shop' // Telegram-username продавца, без «@»
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

  // BackButton: если корзина не пуста — очистить её, иначе закрыть приложение
  if (tg.BackButton) {
    tg.BackButton.onClick(() => {
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
    if (hasItems) tg.BackButton.show();
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

/* ===== Старт ===== */
initTelegram();
loadProducts();
