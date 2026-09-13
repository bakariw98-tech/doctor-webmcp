/* Taste Room — the training harness, WebMCP edition.
 *
 * The room posts a job. Brodie (the agent on the other end) picks it up,
 * generates the two variations himself, and uploads them back into the room.
 * No third-party image API: the agent is the compute.
 *
 * Flow: prompt -> POST /api/taste/jobs -> poll job status ->
 *   done -> fetch each image data URI -> pick winner -> profile learns.
 */
(function () {
  "use strict";

  var JOBS_API = "/api/taste/jobs";
  var KEY = "brodie_taste_profile_v1";
  var POLL_MS = 4000;

  function $(sel) { return document.querySelector(sel); }

  function loadProfile() {
    try {
      var p = JSON.parse(localStorage.getItem(KEY));
      if (p && typeof p === "object" && p.likes && p.dislikes) return p;
    } catch (e) { /* fresh */ }
    return { likes: {}, dislikes: {}, notes: [], rounds: 0 };
  }
  function saveProfile() {
    try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (e) { /* ignore */ }
  }

  var profile = loadProfile();
  var current = null; // { prompt, jobId, a, b } — the live round
  var pollTimer = null;
  var busy = false;
  var agentMode = /[?&]agent=brodie/.test(window.location.search);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function topTags(map, n) {
    return Object.keys(map).sort(function (x, y) { return map[y] - map[x]; }).slice(0, n);
  }

  function renderProfile(flash) {
    var likes = topTags(profile.likes, 8);
    var dislikes = topTags(profile.dislikes, 8);

    $("#taste-rounds").textContent = profile.rounds + (profile.rounds === 1 ? " round" : " rounds");

    $("#taste-likes").innerHTML = likes.length
      ? likes.map(function (t) {
          return '<span class="taste-tag like' + (flash ? " flash" : "") + '">' + esc(t) + " ×" + profile.likes[t] + "</span>";
        }).join("")
      : '<span class="muted">Nothing yet — make your first pick.</span>';

    $("#taste-dislikes").innerHTML = dislikes.length
      ? dislikes.map(function (t) {
          return '<span class="taste-tag dislike">' + esc(t) + " ×" + profile.dislikes[t] + "</span>";
        }).join("")
      : '<span class="muted">Nothing rejected yet.</span>';

    $("#taste-notes").innerHTML = profile.notes.length
      ? profile.notes.slice(-4).reverse().map(function (n) {
          return '<div class="taste-note">“' + esc(n) + "”</div>";
        }).join("")
      : '<span class="muted">Your reasons will land here.</span>';
  }

  function setStatus(msg) {
    $("#taste-status").textContent = msg || "";
  }

  function agoText(sec) {
    if (sec == null) return "";
    if (sec < 60) return "active " + sec + "s ago";
    var m = Math.round(sec / 60);
    if (m < 60) return "active " + m + "m ago";
    return "active " + Math.round(m / 60) + "h ago";
  }

  function checkPresence() {
    fetch("/api/taste/presence")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var dot = $("#presence-dot");
        var txt = $("#presence-text");
        if (!dot || !txt) return;
        if (d && d.ok && d.alive) {
          dot.classList.add("on");
          txt.textContent = "Brodie is here" + (d.lastSeenAgoSec != null ? " · " + agoText(d.lastSeenAgoSec) : "");
        } else {
          dot.classList.remove("on");
          txt.textContent = d && d.ok && d.lastSeenAgoSec != null
            ? "Brodie is away · " + agoText(d.lastSeenAgoSec)
            : "Brodie is away";
        }
      })
      .catch(function () { /* transient — next check retries */ });
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function setArenaWaiting() {
    var arena = $("#taste-arena");
    arena.hidden = false;
    ["a", "b"].forEach(function (side) {
      var img = $("#taste-img-" + side);
      img.removeAttribute("src");
      img.alt = "Waiting for Brodie…";
      $("#taste-card-" + side).classList.add("loading");
      $("#taste-card-" + side).classList.remove("winner");
      $("#taste-label-" + side).textContent = "brodie is creating…";
    });
    $("#taste-why").hidden = true;
  }

  function submitJob(prompt) {
    if (busy) return;
    busy = true;
    stopPolling();
    setArenaWaiting();
    setStatus("Sent to Brodie — he's picking it up…");
    fetch(JOBS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt,
        likes: topTags(profile.likes, 12),
        dislikes: topTags(profile.dislikes, 12),
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok || !data.job_id) {
          busy = false;
          setStatus("Couldn't post that job. Try again.");
          return;
        }
        current = { prompt: prompt, jobId: data.job_id, a: null, b: null };
        pollJob();
        pollTimer = setInterval(pollJob, POLL_MS);
      })
      .catch(function () {
        busy = false;
        setStatus("Couldn't reach the room. Check your connection and try again.");
      });
  }

  function pollJob() {
    if (!current) return;
    fetch(JOBS_API + "?id=" + encodeURIComponent(current.jobId))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok || !data.job) return;
        var status = data.job.status;
        if (status === "working") {
          setStatus("Brodie is making two variations…");
        } else if (status === "failed") {
          stopPolling();
          busy = false;
          setStatus("Brodie couldn't make these — try again or rephrase.");
        } else if (status === "done" && data.images && data.images.length >= 2) {
          stopPolling();
          loadImages(data.images);
        }
        // pending: keep the "picking it up" message, keep polling
      })
      .catch(function () { /* transient — next poll retries */ });
  }

  function loadImages(images) {
    setStatus("Brodie's back — pick the one you like. The pick alone trains; the why is bonus.");
    var done = 0;
    images.slice(0, 2).forEach(function (meta, i) {
      var side = i === 0 ? "a" : "b";
      fetch(meta.url)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.dataUri) {
            var card = $("#taste-card-" + side);
            card.classList.remove("loading");
            var img = $("#taste-img-" + side);
            img.alt = "Variation " + side.toUpperCase() + " — " + (meta.styleLabel || "by Brodie");
            img.src = d.dataUri;
            $("#taste-label-" + side).textContent = meta.styleLabel || "Brodie's take";
            current[side] = { tags: meta.tags || [], styleLabel: meta.styleLabel || "" };
          }
          done++;
          if (done === 2) busy = false;
        })
        .catch(function () {
          done++;
          if (done === 2) { busy = false; setStatus("One variation didn't load — try the round again."); }
        });
    });
  }

  function pick(side) {
    if (!current || !current.a || !current.b || busy) return;
    var winner = current[side];
    var loser = current[side === "a" ? "b" : "a"];

    winner.tags.forEach(function (t) {
      profile.likes[t] = (profile.likes[t] || 0) + 1;
    });
    loser.tags.forEach(function (t) {
      profile.dislikes[t] = (profile.dislikes[t] || 0) + 1;
    });
    profile.rounds += 1;
    saveProfile();
    renderProfile(true);

    $("#taste-card-a").classList.toggle("winner", side === "a");
    $("#taste-card-b").classList.toggle("winner", side === "b");
    $("#taste-why-title").innerHTML =
      "Nice pick" + (winner.styleLabel ? " — <b>" + esc(winner.styleLabel) + "</b>" : "") +
      ". Want to say why? " + '<span class="muted">(optional)</span>';
    $("#taste-why").hidden = false;
    $("#taste-why-input").value = "";
    setStatus("Logged. Your profile just got sharper — watch it steer the next round.");
  }

  function nextRound() {
    var why = $("#taste-why-input").value.trim().slice(0, 200);
    if (why) {
      profile.notes.push(why);
      saveProfile();
      renderProfile(false);
    }
    $("#taste-why").hidden = true;
    if (current) submitJob(current.prompt);
  }

  function reset() {
    if (!window.confirm("Start over? Your taste profile goes back to zero.")) return;
    profile = { likes: {}, dislikes: {}, notes: [], rounds: 0 };
    saveProfile();
    renderProfile(false);
    setStatus("Fresh eye. Make your first pick.");
  }

  /* ---------------- Agent mode: the room's second face ----------------
   * ?agent=brodie logs the agent in. The human UI hides; the workbench shows.
   * This is the page speaking to the agent: queue, contract, standing orders.
   */
  function agentAgo(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + "s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    return Math.round(m / 60) + "h ago";
  }

  function agentCheckPresence() {
    fetch("/api/taste/presence")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var dot = $("#agent-dot"), txt = $("#agent-presence-text");
        if (!dot || !txt) return;
        if (d && d.ok && d.alive) {
          dot.classList.add("on");
          txt.textContent = "you're here · " + (d.lastSeenAgoSec != null ? agoText(d.lastSeenAgoSec) : "active now");
        } else {
          dot.classList.remove("on");
          txt.textContent = "no check-in yet";
        }
      })
      .catch(function () { /* next poll retries */ });
  }

  function agentCheckin(note) {
    fetch("/api/taste/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note || "on shift" }),
    }).then(agentCheckPresence).catch(function () { /* ignore */ });
  }

  function loadAgentQueue() {
    fetch(JOBS_API + "?status=pending")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var box = $("#agent-queue");
        if (!box) return;
        var jobs = (d && d.ok && d.jobs) || [];
        $("#agent-queue-count").textContent = jobs.length ? "· " + jobs.length + " waiting" : "· clear";
        if (!jobs.length) {
          box.innerHTML = '<span class="muted">Queue is clear. Nothing owed.</span>';
          return;
        }
        box.innerHTML = jobs.map(function (j) {
          var likes = (j.likes || []).map(function (t) { return '<span class="taste-tag like">' + esc(t) + "</span>"; }).join(" ");
          var dislikes = (j.dislikes || []).map(function (t) { return '<span class="taste-tag dislike">' + esc(t) + "</span>"; }).join(" ");
          return '<div class="agent-job">' +
            '<div class="agent-job-top"><code>' + esc(j.id) + "</code></div>" +
            '<div class="agent-job-prompt">“' + esc(j.prompt) + "”</div>" +
            '<div class="agent-job-tags">' + (likes || '<span class="muted">no likes yet</span>') + " " + (dislikes || "") + "</div>" +
            "</div>";
        }).join("");
      })
      .catch(function () { /* next poll retries */ });
  }

  function loadAgentRecent() {
    fetch(JOBS_API + "?recent=1")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var box = $("#agent-recent");
        if (!box) return;
        var jobs = (d && d.ok && d.jobs) || [];
        if (!jobs.length) {
          box.innerHTML = '<span class="muted">No work yet.</span>';
          return;
        }
        box.innerHTML = jobs.map(function (j) {
          return '<div class="agent-job">' +
            '<div class="agent-job-top"><code>' + esc(j.id) + '</code> <span class="agent-status st-' + esc(j.status) + '">' + esc(j.status) + "</span>" +
            ' <span class="muted">' + agentAgo(j.created_at) + "</span></div>" +
            '<div class="agent-job-prompt">“' + esc(j.prompt) + "”</div>" +
            "</div>";
        }).join("");
      })
      .catch(function () { /* next poll retries */ });
  }

  function initAgent() {
    document.title = "Taste Room — agent session";
    var human = $("#taste-human"), agent = $("#taste-agent");
    if (human) human.hidden = true;
    if (agent) agent.hidden = false;
    var login = $("#taste-agent-login");
    if (login) login.hidden = true;
    var h1 = document.querySelector(".taste-head h1");
    if (h1) h1.textContent = "Taste Room — agent side";
    var sub = document.querySelector(".taste-head .muted");
    if (sub) sub.hidden = true;
    agentCheckPresence();
    loadAgentQueue();
    loadAgentRecent();
    setInterval(agentCheckPresence, 30000);
    setInterval(loadAgentQueue, 10000);
    setInterval(loadAgentRecent, 30000);
    $("#agent-checkin").addEventListener("click", function () { agentCheckin("on shift"); });
    $("#agent-logout").addEventListener("click", function () {
      window.location.search = "";
    });
  }

  function init() {
    if (!$("#taste-form")) return;
    if (agentMode) { initAgent(); return; }
    renderProfile(false);
    checkPresence();
    setInterval(checkPresence, 30000);
    $("#taste-agent-login").addEventListener("click", function () {
      window.location.search = "?agent=brodie";
    });

    $("#taste-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var p = $("#taste-prompt").value.trim();
      if (!p) { setStatus("Give Brodie a prompt first — anything visual."); return; }
      submitJob(p);
    });

    document.querySelectorAll(".taste-pick").forEach(function (btn) {
      btn.addEventListener("click", function () { pick(btn.getAttribute("data-pick")); });
    });

    $("#taste-why-form").addEventListener("submit", function (e) {
      e.preventDefault();
      nextRound();
    });

    $("#taste-reset").addEventListener("click", reset);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.TasteRoom = { profile: function () { return profile; } };
})();
