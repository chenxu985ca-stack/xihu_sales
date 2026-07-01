/**
 * 西湖生物材料销售助手 — Application Logic
 * v2 — refactored from monolithic index.html
 */
(function () {
  'use strict';

  // ── State ──
  const DATA = window.XIHU_DATA;
  let products = DATA.products;
  let quoteItems = [];
  let favorites = []; // {code, name}[]
  let activeCategory = null;
  let searchQuery = '';

  // ── Admin Changes Merge ──

  /** Merge admin localStorage changes into the products array */
  function mergeAdminChanges() {
    try {
      const raw = localStorage.getItem('xihu_admin_changes');
      if (!raw) return;
      const changes = JSON.parse(raw);
      const { added = [], deleted = [], edited = {} } = changes;

      // 1. Remove deleted products (match by code + name)
      if (deleted.length > 0) {
        products = products.filter(p => {
          return !deleted.some(d => d.code === p.code && d.name === p.name);
        });
      }

      // 2. Apply edits
      const editedCodes = Object.keys(edited);
      if (editedCodes.length > 0) {
        products = products.map(p => {
          if (edited[p.code] && edited[p.code][p.name]) {
            return { ...p, ...edited[p.code][p.name] };
          }
          return p;
        });
      }

      // 3. Append added products
      if (added.length > 0) {
        products = products.concat(added);
      }
    } catch (e) {
      console.warn('Failed to merge admin changes:', e);
    }
  }

  // ── DOM refs ──
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    sidebar: $('#sidebar'),
    sidebarBackdrop: $('#sidebarBackdrop'),
    searchInput: $('#searchInput'),
    contentTitle: $('#contentTitle'),
    resultCount: $('#resultCount'),
    productList: $('#productList'),
    quoteOverlay: $('#quoteOverlay'),
    quotePanel: $('#quotePanel'),
    quoteItems: $('#quoteItems'),
    quoteTotal: $('#quoteTotal'),
    quoteCount: $('#quoteCount'),
    quotePrint: $('#quotePrint'),
    companyModal: $('#companyModal'),
    companyModalInner: $('#companyModalInner'),
  };

  // ── Helpers ──

  /** Parse a price value (number or string like "600.00(.022)/560.00(.018)") to a float */
  function parsePrice(p) {
    if (typeof p === 'number') return p;
    if (typeof p === 'string') {
      const m = p.match(/[\d.]+/);
      if (m) return parseFloat(m[0]);
    }
    return 0;
  }

  /** Format a price for display */
  function formatPrice(p) {
    if (typeof p === 'number') return p.toFixed(2);
    return String(p);
  }

  /** HTML-escape a string for safe insertion */
  function escHtml(s) {
    if (!s) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return String(s).replace(/[&<>"]/g, (c) => map[c]);
  }

  /** Escape a string for safe embedding in JS string literals */
  function escJs(s) {
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n');
  }

  /** Debounce helper */
  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  /** Generate a unique key for quote items */
  function quoteKey(code, name) { return `${code}|||${name}`; }

  // ── Persistence ──

  function saveQuote() {
    localStorage.setItem('xihu_quote', JSON.stringify(quoteItems));
  }

  function loadQuote() {
    try {
      const saved = localStorage.getItem('xihu_quote');
      if (saved) quoteItems = JSON.parse(saved);
    } catch (e) { quoteItems = []; }
  }

  function saveFavorites() {
    localStorage.setItem('xihu_favorites', JSON.stringify(favorites));
  }

  function loadFavorites() {
    try {
      const saved = localStorage.getItem('xihu_favorites');
      if (saved) favorites = JSON.parse(saved);
    } catch (e) { favorites = []; }
  }

  function isFavorite(code, name) {
    return favorites.some(f => f.code === code && f.name === name);
  }

  function toggleFavorite(code, name) {
    if (isFavorite(code, name)) {
      favorites = favorites.filter(f => !(f.code === code && f.name === name));
      showToast('已取消收藏');
      // Reset view if on favorites page and it's now empty
      if (favorites.length === 0 && activeCategory === '__favorites__') {
        activeCategory = null;
      }
    } else {
      const product = products.find(p => p.code === code && p.name === name);
      if (product) {
        favorites.push({ code, name });
        showToast('⭐ 已加入常用产品');
      }
    }
    saveFavorites();
    renderSidebar();
    renderProducts();
  }

  function shareProduct(code, name) {
    const product = products.find(p => p.code === code && p.name === name);
    if (!product) return;
    const text = [
      '【西湖生物材料】',
      product.name,
      '编码：' + (product.code || '—'),
      '规格：' + (product.spec || '—'),
      '价格：¥' + formatPrice(product.price) + ' /' + (product.unit || '—'),
    ].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      showToast('✅ 产品信息已复制，可直接粘贴微信发送');
    }).catch(() => {
      prompt('请手动复制：', text);
    });
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // ── Sidebar ──

  /** Category groups for sidebar display */
  const SIDEBAR_GROUPS = {
    '🦷 托槽': ['超薄方丝弓系列','燕尾方丝弓系列','全程式传统直丝弓系列','仿生整体方丝弓系列','仿生整体直丝弓系列','金属网底方丝弓系列','金属网底直丝弓系列','直丝弓系列：徐氏','其他托槽','隐形方丝弓系列','隐形直丝弓系列','精致直丝弓系列','陶瓷直丝弓托槽'],
    '🔒 自锁托槽': ['瓷缘系列陶瓷自锁托槽','瓷悦系列陶瓷自锁托槽','超越系列自锁托槽','卓越系列自锁托槽','HXZ2.0自锁托槽','隐力系列自锁托槽'],
    '⭕ 带环': ['方丝弓带环','直丝弓带环','光带环','圆丝带环','揭盖式带环','出口型带环','带环附件'],
    '📐 颊面管': ['焊接型直丝弓颊面管','焊接型其他颊面管','焊接型揭盖颊面管','网底直丝弓颊面管','网底圆丝颊面管','网底揭盖颊面管','网底方丝弓颊面管'],
    '🧷 正畸附件': ['正畸附件','螺旋扩弓器','拉钩/开口器'],
    '🔗 弹性体': ['正畸弹性体'],
    '🧪 粘合树脂': ['光固化型-牙釉质粘合树脂','光固化型-牙釉质粘合树脂(绿胶)','光固化型-牙釉质粘合树脂(隐形正畸附件粘结剂)','非调拌型-牙釉质粘合树脂','蓝胶系列','隐形正畸附件粘结剂'],
    '📏 正畸丝': ['正畸丝'],
    '🔩 支抗钉': ['钛合金支抗钉(三芯型)','钛合金支抗钉(方头型)','支抗钉工具'],
    '🔧 正畸钳': ['正畸钳(进口合金)','正畸钳(普通合金)','正畸钳'],
    '😷 口外件': ['正畸口外件'],
    '🪥 工具/其他': ['正畸工具','功能矫治器','24K镀金前牙根管桩','24K镀金后牙根管桩','经营类产品'],
  };

  function renderSidebar() {
    let html = `<div class="cat-item${!activeCategory ? ' active' : ''}" data-cat="">📋 全部产品<span class="count">${products.length}</span></div>`;

    // Favorites item — always visible if there are favorites
    if (favorites.length > 0) {
      html += `<div class="cat-item fav-item${activeCategory === '__favorites__' ? ' active' : ''}" data-cat="__favorites__">
        ⭐ 常用产品<span class="count">${favorites.length}</span>
      </div>`;
    }

    const groupedCats = new Set();

    for (const [groupName, cats] of Object.entries(SIDEBAR_GROUPS)) {
      html += `<div class="sidebar-title">${groupName}</div>`;
      for (const catName of cats) {
        groupedCats.add(catName);
        const count = products.filter((p) => p.category === catName).length;
        if (count === 0) continue;
        html += `<div class="cat-item${activeCategory === catName ? ' active' : ''}" data-cat="${escHtml(catName)}">
          ${escHtml(catName)}
          <span class="count">${count}</span>
        </div>`;
      }
    }

    // Catch any ungrouped categories
    const allCats = [...new Set(products.map((p) => p.category))];
    const ungrouped = allCats.filter((c) => !groupedCats.has(c));
    if (ungrouped.length > 0) {
      html += '<div class="sidebar-title">📦 其他</div>';
      for (const catName of ungrouped) {
        const count = products.filter((p) => p.category === catName).length;
        html += `<div class="cat-item${activeCategory === catName ? ' active' : ''}" data-cat="${escHtml(catName)}">
          ${escHtml(catName)}
          <span class="count">${count}</span>
        </div>`;
      }
    }

    dom.sidebar.innerHTML = html;
  }

  function selectCategory(cat) {
    activeCategory = (activeCategory === cat) ? null : cat;
    dom.searchInput.value = '';
    searchQuery = '';
    renderSidebar();
    renderProducts();
    closeSidebar();
  }

  // ── Product Rendering ──

  function getFilteredProducts() {
    let filtered = products;
    if (activeCategory === '__favorites__') {
      // Filter to only favorited products (by code+name match)
      filtered = filtered.filter(p => isFavorite(p.code, p.name));
    } else if (activeCategory) {
      filtered = filtered.filter((p) => p.category === activeCategory);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.code && p.code.toLowerCase().includes(q)) ||
        (p.baseName && p.baseName.toLowerCase().includes(q)) ||
        (p.spec && p.spec.toLowerCase().includes(q)) ||
        (p.note && p.note.toLowerCase().includes(q))
      );
    }
    return filtered;
  }

  function renderProducts() {
    const filtered = getFilteredProducts();

    // Group by baseName + category
    const groups = new Map();
    const groupOrder = [];
    for (const p of filtered) {
      const key = p.baseName + '|||' + p.category;
      if (!groups.has(key)) {
        groups.set(key, []);
        groupOrder.push(key);
      }
      groups.get(key).push(p);
    }

    let title = activeCategory || '全部产品';
    if (activeCategory === '__favorites__') title = '⭐ 常用产品';
    dom.contentTitle.textContent = title;
    dom.resultCount.textContent = `共 ${groupOrder.length} 个产品系列（${filtered.length} SKU）`;

    if (filtered.length === 0) {
      dom.productList.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>没有找到匹配的产品</p></div>`;
      return;
    }

    let html = `<table class="product-table">
      <thead><tr>
        <th>编码</th><th>产品名称</th><th>分类</th><th>包装规格</th><th>单位</th><th>价格 (¥)</th><th></th>
      </tr></thead><tbody>`;

    for (const key of groupOrder) {
      const variants = groups.get(key);
      const baseName = variants[0].baseName;
      const category = variants[0].category;
      const isStar = variants[0].note && variants[0].note.includes('🌟');

      // Base product row
      html += `<tr class="base-row" style="background:#f8fafc;border-top:2px solid var(--border);">
        <td class="code" style="color:var(--text-light);">${isStar ? '⭐ ' : ''}${variants.length}个规格</td>
        <td class="name" style="font-weight:700;">${escHtml(baseName)}</td>
        <td><span class="cat-tag">${escHtml(category)}</span></td>
        <td style="color:var(--text-light);font-size:12px;">—</td>
        <td style="color:var(--text-light);font-size:12px;">—</td>
        <td style="color:var(--text-light);font-size:12px;">—</td>
        <td></td>
      </tr>`;

      for (const p of variants) {
        const inQuote = quoteItems.some((q) => q.code === p.code && q.name === p.name);
        const faved = isFavorite(p.code, p.name);
        html += `<tr class="variant-row">
          <td class="code">${escHtml(p.code || '—')}</td>
          <td class="name">${escHtml(p.name)}</td>
          <td></td>
          <td>${escHtml(p.spec || '—')}</td>
          <td>${escHtml(p.unit || '—')}</td>
          <td class="price">${formatPrice(p.price)}</td>
          <td class="actions-cell">
            <button class="btn-sm btn-add${inQuote ? ' added' : ''}" data-action="add-quote" data-code="${escJs(p.code)}" data-name="${escJs(p.name)}">${inQuote ? '✓ 已加' : '+ 报价'}</button>
            <button class="btn-share" data-action="share-product" data-code="${escJs(p.code)}" data-name="${escJs(p.name)}" title="复制产品信息">📋</button>
            <button class="btn-fav${faved ? ' faved' : ''}" data-action="toggle-fav" data-code="${escJs(p.code)}" data-name="${escJs(p.name)}" title="${faved ? '取消收藏' : '加入常用'}">${faved ? '⭐' : '☆'}</button>
          </td>
        </tr>`;
      }
    }
    html += '</tbody></table>';
    dom.productList.innerHTML = html;
  }

  // ── Search ──

  function onSearch() {
    searchQuery = dom.searchInput.value.trim();
    activeCategory = null;
    renderSidebar();
    renderProducts();
  }

  // ── Quote Management ──

  function updateQuoteBadge() {
    dom.quoteCount.textContent = quoteItems.length;
  }

  function addToQuote(code, name) {
    const product = products.find((p) => p.code === code && p.name === name);
    if (!product) return;

    const key = quoteKey(code, name);
    const existing = quoteItems.find((q) => q._key === key);
    if (existing) {
      existing.qty += 1;
    } else {
      quoteItems.push({
        _key: key,
        name: product.name,
        baseName: product.baseName || product.name,
        code: product.code,
        price: parsePrice(product.price),
        unit: product.unit,
        spec: product.spec,
        qty: 1,
      });
    }
    saveQuote();
    renderQuote();
    renderProducts();
    updateQuoteBadge();
  }

  function removeFromQuote(code, name) {
    const key = quoteKey(code, name);
    quoteItems = quoteItems.filter((q) => q._key !== key);
    saveQuote();
    renderQuote();
    renderProducts();
    updateQuoteBadge();
  }

  function updateQty(code, name, delta) {
    const key = quoteKey(code, name);
    const item = quoteItems.find((q) => q._key === key);
    if (!item) return;
    item.qty = Math.max(0, item.qty + delta);
    if (item.qty === 0) {
      removeFromQuote(code, name);
      return;
    }
    saveQuote();
    renderQuote();
    updateQuoteBadge();
  }

  function setQty(code, name, val) {
    const key = quoteKey(code, name);
    const qty = parseInt(val) || 0;
    const item = quoteItems.find((q) => q._key === key);
    if (!item) return;
    if (qty <= 0) { removeFromQuote(code, name); return; }
    item.qty = qty;
    saveQuote();
    renderQuote();
    updateQuoteBadge();
  }

  function renderQuote() {
    if (quoteItems.length === 0) {
      dom.quoteItems.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>报价单是空的</p><p style="font-size:12px;color:var(--text-light)">点击产品旁的 + 按钮添加</p></div>`;
    } else {
      let html = '';
      for (const item of quoteItems) {
        const subtotal = item.price * item.qty;
        const displayName = item.spec ? `${item.baseName} — ${item.spec}` : item.name;
        html += `<div class="quote-item">
          <div class="qi-info">
            <div class="qi-name">${escHtml(displayName)}</div>
            <div class="qi-code">${escHtml(item.code)} · ${escHtml(item.unit)}</div>
            <div class="qi-price">¥${item.price.toFixed(2)} × ${item.qty} = ¥${subtotal.toFixed(2)}</div>
          </div>
          <div class="qi-qty">
            <button data-action="qty-dec" data-code="${escJs(item.code)}" data-name="${escJs(item.name)}">−</button>
            <input type="number" value="${item.qty}" min="1" data-action="qty-set" data-code="${escJs(item.code)}" data-name="${escJs(item.name)}">
            <button data-action="qty-inc" data-code="${escJs(item.code)}" data-name="${escJs(item.name)}">+</button>
          </div>
          <button class="qi-remove" data-action="quote-remove" data-code="${escJs(item.code)}" data-name="${escJs(item.name)}">🗑</button>
        </div>`;
      }
      dom.quoteItems.innerHTML = html;
    }

    const total = quoteItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    dom.quoteTotal.textContent = `¥${total.toFixed(2)}`;
  }

  function clearQuote() {
    if (quoteItems.length === 0) return;
    if (confirm('确定清空报价单？')) {
      quoteItems = [];
      saveQuote();
      renderQuote();
      renderProducts();
      updateQuoteBadge();
    }
  }

  // ── Quote Panel Toggle ──

  function toggleQuote() {
    const isOpen = dom.quotePanel.classList.contains('show');
    if (isOpen) { closeQuote(); }
    else {
      dom.quotePanel.classList.add('show');
      dom.quoteOverlay.classList.add('show');
      renderQuote();
    }
  }

  function closeQuote() {
    dom.quotePanel.classList.remove('show');
    dom.quoteOverlay.classList.remove('show');
  }

  // ── Quote Actions ──

  function printQuote() {
    if (quoteItems.length === 0) { alert('报价单是空的'); return; }
    const total = quoteItems.reduce((sum, i) => sum + i.price * i.qty, 0);
    const now = new Date().toLocaleDateString('zh-CN');
    let html = `
      <div style="max-width:700px;margin:0 auto;font-family:sans-serif;">
        <div style="text-align:center;border-bottom:2px solid #1a5276;padding-bottom:16px;margin-bottom:20px;">
          <h1 style="color:#1a5276;margin:0;">杭州西湖生物材料有限公司</h1>
          <p style="color:#666;margin:4px 0;">Hangzhou Xihu Biomaterials Co., Ltd.</p>
          <p style="color:#999;font-size:12px;">报价单 · ${now}</p>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#f0f4f8;">
            <th style="padding:8px;text-align:left;border-bottom:1px solid #ddd;">#</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid #ddd;">编码</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid #ddd;">产品名称</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid #ddd;">规格</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid #ddd;">数量</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid #ddd;">单价(¥)</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid #ddd;">小计(¥)</th>
          </tr></thead><tbody>`;
    quoteItems.forEach((item, i) => {
      html += `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">${i + 1}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-family:monospace;">${escHtml(item.code)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${escHtml(item.baseName)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${escHtml(item.spec || item.unit)}</td>
        <td style="padding:8px;text-align:center;border-bottom:1px solid #eee;">${item.qty}</td>
        <td style="padding:8px;text-align:right;border-bottom:1px solid #eee;">${item.price.toFixed(2)}</td>
        <td style="padding:8px;text-align:right;border-bottom:1px solid #eee;font-weight:bold;">${(item.price * item.qty).toFixed(2)}</td>
      </tr>`;
    });
    html += `</tbody></table>
        <div style="text-align:right;margin-top:20px;font-size:18px;font-weight:bold;">
          合计：¥${total.toFixed(2)}
        </div>
        <div style="margin-top:40px;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:12px;">
          <p>杭州西湖生物材料有限公司 | 杭州钱江经济开发区 | www.xihubiom.com.cn</p>
          <p>ISO 9001 · ISO 13485 · CE · FDA · GMP 认证</p>
        </div>
      </div>`;
    dom.quotePrint.innerHTML = html;
    setTimeout(() => window.print(), 200);
  }

  function copyQuote() {
    if (quoteItems.length === 0) { alert('报价单是空的'); return; }
    const total = quoteItems.reduce((sum, i) => sum + i.price * i.qty, 0);
    let text = '杭州西湖生物材料有限公司 — 报价单\n';
    text += '='.repeat(50) + '\n';
    text += '编码\t产品名称\t规格\t数量\t单价\t小计\n';
    quoteItems.forEach((item) => {
      text += `${item.code}\t${item.baseName}\t${item.spec || item.unit}\t${item.qty}\t${item.price.toFixed(2)}\t${(item.price * item.qty).toFixed(2)}\n`;
    });
    text += '='.repeat(50) + '\n';
    text += `合计：¥${total.toFixed(2)}\n`;
    text += `日期：${new Date().toLocaleDateString('zh-CN')}\n`;
    text += '杭州西湖生物材料有限公司 | www.xihubiom.com.cn';

    navigator.clipboard.writeText(text).then(() => {
      alert('报价单已复制到剪贴板！');
    }).catch(() => {
      alert('复制失败，请手动复制');
    });
  }

  // ── Company Info ──

  function showCompany() {
    const c = DATA.company;
    dom.companyModalInner.innerHTML = `
      <button class="modal-close" data-action="close-modal">✕</button>
      <h2>🏥 ${escHtml(c.name)}</h2>
      <p style="color:var(--text-light);margin-bottom:12px;">${escHtml(c.nameEn)}</p>
      <p>${escHtml(c.description)}</p>
      <p style="margin-top:8px;">📍 成立于 <strong>${c.founded}年</strong>，位于${escHtml(c.location)}，建筑面积${escHtml(c.area)}</p>
      <p>🤝 ${escHtml(c.partners)}</p>
      <p>📦 ${escHtml(c.marketReach)}</p>

      <h3 style="margin-top:20px;">认证资质</h3>
      <div class="cert-list">
        ${c.certifications.map((cert) => `<span class="cert-tag">✅ ${escHtml(cert)}</span>`).join('')}
      </div>
      <p style="margin-top:4px;font-size:12px;color:var(--text-light);">行业早期通过国家医疗器械GMP认证的企业，拥有${escHtml(c.patents)}</p>

      <h3 style="margin-top:20px;">🌟 明星产品</h3>
      <ul class="star-list">
        ${c.starProducts.map((p) => `<li><strong>${escHtml(p)}</strong> — 广受业内好评</li>`).join('')}
      </ul>

      <p style="margin-top:16px;">🌐 <a href="https://${escHtml(c.website)}" target="_blank">${escHtml(c.website)}</a></p>
    `;
    dom.companyModal.classList.add('show');
  }

  function closeCompany(e) {
    if (e && e.target !== dom.companyModal) return;
    dom.companyModal.classList.remove('show');
  }

  // ── Sidebar Mobile Toggle ──

  function toggleSidebar() {
    const isOpen = dom.sidebar.classList.contains('show');
    if (isOpen) { closeSidebar(); }
    else {
      dom.sidebar.classList.add('show');
      dom.sidebarBackdrop.classList.add('show');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeSidebar() {
    dom.sidebar.classList.remove('show');
    dom.sidebarBackdrop.classList.remove('show');
    document.body.style.overflow = '';
  }

  // ── Event Delegation ──

  /** Handle clicks on the sidebar (category selection) */
  dom.sidebar.addEventListener('click', (e) => {
    const item = e.target.closest('.cat-item');
    if (!item) return;
    const cat = item.dataset.cat || '';
    selectCategory(cat || null);
  });

  /** Handle clicks on the product list (add-to-quote, share, fav buttons) */
  dom.productList.addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-action="add-quote"]');
    if (addBtn) {
      addToQuote(addBtn.dataset.code, addBtn.dataset.name);
      return;
    }
    const shareBtn = e.target.closest('[data-action="share-product"]');
    if (shareBtn) {
      shareProduct(shareBtn.dataset.code, shareBtn.dataset.name);
      return;
    }
    const favBtn = e.target.closest('[data-action="toggle-fav"]');
    if (favBtn) {
      toggleFavorite(favBtn.dataset.code, favBtn.dataset.name);
      return;
    }
  });

  /** Handle clicks on the quote panel (qty buttons, remove) */
  dom.quoteItems.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, code, name } = btn.dataset;
    switch (action) {
      case 'qty-inc': updateQty(code, name, 1); break;
      case 'qty-dec': updateQty(code, name, -1); break;
      case 'quote-remove': removeFromQuote(code, name); break;
    }
  });

  /** Handle input changes on qty fields */
  dom.quoteItems.addEventListener('change', (e) => {
    const input = e.target.closest('[data-action="qty-set"]');
    if (!input) return;
    setQty(input.dataset.code, input.dataset.name, input.value);
  });

  /** Handle clicks on the company modal */
  dom.companyModal.addEventListener('click', (e) => {
    if (e.target === dom.companyModal) closeCompany(e);
  });
  dom.companyModalInner.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="close-modal"]');
    if (btn) closeCompany();
  });

  // ── Header button handlers ──
  $('.hamburger').addEventListener('click', toggleSidebar);
  $('#sidebarBackdrop').addEventListener('click', toggleSidebar);
  $('.badge.alt').addEventListener('click', showCompany);
  $('#quoteBadge').addEventListener('click', toggleQuote);
  $('#quoteOverlay').addEventListener('click', toggleQuote);
  $('.quote-close').addEventListener('click', toggleQuote);
  $('.btn-primary').addEventListener('click', printQuote);
  $('.btn-outline').addEventListener('click', copyQuote);
  $('.btn-danger').addEventListener('click', clearQuote);

  // ── Keyboard ──
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeQuote(); closeSidebar(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      dom.searchInput.focus();
    }
  });

  // ── Init ──
  function init() {
    loadQuote();
    loadFavorites();
    mergeAdminChanges();
    renderSidebar();
    renderProducts();
    updateQuoteBadge();

    dom.searchInput.addEventListener('input', debounce(onSearch, 200));

    console.log('🏥 西湖生物材料销售助手已就绪');
    console.log('  ⌘K / Ctrl+K — 聚焦搜索');
    console.log('  ESC — 关闭报价面板');
    console.log(`  ${products.length} 个SKU · ${DATA.categories.length} 个分类`);
  }

  init();
})();
