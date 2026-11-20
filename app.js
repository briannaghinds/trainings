// HIPAA training front end. State lives in memory only: no storage, cookies,
// URL parameters, or logging of user data. All grading happens on the server.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var SECTIONS = ["start", "slides", "quiz", "result"];

  var user = null;            // { name, email } in memory only
  var slideIdx = 0, maxSeen = 0, deadline = 0, timerId = null, unlockAnnounced = false;
  var questions = [], inFlight = false, cooldownId = null, cooldownEnd = 0, retryFn = null;

  // ---------- helpers ----------
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function fmt(s) { return Math.floor(s / 60) + ":" + pad(s % 60); }
  function announce(msg) { $("status").textContent = msg; }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function showSection(id) {
    SECTIONS.forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
    var h = $(id).querySelector("h1"); if (h) h.focus();
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ---------- 1. start screen ----------
  // Client-side cleanup/validation is a convenience only. The server repeats
  // ALL validation (length, format, domain, formula-injection) and never trusts this code.
  function clean(s, max) {
    return String(s || "")
      .replace(/[\u0000-\u001F\u007F<>]/g, "")
      .trim()
      .replace(/^[=+\-@]+/, "")
      .slice(0, max);
  }
  var EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$/;
  function emailError(email) {
    if (!email) return "";
    if (!EMAIL_RE.test(email)) return "Enter a valid email address.";
    // if (ALLOWED_EMAIL_DOMAINS.length) {
    //   var d = email.split("@")[1].toLowerCase();
    //   if (ALLOWED_EMAIL_DOMAINS.indexOf(d) === -1) return "Use your work email address.";
    // }
    return "";
  }
  function validateStart() {
    var name = clean($("name").value, 80);
    var email = clean($("email").value, 120).toLowerCase();
    var err = emailError(email);
    $("email-hint").textContent = err;
    var ok = name.length >= 2 && email && !err && $("attest").checked;
    $("begin-btn").disabled = !ok;
    return ok ? { name: name, email: email } : null;
  }
  ["name", "email"].forEach(function (id) { $(id).addEventListener("input", validateStart); });
  $("attest").addEventListener("change", validateStart);
  $("begin-btn").addEventListener("click", function () {
    var u = validateStart();
    if (!u) return;
    user = u;
    startSlides(MIN_VIEW_SECONDS);
  });

  // ---------- 2. slides ----------
  function startSlides(seconds) {
    slideIdx = 0; maxSeen = 0; unlockAnnounced = false;
    deadline = Date.now() + seconds * 1000;
    showSection("slides");
    renderSlide();
    if (timerId) clearInterval(timerId);
    timerId = setInterval(tick, 250);
    tick();
  }
  function renderSlide() {
    var img = $("slide-img");
    img.src = "slides/slide" + pad(slideIdx + 1) + ".png";
    img.alt = "Training slide " + (slideIdx + 1) + " of " + SLIDE_COUNT;
    $("slide-count").textContent = "Slide " + (slideIdx + 1) + " of " + SLIDE_COUNT;
    $("progress").max = SLIDE_COUNT;
    $("progress").value = slideIdx + 1;
    $("back-btn").disabled = slideIdx === 0;
    $("next-btn").disabled = slideIdx >= SLIDE_COUNT - 1;
    updateQuizBtn();
  }
  function remaining() { return Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); }
  function tick() {
    var r = remaining();
    $("countdown").textContent = fmt(r);
    if (r === 0 && timerId) { clearInterval(timerId); timerId = null; }
    updateQuizBtn();
  }
  function updateQuizBtn() {
    var timeDone = remaining() === 0, allSeen = maxSeen >= SLIDE_COUNT - 1;
    $("quiz-btn").disabled = !(timeDone && allSeen);
    var hint = "";
    if (!timeDone && !allSeen) hint = "The quiz unlocks when the timer reaches 0:00 and you have stepped through every slide.";
    else if (!timeDone) hint = "Keep reviewing. The quiz unlocks when the timer reaches 0:00.";
    else if (!allSeen) hint = "Step through all the slides with Next to unlock the quiz.";
    $("slides-hint").textContent = hint;
    if (timeDone && allSeen && !unlockAnnounced) { unlockAnnounced = true; announce("You can now take the quiz."); }
  }
  $("next-btn").addEventListener("click", function () {
    if (slideIdx < SLIDE_COUNT - 1) { slideIdx++; if (slideIdx > maxSeen) maxSeen = slideIdx; renderSlide(); }
  });
  $("back-btn").addEventListener("click", function () {
    if (slideIdx > 0) { slideIdx--; renderSlide(); }
  });
  $("slide-img").addEventListener("error", function () { announce("This slide could not be loaded."); });
  $("quiz-btn").addEventListener("click", function () { if (!$("quiz-btn").disabled) loadQuiz(); });

  // ---------- 3. quiz ----------
  function feedback(msg, kind, showRetry, fn) {
    var f = $("quiz-feedback");
    f.textContent = msg;
    f.className = "feedback" + (kind ? " " + kind : "");
    f.hidden = !msg;
    retryFn = fn || null;
    $("retry-btn").hidden = !showRetry;
    if (msg) announce(msg);
  }
  function loadQuiz() {
    showSection("quiz");
    feedback("");
    clear($("quiz-list"));
    fetch("questions.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
      .then(function (data) {
        if (!Array.isArray(data) || !data.length) throw new Error("x");
        questions = data;
        renderQuiz();
      })
      .catch(function () {
        feedback("The quiz could not be loaded. Check your connection and try again.", "bad", true, loadQuiz);
      });
  }
  function renderQuiz() {
    var list = $("quiz-list");
    clear(list);
    var order = shuffle(questions.map(function (_, i) { return i; }));
    order.forEach(function (orig, pos) {
      var q = questions[orig];
      var fs = document.createElement("fieldset");
      fs.className = "q";
      var lg = document.createElement("legend");
      lg.appendChild(document.createTextNode((pos + 1) + ". " + q.question));
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Answered";
      lg.appendChild(badge);
      fs.appendChild(lg);
      shuffle(q.choices).forEach(function (c, k) {
        var lab = document.createElement("label");
        lab.className = "choice";
        var inp = document.createElement("input");
        inp.type = "radio";
        inp.name = "q" + orig;          // orig = ORIGINAL question index
        inp.value = c.id;               // ORIGINAL letter, not display position
        inp.id = "q" + orig + "c" + k;
        inp.addEventListener("change", function () {
          var sibs = fs.querySelectorAll(".choice");
          for (var s = 0; s < sibs.length; s++) sibs[s].classList.remove("selected");
          lab.classList.add("selected");
          fs.classList.add("answered");
          updateSubmit();
        });
        var span = document.createElement("span");
        span.textContent = c.text;
        lab.appendChild(inp);
        lab.appendChild(span);
        fs.appendChild(lab);
      });
      list.appendChild(fs);
    });
    updateSubmit();
  }
  function collectAnswers() {
    var out = [];
    for (var i = 0; i < questions.length; i++) {
      var sel = document.querySelector('input[name="q' + i + '"]:checked');
      out.push(sel ? sel.value : null);
    }
    return out;
  }
  function updateSubmit() {
    var a = collectAnswers();
    var n = a.filter(function (x) { return x !== null; }).length;
    $("answered-count").textContent = n + " of " + questions.length + " answered";
    $("submit-btn").disabled = inFlight || n < questions.length || Date.now() < cooldownEnd;
  }
  function setBusy(b) {
    inFlight = b;
    $("spinner").hidden = !b;
    $("retry-btn").disabled = b;
    updateSubmit();
  }

  // ---------- 4. submit ----------
  function submit() {
    if (inFlight) return;
    var answers = collectAnswers();
    if (answers.indexOf(null) !== -1) return;
    if (typeof SCRIPT_URL !== "string" || SCRIPT_URL.indexOf("https://") !== 0) {
      feedback("The training service is not set up yet. Contact your manager.", "bad", false);
      return;
    }
    feedback("");
    setBusy(true);
    fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      body: JSON.stringify({ name: user.name, email: user.email, answers: answers, attested: true })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { setBusy(false); handle(d); })
      .catch(function () {
        setBusy(false);
        feedback("We could not reach the training service. Please try again.", "bad", true, submit);
      });
  }
  $("submit-btn").addEventListener("click", submit);
  $("retry-btn").addEventListener("click", function () { if (retryFn && !inFlight) retryFn(); });

  function handle(d) {
    if (!d || typeof d !== "object") throw new Error("x");
    if (d.error === "cooldown") return startCooldown(Number(d.waitSeconds));
    if (d.error === "not_authorized") {
      return feedback("This email isn't on the training roster. Contact your manager.", "bad", false);
    }
    if (d.error) {
      return feedback("Something went wrong on our side. Please try again.", "bad", true, submit);
    }
    if (d.passed === true) {
      var email = user.email;
      user = null; questions = [];
      if (d.emailed === true) {
        showResult("Congratulations! Your certificate has been emailed to " + email +
          ". Check your spam folder if you don\u2019t see it.", "ok", false);
      } else {
        showResult("Your passing result was recorded. If you do not receive your certificate within a few minutes, contact your manager.", "warn", false);
      }
      return;
    }
    if (d.passed === false) {
      var s = parseInt(d.score, 10), t = parseInt(d.total, 10);
      if (isNaN(s) || isNaN(t)) throw new Error("x");
      return showResult("You scored " + s + " of " + t + ". 100% is required. Click Review the slides to complete a 2-minute review before retaking the quiz.", "bad", true);
    }
    throw new Error("x");
  }
  function showResult(msg, kind, canReview) {
    var m = $("result-msg");
    m.textContent = msg;
    m.className = "feedback " + kind;
    $("review-btn").hidden = !canReview;
    showSection("result");
    announce(msg);
  }
  $("review-btn").addEventListener("click", function () { startSlides(MIN_REVIEW_SECONDS_AFTER_FAIL); });

  // Server enforces its own cooldown; this only shows it nicely.
  function startCooldown(w) {
    if (!isFinite(w) || w < 1) w = 60;
    w = Math.min(Math.floor(w), 86400);
    cooldownEnd = Date.now() + w * 1000;
    if (cooldownId) { clearInterval(cooldownId); cooldownId = null; }
    function step() {
      var r = Math.ceil((cooldownEnd - Date.now()) / 1000);
      if (r <= 0) {
        clearInterval(cooldownId); cooldownId = null;
        feedback("");
        updateSubmit();
        return;
      }
      var f = $("quiz-feedback");
      f.textContent = "Please wait " + fmt(r) + " before trying again.";
      f.className = "feedback warn";
      f.hidden = false;
      $("retry-btn").hidden = true;
      updateSubmit();
    }
    step();
    announce("Please wait " + fmt(w) + " before trying again.");
    cooldownId = setInterval(step, 1000);
  }
})();
