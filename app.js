/* YouTube Doctor — WebMCP edition.
 * One page, two jobs:
 *  1. Registers WebMCP tools (navigator.modelContext) so any AI browser agent
 *     can search the channel, render results, and drive the player — no clicking.
 *  2. Hosts the shared room chat where the human types and the agent reads —
 *     the chat itself is exposed as read_messages / send_message tools, so the
 *     agent talks through the tool surface instead of scraping the page.
 * Everything degrades gracefully when WebMCP or the chat database are unavailable.
 */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };

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

  /* ---------------- video cards + player (generative UI) ---------------- */

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

  function wireCards(container) {
    Array.prototype.forEach.call(container.querySelectorAll(".card"), function (el) {
      function go() { playVideoOnPage(el.getAttribute("data-video-id")); }
      el.addEventListener("click", go);
      el.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); }
      });
    });
  }

  /** Render video cards into the results area. Called by the display_videos tool. */
  function displayVideosOnPage(videos) {
    var box = $("#results");
    if (!videos || videos.length === 0) {
      box.innerHTML = '<div class="empty">No videos found — try a different search.</div>';
      return 0;
    }
    box.innerHTML = videos.map(cardHTML).join("");
    wireCards(box);
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return videos.length;
  }

  /** Load a video into the embedded player. Called by the play_video tool. */
  function playVideoOnPage(videoId) {
    if (!videoId) return null;
    var frame = $("#player");
    frame.src = "https://www.youtube.com/embed/" + encodeURIComponent(videoId) + "?autoplay=1&rel=0";
    $("#player-section").hidden = false;
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

  $("#trending-btn").addEventListener("click", function () {
    api("/api/tools/trending?max=8").then(function (data) {
      displayVideosOnPage(data.videos);
    }).catch(function (err) {
      $("#results").innerHTML = '<div class="empty">Could not load videos: ' + esc(err.message) + "</div>";
    });
  });

  /* ---------------- WebMCP tool surface ---------------- */

  function webmcpSupported() {
    try {
      return "modelContext" in window.navigator && !!window.navigator.modelContext;
    } catch (e) { return false; }
  }

  var TOOLS = [
    {
      name: "search_videos",
      description: "Search all of YouTube by keyword. Pass channel_id to narrow the search to one channel (e.g. 'his videos'). Omit query when channel_id is given to get that channel's latest uploads.",
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
      description: "List what's popular on YouTube right now.",
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
      description: "Render video cards into the page's results area so the human can see and tap them. Call this after searching, with the video ids you want to show.",
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
      description: "Load a video into the page's embedded player so the human can watch it right here.",
      inputSchema: {
        type: "object",
        properties: { video_id: { type: "string", description: "The YouTube video id to play" } },
        required: ["video_id"]
      },
      execute: function (params) {
        var id = playVideoOnPage(params.video_id);
        return Promise.resolve({ playing: id });
      }
    },
    {
      name: "read_messages",
      description: "Read the latest messages in the shared room chat. THIS is how you see what the human typed — use it instead of scraping the page. Poll it to wait for new messages.",
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
      description: "Post a message into the shared room chat as the agent — reply to the human, announce results, or share video ids. The human sees it instantly on the page.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The message text" },
          name: { type: "string", description: "Display name to post as", default: "Agent" },
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
            name: (params.name || "Agent").slice(0, 40),
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
      // Expose for debugging / non-WebMCP agents that can run page JS.
      window.__ydocTools = TOOLS.map(function (t) { return t.name; });
    } catch (e) {
      setLive(false);
    }
  }

  /* ---------------- shared chat ---------------- */

  var chatConfigured = true;
  var lastRenderedIds = "";

  function renderMessages(messages) {
    var box = $("#messages");
    var ids = messages.map(function (m) { return m.id; }).join(",");
    if (ids === lastRenderedIds) return; // nothing new
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
            '<div class="card-body"><p class="card-title">▶ Watch video</p>' +
            '<div class="card-meta"><span>' + esc(id) + "</span></div></div></article>";
        }).join("") + "</div>";
      }
      return html + "</div>";
    }).join("");
    wireCards(box);
    box.scrollTop = box.scrollHeight;
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

  // The big prompt searches YouTube directly and shows the videos as cards,
  // so the page works with no agent in the loop. It also posts into the room
  // so the agent (when present) sees the request.
  $("#ask-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = $("#ask-input");
    var v = input.value.trim();
    if (!v) return;
    input.value = "";
    postChat(v);
    var box = $("#results");
    box.innerHTML = '<div class="empty">Searching…</div>';
    api("/api/tools/search?q=" + encodeURIComponent(v) + "&max=8").then(function (data) {
      displayVideosOnPage(data.videos);
    }).catch(function (err) {
      box.innerHTML = '<div class="empty">Could not search: ' + esc(err.message) + "</div>";
    });
  });

  /* ---------------- boot ---------------- */

  loadChannel();
  registerWebMCP();
  if (ensureName()) { $("#name-overlay").hidden = true; loadMessages(); }
  setInterval(function () { if (me && chatConfigured) loadMessages(); }, 3000);
})();
