/* Room OS — one input, one surface.
 * The human tells Brodie what to do in the command bar; the dashboard builds
 * itself around the request. The thread lives in a drawer (a log, not a
 * column). The agent drives the stage through ONE shared runCommand(),
 * whether it arrives via WebMCP tools or the /api/stage/command inbox —
 * and the page posts receipts so the loop is closed.
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

  function trunc(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
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
   * The agent composes the stage. The tabs are the quiet manual fallback. */

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
    document.body.setAttribute("data-stage", stage);
    var panes = {
      home: $("#home-stage"),
      watch: $("#watch-stage"),
      build: $("#build-stage"),
      files: $("#files-stage")
    };
    STAGES.forEach(function (s) { panes[s].hidden = s !== stage; });
    Array.prototype.forEach.call(document.querySelectorAll("[data-stage]"), function (b) {
      var on = b.getAttribute("data-stage") === stage;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (stage === "files") renderFilesStage();
    if (stage === "home") renderHome();
  }

  Array.prototype.forEach.call(document.querySelectorAll(".stage-tabs button, .drawer-stages button"), function (b) {
    b.addEventListener("click", function () {
      setStage(b.getAttribute("data-stage"));
      closeDrawer();
    });
  });
  $("#brand-home").addEventListener("click", function () { setStage("home"); });

  /* ---------------- stage banner: the agent's hand on the stage ---------------- */

  var bannerTimer = null;
  var optimisticTimer = null;
  function showBanner(html, ms) {
    var el = $("#stage-banner");
    el.innerHTML = '<span class="banner-dot"></span><span>' + html + "</span>";
    el.hidden = false;
    if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
    if (ms > 0) bannerTimer = setTimeout(clearBanner, ms);
  }
  function clearBanner() {
    if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
    if (optimisticTimer) { clearTimeout(optimisticTimer); optimisticTimer = null; }
    $("#stage-banner").hidden = true;
  }
  function agentBanner(text) { showBanner("<b>Brodie</b> · " + esc(text), 6000); }

  /* ---------------- agent presence ---------------- */

  var activityOverride = "";

  function setActivity(text) {
    activityOverride = text;
    $("#agent-activity").textContent = text;
  }
  function clearActivityOverride() { activityOverride = ""; }

  function summarizeAgentMessage(m) {
    if (m.kind === "result" && m.video_ids && m.video_ids.length) {
      var n = m.video_ids.length;
      return "shared " + n + " video" + (n === 1 ? "" : "s");
    }
    return trunc(m.text, 46) || "did something";
  }

  function updatePresence(messages) {
    clearActivityOverride();
    var line = "online — talk in the command bar";
    for (var i = messages.length - 1; i >= 0; i--) {
      var m = messages[i];
      if (isHiddenCommand(m) || m.kind === "system") continue;
      if (!m.name || m.name === me) continue;
      line = summarizeAgentMessage(m);
      break;
    }
    $("#agent-activity").textContent = line;
  }

  function pulseAvatar() {
    var a = $("#agent-avatar");
    a.classList.remove("pulse");
    void a.offsetWidth;
    a.classList.add("pulse");
    setTimeout(function () { a.classList.remove("pulse"); }, 2200);
  }

  function showTyping(on) { $("#typing").hidden = !on; }

  /* ---------------- video cards + players (generative UI) ---------------- */

  function cardHTML(v) {
    return (
      '<article class="card" data-video-id="' + esc(v.video_id) + '" tabindex="0" role="button" aria-label="Play ' + esc(v.title) + '">' +
        '<button type="button" class="card-dock" data-dock="' + esc(v.video_id) + '" title="Keep playing while you work">Dock</button>' +
        '<img src="' + esc(v.thumbnail_url) + '" alt="" loading="lazy">' +
        '<div class="card-body">' +
          '<p class="card-title">' + esc(v.title) + "</p>" +
          '<div class="card-meta"><span>' + esc(fmtDate(v.published_at)) + "</span><span>" + esc(v.duration || "") + "</span>" +
          (v.demo ? '<span class="badge-demo">demo</span>' : "") +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function wireCards(container, playFn) {
    Array.prototype.forEach.call(container.querySelectorAll(".card-dock"), function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        dockVideo(btn.getAttribute("data-dock"));
      });
    });
    Array.prototype.forEach.call(container.querySelectorAll(".card"), function (el) {
      function go() { playFn(el.getAttribute("data-video-id")); }
      el.addEventListener("click", go);
      el.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); }
      });
    });
  }

  function displayVideosOnPage(videos, switchStage) {
    if (switchStage !== false && stage !== "watch") setStage("watch");
    var box = $("#results");
    if (!videos || videos.length === 0) {
      box.innerHTML = '<div class="empty">No videos found — try a different search.</div>';
      return 0;
    }
    box.innerHTML = videos.map(cardHTML).join("");
    wireCards(box, playVideoOnPage);
    return videos.length;
  }

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

  /* ---------------- docked mini player ---------------- */

  function dockVideo(videoId) {
    if (!videoId) return null;
    var dock = $("#dock");
    dock.dataset.videoId = videoId;
    $("#dock-player").src = "https://www.youtube.com/embed/" + encodeURIComponent(videoId) + "?autoplay=1&rel=0";
    dock.hidden = false;
    $("#dock-title").textContent = "Loading…";
    $("#dock-thumb").hidden = true;
    api("/api/tools/details?id=" + encodeURIComponent(videoId)).then(function (data) {
      var v = data.video || {};
      $("#dock-title").textContent = v.title || videoId;
      if (v.thumbnail_url) {
        var th = $("#dock-thumb");
        th.src = v.thumbnail_url;
        th.hidden = false;
      }
      setActivity("▶ " + (v.title || videoId));
      setTimeout(clearActivityOverride, 8000);
    }).catch(function () {
      $("#dock-title").textContent = videoId;
    });
    return videoId;
  }

  $("#dock-close").addEventListener("click", function (ev) {
    ev.stopPropagation();
    $("#dock-player").src = "";
    $("#dock").hidden = true;
    delete $("#dock").dataset.videoId;
  });

  // On the phone the dock is a slim strip: tap to expand into the big player.
  $("#dock").addEventListener("click", function (ev) {
    if (ev.target.closest("#dock-close")) return;
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    var id = $("#dock").dataset.videoId;
    if (id) playVideoOnPage(id);
  });

  /* ---------------- files stage: the studio as a browser ---------------- */

  var ROOTS = [
    { name: "Files", prefix: null },
    { name: "Skills", prefix: "skills/" },
    { name: "Plugins", prefix: "plugins/" }
  ];

  var treeFiles = [];

  function relFor(root, path) {
    if (root.prefix) {
      if (path.indexOf(root.prefix) === 0) return path.slice(root.prefix.length);
      return null;
    }
    if (path.indexOf("skills/") === 0 || path.indexOf("plugins/") === 0) return null;
    return path;
  }

  function loadFiles() {
    api("/api/studio/files").then(function (data) {
      treeFiles = data.files || [];
      if (stage === "files") renderFilesStage();
    }).catch(function () { /* the stage shows its own empty state */ });
  }

  function refreshFiles() {
    api("/api/studio/files").then(function (data) {
      treeFiles = data.files || [];
      if (stage === "files") renderFilesStage();
    }).catch(function () { /* keep old list on transient failure */ });
  }

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
      html += '<div class="files-group"><div class="files-group-head"><span class="files-group-name">' +
        esc(r.name) + '</span><span class="files-count">' + list.length + "</span></div>";
      html += list.map(function (f) {
        var name = f.path.split("/").pop();
        return '<div class="file-row" data-path="' + esc(f.path) + '" role="button" tabindex="0">' +
          '<span class="file-row-main"><span class="file-row-name">' + esc(name) + "</span>" +
          '<span class="file-row-path">' + esc(f.path) + "</span></span>" +
          (f.updated_at ? '<span class="file-row-date">' + esc(fmtDate(f.updated_at)) + "</span>" : "") +
          "</div>";
      }).join("");
      html += "</div>";
    });
    box.innerHTML = html || '<div class="empty">No files yet — tell Brodie to build something.</div>';
    Array.prototype.forEach.call(box.querySelectorAll("[data-path]"), function (el) {
      function go() { openFile(el.getAttribute("data-path")); }
      el.addEventListener("click", go);
      el.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); }
      });
    });
  }

  $("#files-filter").addEventListener("input", renderFilesStage);

  /* ---------------- home: the room, inhabited ---------------- */

  function paintHomeContinue() {
    var box = $("#home-continue");
    if (!box) return;
    var has = ($("#home-files").innerHTML || "").length > 0 ||
              ($("#home-videos").innerHTML || "").length > 0;
    box.hidden = !has;
  }

  function renderHome() {
    var box = $("#home-continue");
    if (!box) return;
    // Recent files — the room's actual stuff, not demo props.
    api("/api/studio/files").then(function (data) {
      var files = (data.files || []).slice().sort(function (a, b) {
        return (b.updated_at || 0) - (a.updated_at || 0);
      }).slice(0, 4);
      var fbox = $("#home-files");
      if (files.length) {
        fbox.innerHTML = '<div class="home-label">Files</div>' + files.map(function (f) {
          var name = f.path.split("/").pop();
          return '<button type="button" class="home-file" data-path="' + esc(f.path) + '">' +
            '<span class="home-file-name">' + esc(name) + '</span>' +
            '<span class="home-file-path">' + esc(f.path) + '</span></button>';
        }).join("");
        Array.prototype.forEach.call(fbox.querySelectorAll(".home-file"), function (b) {
          b.addEventListener("click", function () {
            var p = b.getAttribute("data-path");
            openFile(p, isHtmlPath(p) ? { preview: true } : undefined);
          });
        });
      } else {
        fbox.innerHTML = "";
      }
      paintHomeContinue();
    }).catch(function () { /* quiet: home still works without the list */ });
    // Recent videos from the thread — pick up where you left off.
    api("/api/chat/messages").then(function (data) {
      var ids = [];
      (data.messages || []).forEach(function (m) {
        if (m.kind === "result" && m.video_ids) ids = ids.concat(m.video_ids);
      });
      ids = ids.slice(-4).reverse();
      var vbox = $("#home-videos");
      if (!ids.length) { vbox.innerHTML = ""; paintHomeContinue(); return; }
      Promise.all(ids.map(function (id) {
        return api("/api/tools/details?id=" + encodeURIComponent(id))
          .then(function (d) { return d.video || null; })
          .catch(function () { return null; });
      })).then(function (videos) {
        videos = videos.filter(function (v) { return !!v; });
        if (videos.length) {
          vbox.innerHTML = '<div class="home-label">Recently watched</div>' +
            '<div class="cards">' + videos.map(cardHTML).join("") + "</div>";
          wireCards(vbox, playVideoOnPage);
        } else {
          vbox.innerHTML = "";
        }
        paintHomeContinue();
      });
    }).catch(function () { /* quiet */ });
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
    var pv = $("#preview");
    pv.hidden = !has || !previewOn || !isHtmlPath(currentPath);
    if (!pv.hidden) pv.srcdoc = $("#editor").value;
    $("#preview-toggle").textContent = previewOn ? "Edit" : "Preview";
    $("#save-file-btn").disabled = !dirty;
  }

  function markDirty() {
    if (!dirty) { dirty = true; updateEditorChrome(); }
    $("#save-status").textContent = "";
  }

  function openFile(path, opts) {
    if (stage !== "build") setStage("build");
    currentPath = path;
    dirty = false;
    previewOn = !!(opts && opts.preview);
    updateEditorChrome();
    $("#save-status").textContent = "loading…";
    api("/api/studio/files?path=" + encodeURIComponent(path)).then(function (data) {
      $("#editor").value = data.content || "";
      $("#save-status").textContent = "";
      updateEditorChrome();
    }).catch(function (err) {
      if (/not found/i.test(err.message)) {
        $("#editor").value = "";
        dirty = true;
        updateEditorChrome();
        $("#save-status").textContent = "new file — press Save to create it";
      } else {
        $("#save-status").textContent = "couldn't open file: " + err.message;
        currentPath = null;
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
      refreshFiles();
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
        dirty = false;
        previewOn = false;
        $("#editor").value = "";
        $("#save-status").textContent = "";
        updateEditorChrome();
        refreshFiles();
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
    updateEditorChrome();
  });
  document.addEventListener("keydown", function (ev) {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") {
      if (currentPath && stage === "build") { ev.preventDefault(); saveFile(); }
    }
  });

  $("#editor-new-btn").addEventListener("click", promptNewFile);
  $("#files-new-btn").addEventListener("click", promptNewFile);

  /* ---------------- the closed command loop ----------------
   * ONE executor for every path: WebMCP tools, the /api/stage/command
   * inbox, and legacy kind:"command" chat messages. After executing, the
   * page posts a kind:"system" receipt so the agent sees the ack. */

  var executedCommands = {};

  function postReceipt(text) {
    api("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "room", text: text, kind: "system" })
    }).catch(function () { /* receipts are best-effort */ });
  }

  function runCommand(cmd) {
    var a = cmd.action;
    if (a === "show_stage" && typeof cmd.view === "string") {
      setStage(cmd.view);
      return { receipt: "stage → " + stage + " ✓", banner: "switched to " + stage };
    }
    if (a === "open_file" && typeof cmd.path === "string") {
      openFile(cmd.path);
      return { receipt: "opened " + cmd.path + " ✓", banner: "opened " + cmd.path };
    }
    if (a === "preview_file" && typeof cmd.path === "string") {
      openFile(cmd.path, { preview: true });
      return { receipt: "previewing " + cmd.path + " ✓", banner: "previewing " + cmd.path };
    }
    if (a === "dock" && typeof cmd.video_id === "string") {
      dockVideo(cmd.video_id);
      return { receipt: "docked video ✓", banner: "docked a video — it keeps playing while you work" };
    }
    if (a === "announce" && typeof cmd.text === "string") {
      return { receipt: "announced ✓", banner: cmd.text };
    }
    throw new Error("unknown action: " + a);
  }

  function execCommandMessage(m) {
    if (executedCommands[m.id]) return;
    executedCommands[m.id] = true;
    var cmd = null;
    try { cmd = JSON.parse(m.text); } catch (e) { /* not JSON — just hide it */ }
    if (!cmd || !cmd.action) return;
    try {
      var r = runCommand(cmd);
      clearBanner();
      agentBanner(r.banner);
      postReceipt(r.receipt);
    } catch (e) {
      postReceipt("command failed: " + e.message);
    }
  }

  function runAgentCommands(messages) {
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.kind === "command" && m.name === "Brodie") { execCommandMessage(m); continue; }
      // Malformed control JSON posted as chat: hide it, and only honor it
      // if it's fresh (stale pollution from earlier sessions stays buried).
      if (isHiddenCommand(m) && m.kind !== "command" && m.ts > bootTs) execCommandMessage(m);
    }
  }

  /* ---------------- shared room chat: the thread is a log ---------------- */

  var chatConfigured = true;
  var lastRenderedIds = "";
  var lastLocalSearchTs = 0;
  var lastMirroredResultId = "";
  var lastAgentMsgId = "";
  var paintTimer = null;

  /** A message is a control message — never rendered — when it's an
   *  explicit kind:"command", or when Brodie posted something that looks
   *  like {"action": ...} as plain chat (the old pollution). */
  function isHiddenCommand(m) {
    if (!m) return false;
    if (m.kind === "command") return true;
    return m.name === "Brodie" && /^\s*\{\s*"action"\s*:/.test(m.text || "");
  }

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
      if (isHiddenCommand(m) || m.kind === "system") continue;
      if (m.name && m.name !== me) return m;
    }
    return null;
  }

  function msgHTML(m) {
    if (m.kind === "system") {
      return '<div class="msg sys">' + esc(m.text) + "</div>";
    }
    var head;
    if (m.name === me) {
      head = '<div class="msg-head"><span class="who">' + esc(m.name) + "</span></div>";
    } else {
      head = '<div class="msg-head"><span class="msg-avatar">B</span>' +
        '<span class="who">' + esc(m.name || "Brodie") + "</span></div>";
    }
    var cls = "msg" + (m.name === me ? " mine" : "") + (m.kind === "result" ? " result" : "");
    var html = '<div class="' + cls + '">' + head;
    if (m.kind !== "result" || m.text) html += '<div class="msg-text">' + esc(m.text) + "</div>";
    if (m.kind === "result" && m.video_ids && m.video_ids.length) {
      html += '<div class="result-cards" data-ids="' + esc(m.video_ids.slice(0, 6).join(",")) + '"></div>';
    }
    return html + "</div>";
  }

  function paintResultCards() {
    Array.prototype.forEach.call(document.querySelectorAll(".result-cards"), function (el) {
      if (el.dataset.done) return;
      el.dataset.done = "1";
      var ids = (el.getAttribute("data-ids") || "").split(",").filter(Boolean);
      Promise.all(ids.map(function (id) {
        return api("/api/tools/details?id=" + encodeURIComponent(id))
          .then(function (data) { return data.video || null; })
          .catch(function () { return null; });
      })).then(function (videos) {
        videos = videos.filter(function (v) { return !!v; });
        if (!videos.length) { el.innerHTML = '<div class="empty">Videos unavailable.</div>'; return; }
        el.innerHTML = videos.map(cardHTML).join("");
        wireCards(el, stage === "build" ? dockVideo : playVideoOnPage);
      });
    });
  }

  function renderMessages(messages) {
    var ids = messages.map(function (m) { return m.id; }).join(",");
    if (ids === lastRenderedIds) return;
    lastRenderedIds = ids;

    // A fresh agent message: typing indicator + avatar pulse, then paint.
    var agent = newestAgentMessage(messages);
    var freshAgent = !!(agent && agent.id !== lastAgentMsgId);
    if (agent) lastAgentMsgId = agent.id;

    if (paintTimer) { clearTimeout(paintTimer); paintTimer = null; }
    if (freshAgent) {
      pulseAvatar();
      showTyping(true);
      clearBanner();
      paintTimer = setTimeout(function () {
        paintTimer = null;
        showTyping(false);
        paintMessages(messages, true);
      }, 1300);
    } else {
      paintMessages(messages, false);
    }
    runAgentCommands(messages);
  }

  function paintMessages(messages, freshAgent) {
    var box = $("#messages");
    var visible = messages.filter(function (m) { return !isHiddenCommand(m); });
    if (visible.length === 0) {
      box.innerHTML = '<div class="empty">No messages yet — say hello in the command bar.</div>';
    } else {
      box.innerHTML = visible.map(msgHTML).join("");
      paintResultCards();
    }
    updatePresence(messages);

    var drawerOpen = !$("#agent-drawer").hidden;
    if (drawerOpen) {
      box.scrollTop = box.scrollHeight;
    } else if (freshAgent) {
      // Fresh agent activity while the thread is closed: if the human is
      // mid-conversation (their latest message came after the drawer was
      // last closed), they're waiting on this reply — open the thread so
      // the answer is where they're looking. Otherwise nudge, don't yank.
      var agent = newestAgentMessage(messages);
      var humanTs = 0;
      for (var i = messages.length - 1; i >= 0; i--) {
        var hm = messages[i];
        if (hm.name !== "Brodie" && hm.name !== "room" && hm.kind !== "command" && hm.kind !== "system") {
          humanTs = hm.ts || 0;
          break;
        }
      }
      if (agent && humanTs > 0 && humanTs + 15000 >= lastDrawerCloseTs) {
        openDrawer();
      } else if (agent) {
        unread++;
        updateUnread();
        showToast("<b>" + esc(agent.name || "Brodie") + "</b> · " + esc(trunc(agent.text, 90)));
      }
    }

    for (var i = messages.length - 1; i >= 0; i--) {
      var m = messages[i];
      if (m.kind === "result" && m.video_ids && m.video_ids.length) { mirrorResultToResults(m); break; }
    }
  }

  function loadMessages() {
    api("/api/chat/messages").then(function (data) {
      chatConfigured = data.configured !== false;
      $("#chat-setup").hidden = chatConfigured;
      if (chatConfigured) renderMessages(data.messages || []);
    }).catch(function () {
      $("#chat-setup").hidden = false;
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
    }).catch(function () {
      showBanner("Couldn't reach the room — try again.", 5000);
      return null;
    });
  }

  /* ---------------- agent drawer + toast ---------------- */

  var unread = 0;
  var lastDrawerCloseTs = 0;
  function updateUnread() {
    var b = $("#unread-badge");
    b.hidden = unread <= 0;
    b.textContent = unread > 9 ? "9+" : String(unread);
  }

  function openDrawer() {
    $("#agent-drawer").hidden = false;
    $("#agent-scrim").hidden = false;
    unread = 0;
    updateUnread();
    hideToast();
    var box = $("#messages");
    box.scrollTop = box.scrollHeight;
  }
  function closeDrawer() {
    $("#agent-drawer").hidden = true;
    $("#agent-scrim").hidden = true;
    lastDrawerCloseTs = Date.now();
  }

  $("#agent-presence").addEventListener("click", function () {
    if ($("#agent-drawer").hidden) openDrawer(); else closeDrawer();
  });
  $("#agent-presence").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); $("#agent-presence").click(); }
  });
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#agent-scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !$("#agent-drawer").hidden) closeDrawer();
  });

  var toastTimer = null;
  function showToast(html) {
    var t = $("#agent-toast");
    t.innerHTML = html;
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 7000);
  }
  function hideToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    $("#agent-toast").hidden = true;
  }
  $("#agent-toast").addEventListener("click", openDrawer);

  /* ---------------- command bar: the primary interface ---------------- */

  function stripCommandVerbs(v) {
    var q = v
      .replace(/^(please\s+)?(find|show|get|search|look\s*up|play|watch|dock)(\s+me)?(\s+(a|an|the|some))?\s+/i, "")
      .replace(/^(for|about|on)\s+/i, "")
      .replace(/\s+(video|videos)\s*$/i, "");
    return q.trim() || v;
  }

  var VIDEO_WORDS = /\b(video|videos|watch|youtube|lofi|song|songs|music|clip|trailer|tutorial|beats|podcast)\b/i;
  var FILE_WORDS = /\b(files?|skills?|plugins?|file tree|explorer)\b/i;

  function optimisticWorking(text) {
    showBanner("On it — " + esc(trunc(text, 70)), 0);
    if (optimisticTimer) clearTimeout(optimisticTimer);
    optimisticTimer = setTimeout(clearBanner, 30000);
  }

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
    optimisticWorking(v);
    postChat(v);
    var low = v.toLowerCase();
    // Local shortcuts: the stage change itself is the feedback.
    if (/\btrend/.test(low)) { clearBanner(); runTrending(); return; }
    if (/\bdock\b/.test(low) && VIDEO_WORDS.test(low)) {
      var q = stripCommandVerbs(v);
      lastLocalSearchTs = Date.now();
      setActivity("docking a video…");
      api("/api/tools/search?q=" + encodeURIComponent(q) + "&max=1").then(function (data) {
        var vids = data.videos || [];
        if (vids.length) dockVideo(vids[0].video_id);
        clearBanner();
        clearActivityOverride();
      }).catch(function () { clearBanner(); clearActivityOverride(); });
      return;
    }
    if (FILE_WORDS.test(low) && !VIDEO_WORDS.test(low)) { clearBanner(); setStage("files"); return; }
    if (VIDEO_WORDS.test(low)) { runSearch(stripCommandVerbs(v)); return; }
    // Otherwise the message sits in the room: the agent composes the
    // dashboard with the command inbox + the other tools.
  }

  /* Small notices from the command bar. */
  function barToast(msg) {
    var t = $("#bar-toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(barToast._timer);
    barToast._timer = setTimeout(function () { t.hidden = true; }, 3400);
  }

  /* ---------------- composer: + | dictate | voice ----------------
   * The bar is the agent's body. + hands it context (photos, room files,
   * the video playing now) instead of just files. Mic dictates into the
   * box. The blue button is voice mode: talk, tap, it's sent. */

  var attachments = []; // {kind:"photo",name,dataUrl} | {kind:"file",path} | {kind:"video",videoId,title}

  function currentVideoId() {
    var dock = $("#dock");
    if (dock && !dock.hidden && dock.dataset.videoId) return dock.dataset.videoId;
    var frame = $("#player");
    if (frame && frame.src) {
      var m = frame.src.match(/embed\/([^?&#]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
    return null;
  }

  function renderAttachTray() {
    var tray = $("#attach-tray");
    if (!tray) return;
    tray.innerHTML = "";
    tray.hidden = attachments.length === 0;
    attachments.forEach(function (a, i) {
      var chip = document.createElement("div");
      chip.className = "attach-chip";
      var label, sub;
      if (a.kind === "photo") {
        var im = document.createElement("img");
        im.src = a.dataUrl; im.alt = "";
        chip.appendChild(im);
        label = a.name;
      } else if (a.kind === "file") {
        var doc = document.createElement("span");
        doc.className = "attach-doc"; doc.textContent = "DOC";
        chip.appendChild(doc);
        label = a.path.split("/").pop();
      } else {
        var vid = document.createElement("span");
        vid.className = "attach-doc"; vid.textContent = "▶";
        chip.appendChild(vid);
        label = a.title || a.videoId;
      }
      var nm = document.createElement("span");
      nm.className = "attach-name"; nm.textContent = label;
      var x = document.createElement("button");
      x.type = "button"; x.className = "attach-x"; x.textContent = "×";
      x.setAttribute("aria-label", "Remove attachment");
      x.addEventListener("click", function () { attachments.splice(i, 1); renderAttachTray(); });
      chip.appendChild(nm); chip.appendChild(x);
      tray.appendChild(chip);
    });
  }

  function handleAttachImage(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || "")) { barToast("Only images for now."); return; }
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      try {
        var max = 1024;
        var scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        attachments.push({ kind: "photo", name: file.name || "photo.jpg", dataUrl: c.toDataURL("image/jpeg", 0.72) });
        renderAttachTray();
      } catch (e) { barToast("Couldn't read that image."); }
      URL.revokeObjectURL(url);
    };
    img.onerror = function () { URL.revokeObjectURL(url); barToast("Couldn't read that image."); };
    img.src = url;
  }

  function openRoomFilePicker() {
    var sheet = $("#plus-sheet");
    var files = (typeof treeFiles !== "undefined" ? treeFiles : []).slice().sort(function (a, b) {
      return (b.updated_at || 0) - (a.updated_at || 0);
    }).slice(0, 10);
    if (!files.length) { barToast("No room files yet."); return; }
    sheet.innerHTML = '<div class="sheet-head">Attach a room file</div>' + files.map(function (f) {
      return '<button type="button" data-path="' + esc(f.path) + '">' + esc(f.path.split("/").pop()) +
        '<span class="sheet-file-sub">' + esc(f.path) + "</span></button>";
    }).join("");
    Array.prototype.forEach.call(sheet.querySelectorAll("button[data-path]"), function (b) {
      b.addEventListener("click", function () {
        attachments.push({ kind: "file", path: b.getAttribute("data-path") });
        renderAttachTray();
        resetPlusSheet();
        sheet.hidden = true;
      });
    });
  }

  function resetPlusSheet() {
    $("#plus-sheet").innerHTML =
      '<button type="button" data-act="camera">Take photo</button>' +
      '<button type="button" data-act="library">Choose from library</button>' +
      '<button type="button" data-act="roomfile">Attach a room file</button>' +
      '<button type="button" data-act="video">Attach current video</button>';
  }

  $("#plus-btn").addEventListener("click", function (ev) {
    ev.stopPropagation();
    var sheet = $("#plus-sheet");
    if (sheet.hidden && !sheet.querySelector("button")) resetPlusSheet();
    sheet.hidden = !sheet.hidden;
  });
  document.addEventListener("click", function (ev) {
    var sheet = $("#plus-sheet");
    if (!sheet.hidden && !ev.target.closest("#plus-sheet") && !ev.target.closest("#plus-btn")) {
      sheet.hidden = true;
      resetPlusSheet();
    }
  });
  $("#plus-sheet").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    var sheet = $("#plus-sheet");
    if (act === "camera" || act === "library") {
      sheet.hidden = true; resetPlusSheet();
      var inp = $(act === "camera" ? "#attach-camera" : "#attach-library");
      inp.value = "";
      inp.click();
    } else if (act === "roomfile") {
      openRoomFilePicker();
    } else if (act === "video") {
      var vid = currentVideoId();
      sheet.hidden = true; resetPlusSheet();
      if (!vid) { barToast("Nothing playing right now."); return; }
      var title = ($("#now-playing") && $("#now-playing").textContent || "").replace(/^▶\s*/, "") || vid;
      attachments.push({ kind: "video", videoId: vid, title: title });
      renderAttachTray();
    }
  });
  $("#attach-camera").addEventListener("change", function () { handleAttachImage(this.files && this.files[0]); });
  $("#attach-library").addEventListener("change", function () { handleAttachImage(this.files && this.files[0]); });

  function speechRecog() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    return SR ? new SR() : null;
  }

  /* Mic: dictation. Fills the box, doesn't send. */
  var dictating = false, dictRecog = null;
  $("#mic-btn").addEventListener("click", function () {
    var btn = this;
    if (dictating) { try { dictRecog.stop(); } catch (e) {} return; }
    var r = speechRecog();
    if (!r) { barToast("Dictation isn't supported in this browser — type instead."); return; }
    var input = $("#command-input");
    var base = input.value ? input.value.replace(/\s+$/, "") + " " : "";
    var finalT = "";
    r.lang = "en-US"; r.interimResults = true; r.continuous = true;
    r.onresult = function (ev) {
      var interim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var tr = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalT += tr + " ";
        else interim += tr;
      }
      input.value = base + finalT + interim;
    };
    r.onend = function () { dictating = false; btn.classList.remove("live"); };
    r.onerror = function () { dictating = false; btn.classList.remove("live"); };
    dictRecog = r; dictating = true;
    btn.classList.add("live");
    try { r.start(); } catch (e) { dictating = false; btn.classList.remove("live"); }
  });

  /* Blue button: voice mode. Talk, tap to send — it goes straight in. */
  $("#voice-btn").addEventListener("click", function () {
    var r = speechRecog();
    if (!r) { barToast("Voice mode isn't supported in this browser — type or dictate instead."); return; }
    if (dictating) { try { dictRecog.stop(); } catch (e) {} }
    var ov = $("#voice-overlay");
    var vt = $("#voice-transcript");
    vt.textContent = "";
    $("#voice-status").textContent = "Listening…";
    ov.hidden = false;
    var finalT = "", lastText = "", done = false;
    r.lang = "en-US"; r.interimResults = true; r.continuous = true;
    r.onresult = function (ev) {
      var interim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var tr = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalT += tr + " ";
        else interim += tr;
      }
      lastText = (finalT + interim).trim();
      vt.textContent = lastText;
    };
    function close(send) {
      if (done) return; done = true;
      try { r.stop(); } catch (e) {}
      ov.hidden = true;
      if (send && lastText) handleCommand(lastText);
      else if (send) barToast("Didn't catch that — try again.");
    }
    $("#voice-stop").onclick = function () { close(true); };
    r.onend = function () { close(true); };
    r.onerror = function (ev) {
      if (ev && ev.error === "not-allowed") {
        $("#voice-status").textContent = "Mic blocked — allow microphone access and try again.";
      }
    };
    try { r.start(); } catch (e) { ov.hidden = true; barToast("Couldn't start voice mode."); }
  });

  /* Submit: photos get persisted to the room first, then the whole
     command — attachments as context markers — goes to the agent. */
  $("#command-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = $("#command-input");
    var v = input.value;
    var atts = attachments.slice();
    attachments = [];
    renderAttachTray();
    input.value = "";
    input.blur();
    if (!atts.length) { handleCommand(v); return; }
    var stamp = Date.now();
    barToast("Attaching…");
    Promise.all(atts.map(function (a, i) {
      if (a.kind === "photo") {
        var path = "uploads/" + stamp + "-" + i + ".jpg";
        return api("/api/studio/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: path, content: a.dataUrl })
        }).then(function () { return "[photo " + (i + 1) + ": " + path + "]"; })
          .catch(function () { return "[photo " + (i + 1) + ": upload failed]"; });
      }
      if (a.kind === "file") return Promise.resolve("[file: " + a.path + "]");
      return Promise.resolve("[video: " + a.videoId + " — " + a.title + "]");
    })).then(function (marks) {
      handleCommand((marks.join(" ") + " " + v).trim());
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (c) {
    c.addEventListener("click", function () { handleCommand(c.getAttribute("data-cmd")); });
  });

  /* Manual search on the watch stage (content search, not an agent command). */
  $("#watch-search-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = $("#watch-search-input");
    var q = input.value.trim();
    if (!q) return;
    input.blur();
    runSearch(q);
  });

  /* ---------------- WebMCP tool surface ----------------
   * Teach the agent the generative-UI pattern: the human never clicks —
   * compose the stage first, fill it second, and always finish the last
   * click yourself (preview_file after writing HTML, play/dock directly). */

  function webmcpSupported() {
    try {
      return "modelContext" in window.navigator && !!window.navigator.modelContext;
    } catch (e) { return false; }
  }

  var TOOLS = [
    {
      name: "show_stage",
      description: "Reconfigure the dashboard stage for the human — they should never have to click around. When the human asks to do something, call this FIRST to bring up the right surface, then fill it with the other tools. Views: 'home' (welcome screen with suggestion chips), 'watch' (video results + player), 'build' (code editor), 'files' (file browser). Example: 'find me a video about sourdough' → search_videos, show_stage('watch'), display_videos. 'Build me a landing page' → studio_write_file, preview_file. 'Show my files' → show_stage('files'). The page acknowledges every command with a receipt.",
      inputSchema: {
        type: "object",
        properties: {
          view: { type: "string", description: "Which stage to show: home, watch, build, or files", enum: ["home", "watch", "build", "files"] }
        },
        required: ["view"]
      },
      execute: function (params) {
        var r = runCommand({ action: "show_stage", view: params.view });
        agentBanner(r.banner);
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
        if (stage === "build") {
          runCommand({ action: "dock", video_id: params.video_id });
          agentBanner("docked a video — it keeps playing while you work");
        } else {
          playVideoOnPage(params.video_id);
          agentBanner("playing video");
        }
        return Promise.resolve({ playing: params.video_id });
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
        var r = runCommand({ action: "dock", video_id: params.video_id });
        agentBanner(r.banner);
        return Promise.resolve({ docked: params.video_id });
      }
    },
    {
      name: "open_file",
      description: "Open a studio file in the dashboard's editor — the build stage pops up automatically with the file loaded. For HTML files you just wrote, prefer preview_file so the human sees the result immediately.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "File path in the studio tree, e.g. 'index.html' or 'skills/my-skill/SKILL.md'" } },
        required: ["path"]
      },
      execute: function (params) {
        var r = runCommand({ action: "open_file", path: params.path });
        agentBanner(r.banner);
        return Promise.resolve({ opened: params.path });
      }
    },
    {
      name: "preview_file",
      description: "Open a studio file AND show its rendered preview immediately — the last click, finished for the human. Always call this (not open_file) right after studio_write_file on an .html file, so what you built appears in front of them with zero clicks.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "HTML file path in the studio tree, e.g. 'index.html'" } },
        required: ["path"]
      },
      execute: function (params) {
        var r = runCommand({ action: "preview_file", path: params.path });
        agentBanner(r.banner);
        return Promise.resolve({ previewing: params.path });
      }
    },
    {
      name: "studio_list_files",
      description: "List every file in the studio: files, skills, and plugins.",
      inputSchema: { type: "object", properties: {} },
      execute: function () { return api("/api/studio/files"); }
    },
    {
      name: "studio_read_file",
      description: "Read a file from the studio by path (e.g. 'skills/example/SKILL.md').",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "File path in the studio" } },
        required: ["path"]
      },
      execute: function (params) {
        return api("/api/studio/files?path=" + encodeURIComponent(params.path));
      }
    },
    {
      name: "studio_write_file",
      description: "Create or overwrite a file in the studio. This is how you build with the human: when they ask for something ('build me a landing page', 'add a notes file'), write it here, then call preview_file (for .html) or open_file so it appears in front of them with zero clicks. The Files stage picks it up instantly.",
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
          refreshFiles();
          return data;
        });
      }
    },
    {
      name: "studio_delete_file",
      description: "Delete a file from the studio by path. Use when the human asks to remove something ('delete that draft', 'remove notes/todo.md'). The file tree refreshes instantly.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path in the studio to delete" }
        },
        required: ["path"]
      },
      execute: function (params) {
        return api("/api/studio/files?path=" + encodeURIComponent(params.path), {
          method: "DELETE"
        }).then(function (data) {
          if (params.path === currentPath) {
            currentPath = null;
            dirty = false;
            previewOn = false;
            $("#editor").value = "";
            $("#save-status").textContent = "";
            updateEditorChrome();
          }
          refreshFiles();
          return data;
        });
      }
    },
    {
      name: "announce",
      description: "Show a short activity banner on the dashboard stage itself ('writing index.html…', 'pulling up trending videos…') so the human sees your hand moving the room — the stage narrates, not just the chat. Keep it under 8 words.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Banner text, e.g. 'pulling up trending videos…'" }
        },
        required: ["text"]
      },
      execute: function (params) {
        agentBanner(params.text);
        return Promise.resolve({ announced: params.text });
      }
    },
    {
      name: "read_messages",
      description: "Read the latest messages in the shared room chat — THIS is how you see what the human typed in the command bar. Poll it to wait for new messages, then compose the dashboard. To drive the stage from outside this browser, POST to /api/stage/command instead — you get a synchronous ack, and the page posts a kind:'system' receipt when it executes.",
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
      description: "Post into the shared room chat as the agent. The human sees it in the agent thread (avatar pulses, toast appears if the thread is closed) — this is how you talk back while you work the dashboard. For driving the stage itself, prefer the dedicated tools or POST /api/stage/command over chat.",
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
    var sub = $("#drawer-sub");
    function setState(live) {
      sub.textContent = live ? "thread · agent tools live" : "thread · chat link";
    }
    if (!webmcpSupported()) { setState(false); return; }
    try {
      var mc = window.navigator.modelContext;
      if (typeof mc.registerTool === "function") {
        TOOLS.forEach(function (t) { try { mc.registerTool(t); } catch (e) { /* name clash */ } });
      } else if (typeof mc.provideContext === "function") {
        mc.provideContext({ tools: TOOLS });
      } else {
        setState(false); return;
      }
      setState(true);
      window.__roomTools = TOOLS.map(function (t) { return t.name; });
    } catch (e) {
      setState(false);
    }
  }

  /* ---------------- boot ---------------- */

  setStage(stage);
  updateEditorChrome();
  loadFiles();
  registerWebMCP();
  if (ensureName()) { $("#name-overlay").hidden = true; loadMessages(); }
  setInterval(function () { if (me && chatConfigured) loadMessages(); }, 3000);
})();
