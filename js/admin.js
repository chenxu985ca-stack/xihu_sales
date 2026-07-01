/**
 * 西湖生物材料 — 后台管理面板
 * Admin CRUD for the product catalog
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── Constants ──
  const PAGE_SIZE = 50;
  const STORAGE_KEY = 'xihu_admin_changes';
  const PWD_KEY = 'xihu_admin_pwd';
  const SESSION_KEY = 'xihu_admin_session';
  const DEFAULT_PWD = 'admin123';

  // ── State ──
  let products = [];          // merged product list
  let baseProducts = [];      // original from data.js
  let categories = [];
  let changes = { added: [], deleted: [], edited: {} };
  let currentPage = 1;
  let searchQuery = '';
  let categoryFilter = '';
  let editingCode = null;     // code of product being edited (null = adding new)
  let editingName = null;     // name of product being edited
  let deleteTarget = null;

  // ── Auth ──

  function getPassword() {
    return localStorage.getItem(PWD_KEY) || DEFAULT_PWD;
  }

  function isLoggedIn() {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  }

  function login(pwd) {
    if (pwd === getPassword()) {
      sessionStorage.setItem(SESSION_KEY, '1');
      showApp();
    } else {
      $('#loginMsg').textContent = '密码错误，请重试';
      $('#loginPwd').value = '';
      $('#loginPwd').focus();
    }
  }

  function showApp() {
    $('#loginOverlay').style.display = 'none';
    $('#adminApp').style.display = 'flex';
    initApp();
  }

  // ── Helpers ──

  function escHtml(s) {
    if (!s) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return String(s).replace(/[&<>"]/g, (c) => map[c]);
  }

  function parsePrice(p) {
    if (typeof p === 'number') return p;
    if (typeof p === 'string') {
      const m = p.match(/[\d.]+/);
      if (m) return parseFloat(m[0]);
    }
    return 0;
  }

  function formatPrice(p) {
    if (typeof p === 'number') return p.toFixed(2);
    return String(p);
  }

  // ── Data Management ──

  function loadChanges() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) changes = JSON.parse(raw);
    } catch (e) { changes = { added: [], deleted: [], edited: {} }; }
    // Ensure structure
    if (!changes.added) changes.added = [];
    if (!changes.deleted) changes.deleted = [];
    if (!changes.edited) changes.edited = {};
  }

  function saveChanges() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changes));
    mergeProducts();
    updateStats();
    renderTable();
  }

  function mergeProducts() {
    // Start from base
    let merged = [...baseProducts];

    // Remove deleted (match by code + name)
    if (changes.deleted.length > 0) {
      merged = merged.filter(p => {
        return !changes.deleted.some(d => d.code === p.code && d.name === p.name);
      });
    }

    // Apply edits
    Object.keys(changes.edited).forEach(code => {
      Object.keys(changes.edited[code]).forEach(name => {
        const idx = merged.findIndex(p => p.code === code && p.name === name);
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], ...changes.edited[code][name] };
        }
      });
    });

    // Append added
    if (changes.added.length > 0) {
      merged = merged.concat(changes.added);
    }

    products = merged;
    categories = [...new Set(products.map(p => p.category))].sort();
  }

  /** Check if a product was added by admin */
  function isAddedProduct(code, name) {
    return changes.added.some(p => p.code === code && p.name === name);
  }

  /** Check if a product was edited by admin */
  function isEditedProduct(code, name) {
    return changes.edited[code] && changes.edited[code][name];
  }

  /** Get the effective product data (with edits applied) */
  function getEffective(code, name) {
    const p = products.find(x => x.code === code && x.name === name);
    return p || null;
  }

  // ── Stats ──

  function updateStats() {
    $('#statTotal').textContent = products.length;
    $('#statAdded').textContent = changes.added.length;
    const editCount = Object.keys(changes.edited).reduce((sum, code) => {
      return sum + Object.keys(changes.edited[code]).length;
    }, 0);
    $('#statEdited').textContent = editCount;
    $('#statDeleted').textContent = changes.deleted.length;
  }

  // ── Render ──

  function getFilteredProducts() {
    let filtered = products;
    if (categoryFilter) {
      filtered = filtered.filter(p => p.category === categoryFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.code && p.code.toLowerCase().includes(q)) ||
        p.category.toLowerCase().includes(q) ||
        (p.spec && p.spec.toLowerCase().includes(q)) ||
        (p.baseName && p.baseName.toLowerCase().includes(q))
      );
    }
    return filtered;
  }

  function renderTable() {
    const filtered = getFilteredProducts();
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = Math.max(1, totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const page = filtered.slice(start, start + PAGE_SIZE);

    let html = '';
    for (const p of page) {
      const added = isAddedProduct(p.code, p.name);
      const edited = isEditedProduct(p.code, p.name);
      const rowClass = added ? 'row-added' : (edited ? 'row-edited' : '');
      const nameDisplay = p.code ? escHtml(p.name) : escHtml(p.name);
      const priceDisplay = formatPrice(p.price);

      html += `<tr class="${rowClass}">
        <td class="td-code">${escHtml(p.code || '—')}</td>
        <td class="td-name">${nameDisplay}${added ? ' <span class="tag-new">NEW</span>' : ''}${edited ? ' <span class="tag-edit">已改</span>' : ''}</td>
        <td>${escHtml(p.category)}</td>
        <td>${escHtml(p.spec || '—')}</td>
        <td>${escHtml(p.unit || '—')}</td>
        <td class="td-price">${priceDisplay}</td>
        <td>${escHtml(p.note || '')}</td>
        <td class="td-actions">
          <button class="btn-sm btn-edit" data-action="edit" data-code="${escHtml(p.code)}" data-name="${escHtml(p.name)}">✏️</button>
          <button class="btn-sm btn-del" data-action="delete" data-code="${escHtml(p.code)}" data-name="${escHtml(p.name)}">🗑</button>
        </td>
      </tr>`;
    }

    if (filtered.length === 0) {
      html = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-light);">
        没有匹配的产品
      </td></tr>`;
    }

    $('#adminTableBody').innerHTML = html;

    // Pagination
    let pagHtml = '';
    if (totalPages > 1) {
      pagHtml += `<span>共 ${filtered.length} 条 / ${totalPages} 页</span>`;
      pagHtml += `<button class="btn-sm" data-page="1" ${currentPage === 1 ? 'disabled' : ''}>««</button>`;
      pagHtml += `<button class="btn-sm" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>«</button>`;
      pagHtml += `<span>${currentPage} / ${totalPages}</span>`;
      pagHtml += `<button class="btn-sm" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>»</button>`;
      pagHtml += `<button class="btn-sm" data-page="${totalPages}" ${currentPage === totalPages ? 'disabled' : ''}>»»</button>`;
    } else if (filtered.length > 0) {
      pagHtml += `<span>共 ${filtered.length} 条</span>`;
    }
    $('#adminPagination').innerHTML = pagHtml;

    // Update category filter dropdown
    const catSelect = $('#adminCategoryFilter');
    const currentVal = catSelect.value;
    const allCats = [...new Set(products.map(p => p.category))].sort();
    catSelect.innerHTML = '<option value="">📂 全部分类</option>' +
      allCats.map(c => `<option value="${escHtml(c)}" ${c === currentVal ? 'selected' : ''}>${escHtml(c)}</option>`).join('');

    // Update form datalist
    $('#categoryList').innerHTML = allCats.map(c => `<option value="${escHtml(c)}">`).join('');
  }

  // ── Form Modal ──

  function openAddForm() {
    editingCode = null;
    editingName = null;
    $('#formModalTitle').textContent = '➕ 新增产品';
    $('#fCode').value = '';
    $('#fName').value = '';
    $('#fCategory').value = '';
    $('#fUnit').value = '';
    $('#fPrice').value = '';
    $('#fSpec').value = '';
    $('#fBaseName').value = '';
    $('#fNote').value = '';
    $('#fCode').disabled = false;
    $('#formModal').classList.add('show');
    $('#fName').focus();
  }

  function openEditForm(code, name) {
    const p = getEffective(code, name);
    if (!p) return;
    editingCode = code;
    editingName = name;
    $('#formModalTitle').textContent = '✏️ 编辑产品';
    $('#fCode').value = p.code || '';
    $('#fName').value = p.name || '';
    $('#fCategory').value = p.category || '';
    $('#fUnit').value = p.unit || '';
    $('#fPrice').value = typeof p.price === 'number' ? p.price.toFixed(2) : String(p.price);
    $('#fSpec').value = p.spec || '';
    $('#fBaseName').value = p.baseName || '';
    $('#fNote').value = p.note || '';
    $('#formModal').classList.add('show');
    $('#fName').focus();
  }

  function closeForm() {
    $('#formModal').classList.remove('show');
    editingCode = null;
    editingName = null;
  }

  function saveForm() {
    const code = $('#fCode').value.trim();
    const name = $('#fName').value.trim();
    const category = $('#fCategory').value.trim();
    const unit = $('#fUnit').value.trim();
    const priceRaw = $('#fPrice').value.trim();
    const spec = $('#fSpec').value.trim();
    const baseName = $('#fBaseName').value.trim();
    const note = $('#fNote').value.trim();

    // Validation
    if (!code) { alert('请输入产品编码'); return; }
    if (!name) { alert('请输入产品名称'); return; }
    if (!category) { alert('请输入分类'); return; }
    if (!unit) { alert('请输入单位'); return; }
    if (!priceRaw) { alert('请输入价格'); return; }

    const priceNum = parseFloat(priceRaw);
    if (isNaN(priceNum) || priceNum < 0) { alert('价格格式不正确'); return; }

    // Determine if price should be number or string
    const price = /^[\d.]+$/.test(priceRaw) ? parseFloat(priceRaw) : priceRaw;

    const product = {
      code: code,
      name: name,
      category: category,
      unit: unit,
      price: price,
      spec: spec,
      baseName: baseName || name,
      note: note
    };

    if (editingCode) {
      // Check duplicate if code changed
      if (code !== editingCode || name !== editingName) {
        const dup = products.find(p => p.code === code && p.name === name);
        if (dup) { alert('该编码和名称的产品已存在！'); return; }
      }

      if (isAddedProduct(editingCode, editingName)) {
        // Editing an added product — update in-place
        const idx = changes.added.findIndex(p => p.code === editingCode && p.name === editingName);
        if (idx >= 0) {
          changes.added[idx] = product;
        }
      } else if (code !== editingCode) {
        // Base product code changed — delete old, add as new
        if (!changes.deleted.some(d => d.code === editingCode && d.name === editingName)) {
          changes.deleted.push({ code: editingCode, name: editingName });
        }
        // Also clean up any existing edits for the old code
        if (changes.edited[editingCode]) {
          delete changes.edited[editingCode][editingName];
          if (Object.keys(changes.edited[editingCode]).length === 0) {
            delete changes.edited[editingCode];
          }
        }
        changes.added.push(product);
      } else {
        // Editing a base product (same code) — record in edited
        if (!changes.edited[code]) changes.edited[code] = {};
        changes.edited[code][name] = product;
      }
    } else {
      // Adding new
      // Check for duplicate
      const dup = products.find(p => p.code === code && p.name === name);
      if (dup) { alert('该编码和名称的产品已存在！'); return; }
      changes.added.push(product);
    }

    saveChanges();
    closeForm();
  }

  // ── Delete Modal ──

  function openDeleteConfirm(code, name) {
    deleteTarget = { code, name };
    const p = getEffective(code, name);
    $('#deleteTarget').textContent = p ? `[${p.code}] ${p.name}` : `${code} — ${name}`;
    $('#deleteModal').classList.add('show');
  }

  function closeDeleteConfirm() {
    $('#deleteModal').classList.remove('show');
    deleteTarget = null;
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const { code, name } = deleteTarget;

    if (isAddedProduct(code, name)) {
      // Remove from added list
      changes.added = changes.added.filter(p => !(p.code === code && p.name === name));
    } else {
      // Add to deleted list (if not already there)
      if (!changes.deleted.some(d => d.code === code && d.name === name)) {
        // Also remove any edits for this product
        if (changes.edited[code]) {
          delete changes.edited[code][name];
          if (Object.keys(changes.edited[code]).length === 0) {
            delete changes.edited[code];
          }
        }
        changes.deleted.push({ code, name });
      }
    }

    saveChanges();
    closeDeleteConfirm();
  }

  // ── Reset ──

  function resetChanges() {
    if (!confirm('确定要重置所有变更吗？\n\n这将清除所有新增、修改和删除记录，恢复为原始数据。\n此操作不可撤销。')) return;
    changes = { added: [], deleted: [], edited: {} };
    saveChanges();
    currentPage = 1;
    searchQuery = '';
    categoryFilter = '';
    $('#adminSearch').value = '';
    $('#adminCategoryFilter').value = '';
    alert('✅ 已重置为原始数据');
  }

  // ── Export / Import ──

  function exportJSON() {
    const data = {
      exportedAt: new Date().toISOString(),
      totalProducts: products.length,
      baseProductCount: baseProducts.length,
      changes: changes,
      products: products
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xihu_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.changes) {
          alert('无效的备份文件：缺少 changes 字段');
          return;
        }
        if (!confirm(
          `即将导入备份数据：\n` +
          `- 新增 ${data.changes.added?.length || 0} 个产品\n` +
          `- 删除 ${data.changes.deleted?.length || 0} 个产品\n` +
          `- 修改 ${Object.keys(data.changes.edited || {}).length} 个产品\n\n` +
          `当前变更将被替换，确认继续？`
        )) return;

        changes = {
          added: data.changes.added || [],
          deleted: data.changes.deleted || [],
          edited: data.changes.edited || {}
        };
        saveChanges();
        currentPage = 1;
        alert('✅ 导入成功');
      } catch (err) {
        alert('文件格式错误，无法解析');
      }
    };
    reader.readAsText(file);
  }

  // ── Search ──

  function onSearch() {
    searchQuery = $('#adminSearch').value.trim().toLowerCase();
    currentPage = 1;
    renderTable();
  }

  function onCategoryFilter() {
    categoryFilter = $('#adminCategoryFilter').value;
    currentPage = 1;
    renderTable();
  }

  // ── Init ──

  function initApp() {
    if (!window.XIHU_DATA) {
      alert('数据加载失败，请刷新页面');
      return;
    }

    baseProducts = [...window.XIHU_DATA.products];
    loadChanges();
    mergeProducts();
    updateStats();
    renderTable();

    // Populate category filter
    const allCats = [...new Set(products.map(p => p.category))].sort();
    $('#adminCategoryFilter').innerHTML = '<option value="">📂 全部分类</option>' +
      allCats.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    $('#categoryList').innerHTML = allCats.map(c => `<option value="${escHtml(c)}">`).join('');
  }

  // ── Event Bindings ──

  // Login
  $('#loginBtn').addEventListener('click', () => login($('#loginPwd').value));
  $('#loginPwd').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login($('#loginPwd').value);
  });

  // Check if already logged in
  if (isLoggedIn()) {
    showApp();
  }

  // Add product
  $('#btnAdd').addEventListener('click', openAddForm);

  // Form modal
  $('#btnFormClose').addEventListener('click', closeForm);
  $('#btnFormCancel').addEventListener('click', closeForm);
  $('#btnFormSave').addEventListener('click', saveForm);
  $('#formModal').addEventListener('click', (e) => {
    if (e.target === $('#formModal')) closeForm();
  });

  // Form keyboard submit
  $('#formModalInner').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      saveForm();
    }
    if (e.key === 'Escape') closeForm();
  });

  // Delete modal
  $('#btnDeleteClose').addEventListener('click', closeDeleteConfirm);
  $('#btnDeleteCancel').addEventListener('click', closeDeleteConfirm);
  $('#btnDeleteConfirm').addEventListener('click', confirmDelete);
  $('#deleteModal').addEventListener('click', (e) => {
    if (e.target === $('#deleteModal')) closeDeleteConfirm();
  });

  // Table actions (delegation)
  $('#adminTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, code, name } = btn.dataset;
    if (action === 'edit') openEditForm(code, name);
    if (action === 'delete') openDeleteConfirm(code, name);
  });

  // Pagination
  $('#adminPagination').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    currentPage = parseInt(btn.dataset.page);
    renderTable();
    document.querySelector('.admin-table-wrap').scrollTop = 0;
  });

  // Search
  let searchTimer;
  $('#adminSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(onSearch, 200);
  });

  // Category filter
  $('#adminCategoryFilter').addEventListener('change', onCategoryFilter);

  // Export
  $('#btnExport').addEventListener('click', exportJSON);

  // Import
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });

  // Reset
  $('#btnReset').addEventListener('click', resetChanges);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      $('#adminSearch').focus();
    }
    if (e.key === 'Escape') {
      closeForm();
      closeDeleteConfirm();
    }
  });

  console.log('⚙️ 西湖生物材料管理后台已就绪');
})();
