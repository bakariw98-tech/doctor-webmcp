/* Studio — the vibe coding room.
 * File tree (Files / Skills / Plugins) backed by Neon, a calm editor with
 * save + HTML preview, the same shared room chat, and a mini video player
 * that stays docked while you work.
 */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function api(path, opts) {
    return fetch(path, opts).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) throw new Error((body && body.error) || ("request failed: " + res.status));
        return body;
      });
    });
  }

  /* ---------------- identity ---------------- */

  var me = "";
  try { me = localStorage.getItem("ydoc_name") || ""; } catch (e) { /* private mode */ }

  function ensureName() {
    if (me) return me;
    $("#name-overlay").hidden = false;
    return "";
  }

  $("#name-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var v = $("#name-input").value.trim().slice(0, 40);
    if (!v) return;
    me = v;
    try { localStorage.setItem("ydoc_name", me); } catch (e) { /* ignore */ }
    $("#name-overlay").hidden = true;
    loadMessages();
  });

  /* ---------------- file tree ---------------- */

  var ROOTS = [
    { name: "Files", icon: "▤", prefix: null },
    { name: "Skills", icon: "✦", prefix: "skills/" },
    { name: "Plugins", icon: "⬡", prefix: "plugins/" }
  ];

  var expanded = {}; // key -> true
  var selectedPath = null;
  var treeFiles = [];

  function fileIcon(path) {
    if (/\.md$/i.test(path)) return "✎";
    if (/\.html?$/i.test(path)) return "◧";
    if (/\.css$/i.test(path)) return "◈";
    if (/\.(js|ts|tsx|jsx)$/i.test(path)) return "❖";
    if (/\.json$/i.test(path)) return "{ }";
    return "◦";
  }

  function newNode(name, key) {
    return { name: name, key: key, dirs: [], files: [] };
  }

  function insertPath(node, relPath, fullPath) {
    var parts = relPath.split("/");
    var cur = node;
    var key = node.key;
    for (var i = 0; i < parts.length - 1; i++) {
      key += "/" + parts[i];
      var child = null;
      for (var j = 0; j < cur.dirs.length; j++) {
        if (cur.dirs[j].name === parts[i]) { child = cur.dirs[j]; break; }
      }
      if (!child) { child = newNode(parts[i], key); cur.dirs.push(child); }
      cur = child;
    }
    cur.files.push({ name: parts[parts.length - 1], path: fullPath });
    if (!(node.key in expanded)) expanded[node.key] = true;
  }

  function sortNode(node) {
    var byName = function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; };
    node.dirs.sort(byName);
    node.files.sort(byName);
    node.dirs.forEach(sortNode);
  }

  function relFor(root, path) {
    if (root.prefix) {
      if (path.indexOf(root.prefix) === 0) return path.slice(root.prefix.length);
      return null;
    }
    if (path.indexOf("skills/") === 0 || path.indexOf("plugins/") === 0) return null;
    return path;
  }

  function renderTree() {
    var box = $("#tree");
    var roots = ROOTS.map(function (r, i) {
      var node = newNode(r.name, "root" + i);
      treeFiles.forEach(function (f) {
        var rel = relFor(r, f.path);
        if (rel) insertPath(node, rel, f.path);
      });
      sortNode(node);
      return { def: r, node: node };
    });

    var html = "";
    function renderNode(node, depth) {
      var out = "";
      node.dirs.forEach(function (d) {
        var open = expanded[d.key] !== false;
        out += '<div class="tree-row tree-dir" role="treeitem" aria-expanded="' + open + '" data-dirkey="' + esc(d.key) + '"' +
          ' style="--depth:' + depth + '"><span class="twisty">' + (open ? "▾" : "▸") + "</span>" +
          '<span class="tree-label">' + esc(d.name) + "</span></div>";
        if (open) out += renderNode(d, depth + 1);
      });
      node.files.forEach(function (f) {
        var sel = f.path === selectedPath ? " selected" : "";
        out += '<div class="tree-row tree-file' + sel + '" role="treeitem" data-path="' + esc(f.path) + '"' +
          ' style="--depth:' + depth + '"><span class="tree-file-icon">' + esc(fileIcon(f.path)) + "</span>" +
          '<span class="tree-label">' + esc(f.name) + "</span></div>";
      });
      return out;
    }

    roots.forEach(function (r) {
      var open = expanded[r.node.key] !== false;
      html += '<div class="tree-root"><div class="tree-row tree-dir tree-root-row" role="treeitem" aria-expanded="' + open + '"' +
        ' data-dirkey="' + esc(r.node.key) + '"><span class="twisty">' + (open ? "▾" : "▸") + "</span>" +
        '<span class="tree-root-icon">' + esc(r.def.icon) + '</span><span class="tree-label">' + esc(r.def.name) + "</span></div>";
      if (open) html += renderNode(r.node, 1);
      html += "</div>";
    });

    box.innerHTML = html || '<div class="empty">No files yet.</div>';

    Array.prototype.forEach.call(box.querySelectorAll("[data-dirkey]"), function (el) {
      el.addEventListener("click", function () {
        var k = el.getAttribute("data-dirkey");
        expanded[k] = !(expanded[k] !== false);
        renderTree();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-path]"), function (el) {
      el.addEventListener("click", function () {
        openFile(el.getAttribute("data-path"));
      });
    });
  }

  function loadTree() {
    var status = $("#tree-status");
    status.textContent = "loading…";
    api("/api/studio/files").then(function (data) {
      treeFiles = data.files || [];
      renderTree();
      status.textContent = treeFiles.length + (treeFiles.length === 1 ? " file" : " files");
    }).catch(function (err) {
      status.textContent = "couldn't load files: " + err.message;
      $("#tree").innerHTML = '<div class="empty">Files unavailable — is the database connected?</div>';
    });
  }

  function refreshTreeKeepSelection() {
    api("/api/studio/files").then(function (data) {
      treeFiles = data.files || [];
      renderTree();
      $("#tree-status").textContent = treeFiles.length + (treeFiles.length === 1 ? " file" : " files");
    }).catch(function () { /* keep old tree on transient failure */ });
  }

  /* ---------------- editor ---------------- */

  var currentPath = null;
  var dirty = false;
  var previewOn = false;

  function isHtmlPath(p) { return /\.html?$/i.test(p || ""); }

  function updateEditorChrome() {
    $("#editor-path").textContent = currentPath || "No file open";
    $("#dirty-dot").hidden = !dirty;
    var has = !!currentPath;
    $("#save-file-btn").hidden = !has;
    $("#delete-file-btn").hidden = !has;
    $("#preview-toggle").hidden = !(has && isHtmlPath(currentPath));
    $("#editor-empty").hidden = has;
    $("#editor").hidden = !has || previewOn;
    $("#preview").hidden = !has || !previewOn;
    $("#preview-toggle").textContent = previewOn ? "Edit" : "Preview";
    $("#save-file-btn").disabled = !dirty;
  }

  function markDirty() {
    if (!dirty) { dirty = true; updateEditorChrome(); }
    $("#save-status").textContent = "";
  }

  function openFile(path) {
    selectedPath = path;
    currentPath = path;
    dirty = false;
    previewOn = false;
    renderTree();
    updateEditorChrome();
    $("#save-status").textContent = "loading…";
    api("/api/studio/files?path=" + encodeURIComponent(path)).then(function (data) {
      $("#editor").value = data.content || "";
      $("#save-status").textContent = "";
    }).catch(function (err) {
      if (/not found/i.test(err.message)) {
        // New file: start empty, save will create it.
        $("#editor").value = "";
        dirty = true;
        updateEditorChrome();
        $("#save-status").textContent = "new file — press Save to create it";
      } else {
        $("#save-status").textContent = "couldn't open file: " + err.message;
        currentPath = null;
        selectedPath = null;
        renderTree();
        updateEditorChrome();
      }
    });
  }

  function saveFile() {
    if (!currentPath || !dirty) return;
    var btn = $("#save-file-btn");
    btn.disabled = true;
    $("#save-status").textContent = "saving…";
    api("/api/studio/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentPath, content: $("#editor").value })
    }).then(function () {
      dirty = false;
      updateEditorChrome();
      var t = new Date();
      var hh = String(t.getHours()).padStart(2, "0"), mm = String(t.getMinutes()).padStart(2, "0");
      $("#save-status").textContent = "saved ✓ " + hh + ":" + mm;
      refreshTreeKeepSelection();
    }).catch(function (err) {
      $("#save-status").textContent = "save failed: " + err.message;
      btn.disabled = false;
    });
  }

  function deleteCurrentFile() {
    if (!currentPath) return;
    if (!window.confirm("Delete " + currentPath + "?")) return;
    api("/api/studio/files?path=" + encodeURIComponent(currentPath), { method: "DELETE" })
      .then(function () {
        currentPath = null;
        selectedPath = null;
        dirty = false;
        previewOn = false;
        $("#editor").value = "";
        $("#save-status").textContent = "";
        updateEditorChrome();
        refreshTreeKeepSelection();
      })
      .catch(function (err) {
        $("#save-status").textContent = "delete failed: " + err.message;
      });
  }

  $("#editor").addEventListener("input", markDirty);
  $("#save-file-btn").addEventListener("click", saveFile);
  $("#delete-file-btn").addEventListener("click", deleteCurrentFile);
  $("#preview-toggle").addEventListener("click", function () {
    previewOn = !previewOn;
    if (previewOn) $("#preview").srcdoc = $("#editor").value;
    updateEditorChrome();
  });
  // Cmd/Ctrl+S saves.
  document.addEventListener("keydown", function (ev) {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") {
      if (currentPath) { ev.preventDefault(); saveFile(); }
    }
  });

  $("#new-file-btn").addEventListener("click", function () {
    var p = window.prompt("Path for the new file (e.g. notes/todo.md, skills/my-skill/SKILL.md):");
    if (!p) return;
    p = p.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+/, "");
    if (!p || p.indexOf("..") !== -1) { window.alert("Invalid path."); return; }
    openFile(p);
  });

  /* ---------------- mini player ---------------- */

  function dockVideo(videoId) {
    if (!videoId) return;
    var frame = $("#dock-player");
    frame.src = "https://www.youtube.com/embed/" + encodeURIComponent(videoId) + "?autoplay=1&rel=0";
    $("#dock").hidden = false;
    $("#dock-title").textContent = "Loading…";
    api("/api/tools/details?id=" + encodeURIComponent(videoId)).then(function (data) {
      $("#dock-title").textContent = data.video ? data.video.title : videoId;
    }).catch(function () {
      $("#dock-title").textContent = videoId;
    });
  }

  $("#dock-close").addEventListener("click", function () {
    $("#dock-player").src = "";
    $("#dock").hidden = true;
  });

  // Dock-a-video search in the header.
  var dockSearchTimer = null;
  function hideDockResults() { $("#dock-results").hidden = true; }

  $("#dock-search-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var qv = $("#dock-search-input").value.trim();
    if (!qv) return;
    var box = $("#dock-results");
    box.innerHTML = '<div class="dock-result-row muted">Searching…</div>';
    box.hidden = false;
    api("/api/tools/search?q=" + encodeURIComponent(qv) + "&max=5").then(function (data) {
      var vs = data.videos || [];
      if (!vs.length) { box.innerHTML = '<div class="dock-result-row muted">No videos found.</div>'; return; }
      box.innerHTML = vs.map(function (v) {
        return '<div class="dock-result-row" data-video-id="' + esc(v.video_id) + '" role="button" tabindex="0">' +
          '<img src="' + esc(v.thumbnail_url) + '" alt="" loading="lazy">' +
          '<span class="dock-result-title">' + esc(v.title) + "</span></div>";
      }).join("");
      Array.prototype.forEach.call(box.querySelectorAll("[data-video-id]"), function (el) {
        function pick() {
          dockVideo(el.getAttribute("data-video-id"));
          hideDockResults();
          $("#dock-search-input").value = "";
        }
        el.addEventListener("click", pick);
        el.addEventListener("keydown", function (kev) {
          if (kev.key === "Enter" || kev.key === " ") { kev.preventDefault(); pick(); }
        });
      });
    }).catch(function (err) {
      box.innerHTML = '<div class="dock-result-row muted">Search failed: ' + esc(err.message) + "</div>";
    });
  });

  document.addEventListener("click", function (ev) {
    var wrap = $(".dock-search-wrap");
    if (wrap && !wrap.contains(ev.target)) hideDockResults();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") hideDockResults();
  });
  $("#dock-search-input").addEventListener("input", function () {
    if (dockSearchTimer) clearTimeout(dockSearchTimer);
    dockSearchTimer = setTimeout(hideDockResults, 4000);
  });

  /* ---------------- shared chat (same room) ---------------- */

  var chatConfigured = true;
  var lastRenderedIds = "";

  function renderMessages(messages) {
    var box = $("#studio-messages");
    var ids = messages.map(function (m) { return m.id; }).join(",");
    if (ids === lastRenderedIds) return;
    lastRenderedIds = ids;
    if (messages.length === 0) {
      box.innerHTML = '<div class="empty">No messages yet — say hello.</div>';
      return;
    }
    box.innerHTML = messages.map(function (m) {
      var cls = "msg" + (m.name === me ? " mine" : "") + (m.kind === "result" ? " result" : "");
      var html = '<div class="' + cls + '"><div class="who">' + esc(m.name) + "</div>" +
        '<div class="bubble">' + esc(m.text) + "</div>";
      if (m.kind === "result" && m.video_ids && m.video_ids.length) {
        html += '<div class="mini-cards">' + m.video_ids.map(function (id) {
          return '<article class="card mini" data-video-id="' + esc(id) + '">' +
            '<div class="card-body"><p class="card-title">▶ Dock video</p>' +
            '<div class="card-meta"><span>' + esc(id) + "</span></div></div></article>";
        }).join("") + "</div>";
      }
      return html + "</div>";
    }).join("");
    // In the studio, tapping a video card docks it in the mini player.
    Array.prototype.forEach.call(box.querySelectorAll(".card[data-video-id]"), function (el) {
      function go() { dockVideo(el.getAttribute("data-video-id")); }
      el.addEventListener("click", go);
      el.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); }
      });
    });
    box.scrollTop = box.scrollHeight;
  }

  function loadMessages() {
    api("/api/chat/messages").then(function (data) {
      chatConfigured = data.configured !== false;
      $("#studio-chat-form").style.display = chatConfigured ? "" : "none";
      $("#studio-chat-hint").textContent = chatConfigured ? "same room as Watch" : "";
      if (chatConfigured) renderMessages(data.messages || []);
    }).catch(function () {
      $("#studio-chat-hint").textContent = "chat unavailable";
    });
  }

  function postChat(text) {
    if (!ensureName()) return;
    api("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: me, text: text, kind: "chat" })
    }).then(function () {
      loadMessages();
    }).catch(function (err) {
      $("#studio-chat-hint").textContent = "send failed: " + err.message;
    });
  }

  $("#studio-chat-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = $("#studio-chat-input");
    var v = input.value.trim();
    if (!v) return;
    input.value = "";
    postChat(v);
  });

  /* ---------------- WebMCP tool surface (studio files + dock) ---------------- */

  var TOOLS = [
    {
      name: "studio_list_files",
      description: "List every file in the studio file tree: files, skills, and plugins.",
      inputSchema: { type: "object", properties: {} },
      execute: function () { return api("/api/studio/files"); }
    },
    {
      name: "studio_read_file",
      description: "Read a file from the studio tree by path (e.g. 'skills/example/SKILL.md').",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "File path in the studio tree" } },
        required: ["path"]
      },
      execute: function (params) {
        return api("/api/studio/files?path=" + encodeURIComponent(params.path));
      }
    },
    {
      name: "studio_write_file",
      description: "Create or overwrite a file in the studio tree. Use this to build with the human — the file appears in the tree and opens in their editor.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path, e.g. 'notes/todo.md' or 'skills/my-skill/SKILL.md'" },
          content: { type: "string", description: "Full file content" }
        },
        required: ["path", "content"]
      },
      execute: function (params) {
        return api("/api/studio/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: params.path, content: params.content })
        }).then(function (data) {
          if (params.path === currentPath) { $("#editor").value = params.content; dirty = false; updateEditorChrome(); }
          refreshTreeKeepSelection();
          return data;
        });
      }
    },
    {
      name: "dock_video",
      description: "Load a video into the studio's docked mini player so it keeps playing while the human works.",
      inputSchema: {
        type: "object",
        properties: { video_id: { type: "string", description: "The YouTube video id to dock" } },
        required: ["video_id"]
      },
      execute: function (params) {
        dockVideo(params.video_id);
        return Promise.resolve({ docked: params.video_id });
      }
    }
  ];

  function registerWebMCP() {
    try {
      if (!("modelContext" in window.navigator) || !window.navigator.modelContext) return;
      var mc = window.navigator.modelContext;
      if (typeof mc.registerTool === "function") {
        TOOLS.forEach(function (t) { try { mc.registerTool(t); } catch (e) { /* name clash */ } });
      } else if (typeof mc.provideContext === "function") {
        mc.provideContext({ tools: TOOLS });
      } else { return; }
      window.__studioTools = TOOLS.map(function (t) { return t.name; });
    } catch (e) { /* manual mode */ }
  }

  /* ---------------- boot ---------------- */

  updateEditorChrome();
  loadTree();
  registerWebMCP();
  if (ensureName()) { $("#name-overlay").hidden = true; loadMessages(); }
  setInterval(function () { if (me && chatConfigured) loadMessages(); }, 3000);
})();
