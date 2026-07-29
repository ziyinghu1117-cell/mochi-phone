/**
 * Mochi Settings & Profile Module
 * Self-contained IIFE -> window.MochiSettings
 *
 * Depends on (existing globals):
 *   window.MochiCore.api   -> { get, post, put, del } (NOTE: each prepends "/api")
 *   window.MochiCore.store -> localStorage wrapper
 *   window.MochiCore.toast / window.toast(msg)
 *   window.MochiCore.escapeHtml(text)
 *   window.state           -> { user:{nickname,bio,avatar,relations}, roles:[...] }
 *   window.persist()       -> save state
 *   window.renderProfile() -> re-render profile
 *   window.avatarOf(name, image)
 *   window.activeRole()    -> { id, name, avatar, prompt, ... }
 *
 * Because MochiCore.api already prepends "/api", route args are passed WITHOUT
 * the "/api" prefix (e.g. api().get('/chat-settings') -> GET /api/chat-settings).
 *
 * Server responses are enveloped as { code, message, data }; this module unwraps
 * .data automatically and falls back gracefully if the envelope is absent.
 */
(function () {
  'use strict';

  var PINK = '#FF6B9D';
  var PINK_LIGHT = '#FFB6C1';
  var PINK_DARK = '#E55388';

  var settingsCache = null;
  var settingsPromise = null;
  var albumCache = null;
  var stylesInjected = false;

  var LANG_OPTIONS = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文 (Chinese)' },
    { value: 'ja', label: '日本語 (Japanese)' },
    { value: 'ko', label: '한국어 (Korean)' },
    { value: 'es', label: 'Español (Spanish)' },
    { value: 'fr', label: 'Français (French)' },
    { value: 'de', label: 'Deutsch (German)' },
    { value: 'pt', label: 'Português (Portuguese)' },
    { value: 'ru', label: 'Русский (Russian)' },
    { value: 'ar', label: 'العربية (Arabic)' }
  ];

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function api() { return window.MochiCore && window.MochiCore.api; }

  function toast(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
    else if (window.MochiCore && window.MochiCore.toast) window.MochiCore.toast(msg);
  }

  // Unwrap { code, message, data } envelope; throw on non-zero code.
  function unwrap(resp) {
    if (resp && typeof resp === 'object' && 'code' in resp && 'data' in resp) {
      if (resp.code !== 0) {
        var err = new Error(resp.message || 'Request failed');
        err.code = resp.code;
        throw err;
      }
      return resp.data;
    }
    return resp;
  }

  function findRole(roleId) {
    var roles = (window.state && window.state.roles) || [];
    for (var i = 0; i < roles.length; i++) {
      if (roles[i] && roles[i].id === roleId) return roles[i];
    }
    return null;
  }

  function avatarUrl(name, image) {
    if (image) return image;
    return typeof window.avatarOf === 'function' ? window.avatarOf(name || 'AI', '') : '';
  }

  /* ------------------------------------------------------------------ *
   * Styles (CSS-in-JS, pink theme)
   * ------------------------------------------------------------------ */
  function injectStyles() {
    if (stylesInjected) return;
    var css = [
      '.mochi-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;',
      'justify-content:center;background:rgba(0,0,0,.5);opacity:0;transition:opacity .2s}',
      '.mochi-overlay.show{opacity:1}',
      '.mochi-modal{background:#fff;border-radius:16px;padding:22px;width:90%;max-width:480px;',
      'max-height:85vh;overflow-y:auto;box-shadow:0 12px 40px rgba(255,107,157,.35);',
      'transform:scale(.92);transition:transform .2s;font-family:inherit}',
      '.mochi-overlay.show .mochi-modal{transform:scale(1)}',
      '.mochi-modal h2{margin:0 0 16px;font-size:19px;color:' + PINK + ';display:flex;',
      'align-items:center;justify-content:space-between}',
      '.mochi-close{cursor:pointer;font-size:24px;line-height:1;color:#bbb;background:none;',
      'border:none;padding:0 4px}',
      '.mochi-close:hover{color:' + PINK + '}',
      '.mochi-field{margin-bottom:14px}',
      '.mochi-field>label{display:block;font-size:12.5px;color:#777;margin-bottom:5px;font-weight:600}',
      '.mochi-field input[type=text],.mochi-field input[type=number],.mochi-field textarea,',
      '.mochi-field select{width:100%;padding:9px 12px;border:1.5px solid #eee;border-radius:10px;',
      'font-size:14px;box-sizing:border-box;outline:none;font-family:inherit;transition:border-color .2s}',
      '.mochi-field input:focus,.mochi-field textarea:focus,.mochi-field select:focus{border-color:' + PINK + '}',
      '.mochi-field textarea{resize:vertical;min-height:72px}',
      '.mochi-hint{font-size:11px;color:#aaa;margin-top:4px}',
      '.mochi-toggle-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0}',
      '.mochi-toggle-row>label{margin:0;font-size:14px;color:#333;font-weight:600}',
      '.mochi-switch{position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;flex-shrink:0}',
      '.mochi-switch input{opacity:0;width:0;height:0}',
      '.mochi-slider{position:absolute;inset:0;background:#ddd;border-radius:12px;transition:.2s}',
      '.mochi-slider:before{content:"";position:absolute;height:18px;width:18px;left:3px;top:3px;',
      'background:#fff;border-radius:50%;transition:.2s}',
      '.mochi-switch input:checked+.mochi-slider{background:' + PINK + '}',
      '.mochi-switch input:checked+.mochi-slider:before{transform:translateX(20px)}',
      '.mochi-btn{background:' + PINK + ';color:#fff;border:none;padding:10px 18px;border-radius:10px;',
      'font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .2s}',
      '.mochi-btn:hover{background:' + PINK_DARK + '}',
      '.mochi-btn:disabled{opacity:.6;cursor:default}',
      '.mochi-btn-ghost{background:transparent;color:' + PINK + ';border:1.5px solid ' + PINK + '}',
      '.mochi-btn-ghost:hover{background:' + PINK_LIGHT + ';color:#fff}',
      '.mochi-btn-row{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}',
      '.mochi-info{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:10px;',
      'background:#fff5f8;border-radius:10px}',
      '.mochi-info img{width:40px;height:40px;border-radius:50%;object-fit:cover;background:#eee}',
      '.mochi-info span{font-weight:600;color:#333}',
      '.mochi-av-row{display:flex;align-items:center;gap:10px;margin-bottom:14px}',
      '.mochi-av-row img{width:48px;height:48px;border-radius:50%;object-fit:cover;background:#eee}',
      '.mochi-upload-zone{border:2px dashed #ddd;border-radius:10px;padding:20px;text-align:center;',
      'color:#999;cursor:pointer;transition:.2s}',
      '.mochi-upload-zone:hover{border-color:' + PINK + ';color:' + PINK + '}',
      '.mochi-album-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}',
      '.mochi-album-item{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:#f5f5f5}',
      '.mochi-album-item img{width:100%;height:100%;object-fit:cover;cursor:pointer;display:block}',
      '.mochi-album-del{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;',
      'background:rgba(0,0,0,.6);color:#fff;border:none;cursor:pointer;font-size:13px;line-height:1;',
      'padding:0;display:flex;align-items:center;justify-content:center}',
      '.mochi-album-del:hover{background:' + PINK + '}',
      '.mochi-empty{grid-column:1/-1;text-align:center;color:#aaa;padding:28px 0;font-size:14px}'
    ].join('');
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    stylesInjected = true;
  }

  /* ------------------------------------------------------------------ *
   * Overlay / modal lifecycle
   * ------------------------------------------------------------------ */
  function openOverlay(overlay, clickCloses) {
    // Only the top-most overlay reacts to Escape so stacked modals behave.
    var onKey = function (e) {
      if (e.key !== 'Escape') return;
      var nodes = document.querySelectorAll('.mochi-overlay');
      if (nodes.length && nodes[nodes.length - 1] === overlay) closeOverlay(overlay);
    };
    document.addEventListener('keydown', onKey);
    overlay._cleanup = function () { document.removeEventListener('keydown', onKey); };
    if (clickCloses) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeOverlay(overlay);
      });
    }
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
  }

  function closeOverlay(overlay) {
    if (!overlay || overlay._closing) return;
    overlay._closing = true;
    if (overlay._cleanup) { overlay._cleanup(); overlay._cleanup = null; }
    overlay.classList.remove('show');
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 200);
  }

  function createModal(title, bodyNode) {
    injectStyles();
    var overlay = document.createElement('div');
    overlay.className = 'mochi-overlay';
    var modal = document.createElement('div');
    modal.className = 'mochi-modal';
    var h2 = document.createElement('h2');
    var span = document.createElement('span');
    span.textContent = title;
    var closeBtn = document.createElement('button');
    closeBtn.className = 'mochi-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '\u00d7';
    closeBtn.onclick = function () { closeOverlay(overlay); };
    h2.appendChild(span);
    h2.appendChild(closeBtn);
    modal.appendChild(h2);
    modal.appendChild(bodyNode);
    overlay.appendChild(modal);
    openOverlay(overlay, true);
    return overlay;
  }

  function lightbox(src, caption) {
    injectStyles();
    var overlay = document.createElement('div');
    overlay.className = 'mochi-overlay';
    overlay.style.background = 'rgba(0,0,0,.92)';
    var box = document.createElement('div');
    box.style.textAlign = 'center';
    var img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width:90vw;max-height:78vh;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.5)';
    box.appendChild(img);
    if (caption) {
      var c = document.createElement('div');
      c.style.cssText = 'color:#fff;padding:10px 0 0;font-size:14px';
      c.textContent = caption;
      box.appendChild(c);
    }
    overlay.appendChild(box);
    openOverlay(overlay, true);
  }

  /* ------------------------------------------------------------------ *
   * Field builders
   * ------------------------------------------------------------------ */
  function field(labelText, inputEl, hint) {
    var wrap = document.createElement('div');
    wrap.className = 'mochi-field';
    var label = document.createElement('label');
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(inputEl);
    if (hint) {
      var h = document.createElement('div');
      h.className = 'mochi-hint';
      h.textContent = hint;
      wrap.appendChild(h);
    }
    return wrap;
  }

  function textInput(value, placeholder) {
    var i = document.createElement('input');
    i.type = 'text';
    i.value = value || '';
    if (placeholder) i.placeholder = placeholder;
    return i;
  }

  function numberInput(value, min, max) {
    var i = document.createElement('input');
    i.type = 'number';
    if (value !== undefined && value !== null && value !== '') i.value = value;
    if (min !== undefined) i.min = min;
    if (max !== undefined) i.max = max;
    return i;
  }

  function textarea(value, placeholder) {
    var t = document.createElement('textarea');
    t.value = value || '';
    if (placeholder) t.placeholder = placeholder;
    return t;
  }

  function toggleRow(labelText, checked) {
    var row = document.createElement('div');
    row.className = 'mochi-toggle-row';
    var label = document.createElement('label');
    label.textContent = labelText;
    var sw = document.createElement('label');
    sw.className = 'mochi-switch';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    var slider = document.createElement('span');
    slider.className = 'mochi-slider';
    sw.appendChild(input);
    sw.appendChild(slider);
    row.appendChild(label);
    row.appendChild(sw);
    return { row: row, input: input };
  }

  function selectInput(value, options) {
    var s = document.createElement('select');
    options.forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === value) o.selected = true;
      s.appendChild(o);
    });
    return s;
  }

  function btnRow() {
    var r = document.createElement('div');
    r.className = 'mochi-btn-row';
    return r;
  }
  function primaryBtn(text) {
    var b = document.createElement('button');
    b.className = 'mochi-btn';
    b.type = 'button';
    b.textContent = text;
    return b;
  }
  function ghostBtn(text) {
    var b = document.createElement('button');
    b.className = 'mochi-btn mochi-btn-ghost';
    b.type = 'button';
    b.textContent = text;
    return b;
  }

  /* ------------------------------------------------------------------ *
   * Settings data (cached)
   * ------------------------------------------------------------------ */
  function defaultSettings() {
    return {
      global: {
        timeAwareness: false,
        memoryCount: 20,
        summaryTrigger: 30,
        backgroundMessage: false,
        translationLang: 'en'
      },
      perContact: {}
    };
  }

  function getSettings() {
    if (settingsCache) return Promise.resolve(settingsCache);
    if (settingsPromise) return settingsPromise;
    if (!api()) { settingsCache = defaultSettings(); return Promise.resolve(settingsCache); }
    settingsPromise = api().get('/chat-settings')
      .then(unwrap)
      .then(function (data) {
        settingsCache = data || defaultSettings();
        settingsCache.global = settingsCache.global || {};
        settingsCache.perContact = settingsCache.perContact || {};
        settingsPromise = null;
        return settingsCache;
      })
      .catch(function () {
        settingsCache = defaultSettings();
        settingsPromise = null;
        return settingsCache;
      });
    return settingsPromise;
  }

  function getContactSettings(roleId) {
    return getSettings().then(function (s) {
      if (!s.perContact[roleId]) s.perContact[roleId] = {};
      return s.perContact[roleId];
    });
  }

  function persistSettings() {
    if (!api()) return Promise.resolve();
    return api().put('/chat-settings', settingsCache)
      .then(unwrap)
      .catch(function () { toast('Failed to save settings'); });
  }

  /* ------------------------------------------------------------------ *
   * Global chat settings
   * ------------------------------------------------------------------ */
  function showGlobalSettings() {
    getSettings().then(function (settings) {
      var g = settings.global || {};
      var body = document.createElement('div');

      var timeToggle = toggleRow('Time Awareness', g.timeAwareness);
      body.appendChild(timeToggle.row);

      var memInput = numberInput(g.memoryCount != null ? g.memoryCount : 20, 1, 500);
      body.appendChild(field('Memory Count', memInput, 'Past messages kept in context'));

      var sumInput = numberInput(g.summaryTrigger != null ? g.summaryTrigger : 30, 1, 100);
      body.appendChild(field('Summary Trigger Threshold', sumInput, 'Summarize after this many new messages'));

      var bgToggle = toggleRow('Background Messages', g.backgroundMessage);
      body.appendChild(bgToggle.row);

      var langSelect = selectInput(g.translationLang || 'en', LANG_OPTIONS);
      body.appendChild(field('Default Translation Language', langSelect, 'Target language for translation'));

      var row = btnRow();
      var cancel = ghostBtn('Cancel');
      var save = primaryBtn('Save');
      row.appendChild(cancel);
      row.appendChild(save);
      body.appendChild(row);

      var overlay = createModal('Chat Settings', body);
      cancel.onclick = function () { closeOverlay(overlay); };
      save.onclick = function () {
        var data = {
          timeAwareness: timeToggle.input.checked,
          memoryCount: parseInt(memInput.value, 10) || 20,
          summaryTrigger: parseInt(sumInput.value, 10) || 30,
          backgroundMessage: bgToggle.input.checked,
          translationLang: langSelect.value
        };
        save.disabled = true;
        save.textContent = 'Saving...';
        saveGlobalSettings(data).then(function () {
          closeOverlay(overlay);
          toast('Settings saved');
        });
      };
    });
  }

  function saveGlobalSettings(settings) {
    return getSettings().then(function (s) {
      s.global = settings;
      return persistSettings();
    });
  }

  /* ------------------------------------------------------------------ *
   * Per-contact settings
   * ------------------------------------------------------------------ */
  function showContactSettings(roleId) {
    getContactSettings(roleId).then(function (contact) {
      var role = findRole(roleId);
      var body = document.createElement('div');

      if (role) {
        var info = document.createElement('div');
        info.className = 'mochi-info';
        var img = document.createElement('img');
        img.src = avatarUrl(role.name, role.avatar);
        var nm = document.createElement('span');
        nm.textContent = role.name || roleId;
        info.appendChild(img);
        info.appendChild(nm);
        body.appendChild(info);
      }

      var nickInput = textInput(contact.nickname, 'Custom nickname');
      body.appendChild(field('Nickname', nickInput, 'Override how this character is addressed'));

      var memInput = numberInput(contact.memoryCount, 1, 500);
      body.appendChild(field('Memory Count Override', memInput, 'Leave empty to use global setting'));

      var promptArea = textarea(contact.promptAddition, 'Additional prompt instructions for this character...');
      body.appendChild(field('Custom Prompt Addition', promptArea, 'Appended to the character base prompt'));

      var row = btnRow();
      var reset = ghostBtn('Reset');
      var cancel = ghostBtn('Cancel');
      var save = primaryBtn('Save');
      row.appendChild(reset);
      row.appendChild(cancel);
      row.appendChild(save);
      body.appendChild(row);

      var overlay = createModal('Contact Settings', body);
      cancel.onclick = function () { closeOverlay(overlay); };
      reset.onclick = function () {
        if (!confirm('Reset settings for this contact?')) return;
        getSettings().then(function (s) {
          delete s.perContact[roleId];
          return persistSettings();
        }).then(function () {
          closeOverlay(overlay);
          toast('Contact settings reset');
        });
      };
      save.onclick = function () {
        save.disabled = true;
        save.textContent = 'Saving...';
        var data = {
          nickname: nickInput.value.trim(),
          memoryCount: memInput.value ? parseInt(memInput.value, 10) : null,
          promptAddition: promptArea.value.trim()
        };
        saveContactSettings(roleId, data).then(function () {
          closeOverlay(overlay);
          toast('Contact settings saved');
        });
      };
    });
  }

  function saveContactSettings(roleId, settings) {
    return getSettings().then(function (s) {
      s.perContact[roleId] = settings;
      return persistSettings();
    });
  }

  /* ------------------------------------------------------------------ *
   * Personal profile editor
   * ------------------------------------------------------------------ */
  function showProfileEditor() {
    var user = (window.state && window.state.user) || {};
    var body = document.createElement('div');

    var nickInput = textInput(user.nickname, 'Your nickname');
    body.appendChild(field('Nickname', nickInput));

    var bioArea = textarea(user.bio, 'Tell something about yourself...');
    body.appendChild(field('Bio', bioArea));

    var avatarInput = textInput(user.avatar, 'Avatar URL (leave blank for auto)');
    body.appendChild(field('Avatar URL', avatarInput));

    var avRow = document.createElement('div');
    avRow.className = 'mochi-av-row';
    var avPreview = document.createElement('img');
    var autoBtn = ghostBtn('Use Auto');
    var updateAv = function () {
      avPreview.src = avatarInput.value.trim() || avatarUrl(nickInput.value || 'me', '');
    };
    avatarInput.addEventListener('input', updateAv);
    nickInput.addEventListener('input', updateAv);
    autoBtn.onclick = function () { avatarInput.value = ''; updateAv(); };
    updateAv();
    avRow.appendChild(avPreview);
    avRow.appendChild(autoBtn);
    body.appendChild(avRow);

    var relationsArea = textarea(user.relations, 'Describe your relationships with characters...');
    body.appendChild(field('Relations', relationsArea));

    var row = btnRow();
    var cancel = ghostBtn('Cancel');
    var save = primaryBtn('Save Profile');
    row.appendChild(cancel);
    row.appendChild(save);
    body.appendChild(row);

    var overlay = createModal('Edit Profile', body);
    cancel.onclick = function () { closeOverlay(overlay); };
    save.onclick = function () {
      save.disabled = true;
      save.textContent = 'Saving...';
      var data = {
        nickname: nickInput.value.trim(),
        bio: bioArea.value.trim(),
        avatar: avatarInput.value.trim(),
        relations: relationsArea.value.trim()
      };
      saveProfile(data).then(function () {
        closeOverlay(overlay);
        toast('Profile saved');
      });
    };
  }

  function saveProfile(data) {
    return new Promise(function (resolve) {
      // No dedicated profile endpoint; profile lives in global state and is
      // persisted via the app's persist()/renderProfile() mechanism.
      if (window.state) {
        window.state.user = window.state.user || {};
        Object.assign(window.state.user, data);
      }
      if (typeof window.persist === 'function') window.persist();
      if (typeof window.renderProfile === 'function') window.renderProfile();
      resolve();
    });
  }

  /* ------------------------------------------------------------------ *
   * Album
   * ------------------------------------------------------------------ */
  function loadAlbum() {
    if (!api()) { albumCache = []; return Promise.resolve(albumCache); }
    return api().get('/album')
      .then(unwrap)
      .then(function (data) {
        albumCache = (data && data.list) || [];
        return albumCache;
      })
      .catch(function () {
        albumCache = [];
        return albumCache;
      });
  }

  function showAlbum() {
    var body = document.createElement('div');

    var zone = document.createElement('div');
    zone.className = 'mochi-upload-zone';
    var zoneDefault = '<div style="font-size:26px;line-height:1;margin-bottom:6px">+</div>' +
      '<div>Click or drop a photo to upload</div>';
    zone.innerHTML = zoneDefault;

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    var descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.placeholder = 'Optional description...';
    descInput.style.cssText = 'width:100%;margin-top:10px;padding:9px 12px;border:1.5px solid #eee;' +
      'border-radius:10px;box-sizing:border-box;font-size:13px;outline:none;font-family:inherit';

    function doUpload(file) {
      zone.innerHTML = '<div>Uploading...</div>';
      uploadPhoto(file, descInput.value.trim()).then(function (ok) {
        zone.innerHTML = zoneDefault;
        if (ok) {
          toast('Photo uploaded');
          descInput.value = '';
          renderGrid();
        }
      });
    }

    zone.onclick = function () { fileInput.click(); };
    zone.ondragover = function (e) { e.preventDefault(); zone.style.borderColor = PINK; };
    zone.ondragleave = function () { zone.style.borderColor = '#ddd'; };
    zone.ondrop = function (e) {
      e.preventDefault();
      zone.style.borderColor = '#ddd';
      if (e.dataTransfer.files && e.dataTransfer.files[0]) doUpload(e.dataTransfer.files[0]);
    };
    fileInput.onchange = function () {
      if (fileInput.files && fileInput.files[0]) doUpload(fileInput.files[0]);
      fileInput.value = '';
    };

    body.appendChild(zone);
    body.appendChild(fileInput);
    body.appendChild(descInput);

    var grid = document.createElement('div');
    grid.className = 'mochi-album-grid';
    body.appendChild(grid);

    function renderGrid() {
      grid.innerHTML = '';
      var list = albumCache || [];
      if (!list.length) {
        var empty = document.createElement('div');
        empty.className = 'mochi-empty';
        empty.textContent = 'No photos yet. Upload your first one!';
        grid.appendChild(empty);
        return;
      }
      list.forEach(function (photo) {
        var item = document.createElement('div');
        item.className = 'mochi-album-item';
        var img = document.createElement('img');
        img.src = photo.url;
        img.title = photo.desc || '';
        img.onclick = function () { lightbox(photo.url, photo.desc); };
        var del = document.createElement('button');
        del.className = 'mochi-album-del';
        del.type = 'button';
        del.textContent = '\u00d7';
        del.onclick = function (e) {
          e.stopPropagation();
          if (!confirm('Delete this photo?')) return;
          deletePhoto(photo.id).then(function (ok) {
            if (ok) { toast('Photo deleted'); renderGrid(); }
          });
        };
        item.appendChild(img);
        item.appendChild(del);
        grid.appendChild(item);
      });
    }

    var overlay = createModal('Photo Album', body);
    loadAlbum().then(renderGrid);
  }

  function uploadPhoto(file, desc) {
    return new Promise(function (resolve) {
      if (!file) { resolve(null); return; }
      if (!api()) { toast('API unavailable'); resolve(null); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var base64 = reader.result; // data:image/...;base64,...
        api().post('/album', { url: base64, desc: desc || '' })
          .then(unwrap)
          .then(function (photo) {
            if (photo) {
              if (albumCache) albumCache.unshift(photo);
              else albumCache = [photo];
            }
            resolve(photo || null);
          })
          .catch(function () { toast('Upload failed'); resolve(null); });
      };
      reader.onerror = function () { toast('Failed to read file'); resolve(null); };
      reader.readAsDataURL(file);
    });
  }

  function deletePhoto(id) {
    if (!api()) return Promise.resolve(false);
    return api().del('/album/' + encodeURIComponent(id))
      .then(unwrap)
      .then(function () {
        if (albumCache) albumCache = albumCache.filter(function (p) { return p.id !== id; });
        return true;
      })
      .catch(function () { toast('Delete failed'); return false; });
  }

  /* ------------------------------------------------------------------ *
   * Rule Presets (Thinking Chain + Operation Rules)
   * ------------------------------------------------------------------ */
  var rulePresetsCache = null;

  function getRulePresets() {
    if (rulePresetsCache) return Promise.resolve(rulePresetsCache);
    if (!api()) { rulePresetsCache = { thinking: [], operation: [] }; return Promise.resolve(rulePresetsCache); }
    return api().get('/rule-presets')
      .then(unwrap)
      .then(function (data) {
        rulePresetsCache = data || { thinking: [], operation: [] };
        rulePresetsCache.thinking = rulePresetsCache.thinking || [];
        rulePresetsCache.operation = rulePresetsCache.operation || [];
        return rulePresetsCache;
      })
      .catch(function () {
        rulePresetsCache = { thinking: [], operation: [] };
        return rulePresetsCache;
      });
  }

  function persistRulePresets() {
    if (!api()) return Promise.resolve();
    return api().put('/rule-presets', rulePresetsCache)
      .then(unwrap)
      .catch(function () { toast('保存规则失败'); });
  }

  function showRulePresets() {
    getRulePresets().then(function (presets) {
      var body = document.createElement('div');

      /* === 思维链预设 === */
      var thinkTitle = document.createElement('div');
      thinkTitle.style.cssText = 'font-size:15px;font-weight:700;color:' + PINK + ';margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid ' + PINK_LIGHT + ';';
      thinkTitle.textContent = '🧠 思维链预设';
      body.appendChild(thinkTitle);

      var thinkHint = document.createElement('div');
      thinkHint.className = 'mochi-hint';
      thinkHint.style.cssText = 'margin-bottom:12px;';
      thinkHint.textContent = '勾选要启用的思维链模板，可同时启用多个。启用后AI会按选中的策略进行思考。';
      body.appendChild(thinkHint);

      var thinkList = document.createElement('div');
      thinkList.style.cssText = 'margin-bottom:20px;';
      presets.thinking.forEach(function (tp, idx) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:10px 12px;margin-bottom:8px;border:1.5px solid #eee;border-radius:10px;background:#fafafa;';
        var topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
        var nameEl = document.createElement('span');
        nameEl.style.cssText = 'font-size:14px;font-weight:600;color:#333;';
        nameEl.textContent = tp.name || '未命名';
        var toggle = toggleRow('', tp.enabled);
        topRow.appendChild(nameEl);
        topRow.appendChild(toggle.sw);
        toggle.sw.querySelector('input').addEventListener('change', function () {
          presets.thinking[idx].enabled = this.checked;
        });
        var descEl = document.createElement('div');
        descEl.style.cssText = 'font-size:12px;color:#888;line-height:1.5;';
        descEl.textContent = tp.content || '';
        item.appendChild(topRow);
        item.appendChild(descEl);
        thinkList.appendChild(item);
      });
      body.appendChild(thinkList);

      /* === 运转规则预设 === */
      var opTitle = document.createElement('div');
      opTitle.style.cssText = 'font-size:15px;font-weight:700;color:' + PINK + ';margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid ' + PINK_LIGHT + ';';
      opTitle.textContent = '⚙️ 运转规则预设';
      body.appendChild(opTitle);

      var opHint = document.createElement('div');
      opHint.className = 'mochi-hint';
      opHint.style.cssText = 'margin-bottom:12px;';
      opHint.textContent = '勾选要启用的运转规则。关闭的规则不会注入到AI指令中。';
      body.appendChild(opHint);

      var opList = document.createElement('div');
      presets.operation.forEach(function (op, idx) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:10px 12px;margin-bottom:8px;border:1.5px solid #eee;border-radius:10px;background:#fafafa;';
        var topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
        var nameEl = document.createElement('span');
        nameEl.style.cssText = 'font-size:14px;font-weight:600;color:#333;';
        nameEl.textContent = op.name || '未命名';
        var toggle = toggleRow('', op.enabled);
        topRow.appendChild(nameEl);
        topRow.appendChild(toggle.sw);
        toggle.sw.querySelector('input').addEventListener('change', function () {
          presets.operation[idx].enabled = this.checked;
        });
        var descEl = document.createElement('div');
        descEl.style.cssText = 'font-size:12px;color:#888;line-height:1.5;';
        descEl.textContent = op.content || '';
        item.appendChild(topRow);
        item.appendChild(descEl);
        opList.appendChild(item);
      });
      body.appendChild(opList);

      var row = btnRow();
      var cancel = ghostBtn('取消');
      var save = primaryBtn('保存规则');
      row.appendChild(cancel);
      row.appendChild(save);
      body.appendChild(row);

      var overlay = createModal('AI规则预设', body);
      cancel.onclick = function () { closeOverlay(overlay); };
      save.onclick = function () {
        save.disabled = true;
        save.textContent = '保存中...';
        persistRulePresets().then(function () {
          closeOverlay(overlay);
          toast('规则预设已保存');
        });
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  window.MochiSettings = {
    // Settings
    getSettings: getSettings,
    getContactSettings: getContactSettings,
    showGlobalSettings: showGlobalSettings,
    saveGlobalSettings: saveGlobalSettings,
    showContactSettings: showContactSettings,
    saveContactSettings: saveContactSettings,
    // Rule Presets
    showRulePresets: showRulePresets,
    getRulePresets: getRulePresets,
    // Profile
    showProfileEditor: showProfileEditor,
    saveProfile: saveProfile,
    // Album
    showAlbum: showAlbum,
    uploadPhoto: uploadPhoto,
    deletePhoto: deletePhoto,
    loadAlbum: loadAlbum,
    // Utilities
    lightbox: lightbox,
    clearCache: function () { settingsCache = null; settingsPromise = null; albumCache = null; }
  };
})();
