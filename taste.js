/* Taste Room — the training harness.
 * Brodie makes two variations. You pick the winner, say why if you want.
 * Every pick sharpens your taste profile (localStorage), and the profile
 * steers every future round. The harness is the product; the agent is
 * interchangeable; the profile is the asset. */
(function () {
  "use strict";

  var API = "/api/taste/generate";
  var KEY = "brodie_taste_profile_v1";

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
  var current = null; // { prompt, a, b } — the live round
  var busy = false;

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

  function setArenaLoading() {
    var arena = $("#taste-arena");
    arena.hidden = false;
    ["a", "b"].forEach(function (side) {
      var img = $("#taste-img-" + side);
      img.removeAttribute("src");
      img.alt = "Brodie is creating variation " + side.toUpperCase() + "…";
      $("#taste-card-" + side).classList.add("loading");
      $("#taste-card-" + side).classList.remove("winner");
      $("#taste-label-" + side).textContent = "creating…";
    });
    $("#taste-why").hidden = true;
    setStatus("Brodie is making two variations…");
  }

  function renderRound() {
    ["a", "b"].forEach(function (side) {
      var data = current[side];
      var img = $("#taste-img-" + side);
      var card = $("#taste-card-" + side);
      card.classList.remove("loading");
      img.alt = "Variation " + side.toUpperCase() + " — " + data.styleLabel;
      $("#taste-label-" + side).textContent = data.styleLabel;
      img.src = data.url; // start the fetch now
    });
    setStatus("Pick the one you like. The pick alone trains — the why is bonus.");
  }

  function generate(prompt) {
    if (busy) return;
    busy = true;
    setArenaLoading();
    var payload = {
      prompt: prompt,
      likes: topTags(profile.likes, 12),
      dislikes: topTags(profile.dislikes, 12),
    };
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        busy = false;
        if (!data || !data.ok || !data.images || data.images.length < 2) {
          setStatus("Hmm, that round failed to generate. Try again.");
          return;
        }
        current = { prompt: prompt, a: data.images[0], b: data.images[1] };
        renderRound();
      })
      .catch(function () {
        busy = false;
        setStatus("Couldn't reach the generator. Check your connection and try again.");
      });
  }

  function pick(side) {
    if (!current || busy) return;
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
      "Nice pick — <b>" + esc(winner.styleLabel) + "</b>. Want to say why? " +
      '<span class="muted">(optional)</span>';
    $("#taste-why").hidden = false;
    $("#taste-why-input").value = "";
    $("#taste-why-input").focus();
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
    if (current) generate(current.prompt);
  }

  function reset() {
    if (!window.confirm("Start over? Your taste profile goes back to zero.")) return;
    profile = { likes: {}, dislikes: {}, notes: [], rounds: 0 };
    saveProfile();
    renderProfile(false);
    setStatus("Fresh eye. Make your first pick.");
  }

  function init() {
    if (!$("#taste-form")) return; // stage not in this build
    renderProfile(false);

    $("#taste-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var p = $("#taste-prompt").value.trim();
      if (!p) { setStatus("Give Brodie a prompt first — anything visual."); return; }
      generate(p);
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
