(function () {
  'use strict';

  var STORAGE_KEY = 'video-list-data-v1';
  var SEED_URL = 'data/videos.yml';
  var STATUSES = ['未視聴', '視聴済み', 'お気に入り'];

  var ENTRIES = [];
  var filtered = [];
  var state = { q: '', group: '', person: '', genre: '', status: '', sort: 'added' };
  var editingId = null;      // 編集中の項目id(新規はnull)
  var currentDetailId = null;
  var deleteArmed = false;
  var pendingImport = null;
  var confirmAction = null;
  var idCounter = 0;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toArr(v) {
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    if (v === null || v === undefined || v === '') return [];
    return [String(v)];
  }

  function splitMulti(s) {
    return String(s || '').split(/[、,]/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  function makeId() {
    idCounter += 1;
    return 'e' + Date.now().toString(36) + '-' + idCounter + '-' + Math.floor(Math.random() * 1e6).toString(36);
  }

  function normalizeEntry(raw) {
    raw = raw || {};
    var name = raw['名前'] !== undefined && raw['名前'] !== null ? String(raw['名前']).trim() : '';
    if (!name) name = '(無題)';
    var st = String(raw['ステータス'] || '').trim();
    if (!st) st = '未視聴';
    return {
      _id: raw._id ? String(raw._id) : makeId(),
      名前: name,
      出演者: toArr(raw['出演者']),
      グループ: toArr(raw['グループ']),
      個人: toArr(raw['個人']),
      ジャンル: toArr(raw['ジャンル']),
      画質: toArr(raw['画質']),
      メモ: String(raw['メモ'] || ''),
      動画URL: String(raw['動画URL'] || ''),
      ステータス: st,
      タグ: toArr(raw['タグ'])
    };
  }

  /* ---------- localStorage ---------- */
  function storageGet() { try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; } }
  function storageSet(v) { try { localStorage.setItem(STORAGE_KEY, v); return true; } catch (e) { return false; } }
  function storageRemove() { try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ } }

  function save() {
    if (!storageSet(JSON.stringify(ENTRIES))) {
      toast('ブラウザに保存できませんでした(この環境ではデータが残りません)');
    }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------- プルダウン・候補 ---------- */
  function uniqSorted(values) {
    var seen = {}, out = [];
    values.forEach(function (v) { if (v && !seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort(function (a, b) { return a.localeCompare(b, 'ja'); });
  }

  function fillDatalist(id, values) {
    var dl = $(id);
    dl.innerHTML = '';
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      dl.appendChild(o);
    });
  }

  function fillSelect(sel, values, label) {
    var cur = sel.value;
    sel.innerHTML = '';
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = label;
    sel.appendChild(opt);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
    if (cur && values.indexOf(cur) !== -1) sel.value = cur;
  }

  function refreshSelects() {
    fillSelect($('filter-group'), uniqSorted(ENTRIES.reduce(function (a, e) { return a.concat(e.グループ); }, [])), 'すべて');
    fillSelect($('filter-person'), uniqSorted(ENTRIES.reduce(function (a, e) { return a.concat(e.個人); }, [])), 'すべて');
    fillSelect($('filter-genre'), uniqSorted(ENTRIES.reduce(function (a, e) { return a.concat(e.ジャンル); }, [])), 'すべて');
    fillDatalist('dl-cast', uniqSorted(ENTRIES.reduce(function (a, e) { return a.concat(e.出演者); }, [])));
    fillDatalist('dl-group', uniqSorted(ENTRIES.reduce(function (a, e) { return a.concat(e.グループ); }, [])));
    fillDatalist('dl-person', uniqSorted(ENTRIES.reduce(function (a, e) { return a.concat(e.個人); }, [])));
    fillDatalist('dl-genre', uniqSorted(ENTRIES.reduce(function (a, e) { return a.concat(e.ジャンル); }, [])));
    fillDatalist('dl-quality', uniqSorted(ENTRIES.reduce(function (a, e) { return a.concat(e.画質); }, [])));
    fillDatalist('dl-tags', uniqSorted(ENTRIES.reduce(function (a, e) { return a.concat(e.タグ); }, [])));
  }

  function fillStatusSelect() {
    var sel = $('f-status');
    sel.innerHTML = '';
    STATUSES.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      sel.appendChild(o);
    });
  }

  /* ---------- 絞り込み・描画 ---------- */
  function matches(e) {
    var q = state.q.trim().toLowerCase();
    if (q) {
      var hay = [e.名前, e.メモ, e.ステータス]
        .concat(e.出演者, e.グループ, e.個人, e.ジャンル, e.画質, e.タグ)
        .join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (state.group && e.グループ.indexOf(state.group) === -1) return false;
    if (state.person && e.個人.indexOf(state.person) === -1) return false;
    if (state.genre && e.ジャンル.indexOf(state.genre) === -1) return false;
    if (state.status && e.ステータス !== state.status) return false;
    return true;
  }

  function badge(status) {
    return '<span class="badge" data-status="' + esc(status) + '">' + esc(status) + '</span>';
  }

  function render() {
    var tbody = $('tbody');
    var html = '';
    var cardHtml = '';

    filtered.forEach(function (e) {
      var cast = e.出演者.length ? e.出演者.join(' / ') : (e.グループ.length ? e.グループ.join(' / ') : '—');
      html += '<tr data-id="' + esc(e._id) + '">'
        + '<td class="cell-name">' + esc(e.名前) + '</td>'
        + '<td>' + esc(cast) + '</td>'
        + '<td>' + esc(e.グループ.join(' / ') || '—') + '</td>'
        + '<td>' + esc(e.ジャンル.join(' / ') || '—') + '</td>'
        + '<td class="cell-status">' + badge(e.ステータス) + '</td>'
        + '<td class="cell-quality">' + esc(e.画質.join(', ') || '—') + '</td>'
        + '<td class="cell-memo">' + esc(e.メモ || '—') + '</td>'
        + '</tr>';

      cardHtml += '<article class="card" data-id="' + esc(e._id) + '">'
        + '<h3>' + esc(e.名前) + ' ' + badge(e.ステータス) + '</h3>'
        + '<p class="card-line">' + esc(cast) + '</p>'
        + '<p class="card-meta">' + esc(e.ジャンル.join(' / ') || '—')
        + (e.画質.length ? ' ・ ' + esc(e.画質.join(', ')) : '') + '</p>'
        + (e.メモ ? '<p class="card-memo">' + esc(e.メモ) + '</p>' : '')
        + '</article>';
    });

    tbody.innerHTML = html;
    $('cards').innerHTML = cardHtml;
    $('count').textContent = '全' + ENTRIES.length + '件中 ' + filtered.length + '件を表示';
    var has = ENTRIES.length > 0 && filtered.length === 0;
    $('empty').hidden = !has;
  }

  function apply() {
    filtered = ENTRIES.filter(matches);
    if (state.sort === 'name') {
      filtered = filtered.slice().sort(function (a, b) { return a.名前.localeCompare(b.名前, 'ja'); });
    }
    render();
  }

  function findById(id) {
    for (var i = 0; i < ENTRIES.length; i++) if (ENTRIES[i]._id === id) return ENTRIES[i];
    return null;
  }

  /* ---------- 詳細モーダル ---------- */
  function openDetail(id) {
    var e = findById(id);
    if (!e) return;
    currentDetailId = id;
    deleteArmed = false;
    $('btn-delete').textContent = '削除';
    $('btn-delete').classList.remove('armed');

    function chips(values) {
      return values.map(function (v) { return '<span class="chip">' + esc(v) + '</span>'; }).join('');
    }
    function field(label, value) {
      if (value === '' || value === '—') return '';
      return '<div class="field"><dt>' + label + '</dt><dd>' + value + '</dd></div>';
    }
    var url = e.動画URL ? '<a href="' + esc(e.動画URL) + '" target="_blank" rel="noopener" class="btn-video">動画を開く ↗</a>' : '';

    $('modal-body').innerHTML =
      '<h2>' + esc(e.名前) + '</h2>'
      + '<dl>'
      + field('ステータス', badge(e.ステータス))
      + field('出演者', chips(e.出演者))
      + field('グループ', chips(e.グループ))
      + field('個人', chips(e.個人))
      + field('ジャンル', chips(e.ジャンル))
      + field('画質', chips(e.画質))
      + field('タグ', chips(e.タグ))
      + field('メモ', esc(e.メモ))
      + '</dl>' + url;
    $('modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function anyModalOpen() {
    return !$('modal').hidden || !$('form-modal').hidden || !$('confirm-modal').hidden;
  }

  function closeDetail() {
    $('modal').hidden = true;
    if (!anyModalOpen()) document.body.style.overflow = '';
  }

  /* ---------- 追加・編集フォーム ---------- */
  function openForm(entry) {
    editingId = entry ? entry._id : null;
    $('form-title').textContent = entry ? '項目を編集' : '項目を追加';
    $('f-name').value = entry ? entry.名前 : '';
    $('f-name').classList.remove('error');
    $('f-cast').value = entry ? entry.出演者.join(', ') : '';
    $('f-group').value = entry ? entry.グループ.join(', ') : '';
    $('f-person').value = entry ? entry.個人.join(', ') : '';
    $('f-genre').value = entry ? entry.ジャンル.join(', ') : '';
    $('f-quality').value = entry ? entry.画質.join(', ') : '';
    $('f-tags').value = entry ? entry.タグ.join(', ') : '';
    $('f-url').value = entry ? entry.動画URL : '';
    $('f-memo').value = entry ? entry.メモ : '';
    var st = entry ? entry.ステータス : '未視聴';
    var sel = $('f-status');
    if (STATUSES.indexOf(st) === -1 && !sel.querySelector('option[value="' + st.replace(/"/g, '\\"') + '"]')) {
      var o = document.createElement('option');
      o.value = st;
      o.textContent = st;
      sel.appendChild(o);
    }
    sel.value = st;
    closeDetail();
    $('form-modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeForm() {
    $('form-modal').hidden = true;
    if (!anyModalOpen()) document.body.style.overflow = '';
  }

  function submitForm() {
    var name = $('f-name').value.trim();
    if (!name) {
      $('f-name').classList.add('error');
      $('f-name').focus();
      toast('名前を入力してください');
      return;
    }
    var entry = {
      名前: name,
      出演者: splitMulti($('f-cast').value),
      グループ: splitMulti($('f-group').value),
      個人: splitMulti($('f-person').value),
      ジャンル: splitMulti($('f-genre').value),
      画質: splitMulti($('f-quality').value),
      メモ: $('f-memo').value.trim(),
      動画URL: $('f-url').value.trim(),
      ステータス: $('f-status').value || '未視聴',
      タグ: splitMulti($('f-tags').value)
    };
    if (editingId) {
      entry._id = editingId;
      ENTRIES = ENTRIES.map(function (e) { return e._id === editingId ? normalizeEntry(entry) : e; });
      toast('更新しました');
    } else {
      ENTRIES.push(normalizeEntry(entry));
      toast('追加しました');
    }
    save();
    refreshSelects();
    apply();
    closeForm();
  }

  /* ---------- 削除(2段階) ---------- */
  function onDeleteClick() {
    if (!currentDetailId) return;
    if (!deleteArmed) {
      deleteArmed = true;
      $('btn-delete').textContent = 'もう一度押すと削除されます';
      $('btn-delete').classList.add('armed');
      return;
    }
    ENTRIES = ENTRIES.filter(function (e) { return e._id !== currentDetailId; });
    save();
    refreshSelects();
    apply();
    closeDetail();
    toast('削除しました');
  }

  /* ---------- 確認モーダル ---------- */
  function showConfirm(text, fn) {
    $('confirm-text').textContent = text;
    confirmAction = fn;
    $('confirm-modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeConfirm() {
    $('confirm-modal').hidden = true;
    confirmAction = null;
    if (!anyModalOpen()) document.body.style.overflow = '';
  }

  /* ---------- 書き出し・読み込み ---------- */
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); }, 500);
  }

  function exportJSON() {
    var d = new Date();
    var stamp = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    download('video-list-backup-' + stamp + '.json', JSON.stringify(ENTRIES, null, 2), 'application/json');
    toast('JSONを書き出しました');
  }

  function exportYAML() {
    var plain = ENTRIES.map(function (e) {
      return {
        名前: e.名前, 出演者: e.出演者, グループ: e.グループ, 個人: e.個人,
        ジャンル: e.ジャンル, 画質: e.画質, メモ: e.メモ, 動画URL: e.動画URL,
        ステータス: e.ステータス, タグ: e.タグ
      };
    });
    download('videos.yml', jsyaml.dump(plain, { lineWidth: 300 }), 'text/yaml');
    toast('YAMLを書き出しました');
  }

  /* ---------- イベント ---------- */
  function wire() {
    $('q').addEventListener('input', function () { state.q = this.value; apply(); });
    $('filter-group').addEventListener('change', function () { state.group = this.value; apply(); });
    $('filter-person').addEventListener('change', function () { state.person = this.value; apply(); });
    $('filter-genre').addEventListener('change', function () { state.genre = this.value; apply(); });
    $('filter-status').addEventListener('change', function () { state.status = this.value; apply(); });
    $('sort').addEventListener('change', function () { state.sort = this.value; apply(); });
    $('reset').addEventListener('click', function () {
      state = { q: '', group: '', person: '', genre: '', status: '', sort: 'added' };
      $('q').value = '';
      $('filter-group').value = '';
      $('filter-person').value = '';
      $('filter-genre').value = '';
      $('filter-status').value = '';
      $('sort').value = 'added';
      apply();
    });

    $('btn-add').addEventListener('click', function () { openForm(null); });
    $('entry-form').addEventListener('submit', function (ev) { ev.preventDefault(); submitForm(); });
    $('form-cancel').addEventListener('click', closeForm);

    $('btn-export-json').addEventListener('click', exportJSON);
    $('btn-export-yaml').addEventListener('click', exportYAML);
    $('btn-import').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var text = String(reader.result);
          var raw;
          if (/\.ya?ml$/i.test(file.name)) raw = jsyaml.load(text);
          else raw = JSON.parse(text);
          if (!Array.isArray(raw)) throw new Error('配列形式のファイルを指定してください');
          pendingImport = raw.map(normalizeEntry);
          showConfirm(pendingImport.length + '件のデータを読み込み、現在の一覧と入れ替えます。よろしいですか？', function () {
            ENTRIES = pendingImport;
            pendingImport = null;
            save();
            refreshSelects();
            apply();
            toast('読み込みました');
          });
        } catch (err) {
          toast('読み込みに失敗しました: ' + err.message);
        }
      };
      reader.readAsText(file);
    });

    $('btn-edit').addEventListener('click', function () {
      var e = findById(currentDetailId);
      if (e) openForm(e);
    });
    $('btn-delete').addEventListener('click', onDeleteClick);

    $('btn-reset-data').addEventListener('click', function () {
      showConfirm('すべての変更を破棄して、初期データ(videos.yml)の状態に戻します。よろしいですか？', function () {
        storageRemove();
        loadSeed(false);
        toast('初期データに戻しました');
      });
    });

    $('confirm-ok').addEventListener('click', function () {
      var fn = confirmAction;
      closeConfirm();
      if (fn) fn();
    });
    $('confirm-cancel').addEventListener('click', closeConfirm);

    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var row = t.closest('tr[data-id], article.card');
      if (row) { openDetail(row.getAttribute('data-id')); return; }
      var closer = t.getAttribute ? t.getAttribute('data-close') : null;
      if (closer === 'detail') closeDetail();
      else if (closer === 'form') closeForm();
      else if (closer === 'confirm') closeConfirm();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (!$('form-modal').hidden) closeForm();
      else if (!$('confirm-modal').hidden) closeConfirm();
      else if (!$('modal').hidden) closeDetail();
    });
  }

  /* ---------- データ読み込み ---------- */
  function afterLoad() {
    $('loading').hidden = true;
    $('tableWrap').hidden = false;
    $('cards').hidden = false;
    refreshSelects();
    apply();
  }

  function loadSeed(saveAfter) {
    return fetch(SEED_URL + '?_=' + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error('data/videos.yml が見つかりません(HTTP ' + res.status + ')');
        return res.text();
      })
      .then(function (text) {
        var raw = jsyaml.load(text);
        if (!Array.isArray(raw)) throw new Error('データ形式が不正です(先頭は「- 名前:」のリストにしてください)');
        ENTRIES = raw.map(normalizeEntry);
        if (saveAfter) save();
        afterLoad();
      })
      .catch(function (err) {
        $('loading').hidden = true;
        $('tableWrap').hidden = true;
        $('cards').hidden = true;
        var el = $('error');
        el.hidden = false;
        el.textContent = 'データを読み込めませんでした: ' + err.message
          + ' ― GitHub Pages上で開くか、YAMLのインデントを確認してください。';
      });
  }

  function loadData() {
    var stored = storageGet();
    if (stored !== null) {
      try {
        var arr = JSON.parse(stored);
        if (Array.isArray(arr)) {
          ENTRIES = arr.map(normalizeEntry);
          afterLoad();
          return;
        }
      } catch (e) { /* 壊れていたら初期データから読み直す */ }
    }
    loadSeed(false);
  }

  wire();
  fillStatusSelect();
  if (typeof jsyaml === 'undefined') {
    $('loading').hidden = true;
    var el = $('error');
    el.hidden = false;
    el.textContent = 'YAML解析ライブラリ(js-yaml)の読み込みに失敗しました。ネットワーク接続を確認してください。';
  } else {
    loadData();
  }
})();
