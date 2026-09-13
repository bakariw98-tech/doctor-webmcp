/* YouTube Doctor — one dashboard, driven by the agent.
 * The human tells Brodie what to do in the command bar; the dashboard builds
 * itself around the request. Left icons are manual shortcuts only.
 * Stages: home | watch | build | files. The agent composes the stage with the
 * show_stage tool, then fills it with the other tools — no clicking needed.
 */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var bootTs = Date.now();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (e) { return ""; }
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

  /* ---------------- stages: home | watch | build | files ----------------
   * The agent composes the stage with show_stage. The icon rail is the
   * manual fallback — same function, for when the human wants to click. */

  var STAGES = ["home", "watch", "build", "files"];
  var stage = "home";
  try {
    var saved = localStorage.getItem("ydoc_stage");
    if (STAGES.indexOf(saved) !== -1) stage = saved;
  } catch (e) { /* ignore */ }

  function setStage(next) {
    if (STAGES.indexOf(next) === -1) next = "home";
    stage = next;
    try { localStorage.setItem("ydoc_stage", stage); } catch (e) { /* ignore */ }
    var panes = {
      home: $("#home-stage"),
      watch: $("#watch-stage"),
      build: $("#build-stage"),
      files: $("#files-stage")
    };
    STAGES.forEach(function (s) { panes[s].hidden = s !== stage; });
    Array.prototype.forEach.call(document.querySelectorAll(".icon-btn"), function (b) {
      var on = b.getAttribute("data-stage") === stage;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (stage === "files") renderFilesStage();
  }

  Array.prototype.forEach.call(document.querySelectorAll(".icon-btn"), function (b) {
    b.addEventListener("click", function () { setStage(b.getAttribute("data-stage")); });
  });

  /* ---------------- agent presence: the dashboard feels alive ---------------- */

  var activityOverride = "";

  function setActivity(text) {
    activityOverride = text;
    $("#agent-activity").textContent = text;
  }

  function clearActivityOverride() { activityOverride = ""; }

  function summarizeAgentMessage(m) {
    if (m.kind === "command") return "rearranged the dashboard";
    if (m.kind === "result" && m.video_ids && m.video_ids.length) {
      var n = m.video_ids.length;
      return "shared " + n + " video" + (n === 1 ? "" : "s");
    }
    var t = (m.text || "").replace(/\s+/g, " ").trim();
    return t.length > 46 ? t.slice(0, 46) + "…" : (t || "did something");
  }

  /** The activity line follows the latest thing the agent did in the room. */
  function updatePresence(messages) {
    clearActivityOverride();
    var line = "online — say hi in the chat";
    for (var i = messages.length - 1; i >= 0; i--) {
      var m = messages[i];
      if (!m.name || m.name === me) continue;
      line = summarizeAgentMessage(m);
      break;
    }
    $("#agent-activity").textContent = line;
  }

  function pulseAvatar() {
    var a = $("#agent-avatar");
    a.classList.remove("pulse");
    // Force reflow so a second pulse restarts the animation.
    void a.offsetWidth;
    a.classList.add("pulse");
    setTimeout(function () { a.classList.remove("pulse"); }, 2200);
  }

  function showTyping(on) { $("#typing").hidden = !on; }

  /* ---------------- channel badge ---------------- */

  function loadChannel() {
    api("/api/tools/channel").then(function (data) {
      var c = data.channel || {};
      $("#channel-line").textContent = c.title || "searching all of YouTube";
      $("#demo-badge").hidden = !c.demo;
    }).catch(function () {
      $("#channel-line").textContent = "channel unavailable";
    });
  }

  /* ---------------- video cards + players (generative UI) ---------------- */

  function cardHTML(v) {
    return (
      '<article class="card" data-video-id="' + esc(v.video_id) + '" tabindex="0" role="button" aria-label="Play ' + esc(v.title) + '">' +
        '<img src="' + esc(v.thumbnail_url) + '" alt="" loading="lazy">' +
        '<div class="card-body">' +
          '<p class="card-title">' + esc(v.title) + "</p>" +
          '<div class="card-meta"><span>' + esc(fmtDate(v.published_at)) + "</span><span>" + esc(v.duration || "") + "</span>" +
          (v.demo ? '<span class="badge badge-demo">demo</span>' : "") +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function wireCards(container, playFn) {
    Array.prototype.forEach.call(container.querySelectorAll(".card"), function (el) {
      function go() { playFn(el.getAttribute("data-video-id")); }
      el.addEventListener("click", go);
      el.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); }
      });
    });
  }

  /** Render video cards into the results area. switchStage=false keeps the
   *  current stage (used when mirroring old messages on page load). */
  function displayVideosOnPage(videos, switchStage) {
    if (switchStage !== false && stage !== "watch") setStage("watch");
    var box = $("#results");
    if (!videos || videos.length === 0) {
      box.innerHTML = '<div class="empty">No videos found — try a different search.</div>';
      return 0;
    }
    box.innerHTML = videos.map(cardHTML).join("");
    wireCards(box, playVideoOnPage);
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return videos.length;
  }

  /** Load a video into the embedded player. Called by the play_video tool. */
  function playVideoOnPage(videoId) {
    if (!videoId) return null;
    if (stage !== "watch") setStage("watch");
    var frame = $("#player");
    frame.src = "https://www.youtube.com/embed/" + encodeURIComponent(videoId) + "?autoplay=1&rel=0";
    $("#player-section").hidden = false;
    $("#now-playing").textContent = "▶ loading…";
    api("/api/tools/details?id=" + encodeURIComponent(videoId))
      .then(function (data) {
        $("#now-playing").textContent = "▶ " + (data.video ? data.video.title : videoId);
      })
      .catch(function () { $("#now-playing").textContent = "▶ " + videoId; });
    $("#player-section").scrollIntoView({ behavior: "smooth", block: "center" });
    return videoId;
  }

  $("#player-close").addEventListener("click", function () {
    $("#player").src = "";
    $("#player-section").hidden = true;
  });

  function runTrending() {
    lastLocalSearchTs = Date.now();
    setActivity("finding what's trending…");
    setStage("watch");
    api("/api/tools/trending?max=8").then(function (data) {
      displayVideosOnPage(data.videos, false);
      clearActivityOverride();
    }).catch(function (err) {
      clearActivityOverride();
      $("#results").innerHTML = '<div class="empty">Could not load videos: ' + esc(err.message) + "</div>";
    });
  }

  $("#trending-btn").addEventListener("click", runTrending);

  /* ---------------- docked mini player: video keeps playing while you build ---------------- */

  function dockVideo(videoId) {
    if (!videoId) return null;
    var frame = $("#dock-player");
    frame.src = "https://www.youtube.com/embed/" + encodeURIComponent(videoId) + "?autoplay=1&rel=0";
    $("#dock").hidden = false;
    $("#dock-title").textContent = "Loading…";
    api("/api/tools/details?id=" + encodeURIComponent(videoId)).then(function (data) {
      var title = data.video ? data.video.title : videoId;
      $("#dock-title").textContent = title;
      setActivity("▶ " + title);
      setTimeout(clearActivityOverride, 8000);
    }).catch(function () {
      $("#dock-title").textContent = videoId;
    });
    return videoId;
  }

  $("#dock-close").addEventListener("click", function () {
    $("#dock-player").src = "";
    $("#dock").hidden = true;
  });

  // Dock-a-video search, in the Build toolbar.
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
    var wrap = document.querySelector(".dock-search-wrap");
    if (wrap && !wrap.contains(ev.target)) hideDockResults();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") hideDockResults();
  });
  $("#dock-search-input").addEventListener("input", function () {
    if (dockSearchTimer) clearTimeout(dockSearchTimer);
    dockSearchTimer = setTimeout(hideDockResults, 4000);
  });

  /* ---------------- file tree (Files / Skills / Plugins) ---------------- */

  var ROOTS = [
    { name: "Files", icon: "▤", prefix: null },
    { name: "Skills", icon: "✦", prefix: "skills/" },
    { name: "Plugins", icon: "⬡", prefix: "plugins/" }
  ];

  var expanded = {};
  var selectedPath = null;
  var treeFiles = [];
  var treeLoaded = false;

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
    treeLoaded = true;
    var status = $("#tree-status");
    status.textContent = "loading…";
    api("/api/studio/files").then(function (data) {
      treeFiles = data.files || [];
      renderTree();
      status.textContent = treeFiles.length + (treeFiles.length === 1 ? " file" : " files");
      if (stage === "files") renderFilesStage();
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
      if (stage === "files") renderFilesStage();
    }).catch(function () { /* keep old tree on transient failure */ });
  }

  /* ---------------- files stage: the studio as a browser ---------------- */

  function renderFilesStage() {
    var box = $("#files-browser");
    if (!box) return;
    var q = ($("#files-filter").value || "").toLowerCase();
    var html = "";
    ROOTS.forEach(function (r) {
      var list = treeFiles.filter(function (f) {
        return relFor(r, f.path) && (!q || f.path.toLowerCase().indexOf(q) !== -1);
      });
      if (!list.length) return;
      html += '<div class="files-group"><div class="files-group-head"><span class="tree-root-icon">' +
        esc(r.icon) + '</span><span class="files-group-name">' + esc(r.name) + '</span>' +
        '<span class="files-count">' + list.length + "</span></div>";
      html += list.map(function (f) {
        var name = f.path.split("/").pop();
        return '<div class="file-row" data-path="' + esc(f.path) + '" role="button" tabindex="0">' +
          '<span class="tree-file-icon">' + esc(fileIcon(f.path)) + "</span>" +
          '<span class="file-row-main"><span class="file-row-name">' + esc(name) + "</span>" +
          '<span class="file-row-path muted">' + esc(f.path) + "</span></span>" +
          (f.updated_at ? '<span class="file-row-date muted">' + esc(fmtDate(f.updated_at)) + "</span>" : "") +
          "</div>";
      }).join("");
      html += "</div>";
    });
    box.innerHTML = html || '<div class="empty">No files found.</div>';
    Array.prototype.forEach.call(box.querySelectorAll("[data-path]"), function (el) {
      function go() { openFile(el.getAttribute("data-path")); }
      el.addEventListener("click", go);
      el.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); }
      });
    });
  }

  $("#files-filter").addEventListener("input", renderFilesStage);

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
    if (stage !== "build") setStage("build");
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
      setActivity("saved " + currentPath);
      setTimeout(clearActivityOverride, 6000);
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

  function promptNewFile() {
    var p = window.prompt("Path for the new file (e.g. notes/todo.md, skills/my-skill/SKILL.md):");
    if (!p) return;
    p = p.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+/, "");
    if (!p || p.indexOf("..") !== -1) { window.alert("Invalid path."); return; }
    openFile(p);
  }

  $("#editor").addEventListener("input", markDirty);
  $("#save-file-btn").addEventListener("click", saveFile);
  $("#delete-file-btn").addEventListener("click", deleteCurrentFile);
  $("#preview-toggle").addEventListener("click", function () {
    previewOn = !previewOn;
    if (previewOn) $("#preview").srcdoc = $("#editor").value;
    updateEditorChrome();
  });
  document.addEventListener("keydown", function (ev) {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") {
      if (currentPath && stage === "build") { ev.preventDefault(); saveFile(); }
    }
  });

  $("#new-file-btn").addEventListener("click", promptNewFile);
  $("#files-new-btn").addEventListener("click", promptNewFile);

  /* ---------------- shared room chat + agent aliveness ---------------- */

  var chatConfigured = true;
  var lastRenderedIds = "";
  var lastLocalSearchTs = 0;
  var lastMirroredResultId = "";
  var lastAgentMsgId = "";
  var paintTimer = null;

  /** Mirror an agent's result message into the results area as full video
   *  cards, so shared videos feel like generative UI — not just chat.
   *  Only yanks the stage if the message arrived while you were here. */
  function mirrorResultToResults(msg) {
    if (!msg || msg.id === lastMirroredResultId) return;
    if (!(msg.ts > lastLocalSearchTs)) return;
    lastMirroredResultId = msg.id;
    var ids = (msg.video_ids || []).slice(0, 8);
    Promise.all(ids.map(function (id) {
      return api("/api/tools/details?id=" + encodeURIComponent(id))
        .then(function (data) { return data.video || null; })
        .catch(function () { return null; });
    })).then(function (videos) {
      videos = videos.filter(function (v) { return !!v; });
      if (videos.length) displayVideosOnPage(videos, msg.ts > bootTs);
    });
  }

  function newestAgentMessage(messages) {
    for (var i = messages.length - 1; i >= 0; i--) {
      var m = messages[i];
      if (m.kind === "command") continue; // invisible control messages
      if (m.name && m.name !== me) return m;
    }
    return null;
  }

  /* ------- remote agent control: the agent composes the dashboard -------
   * The in-room agent (posting as "Brodie") can drive the stage by sending
   * chat messages with kind:"command" and a JSON body, e.g.
   *   {"action":"show_stage","view":"build"}
   *   {"action":"open_file","path":"notes.md"}
   *   {"action":"dock","video_id":"dQw4w9WgXcQ"}
   * Commands are invisible in the chat and run once, newest-first. Only
   * messages from the agent name are honored. */
  var executedCommands = {};
  function runAgentCommands(messages) {
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.kind !== "command" || m.name !== "Brodie" || executedCommands[m.id]) continue;
      executedCommands[m.id] = true;
      var cmd = null;
      try { cmd = JSON.parse(m.text); } catch (e) { cmd = null; }
      if (!cmd || !cmd.action) continue;
      try {
        if (cmd.action === "show_stage" && typeof cmd.view === "string") setStage(cmd.view);
        else if (cmd.action === "open_file" && typeof cmd.path === "string") openFile(cmd.path);
        else if (cmd.action === "dock" && typeof cmd.video_id === "string") dockVideo(cmd.video_id);
      } catch (e) { /* a bad command never breaks the room */ }
    }
  }

  function renderMessages(messages) {
    var ids = messages.map(function (m) { return m.id; }).join(",");
    if (ids === lastRenderedIds) return; // nothing new
    lastRenderedIds = ids;

    // A fresh agent message: typing indicator + avatar pulse, then paint.
    var agent = newestAgentMessage(messages);
    var fresh = agent && agent.id !== lastAgentMsgId;
    if (agent) lastAgentMsgId = agent.id;

    if (paintTimer) { clearTimeout(paintTimer); paintTimer = null; }
    if (fresh) {
      pulseAvatar();
      showTyping(true);
      paintTimer = setTimeout(function () {
        paintTimer = null;
        showTyping(false);
        paintMessages(messages);
      }, 1300);
    } else {
      paintMessages(messages);
    }
    runAgentCommands(messages);
  }

  function paintMessages(messages) {
    var box = $("#messages");
    if (messages.length === 0) {
      box.innerHTML = '<div class="empty">No messages yet — say hello.</div>';
      updatePresence(messages);
      return;
    }
    box.innerHTML = messages.map(function (m) {
      if (m.kind === "command") return ""; // invisible control messages
      var cls = "msg" + (m.name === me ? " mine" : "") + (m.kind === "result" ? " result" : "");
      var html = '<div class="' + cls + '"><div class="who">' + esc(m.name) + "</div>" +
        '<div class="bubble">' + esc(m.text) + "</div>";
      if (m.kind === "result" && m.video_ids && m.video_ids.length) {
        html += '<div class="mini-cards">' + m.video_ids.map(function (id) {
          return '<article class="card mini" data-video-id="' + esc(id) + '" tabindex="0" role="button" aria-label="Play video">' +
            '<div class="card-body"><p class="card-title">▶ ' + (stage === "build" ? "Dock" : "Watch") + " video</p>" +
            '<div class="card-meta"><span>' + esc(id) + "</span></div></div></article>";
        }).join("") + "</div>";
      }
      return html + "</div>";
    }).join("");
    // Chat video cards follow the current stage: Build docks, everything else plays big.
    wireCards(box, stage === "build" ? dockVideo : playVideoOnPage);
    box.scrollTop = box.scrollHeight;
    updatePresence(messages);
    // Mirror the newest agent result into the results area as full cards.
    for (var i = messages.length - 1; i >= 0; i--) {
      var m = messages[i];
      if (m.kind === "result" && m.video_ids && m.video_ids.length) { mirrorResultToResults(m); break; }
    }
  }

  function loadMessages() {
    api("/api/chat/messages").then(function (data) {
      chatConfigured = data.configured !== false;
      $("#chat-setup").hidden = chatConfigured;
      $("#chat-form").style.display = chatConfigured ? "" : "none";
      $("#chat-hint").textContent = chatConfigured ? "synced across devices" : "";
      if (chatConfigured) renderMessages(data.messages || []);
    }).catch(function () {
      $("#chat-hint").textContent = "chat unavailable";
    });
  }

  function postChat(text, kind, videoIds) {
    if (!ensureName()) return Promise.resolve(null);
    return api("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: me, text: text, kind: kind || "chat", video_ids: videoIds })
    }).then(function (data) {
      loadMessages();
      return data.message;
    }).catch(function (err) {
      $("#chat-hint").textContent = "send failed: " + err.message;
      return null;
    });
  }

  $("#chat-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = $("#chat-input");
    var v = input.value.trim();
    if (!v) return;
    input.value = "";
    postChat(v);
  });

  /* ---------------- command bar: the primary interface ----------------
   * Every command goes into the room (the agent sees it). For video
   * requests the dashboard also searches directly, so it works with no
   * agent in the loop — and the stage composes itself. */

  function stripCommandVerbs(v) {
    var q = v
      .replace(/^(please\s+)?(find|show|get|search|look\s*up|play|watch|dock)(\s+me)?(\s+(a|an|the|some))?\s+/i, "")
      .replace(/^(for|about|on)\s+/i, "")
      .replace(/\s+(video|videos)\s*$/i, "");
    return q.trim() || v;
  }

  var VIDEO_WORDS = /\b(video|videos|watch|youtube|lofi|song|songs|music|clip|trailer|tutorial|beats|podcast)\b/i;
  var FILE_WORDS = /\b(files?|skills?|plugins?|file tree|explorer)\b/i;

  function runSearch(q) {
    lastLocalSearchTs = Date.now();
    setActivity("searching YouTube…");
    setStage("watch");
    var box = $("#results");
    box.innerHTML = '<div class="empty">Searching…</div>';
    api("/api/tools/search?q=" + encodeURIComponent(q) + "&max=8").then(function (data) {
      displayVideosOnPage(data.videos, false);
      clearActivityOverride();
    }).catch(function (err) {
      clearActivityOverride();
      box.innerHTML = '<div class="empty">Could not search: ' + esc(err.message) + "</div>";
    });
  }

  function handleCommand(text) {
    var v = (text || "").trim();
    if (!v) return;
    postChat(v);
    var low = v.toLowerCase();
    if (/\btrend/.test(low)) { runTrending(); return; }
    if (/\bdock\b/.test(low) && VIDEO_WORDS.test(low)) {
      // "dock some lofi while I work": park the top result, stay put.
      var q = stripCommandVerbs(v);
      lastLocalSearchTs = Date.now();
      setActivity("docking a video…");
      api("/api/tools/search?q=" + encodeURIComponent(q) + "&max=1").then(function (data) {
        var vids = data.videos || [];
        if (vids.length) dockVideo(vids[0].video_id);
        clearActivityOverride();
      }).catch(function () { clearActivityOverride(); });
      return;
    }
    if (FILE_WORDS.test(low) && !VIDEO_WORDS.test(low)) { setStage("files"); return; }
    if (VIDEO_WORDS.test(low)) { runSearch(stripCommandVerbs(v)); return; }
    // Otherwise the message just sits in the room: if the agent is around,
    // it composes the dashboard with show_stage + the other tools.
  }

  $("#command-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = $("#command-input");
    handleCommand(input.value);
    input.value = "";
  });

  Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (c) {
    c.addEventListener("click", function () { handleCommand(c.getAttribute("data-cmd")); });
  });

  /* ---------------- WebMCP tool surface ----------------
   * These descriptions teach the agent the generative-UI pattern:
   * the human should never have to click — the agent calls show_stage
   * to compose the dashboard, then fills it with the other tools. */

  function webmcpSupported() {
    try {
      return "modelContext" in window.navigator && !!window.navigator.modelContext;
    } catch (e) { return false; }
  }

  var TOOLS = [
    {
      name: "show_stage",
      description: "Reconfigure the dashboard stage for the human — they should never have to click around. When the human asks to do something, call this FIRST to bring up the right surface, then fill it with the other tools. Views: 'home' (welcome screen with suggestion chips), 'watch' (video results + player), 'build' (code editor), 'files' (file browser). Example: 'find me a video about sourdough' → search_videos, show_stage('watch'), display_videos. 'Build me a landing page' → studio_write_file, show_stage('build'), open_file. 'Show my files' → show_stage('files').",
      inputSchema: {
        type: "object",
        properties: {
          view: { type: "string", description: "Which stage to show: home, watch, build, or files", enum: ["home", "watch", "build", "files"] }
        },
        required: ["view"]
      },
      execute: function (params) {
        setStage(params.view);
        return Promise.resolve({ stage: stage });
      }
    },
    {
      name: "search_videos",
      description: "Search all of YouTube by keyword. When the human asks to find or watch something ('find me videos about X', 'show me lofi beats'), search here, then call show_stage('watch') and display_videos so the results pop up on the dashboard — no clicking needed. Pass channel_id to narrow the search to one channel (e.g. 'his videos'). Omit query when channel_id is given to get that channel's latest uploads.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keywords, e.g. 'gut health'. Optional if channel_id is given." },
          max_results: { type: "integer", description: "Max videos to return (1-25)", default: 8 },
          channel_id: { type: "string", description: "Optional: a YouTube channel id (UC…) to search within" },
          order: { type: "string", description: "'relevance' (default) or 'date' for newest first" }
        }
      },
      execute: function (params) {
        var qs = "?max=" + Math.min(25, Math.max(1, params.max_results || 8));
        if (params.query) qs += "&q=" + encodeURIComponent(params.query);
        if (params.channel_id) qs += "&channel=" + encodeURIComponent(params.channel_id);
        if (params.order === "date") qs += "&order=date";
        return api("/api/tools/search" + qs);
      }
    },
    {
      name: "list_trending_videos",
      description: "List what's popular on YouTube right now. Pair with show_stage('watch') + display_videos when the human asks what's trending.",
      inputSchema: {
        type: "object",
        properties: {
          max_results: { type: "integer", description: "Max videos to return (1-25)", default: 8 }
        }
      },
      execute: function (params) {
        var max = Math.min(25, Math.max(1, (params && params.max_results) || 8));
        return api("/api/tools/trending?max=" + max);
      }
    },
    {
      name: "get_video_details",
      description: "Get full details for one video: title, description, publish date, duration, thumbnail, and watch URL.",
      inputSchema: {
        type: "object",
        properties: { video_id: { type: "string", description: "The YouTube video id" } },
        required: ["video_id"]
      },
      execute: function (params) {
        return api("/api/tools/details?id=" + encodeURIComponent(params.video_id));
      }
    },
    {
      name: "display_videos",
      description: "Render video cards onto the dashboard's watch stage so the human can see and tap them. Call show_stage('watch') first if the dashboard isn't on the watch stage, then this — the human never has to navigate.",
      inputSchema: {
        type: "object",
        properties: {
          video_ids: { type: "array", items: { type: "string" }, description: "Video ids to display as cards" }
        },
        required: ["video_ids"]
      },
      execute: function (params) {
        var ids = (params.video_ids || []).slice(0, 12);
        return Promise.all(ids.map(function (id) {
          return api("/api/tools/details?id=" + encodeURIComponent(id))
            .then(function (d) { return d.video; })
            .catch(function () { return null; });
        })).then(function (videos) {
          var shown = displayVideosOnPage(videos.filter(Boolean));
          return { displayed: shown };
        });
      }
    },
    {
      name: "play_video",
      description: "Play a video in the dashboard's big player (watch stage appears automatically). Use when the human picks a video or asks to play one — don't autoplay unasked.",
      inputSchema: {
        type: "object",
        properties: { video_id: { type: "string", description: "The YouTube video id to play" } },
        required: ["video_id"]
      },
      execute: function (params) {
        var id = stage === "build" ? dockVideo(params.video_id) : playVideoOnPage(params.video_id);
        return Promise.resolve({ playing: id });
      }
    },
    {
      name: "dock_video",
      description: "Park a video in the docked mini player so it keeps playing while the human works on the build stage. Use when they ask to keep something playing in the background ('dock some lofi while I work').",
      inputSchema: {
        type: "object",
        properties: { video_id: { type: "string", description: "The YouTube video id to dock" } },
        required: ["video_id"]
      },
      execute: function (params) {
        return Promise.resolve({ docked: dockVideo(params.video_id) });
      }
    },
    {
      name: "open_file",
      description: "Open a studio file in the dashboard's editor — the build stage pops up automatically with the file loaded. Call this right after studio_write_file so the human sees what you built without clicking anything.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "File path in the studio tree, e.g. 'index.html' or 'skills/my-skill/SKILL.md'" } },
        required: ["path"]
      },
      execute: function (params) {
        openFile(params.path);
        return Promise.resolve({ opened: params.path });
      }
    },
    {
      name: "studio_list_files",
      description: "List every file in the dashboard's file tree: files, skills, and plugins.",
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
      description: "Create or overwrite a file in the studio tree. This is how you build with the human: when they ask for something ('build me a landing page', 'add a notes file'), write it here, then call show_stage('build') and open_file so it appears in front of them. The file shows up in the tree and the Files stage instantly.",
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
          if (params.path === currentPath) {
            $("#editor").value = params.content;
            dirty = false;
            updateEditorChrome();
            $("#save-status").textContent = "updated by the agent";
          }
          refreshTreeKeepSelection();
          return data;
        });
      }
    },
    {
      name: "read_messages",
      description: "Read the latest messages in the shared room chat — THIS is how you see what the human typed in the command bar. Poll it to wait for new messages, then compose the dashboard with show_stage + the other tools.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "How many recent messages to return (1-50)", default: 20 }
        }
      },
      execute: function (params) {
        return api("/api/chat/messages").then(function (data) {
          var msgs = data.messages || [];
          var n = Math.min(50, Math.max(1, (params && params.limit) || 20));
          return { configured: data.configured, messages: msgs.slice(-n) };
        });
      }
    },
    {
      name: "send_message",
      description: "Post into the shared room chat as the agent. The human sees it instantly in the agent panel, the avatar pulses, and the activity line updates — this is how you talk back while you work the dashboard.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The message text" },
          name: { type: "string", description: "Display name to post as", default: "Brodie" },
          kind: { type: "string", description: "'chat' for a normal message, 'result' to attach video cards", default: "chat" },
          video_ids: { type: "array", items: { type: "string" }, description: "Video ids to attach as watch cards (kind='result')" }
        },
        required: ["text"]
      },
      execute: function (params) {
        return api("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: (params.name || "Brodie").slice(0, 40),
            text: params.text,
            kind: params.kind === "result" ? "result" : "chat",
            video_ids: params.video_ids
          })
        });
      }
    }
  ];

  function registerWebMCP() {
    var dot = $("#webmcp-dot"), label = $("#webmcp-label");
    function setLive(live) {
      dot.className = "dot " + (live ? "dot-green" : "dot-gray");
      label.textContent = live ? "agent tools live" : "manual mode";
    }
    if (!webmcpSupported()) { setLive(false); return; }
    try {
      var mc = window.navigator.modelContext;
      if (typeof mc.registerTool === "function") {
        TOOLS.forEach(function (t) { try { mc.registerTool(t); } catch (e) { /* name clash */ } });
      } else if (typeof mc.provideContext === "function") {
        mc.provideContext({ tools: TOOLS });
      } else {
        setLive(false); return;
      }
      setLive(true);
      window.__ydocTools = TOOLS.map(function (t) { return t.name; });
    } catch (e) {
      setLive(false);
    }
  }

  /* ---------------- boot ---------------- */

  setStage(stage);
  updateEditorChrome();
  loadChannel();
  loadTree();
  registerWebMCP();
  if (ensureName()) { $("#name-overlay").hidden = true; loadMessages(); }
  setInterval(function () { if (me && chatConfigured) loadMessages(); }, 3000);
})();
