// Storage keys keep their original names on purpose: renaming them would hide books already saved in the browser.
const STORAGE_KEY = "next-chapter-state-v1";
const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";

// Short lines from public-domain books, shown on the loading screen.
const BOOK_QUOTES = [
  { text: "Call me Ishmael.", source: "Herman Melville, Moby-Dick" },
  { text: "I declare after all there is no enjoyment like reading!", source: "Jane Austen, Pride and Prejudice" },
  { text: "I am half agony, half hope.", source: "Jane Austen, Persuasion" },
  { text: "I am no bird; and no net ensnares me.", source: "Charlotte Brontë, Jane Eyre" },
  { text: "It was the best of times, it was the worst of times.", source: "Charles Dickens, A Tale of Two Cities" },
  { text: "Books are the treasured wealth of the world.", source: "Henry David Thoreau, Walden" },
  { text: "There is no Frigate like a Book / To take us Lands away.", source: "Emily Dickinson" },
  { text: "I am not afraid of storms, for I am learning how to sail my ship.", source: "Louisa May Alcott, Little Women" },
  { text: "What is the use of a book without pictures or conversations?", source: "Lewis Carroll, Alice’s Adventures in Wonderland" },
  { text: "Beware; for I am fearless, and therefore powerful.", source: "Mary Shelley, Frankenstein" }
];

const seedBooks = [
  { id: "book-1", title: "The Midnight Library", author: "Matt Haig", genre: "Speculative fiction", pages: 304, status: "tbr", progress: 0, color: "sage", note: "A quiet, hopeful story for the part of you that is curious about the roads not taken." },
  { id: "book-2", title: "Tomorrow, and Tomorrow, and Tomorrow", author: "Gabrielle Zevin", genre: "Literary fiction", pages: 416, status: "reading", progress: 42, color: "coral", note: "A story about friendship, creativity, and the games we play to stay connected." },
  { id: "book-3", title: "Piranesi", author: "Susanna Clarke", genre: "Fantasy", pages: 272, status: "tbr", progress: 0, color: "lilac", note: "Strange halls, endless tides, and the feeling of finding a world inside yourself." },
  { id: "book-4", title: "The Creative Act", author: "Rick Rubin", genre: "Creativity", pages: 432, status: "reading", progress: 68, color: "ochre", note: "A generous field guide to noticing, making, and trusting the work." },
  { id: "book-5", title: "Sea of Tranquility", author: "Emily St. John Mandel", genre: "Science fiction", pages: 272, status: "tbr", progress: 0, color: "ink", note: "A shimmering time-travel mystery with a pulse of something bigger." },
  { id: "book-6", title: "Braiding Sweetgrass", author: "Robin Wall Kimmerer", genre: "Nature writing", pages: 408, status: "completed", progress: 100, completedAt: "2024-09-22", rating: 5, note: "A reminder that attention is a form of gratitude." , color: "sage" },
  { id: "book-7", title: "A Psalm for the Wild-Built", author: "Becky Chambers", genre: "Cozy science fiction", pages: 160, status: "completed", progress: 100, completedAt: "2024-08-14", rating: 4, note: "Soft, warm, and exactly the kind of hopeful future I needed.", color: "rose" },
  { id: "book-8", title: "The Book of Delights", author: "Ross Gay", genre: "Essays", pages: 288, status: "completed", progress: 100, completedAt: "2024-07-03", rating: 5, note: "Small observations that make the ordinary feel newly lit.", color: "coral" }
];

const defaultState = {
  books: seedBooks,
  nextPickId: "book-1",
  streak: 12,
  weekPages: 126,
  goals: [
    { id: "goal-2024", name: "A chapter a week", target: 24, unit: "books", featured: true },
    { id: "goal-pages", name: "Pages in October", target: 800, unit: "pages" },
    { id: "goal-genre", name: "Try three new genres", target: 3, unit: "genre" }
  ]
};

let state = loadState();
let activeFilter = "all";
let bookSearchResults = [];
let bookSearchRequest = 0;
let logFilter = "all";
let toastTimer;
let lastSearchQuery = "";
let searchActive = false;
let searchController = null;
let searchOrigin = "dashboard";
let currentView = "dashboard";
let previousView = "dashboard";
let previousScroll = 0;
let detailRef = null;
let detailStack = [];
const searchCache = new Map();
const dirtyViews = { dashboard: true, tbr: true, log: true, goals: true };
let menuTrigger = null;
const detailCache = {};
const extrasPromises = {};
const relatedCache = {};
let detailRelatedDocs = [];
const LOGGED_IN_LOADER_MS = 1100;
let LOADER_MIN_MS = LOGGED_IN_LOADER_MS;
const QUOTE_KEY = "next-chapter-last-quote";
const loaderStart = window.__quoteAt || performance.now(); // starts when the quote first appeared
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function debounce(fn, wait = 140) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.books)) parsed.books = parsed.books.map((book) => book.note === "Found via Google Books." ? { ...book, note: "Found via Open Library." } : book);
      return { ...defaultState, ...parsed };
    }
  } catch (error) {
    console.warn("Could not load local reading data", error);
  }
  return structuredClone(defaultState);
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (error) { console.warn("Could not save reading data", error); }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function initials(title = "") {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "MS";
}

function statusLabel(status) {
  return { tbr: "On TBR", reading: "Reading", completed: "Finished" }[status] || status;
}

function prettyDate(dateString) {
  if (!dateString) return "Not finished yet";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${dateString}T12:00:00`));
}

function formatNumber(number) {
  return new Intl.NumberFormat("en").format(number || 0);
}

function completedBooks() {
  return state.books.filter((book) => book.status === "completed");
}

function readingBooks() {
  return state.books.filter((book) => book.status === "reading");
}

function tbrBooks() {
  return state.books.filter((book) => book.status === "tbr");
}

function ymd(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// A goal with a deadline only counts books finished between its start and its deadline.
function getGoalCurrent(goal) {
  let finished = completedBooks();
  if (goal.start || goal.deadline) {
    finished = finished.filter((book) => {
      const done = book.completedAt || "";
      return (!goal.start || done >= goal.start) && (!goal.deadline || done <= goal.deadline);
    });
  }
  if (goal.unit === "books") return finished.length;
  if (goal.unit === "pages") return finished.reduce((sum, book) => sum + Number(book.pages || 0), 0);
  if (goal.unit === "genre") return new Set(finished.map((book) => book.genre).filter(Boolean)).size;
  return 0;
}

function goalStart(deadline) {
  const now = new Date();
  const year = String(now.getFullYear());
  return deadline.slice(0, 4) === year ? `${year}-01-01` : ymd(now);
}

function paceLabel(remaining, daysLeft) {
  const perBook = daysLeft / remaining;
  if (perBook <= 7) {
    const perWeek = Math.round((remaining / daysLeft) * 70) / 10;
    return `${perWeek} ${perWeek === 1 ? "book" : "books"} a week`;
  }
  if (perBook < 45) {
    const weeks = Math.max(1, Math.round(perBook / 7));
    return `one book every ${weeks === 1 ? "week" : `${weeks} weeks`}`;
  }
  const months = Math.max(1, Math.round(perBook / 30));
  return `one book every ${months === 1 ? "month" : `${months} months`}`;
}

function goalPaceText(goal, current) {
  const remaining = Math.max(0, goal.target - current);
  if (!remaining) return "Goal reached. Lovely reading!";
  if (!goal.deadline) return `${formatNumber(remaining)} to go.`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((new Date(`${goal.deadline}T00:00:00`) - today) / 86400000);
  if (daysLeft < 0) return "That date has passed. Pick a later finish date.";
  const noun = remaining === 1 ? "book" : "books";
  if (daysLeft === 0) return `Last day: ${remaining} ${noun} to go.`;
  return `${formatNumber(remaining)} ${noun} to go in ${formatNumber(daysLeft)} ${daysLeft === 1 ? "day" : "days"}, about ${paceLabel(remaining, daysLeft)}.`;
}

function featuredBooksGoal() {
  return state.goals.find((goal) => goal.featured && goal.unit === "books");
}

function coverMarkup(book, className = "book-cover", { open = false } = {}) {
  const opener = open ? ` role="button" tabindex="0" data-action="open-book" data-id="${escapeHtml(book.id)}"` : "";
  const label = open ? `Open details for ${escapeHtml(book.title)}` : `Cover for ${escapeHtml(book.title)}`;
  return `<div class="${className} cover-${escapeHtml(book.color || "sage")}${open ? " is-openable" : ""}" data-cover="${escapeHtml(book.cover || "")}" aria-label="${label}"${opener}><span>${escapeHtml(initials(book.title))}</span></div>`;
}

function titleLink(book) {
  return `<button type="button" class="title-link" data-action="open-book" data-id="${escapeHtml(book.id)}">${escapeHtml(book.title)}</button>`;
}

function applyCoverImages() {
  document.querySelectorAll("[data-cover]").forEach((cover) => {
    const url = cover.dataset.cover;
    if (!url || !/^https?:\/\//i.test(url)) {
      if (cover.dataset.coverApplied) { cover.style.backgroundImage = ""; delete cover.dataset.coverApplied; }
      return;
    }
    if (cover.dataset.coverApplied === url) return;
    cover.style.backgroundImage = `url("${url.replaceAll('"', "%22")}")`;
    cover.dataset.coverApplied = url;
  });
}

function openLibraryAuthors(doc) {
  return Array.isArray(doc.author_name) && doc.author_name.length ? doc.author_name.slice(0, 3).join(", ") : "Unknown author";
}

function openLibraryCover(doc) {
  return doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : "";
}

function docToBook(doc) {
  return {
    title: doc.title,
    author: openLibraryAuthors(doc).split(",")[0],
    genre: "To discover",
    pages: Number(doc.number_of_pages_median) || 1,
    color: ["sage", "coral", "lilac", "ochre", "ink", "rose"][state.books.length % 6],
    cover: openLibraryCover(doc),
    publisher: Array.isArray(doc.publisher) ? doc.publisher[0] || "" : "",
    firstPublishYear: doc.first_publish_year || "",
    openLibraryKey: doc.key || ""
  };
}

function bookKey(title, author) {
  return `${String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}::${String(author || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

function isBookOnShelf(doc) {
  const author = openLibraryAuthors(doc).split(",")[0];
  return state.books.some((book) => bookKey(book.title, book.author) === bookKey(doc.title, author));
}

function searchStatusEl() {
  return searchOrigin === "tbr" ? $("#book-search-status") : $("#home-book-search-status");
}

function searchContainer() {
  return searchOrigin === "tbr" ? $("#book-search-results") : $("#home-book-search-results");
}

function clearSearchContainers() {
  [$("#book-search-results"), $("#home-book-search-results")].forEach((container) => { if (container) container.innerHTML = ""; });
  const homeWrap = $("#home-book-search-wrap");
  if (homeWrap) homeWrap.hidden = true;
}

function skeletonMarkup(count = 8) {
  return Array.from({ length: count }, () => `<article class="open-book-card is-skeleton" aria-hidden="true"><div class="open-book-cover"><div class="open-book-placeholder"></div></div><div class="open-book-body"><span class="skeleton-line short"></span><span class="skeleton-line"></span><span class="skeleton-line mid"></span><span class="skeleton-line"></span></div></article>`).join("");
}

function showSearchSkeleton() {
  clearSearchContainers();
  const container = searchContainer();
  if (!container) return;
  container.innerHTML = skeletonMarkup();
  container.setAttribute("aria-busy", "true");
  if (searchOrigin !== "tbr") $("#home-book-search-wrap").hidden = false;
}

function renderBookSearchResults() {
  clearSearchContainers();
  const container = searchContainer();
  if (!container) return;
  container.removeAttribute("aria-busy");
  if (searchOrigin !== "tbr" && searchActive) $("#home-book-search-wrap").hidden = false;
  if (!bookSearchResults.length) return;
  container.innerHTML = bookSearchResults.map((doc, index) => {
    const authors = openLibraryAuthors(doc);
    const publisher = Array.isArray(doc.publisher) && doc.publisher.length ? doc.publisher[0] : "Publisher not listed";
    const cover = openLibraryCover(doc);
    const onShelf = isBookOnShelf(doc);
    return `<article class="open-book-card" style="--i:${Math.min(index, 11)}">
      <div class="open-book-cover is-openable" role="button" tabindex="0" data-action="open-result" data-result-index="${index}" aria-label="Open details for ${escapeHtml(doc.title || "book")}">${cover ? `<img src="${cover}" width="120" height="180" loading="lazy" decoding="async" alt="Cover of ${escapeHtml(doc.title || "book")}" data-open-cover />` : `<div class="open-book-placeholder"><span>${escapeHtml(initials(doc.title))}</span><small>No cover<br />on record</small></div>`}</div>
      <div class="open-book-body"><span class="open-book-source">OPEN LIBRARY RECORD</span><h3><button type="button" class="title-link" data-action="open-result" data-result-index="${index}">${escapeHtml(doc.title || "Untitled")}</button></h3><p class="open-book-author">${escapeHtml(authors)}</p><div class="open-book-facts"><span><b>First published</b>${escapeHtml(doc.first_publish_year || "Unknown")}</span><span><b>Publisher</b>${escapeHtml(publisher)}</span></div><button class="card-action ${onShelf ? "is-added" : ""}" data-action="add-book-search-result" data-result-index="${index}" ${onShelf ? "disabled" : ""}>${onShelf ? "✓ On your TBR" : "Add to TBR"} <span>${onShelf ? "" : "→"}</span></button></div>
    </article>`;
  }).join("");
}

// Cheap update: only flips the buttons, instead of rebuilding all 40 cards.
function syncSearchButtons() {
  $$("[data-action='add-book-search-result']").forEach((button) => {
    const doc = bookSearchResults[Number(button.dataset.resultIndex)];
    if (!doc) return;
    const onShelf = isBookOnShelf(doc);
    button.disabled = onShelf;
    button.classList.toggle("is-added", onShelf);
    button.innerHTML = onShelf ? "✓ On your TBR <span></span>" : "Add to TBR <span>→</span>";
  });
}

// One listener for broken cover images (instead of one per image per render).
document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.hasAttribute("data-open-cover")) return;
  const fallback = document.createElement("div");
  fallback.className = "open-book-placeholder";
  fallback.innerHTML = "<span>?</span><small>Cover unavailable</small>";
  image.replaceWith(fallback);
}, true);

function clearSearch() {
  if (searchController) searchController.abort();
  bookSearchRequest++; // any response still in flight is now ignored
  bookSearchResults = [];
  searchActive = false;
  clearSearchContainers();
  ["#home-book-search-status", "#book-search-status"].forEach((id) => { const el = $(id); if (el) el.textContent = ""; });
  ["#global-book-search-query", "#book-search-query"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
  if (currentView === "dashboard") window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
}

function showSearchResults(cleanedQuery, data, status) {
  bookSearchResults = Array.isArray(data.docs) ? data.docs.filter((doc) => doc.title).slice(0, 40) : [];
  $("#home-search-query").textContent = cleanedQuery;
  const safeQuery = escapeHtml(cleanedQuery);
  const clear = searchOrigin === "tbr" && bookSearchResults.length ? ` <button class="retry-button" type="button" data-action="clear-search">Clear results</button>` : "";
  status.innerHTML = bookSearchResults.length
    ? `Showing ${formatNumber(bookSearchResults.length)} books for “${safeQuery}”${data.numFound ? ` · ${formatNumber(data.numFound)} total matches` : ""}${clear}`
    : `No books found for “${safeQuery}”. Try a different title.`;
  renderBookSearchResults();
}

async function searchOpenLibrary(query, origin = searchOrigin) {
  const cleanedQuery = query.trim();
  searchOrigin = origin;
  const status = searchStatusEl();
  if (!cleanedQuery) {
    searchActive = origin === "dashboard" ? false : searchActive;
    status.textContent = "Type a title to search the Open Library catalog.";
    if (origin === "dashboard") showToast("Type a book title to search");
    bookSearchResults = [];
    renderBookSearchResults();
    return;
  }
  searchActive = true;
  lastSearchQuery = cleanedQuery;
  // One history entry per search session, so the phone/browser Back button clears the results.
  if (!history.state?.search) pushNav({ view: currentView, search: 1 });
  if (searchController) searchController.abort();
  const requestId = ++bookSearchRequest;
  const cacheKey = cleanedQuery.toLowerCase();
  if (searchCache.has(cacheKey)) { // repeat searches are instant and don't use up the public quota
    showSearchResults(cleanedQuery, searchCache.get(cacheKey), status);
    return;
  }
  searchController = new AbortController();
  const controller = searchController;
  const timeout = setTimeout(() => controller.abort("timeout"), 12000);
  status.innerHTML = `<span class="loading-pulse">Searching Open Library for “${escapeHtml(cleanedQuery)}”…</span>`;
  $("#home-search-query").textContent = cleanedQuery;
  showSearchSkeleton();
  try {
    const url = new URL(OPEN_LIBRARY_SEARCH_URL);
    url.searchParams.set("title", cleanedQuery);
    url.searchParams.set("limit", "40");
    url.searchParams.set("fields", "key,title,author_name,first_publish_year,publisher,cover_i,number_of_pages_median");
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) { const requestError = new Error(`Open Library returned ${response.status}`); requestError.status = response.status; throw requestError; }
    const data = await response.json();
    if (requestId !== bookSearchRequest) return;
    if (searchCache.size >= 20) searchCache.delete(searchCache.keys().next().value);
    searchCache.set(cacheKey, { docs: data.docs, numFound: data.numFound });
    showSearchResults(cleanedQuery, data, status);
  } catch (error) {
    if (requestId !== bookSearchRequest) return;
    bookSearchResults = [];
    renderBookSearchResults();
    const message = error.status === 429
      ? "Open Library is limiting searches for a moment. Wait a few seconds, then try again."
      : controller.signal.aborted
        ? "That search took too long. Try again."
        : "Open Library isn’t responding. Check your connection, then try again.";
    status.innerHTML = `${escapeHtml(message)} <button class="retry-button" type="button" data-action="retry-search">Try again</button> <button class="retry-button" type="button" data-action="clear-search">Back</button>`;
    console.warn("Open Library search failed", error);
  } finally {
    clearTimeout(timeout);
  }
}

function addDocToShelf(doc) {
  if (!doc || !doc.title) return null;
  if (isBookOnShelf(doc)) {
    showToast(`${doc.title} is already on your TBR`);
    return null;
  }
  const newBook = { id: `book-${Date.now()}`, ...docToBook(doc), status: "tbr", progress: 0, note: "Found via Open Library." };
  state.books.unshift(newBook);
  state.nextPickId = newBook.id;
  saveState();
  render();
  showToast(`${newBook.title} added to your TBR`);
  return newBook;
}

function addOpenLibraryBook(index) {
  addDocToShelf(bookSearchResults[index]);
}

function setText(selector, value) {
  const el = $(selector);
  const text = String(value);
  if (el && el.textContent !== text) el.textContent = text;
}

// Cheap numbers that are always visible (sidebar badge, filter counts).
function renderCounters() {
  const finished = completedBooks();
  const reviewed = finished.filter((book) => book.rating || book.note).length;
  setText("#tbr-count", tbrBooks().length);
  setText("#all-count", state.books.length);
  setText("#tbr-filter-count", tbrBooks().length);
  setText("#reading-filter-count", readingBooks().length);
  setText("#completed-filter-count", finished.length);
  setText("#log-all-count", finished.length);
  setText("#reviewed-count", reviewed);
  setText("#unreviewed-count", finished.length - reviewed);
}

function renderDashboard() {
  const finished = completedBooks();
  const tbr = tbrBooks();
  setText("#stat-read", finished.length);
  setText("#stat-pages", formatNumber(finished.reduce((sum, book) => sum + Number(book.pages || 0), 0)));
  setText("#stat-streak", state.streak);
  setText("#week-pages", formatNumber(state.weekPages));
  setText("#shelf-number", tbr.length);
  renderPick(tbr);
  renderCurrentlyReading(readingBooks());
  renderShelf(tbr);
  renderChallenge();
}

function renderChallenge() {
  const goal = state.goals.find((item) => item.featured) || state.goals[0];
  const current = goal ? getGoalCurrent(goal) : 0;
  const percent = goal ? Math.min(100, Math.round((current / goal.target) * 100)) : 0;
  setText("#goal-percent", `${percent}%`);
  $("#goal-ring").style.setProperty("--goal-progress", `${percent}%`);
  if (!goal) {
    setText("#challenge-kicker", "YOUR READING GOAL");
    setText("#challenge-heading", "Set a reading goal");
    $("#goal-count-line").innerHTML = "<strong>No goal yet</strong>";
    setText("#goal-remaining-line", "Pick how many books you’d like to read, and by when.");
    setText("#goal-milestone-text", "Set a goal →");
    return;
  }
  const unitLabel = goal.unit === "genre" ? "genres" : goal.unit;
  const doneLabel = goal.unit === "pages" ? "pages read" : goal.unit === "genre" ? "genres explored" : "books finished";
  setText("#challenge-kicker", goal.deadline ? `YOUR ${goal.deadline.slice(0, 4)} CHALLENGE` : "YOUR READING GOAL");
  setText("#challenge-heading", goal.name);
  $("#goal-count-line").innerHTML = `<strong>${formatNumber(current)} of ${formatNumber(goal.target)}</strong> ${doneLabel}`;
  const remaining = Math.max(0, goal.target - current);
  $("#goal-remaining-line").innerHTML = goal.unit === "books" && goal.deadline
    ? goalPaceText(goal, current)
    : `You’re <strong>${formatNumber(remaining)} ${unitLabel}</strong> away from your goal.`;
  const step = Math.max(1, Math.ceil(goal.target / 4));
  const next = Math.min(goal.target, (Math.floor(current / step) + 1) * step);
  $("#goal-milestone-text").innerHTML = remaining ? `Next milestone: <b>${formatNumber(next)} ${unitLabel}</b>` : "<b>Goal complete</b>";
}

// Heavy lists are rebuilt only for the view on screen; the others are marked stale and refreshed when opened.
function renderViewContent(view) {
  if (!dirtyViews[view]) return;
  dirtyViews[view] = false;
  if (view === "dashboard") renderDashboard();
  else if (view === "tbr") { renderLibrary(); syncSearchButtons(); }
  else if (view === "log") renderLog(completedBooks());
  else if (view === "goals") { renderGoals(); syncGoalForm(); }
  applyCoverImages();
}

function render() {
  renderCounters();
  Object.keys(dirtyViews).forEach((view) => { dirtyViews[view] = true; });
  if (currentView === "book") renderBookDetail(); else renderViewContent(currentView);
  syncSearchButtons();
  applyCoverImages();
}

function renderPick(tbr) {
  const picked = tbr.find((book) => book.id === state.nextPickId) || tbr[0];
  if (!picked) {
    $("#pick-title").textContent = "Your shelf is feeling light";
    $("#pick-author").textContent = "Search for a book to begin";
    $("#pick-note").textContent = "A good next read is only one search away. Look up a title and add it to your TBR.";
    $("#pick-cover").className = "feature-cover cover-sage";
    $("#pick-cover").dataset.cover = "";
    $("#pick-initials").textContent = "?";
    $("#pick-tags").innerHTML = "<span class=\"tag tag-light\">Your TBR is waiting</span>";
    $("#pick-details").hidden = true;
    return;
  }
  $("#pick-title").textContent = picked.title;
  $("#pick-details").hidden = false;
  $("#pick-details").dataset.id = picked.id;
  $("#pick-author").textContent = picked.author;
  $("#pick-note").textContent = picked.note || "A story from your TBR, chosen for a little serendipity.";
  $("#pick-initials").textContent = initials(picked.title);
  $("#pick-cover").className = `feature-cover cover-${picked.color || "sage"}`;
  $("#pick-cover").dataset.cover = picked.cover || "";
  $("#pick-tags").innerHTML = `<span class="tag tag-light">${escapeHtml(picked.genre || "Fiction")}</span><span class="tag tag-light">${formatNumber(picked.pages)} pages</span>`;
}

function renderCurrentlyReading(books) {
  const container = $("#currently-reading");
  if (!books.length) {
    container.innerHTML = `<div class="empty-state"><div><strong>No open chapters yet.</strong><span>Start a book from your TBR shelf and it will show up here.</span></div></div>`;
    return;
  }
  container.innerHTML = books.slice(0, 4).map((book) => `<article class="reading-card">
    ${coverMarkup(book, "mini-cover", { open: true })}
    <div class="reading-meta"><h3 title="${escapeHtml(book.title)}">${titleLink(book)}</h3><p>${escapeHtml(book.author)}</p><div class="progress-line" aria-label="${book.progress}% complete"><span style="width:${Math.min(100, book.progress || 0)}%"></span></div><div class="progress-details"><span>${book.progress || 0}% · ${Math.round((Number(book.pages || 0) * (book.progress || 0)) / 100)} pages</span><button data-action="open-progress" data-id="${book.id}">Update →</button></div></div>
  </article>`).join("");
}

function renderShelf(books) {
  $("#shelf-strip").innerHTML = books.length ? books.slice(0, 5).map((book) => `${coverMarkup(book, "shelf-cover", { open: true })}`).join("") : `<span class="muted">Your next five stories will live here.</span>`;
}

function renderLibrary() {
  const query = ($("#book-search")?.value || "").trim().toLowerCase();
  const books = state.books.filter((book) => {
    const matchesFilter = activeFilter === "all" || book.status === activeFilter;
    const matchesQuery = !query || `${book.title} ${book.author} ${book.genre}`.toLowerCase().includes(query);
    return matchesFilter && matchesQuery;
  });
  const container = $("#tbr-grid");
  if (!books.length) {
    container.innerHTML = `<div class="empty-state"><div><strong>No books found.</strong><span>Try another search, or find a new story with the search bar above.</span></div></div>`;
    return;
  }
  container.innerHTML = books.map((book) => {
    const action = book.status === "tbr" ? "start-book" : book.status === "reading" ? "open-progress" : "review-book";
    const actionLabel = book.status === "tbr" ? "Start reading" : book.status === "reading" ? "Update progress" : "Review book";
    return `<article class="book-card">
      ${coverMarkup(book, "book-cover", { open: true })}
      <div class="book-card-content"><h3 title="${escapeHtml(book.title)}">${titleLink(book)}</h3><p>${escapeHtml(book.author)} · ${formatNumber(book.pages)} pages</p><div class="card-footer"><span class="status-badge ${book.status}">${statusLabel(book.status)}</span><button class="card-menu" data-action="book-menu" data-id="${book.id}" aria-haspopup="menu" aria-expanded="false" aria-label="More options for ${escapeHtml(book.title)}">···</button></div><button class="card-action" data-action="${action}" data-id="${book.id}">${actionLabel} <span>→</span></button></div>
    </article>`;
  }).join("");
}

function renderLog(books) {
  const pages = books.reduce((sum, book) => sum + Number(book.pages || 0), 0);
  const genreCounts = books.reduce((counts, book) => { if (book.genre) counts[book.genre] = (counts[book.genre] || 0) + 1; return counts; }, {});
  const favorite = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];
  const visibleBooks = books.filter((book) => logFilter === "all" || (logFilter === "reviewed" ? book.rating || book.note : !(book.rating || book.note)));
  $("#log-books").textContent = books.length;
  $("#log-pages").textContent = formatNumber(pages);
  $("#favorite-genre").textContent = favorite?.[0] || "—";
  $("#favorite-genre-count").textContent = favorite ? `${favorite[1]} ${favorite[1] === 1 ? "book" : "books"} so far` : "Keep exploring";
  const emptyCopy = logFilter === "reviewed" ? "No reviewed books yet." : logFilter === "unreviewed" ? "Every finished book has a review." : "Your reading log is ready.";
  const emptyDetail = logFilter === "reviewed" ? "Add a rating or note to a finished book and it will appear here." : logFilter === "unreviewed" ? "Your finished stories are all caught up." : "Finish a book and it will be remembered here.";
  $("#log-list").innerHTML = visibleBooks.length ? [...visibleBooks].sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))).map((book) => `<article class="log-item">${coverMarkup(book, "mini-cover", { open: true })}<div><h3>${titleLink(book)}</h3><p>${escapeHtml(book.author)} · ${escapeHtml(book.genre || "Uncategorized")}</p><div class="stars">${"★".repeat(book.rating || 0)}<span>${book.rating ? "" : "Not rated"}</span></div><button class="review-button" data-action="review-book" data-id="${book.id}">${book.rating || book.note ? "Edit review" : "Write a review"} <span>→</span></button></div><div class="log-date">${prettyDate(book.completedAt)}<br />${formatNumber(book.pages)} pages</div></article>`).join("") : `<div class="empty-state"><div><strong>${emptyCopy}</strong><span>${emptyDetail}</span></div></div>`;
}

function renderGoals() {
  $("#goals-grid").innerHTML = state.goals.length ? state.goals.map((goal) => {
    const current = getGoalCurrent(goal);
    const percent = Math.min(100, Math.round((current / goal.target) * 100));
    const unitLabel = goal.unit === "genre" ? "genres" : goal.unit;
    const due = goal.deadline ? ` · by ${prettyDate(goal.deadline)}` : "";
    const foot = percent >= 100 ? "Goal complete" : goal.unit === "books" && goal.deadline ? goalPaceText(goal, current) : `${formatNumber(goal.target - current)} to go`;
    return `<article class="goal-card ${goal.featured ? "featured" : ""}"><span class="section-kicker">${goal.featured ? "FEATURED CHALLENGE" : "PERSONAL GOAL"}</span><h2>${escapeHtml(goal.name)}</h2><div class="goal-meta"><span>${formatNumber(current)} of ${formatNumber(goal.target)} ${unitLabel}${due}</span><strong>${percent}%</strong></div><div class="goal-progress"><span style="width:${percent}%"></span></div><div class="goal-foot"><span class="milestone"><span>${percent >= 100 ? "✓" : "✦"}</span><small>${escapeHtml(foot)}</small></span><button class="card-menu goal-menu" data-action="goal-menu" data-id="${goal.id}" data-featured="${goal.featured && goal.unit === "books" ? "1" : ""}" aria-haspopup="menu" aria-expanded="false" aria-label="More options for ${escapeHtml(goal.name)}">···</button></div></article>`;
  }).join("") : `<div class="empty-state"><div><strong>No goals yet.</strong><span>Set a target above and it will show up here.</span></div></div>`;
}

// ---- Goal setter (inline form: "I want to read N books by <date>") ----
function presetDeadline(kind) {
  const year = new Date().getFullYear();
  return kind === "next-year" ? `${year + 1}-12-31` : `${year}-12-31`;
}

function updateGoalPreview() {
  const target = Math.round(Number($("#gs-target").value));
  const deadline = $("#gs-deadline").value;
  const validTarget = Number.isFinite(target) && target >= 1;
  setText("#gs-number-label", validTarget ? formatNumber(Math.min(target, 999)) : "—");
  setText("#gs-unit-label", target === 1 ? "book" : "books");
  setText("#gs-date-label", deadline ? prettyDate(deadline) : "…");
  $$("[data-action='goal-preset']").forEach((button) => button.classList.toggle("active", Number(button.dataset.value) === target));
  $$("[data-action='goal-deadline']").forEach((button) => button.classList.toggle("active", deadline === presetDeadline(button.dataset.value)));
  setText("#gs-error", "");
  if (!validTarget || !deadline) { setText("#gs-pace", "Choose how many books and a finish date."); return; }
  const preview = { target, deadline, start: goalStart(deadline), unit: "books" };
  setText("#gs-pace", goalPaceText(preview, getGoalCurrent(preview)));
}

function syncGoalForm() {
  const goal = featuredBooksGoal();
  const today = ymd(new Date());
  $("#gs-target").value = goal?.target || 24;
  $("#gs-deadline").min = today;
  $("#gs-deadline").value = goal?.deadline && goal.deadline >= today ? goal.deadline : presetDeadline("this-year");
  $("#gs-submit").innerHTML = goal?.deadline ? "Update my goal <span>→</span>" : "Save my goal <span>→</span>";
  updateGoalPreview();
}

function saveGoalFromForm() {
  const target = Math.round(Number($("#gs-target").value));
  const deadline = $("#gs-deadline").value;
  if (!Number.isFinite(target) || target < 1 || target > 999) { setText("#gs-error", "Choose a number of books between 1 and 999."); $("#gs-target").focus(); return; }
  if (!deadline || deadline < ymd(new Date())) { setText("#gs-error", "Pick a finish date that hasn’t passed yet."); $("#gs-deadline").focus(); return; }
  const name = `Read ${formatNumber(target)} ${target === 1 ? "book" : "books"} by ${prettyDate(deadline)}`;
  const existing = featuredBooksGoal();
  if (existing) Object.assign(existing, { name, target, deadline, start: goalStart(deadline) });
  else {
    state.goals.forEach((goal) => { goal.featured = false; });
    state.goals.unshift({ id: `goal-${Date.now()}`, name, target, unit: "books", deadline, start: goalStart(deadline), featured: true });
  }
  saveState();
  render();
  showToast("Reading goal saved");
}

function chooseNext() {
  const books = tbrBooks();
  if (!books.length) { showToast("Search for a book to fill your TBR"); focusSearch(); return; }
  const options = books.filter((book) => book.id !== state.nextPickId);
  const selected = (options.length ? options : books)[Math.floor(Math.random() * (options.length || books.length))];
  state.nextPickId = selected.id;
  saveState();
  const card = $(".pick-card");
  card?.classList.remove("is-swapping");
  void card?.offsetWidth;
  card?.classList.add("is-swapping");
  renderPick(books);
  applyCoverImages();
  showToast(`Your next read is ${selected.title}`);
}

function openBookDialog(book) {
  if (!book) return;
  const dialog = $("#book-dialog");
  $("#book-id").value = book.id;
  $("#book-title").value = book.title || "";
  $("#book-author").value = book.author || "";
  $("#book-genre").value = book.genre || "";
  $("#book-pages").value = book.pages || "";
  $("#book-cover").value = book.cover || "";
  if (!dialog.open) dialog.showModal();
}

function openProgressDialog(book) {
  $("#progress-id").value = book.id;
  $("#progress-range").value = book.progress || 0;
  $("#progress-number").value = book.progress || 0;
  $("#progress-output").value = `${book.progress || 0}%`;
  $("#progress-dialog").showModal();
}

function openCompletionDialog(book, reviewOnly = false) {
  $("#completion-id").value = book.id;
  $("#completion-note").value = book.note || "";
  $("#completion-dialog").dataset.mode = reviewOnly ? "review" : "completion";
  $("#completion-dialog .section-kicker").textContent = reviewOnly ? "YOUR TAKE" : "ONE LAST NOTE";
  $("#completion-dialog-title").textContent = reviewOnly ? "Leave a review." : "You finished a story.";
  $("#completion-form .button-dark").innerHTML = reviewOnly ? "Save review <span>→</span>" : "Save to reading log <span>→</span>";
  $("#rating-picker").dataset.rating = book.rating || 0;
  $("#rating-picker").querySelectorAll("button").forEach((button) => button.classList.toggle("selected", Number(button.dataset.rating) <= (book.rating || 0)));
  $("#completion-dialog").showModal();
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("#toast-message").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2800);
}

function todayLabel() {
  return new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
}

function pushNav(navState) {
  // Entries pushed while results are showing are marked, so Back only clears results once you go back past the search.
  const entry = searchActive && !navState.search ? { ...navState, afterSearch: true } : navState;
  try { history.pushState(entry, ""); } catch (error) { /* history can be blocked in some previews */ }
}

// Show a view without touching history (used by navigate() and by the Back button handler).
function showView(view) {
  closeMenu();
  document.body.classList.remove("sidebar-open");
  if (view !== currentView) {
    currentView = view;
    $$(".page-view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
    $$(".nav-item").forEach((button) => {
      const navView = view === "book" ? previousView : view;
      const active = button.dataset.view === navView;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    const labels = { dashboard: todayLabel(), tbr: "Your personal library", log: "A record of your stories", goals: "Small goals, big stories", book: "Book details" };
    $("#view-eyebrow").textContent = labels[view] || labels.dashboard;
  }
  renderViewContent(view);
  window.scrollTo({ top: 0, behavior: "instant" });
}

// A user-initiated move to a main view. Adds a history entry so the Back button returns here.
function navigate(view) {
  if (view === currentView) { document.body.classList.remove("sidebar-open"); return; }
  detailStack = []; detailRef = null;
  pushNav({ view });
  showView(view);
}

function focusSearch() {
  document.body.classList.remove("sidebar-open");
  navigate("dashboard");
  setTimeout(() => $("#global-book-search-query").focus(), 60);
}

function getBook(id) { return state.books.find((book) => book.id === id); }

function startBook(book) {
  book.status = "reading";
  book.progress = book.progress || 1;
  saveState(); render();
  showToast(`${book.title} is now in progress`);
}

// ---------------------------------------------------------------------------
// "More options" menu (books and goals) + confirmation before anything is removed
// ---------------------------------------------------------------------------
function isPlaceholderNote(note = "") {
  return !note || note === "Found via Open Library." || note === "A new possibility from your reading list.";
}

function hasOwnReview(book) {
  return book.status === "completed" && Boolean(book.rating || !isPlaceholderNote(book.note));
}

function menuEl() {
  let el = $("#menu-pop");
  if (!el) {
    el = document.createElement("div");
    el.id = "menu-pop";
    el.className = "menu-pop";
    el.setAttribute("role", "menu");
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function bookMenuItems(book) {
  const items = [];
  if (currentView !== "book") items.push({ action: "view", label: "View details" });
  if (book.status === "tbr") items.push({ action: "start", label: "Start reading" });
  if (book.status === "reading") items.push({ action: "progress", label: "Update progress" });
  if (book.status !== "completed") items.push({ action: "finish", label: "Mark as finished" });
  if (book.status === "completed") items.push({ action: "review", label: hasOwnReview(book) ? "Edit review" : "Write a review" });
  items.push({ action: "edit", label: "Edit details" });
  items.push({ divider: true });
  items.push({ action: "remove", label: "Remove from shelf", danger: true });
  return items.map((item) => ({ ...item, id: book.id }));
}

function openMenu(trigger, items) {
  const el = menuEl();
  if (!el.hidden && menuTrigger === trigger) return closeMenu(true);
  if (menuTrigger) menuTrigger.setAttribute("aria-expanded", "false");
  menuTrigger = trigger;
  el.innerHTML = items.map((item) => item.divider
    ? `<hr role="separator" />`
    : `<button type="button" role="menuitem" class="menu-item${item.danger ? " is-danger" : ""}" data-menu-action="${item.action}" data-id="${escapeHtml(item.id || "")}">${escapeHtml(item.label)}</button>`).join("");
  el.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  const rect = trigger.getBoundingClientRect();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.querySelector(".menu-item")?.focus({ preventScroll: true });
}

function closeMenu(returnFocus = false) {
  const el = $("#menu-pop");
  if (el) el.hidden = true;
  if (menuTrigger) {
    menuTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus && document.contains(menuTrigger)) menuTrigger.focus();
  }
  menuTrigger = null;
}

function handleMenuKeys(event) {
  const items = [...menuEl().querySelectorAll(".menu-item")];
  if (!items.length) return;
  const index = items.indexOf(document.activeElement);
  if (event.key === "ArrowDown") { event.preventDefault(); items[(index + 1) % items.length].focus(); }
  else if (event.key === "ArrowUp") { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
  else if (event.key === "Tab") closeMenu();
}

function runMenuAction(action, id) {
  if (action === "remove-goal") return removeGoal(id);
  if (action === "edit-goal") { $("#goal-setter-form")?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" }); return setTimeout(() => $("#gs-target").focus({ preventScroll: true }), 250); }
  const book = getBook(id);
  if (!book) return;
  if (action === "view") return openBook({ id });
  if (action === "start") return startBook(book);
  if (action === "progress") return openProgressDialog(book);
  if (action === "finish") return openCompletionDialog(book);
  if (action === "review") return openCompletionDialog(book, true);
  if (action === "edit") return openBookDialog(book);
  if (action === "remove") return removeBook(id);
}

function askConfirm({ title, text, okLabel }) {
  return new Promise((resolve) => {
    const dialog = $("#confirm-dialog");
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    $("#confirm-ok").textContent = okLabel;
    dialog.returnValue = "";
    const onClose = () => { dialog.removeEventListener("close", onClose); resolve(dialog.returnValue === "confirm"); };
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}

async function removeBook(id) {
  const book = getBook(id);
  if (!book) return;
  const confirmed = await askConfirm({
    title: "Remove this book?",
    text: `“${book.title}” will come off your shelf, along with its progress and review. This can’t be undone.`,
    okLabel: "Remove book"
  });
  if (!confirmed) return;
  const wasOpen = currentView === "book" && detailRef?.id === id;
  state.books = state.books.filter((item) => item.id !== id);
  if (state.nextPickId === id) state.nextPickId = tbrBooks()[0]?.id || "";
  saveState();
  render();
  if (wasOpen) closeBook();
  showToast(`${book.title} was removed from your shelf`);
}

async function removeGoal(id) {
  const goal = state.goals.find((item) => item.id === id);
  if (!goal) return;
  const confirmed = await askConfirm({ title: "Remove this goal?", text: `“${goal.name}” will be deleted. Your books and progress stay as they are.`, okLabel: "Remove goal" });
  if (!confirmed) return;
  state.goals = state.goals.filter((item) => item.id !== id);
  saveState(); render(); showToast("Goal removed");
  if (currentView === "goals") syncGoalForm();
}

// ---------------------------------------------------------------------------
// Book detail page
// ---------------------------------------------------------------------------
// Open Library has public ratings but no public text reviews, so these are previews.
const PREVIEW_REVIEWS = [
  { name: "Mira S.", rating: 5, ago: "2 weeks ago", text: "Stayed with me for days after the last page. I kept going back to a few scenes in my head." },
  { name: "Daniel O.", rating: 4, ago: "3 weeks ago", text: "Slow to start, but the second half pulled me in completely. Worth the patience." },
  { name: "Priya R.", rating: 5, ago: "1 month ago", text: "Beautifully written. I read the last fifty pages in one sitting and didn’t want it to end." },
  { name: "Tom W.", rating: 3, ago: "1 month ago", text: "Strong ideas and some lovely moments, though I wanted more from the ending." },
  { name: "Lena K.", rating: 4, ago: "2 months ago", text: "A comforting read for a rainy weekend. Easy to recommend to friends." },
  { name: "Arjun M.", rating: 5, ago: "2 months ago", text: "I underlined half the book. The prose is the real draw here." },
  { name: "Chloe B.", rating: 2, ago: "3 months ago", text: "Not for me. I admired the craft but never connected with the characters." },
  { name: "Sam H.", rating: 4, ago: "4 months ago", text: "Thoughtful and surprisingly funny in places. I’d happily read more from this author." }
];

const VIEW_NAMES = { dashboard: "Today", tbr: "My TBR", log: "Reading log", goals: "Goals" };

function hashString(text) {
  let hash = 0;
  for (const character of String(text)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function currentDetail() {
  if (!detailRef) return null;
  if (detailRef.id) {
    const book = getBook(detailRef.id);
    return book ? { book, onShelf: true } : null;
  }
  const doc = detailRef.doc;
  const author = openLibraryAuthors(doc).split(",")[0];
  const shelved = state.books.find((item) => bookKey(item.title, item.author) === bookKey(doc.title, author));
  if (shelved) return { book: shelved, onShelf: true };
  return { book: { id: "", ...docToBook(doc), status: "", progress: 0, note: "" }, onShelf: false };
}

function openBook(ref) {
  closeMenu();
  const wasBook = currentView === "book";
  const before = detailRef;
  detailRef = ref;
  const detail = currentDetail();
  if (!detail) { detailRef = before; return; }
  if (!wasBook) { previousView = currentView; previousScroll = window.scrollY; detailStack = []; }
  detailStack.push(ref);
  pushNav({ view: "book", depth: detailStack.length });
  renderBookDetail();
  applyCoverImages();
  if (!wasBook) showView("book"); else window.scrollTo({ top: 0, behavior: "instant" });
  loadBookExtras(detail.book).then(() => loadRelated(detail.book));
  setTimeout(() => $("#book-detail .back-link")?.focus({ preventScroll: true }), 60);
}

// Back goes through history so the phone/browser Back button and the on-page link behave the same.
function closeBook() {
  if (history.state?.view === "book") { history.back(); return; }
  detailStack = []; detailRef = null;
  showView(previousView || "dashboard");
  window.scrollTo({ top: previousScroll, behavior: "instant" });
}

function addDetailBook() {
  if (!detailRef?.doc) return;
  const added = addDocToShelf(detailRef.doc);
  if (added) { detailRef = { id: added.id }; detailStack[detailStack.length - 1] = detailRef; }
}

window.addEventListener("popstate", (event) => {
  const target = event.state || { view: "dashboard" };
  closeMenu();
  document.body.classList.remove("sidebar-open");
  if (target.view === "book") {
    const ref = detailStack[(target.depth || 1) - 1];
    if (ref) {
      detailStack.length = target.depth;
      detailRef = ref;
      renderBookDetail();
      applyCoverImages();
      if (currentView !== "book") showView("book"); else window.scrollTo({ top: 0, behavior: "instant" });
      const detail = currentDetail();
      if (detail) loadBookExtras(detail.book).then(() => loadRelated(detail.book));
      return;
    }
    // Nothing to restore (for example after a reload): fall back to the last list.
    try { history.replaceState({ view: previousView || "dashboard" }, ""); } catch (error) { /* ignore */ }
    detailStack = []; detailRef = null;
    showView(previousView || "dashboard");
    return;
  }
  const leavingBook = currentView === "book";
  detailStack = []; detailRef = null;
  showView(target.view || "dashboard");
  if (leavingBook) window.scrollTo({ top: previousScroll, behavior: "instant" });
  if (searchActive && !target.search && !target.afterSearch) clearSearch();
});

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function cleanDescription(raw) {
  let text = typeof raw === "string" ? raw : raw?.value || "";
  text = text.split(/\r?\n-{3,}/)[0]
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[\d+\]/g, "$1")
    .replace(/\*\*|__/g, "")
    .trim();
  if (text.length > 1100) text = `${text.slice(0, 1100).replace(/\s+\S*$/, "")}…`;
  return text;
}

function loadBookExtras(book) {
  const key = book.openLibraryKey;
  if (!key || !/^\/works\/OL\d+W$/.test(key)) return Promise.resolve();
  if (extrasPromises[key] && detailCache[key]?.status !== "error") return extrasPromises[key];
  extrasPromises[key] = fetchExtras(key);
  return extrasPromises[key];
}

async function fetchExtras(key) {
  detailCache[key] = { status: "loading" };
  const [work, ratings] = await Promise.allSettled([
    fetchJson(`https://openlibrary.org${key}.json`),
    fetchJson(`https://openlibrary.org${key}/ratings.json`)
  ]);
  const entry = { status: "done", description: "", subjects: [], ratings: null };
  if (work.status === "fulfilled") {
    entry.description = cleanDescription(work.value.description);
    entry.subjects = Array.isArray(work.value.subjects) ? work.value.subjects.filter((item) => typeof item === "string").slice(0, 6) : [];
  }
  if (ratings.status === "fulfilled") {
    const data = ratings.value || {};
    entry.ratings = { average: Number(data.summary?.average) || 0, count: Number(data.summary?.count) || 0, counts: data.counts || {} };
  }
  if (work.status === "rejected" && ratings.status === "rejected") entry.status = "error";
  detailCache[key] = entry;
  if (currentView === "book" && detailRef) renderBookDetail();
  applyCoverImages();
}

function starsMarkup(value) {
  const percent = Math.max(0, Math.min(100, (Number(value) / 5) * 100));
  return `<span class="star-row" style="--fill:${percent}%" aria-hidden="true">★★★★★</span><span class="visually-hidden">${Number(value).toFixed(1)} out of 5 stars</span>`;
}

function previewReviews(book) {
  const start = hashString(book.title) % PREVIEW_REVIEWS.length;
  return Array.from({ length: 5 }, (_, offset) => PREVIEW_REVIEWS[(start + offset) % PREVIEW_REVIEWS.length]);
}

function ratingStats(book, extras, reviews) {
  const online = extras?.ratings;
  if (online && online.count > 0 && online.average > 0) {
    return { average: online.average, count: online.count, counts: online.counts, source: "Open Library readers" };
  }
  const values = reviews.map((review) => review.rating).filter(Boolean);
  if (book.status === "completed" && book.rating) values.push(book.rating);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  values.forEach((value) => { counts[value] += 1; });
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return { average, count: values.length, counts, source: "the reviews below" };
}

function reviewCardMarkup({ name, rating, text, meta, mine = false, action = "" }) {
  return `<article class="review-card${mine ? " is-mine" : ""}">
    <div class="review-avatar" aria-hidden="true">${escapeHtml(mine ? "You" : name.split(" ").map((part) => part[0]).join(""))}</div>
    <div class="review-body">
      <div class="review-head"><strong>${escapeHtml(mine ? "Your review" : name)}</strong><span>${escapeHtml(meta)}</span></div>
      ${rating ? `<div class="review-stars">${starsMarkup(rating)}</div>` : ""}
      ${text ? `<p>${escapeHtml(text)}</p>` : ""}
      ${action}
    </div>
  </article>`;
}

// Related books: more by the same author plus books that share the first subjects (or the genre).
async function loadRelated(book) {
  const id = bookKey(book.title, book.author);
  if (relatedCache[id] && relatedCache[id].status !== "error") return;
  relatedCache[id] = { status: "loading", docs: [] };
  const subjects = detailCache[book.openLibraryKey]?.subjects || [];
  const topics = subjects.slice(0, 2);
  if (!topics.length && book.genre && !["To discover", "Uncategorized"].includes(book.genre)) topics.push(book.genre);
  const searches = [];
  if (book.author && book.author !== "Unknown author") searches.push({ author: book.author });
  topics.forEach((topic) => searches.push({ q: `subject:"${topic.replace(/"/g, "")}"` }));
  const results = await Promise.allSettled(searches.map((params) => {
    const url = new URL(OPEN_LIBRARY_SEARCH_URL);
    Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));
    url.searchParams.set("limit", "20");
    url.searchParams.set("fields", "key,title,author_name,first_publish_year,publisher,cover_i,number_of_pages_median");
    return fetchJson(url.toString());
  }));
  const seen = new Set([id.split("::")[0]]);
  const docs = [];
  results.forEach((result) => {
    if (result.status !== "fulfilled") return;
    (result.value.docs || []).forEach((doc) => {
      const titleKey = bookKey(doc.title, "").replace("::", "");
      if (!doc.title || seen.has(titleKey) || doc.key === book.openLibraryKey) return;
      seen.add(titleKey);
      docs.push(doc);
    });
  });
  docs.sort((a, b) => Boolean(b.cover_i) - Boolean(a.cover_i));
  const failed = searches.length > 0 && results.every((result) => result.status === "rejected");
  relatedCache[id] = { status: failed ? "error" : "done", docs: docs.slice(0, 10) };
  if (currentView === "book" && detailRef) renderBookDetail();
  applyCoverImages();
}

function relatedMarkup(book) {
  const entry = relatedCache[bookKey(book.title, book.author)];
  detailRelatedDocs = entry?.docs || [];
  let body;
  if (!entry || entry.status === "loading") body = `<p class="muted related-status">Finding books you might like…</p>`;
  else if (entry.status === "error") body = `<p class="muted related-status">Couldn’t load recommendations from Open Library. <button class="retry-button" type="button" data-action="retry-related">Try again</button></p>`;
  else if (!entry.docs.length) return "";
  else body = `<div class="related-row">${entry.docs.map((doc, index) => {
    const cover = openLibraryCover(doc);
    const author = openLibraryAuthors(doc).split(",")[0];
    const onShelf = isBookOnShelf(doc);
    return `<article class="related-card">
      <div class="related-cover is-openable" role="button" tabindex="0" data-action="open-related" data-related-index="${index}" aria-label="Open details for ${escapeHtml(doc.title)}">${cover ? `<img src="${cover}" width="150" height="225" loading="lazy" decoding="async" alt="" data-open-cover />` : `<div class="open-book-placeholder"><span>${escapeHtml(initials(doc.title))}</span><small>No cover<br />on record</small></div>`}</div>
      <h3><button type="button" class="title-link" data-action="open-related" data-related-index="${index}">${escapeHtml(doc.title)}</button></h3>
      <p>${escapeHtml(author)}${doc.first_publish_year ? ` · ${escapeHtml(doc.first_publish_year)}` : ""}</p>
      <button class="card-action ${onShelf ? "is-added" : ""}" data-action="add-related" data-related-index="${index}" ${onShelf ? "disabled" : ""}>${onShelf ? "✓ On your TBR" : "Add to TBR"} <span>${onShelf ? "" : "→"}</span></button>
    </article>`;
  }).join("")}</div>`;
  return `<section class="detail-section related-section" aria-labelledby="related-heading"><h2 id="related-heading">You might also like</h2>${body}</section>`;
}

function renderBookDetail() {
  const host = $("#book-detail");
  if (!host) return;
  const detail = currentDetail();
  if (!detail) {
    host.innerHTML = `<div class="empty-state"><div><strong>This book isn’t on your shelf anymore.</strong><span>Head back to find another story.</span></div></div>`;
    return;
  }
  const { book, onShelf } = detail;
  const extras = book.openLibraryKey ? detailCache[book.openLibraryKey] : null;
  const reviews = previewReviews(book);
  const stats = ratingStats(book, extras, reviews);
  const backLabel = VIEW_NAMES[previousView] || "Today";

  const description = extras?.description || (onShelf && book.status !== "completed" && !isPlaceholderNote(book.note) ? book.note : "");
  const descriptionMarkup = description
    ? description.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")
    : extras?.status === "loading" ? `<p class="muted">Loading the description from Open Library…</p>`
    : extras?.status === "error" ? `<p class="muted">Couldn’t reach Open Library for the description and ratings. Close this page and open the book again to retry.</p>`
    : `<p class="muted">No description on record for this book yet.</p>`;

  const facts = [
    ["Author", book.author],
    book.pages > 1 ? ["Pages", formatNumber(book.pages)] : null,
    book.firstPublishYear ? ["First published", book.firstPublishYear] : null,
    book.publisher ? ["Publisher", book.publisher] : null,
    book.genre ? ["Genre", book.genre] : null,
    book.status === "completed" && book.completedAt ? ["Finished", prettyDate(book.completedAt)] : null
  ].filter(Boolean).map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");

  let primary;
  if (!onShelf) primary = `<button class="button button-dark" data-action="add-detail-book">Add to TBR <span>→</span></button>`;
  else if (book.status === "tbr") primary = `<button class="button button-dark" data-action="start-book" data-id="${book.id}">Start reading <span>→</span></button>`;
  else if (book.status === "reading") primary = `<button class="button button-dark" data-action="open-progress" data-id="${book.id}">Update progress <span>→</span></button>`;
  else primary = `<button class="button button-dark" data-action="review-book" data-id="${book.id}">${hasOwnReview(book) ? "Edit review" : "Write a review"} <span>→</span></button>`;
  const more = onShelf ? `<button class="button button-ghost" data-action="book-menu" data-id="${book.id}" aria-haspopup="menu" aria-expanded="false" aria-label="More options for ${escapeHtml(book.title)}">More options <span>···</span></button>` : "";

  const largeCover = String(book.cover || "").replace(/-M\.jpg$/, "-L.jpg");
  const coverInner = largeCover ? "" : `<span>${escapeHtml(initials(book.title))}</span>`;
  const progress = onShelf && book.status === "reading"
    ? `<div class="detail-progress"><div class="progress-line" aria-label="${book.progress || 0}% complete"><span style="width:${Math.min(100, book.progress || 0)}%"></span></div><small>${book.progress || 0}% read · about ${formatNumber(Math.round((Number(book.pages || 0) * (book.progress || 0)) / 100))} pages</small></div>`
    : "";

  const total = Math.max(1, stats.count);
  const bars = [5, 4, 3, 2, 1].map((star) => {
    const count = Number(stats.counts?.[star] || 0);
    return `<div class="dist-row"><span>${star} star${star === 1 ? "" : "s"}</span><i><b style="width:${Math.round((count / total) * 100)}%"></b></i><span>${formatNumber(count)}</span></div>`;
  }).join("");
  const summarySource = stats.source === "the reviews below" ? "Based on the reviews below" : `${formatNumber(stats.count)} ${stats.count === 1 ? "rating" : "ratings"} on Open Library`;

  const mine = onShelf && hasOwnReview(book)
    ? reviewCardMarkup({ name: "You", rating: book.rating || 0, text: isPlaceholderNote(book.note) ? "" : book.note, meta: prettyDate(book.completedAt), mine: true, action: `<button class="review-button" data-action="review-book" data-id="${book.id}">Edit review <span>→</span></button>` })
    : onShelf && book.status === "completed"
      ? `<div class="review-prompt"><span>You haven’t reviewed this one yet.</span><button class="review-button" data-action="review-book" data-id="${book.id}">Write a review <span>→</span></button></div>`
      : onShelf ? `<div class="review-prompt"><span>Finish the book to add your own rating and review.</span></div>` : "";

  host.innerHTML = `<article class="book-page">
    <button class="back-link" type="button" data-action="close-book"><span aria-hidden="true">←</span> Back to ${escapeHtml(backLabel)}</button>
    <header class="book-hero">
      <div class="hero-cover cover-${escapeHtml(book.color || "sage")}" data-cover="${escapeHtml(largeCover)}" role="img" aria-label="Cover of ${escapeHtml(book.title)}">${coverInner}</div>
      <div class="book-hero-copy">
        ${onShelf ? `<span class="status-badge ${book.status}">${statusLabel(book.status)}</span>` : `<span class="status-badge">Not on your shelf</span>`}
        <h1>${escapeHtml(book.title)}</h1>
        <p class="hero-author">by ${escapeHtml(book.author)}</p>
        ${stats.count ? `<div class="hero-rating">${starsMarkup(stats.average)}<strong>${stats.average.toFixed(1)}</strong><span>${summarySource}</span></div>` : ""}
        ${progress}
        <dl class="book-facts">${facts}</dl>
        ${extras?.subjects?.length ? `<div class="tag-row">${extras.subjects.map((subject) => `<span class="tag tag-light">${escapeHtml(subject)}</span>`).join("")}</div>` : ""}
        <div class="hero-actions">${primary}${more}</div>
      </div>
    </header>

    <section class="detail-section" aria-labelledby="about-heading">
      <h2 id="about-heading">About this book</h2>
      <div class="detail-prose">${descriptionMarkup}</div>
    </section>

    <section class="detail-section" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading">What readers think</h2>
      <div class="rating-summary">
        <div class="rating-big"><strong>${stats.count ? stats.average.toFixed(1) : "—"}</strong>${stats.count ? starsMarkup(stats.average) : ""}<span>${stats.count ? summarySource : "No ratings yet"}</span></div>
        <div class="rating-dist" aria-label="Rating breakdown">${bars}</div>
      </div>
      ${extras?.status === "loading" ? `<p class="muted">Checking Open Library for ratings…</p>` : ""}
      <div class="review-list">
        ${mine}
        ${reviews.map((review) => reviewCardMarkup({ name: review.name, rating: review.rating, text: review.text, meta: review.ago })).join("")}
      </div>
      <p class="preview-note">Reader reviews are previews for now. Star ratings come from Open Library when it has them.</p>
    </section>
    ${relatedMarkup(book)}
  </article>`;

  // If the large cover can't be loaded, fall back to the book's initials.
  if (largeCover) {
    const probe = new Image();
    probe.onerror = () => { const hero = $("#book-detail .hero-cover"); if (hero && !hero.querySelector("span")) hero.innerHTML = `<span>${escapeHtml(initials(book.title))}</span>`; };
    probe.src = largeCover;
  }
}

$("#choose-next").addEventListener("click", chooseNext);
$("#mobile-menu").addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
$("#focus-search").addEventListener("click", focusSearch);

$("#progress-range").addEventListener("input", (event) => { $("#progress-number").value = event.target.value; $("#progress-output").value = `${event.target.value}%`; });
$("#progress-number").addEventListener("input", (event) => { const value = Math.max(0, Math.min(100, Number(event.target.value) || 0)); $("#progress-range").value = value; $("#progress-output").value = `${value}%`; });
$("#rating-picker").addEventListener("click", (event) => { const button = event.target.closest("button"); if (!button) return; $("#rating-picker").dataset.rating = button.dataset.rating; $("#rating-picker").querySelectorAll("button").forEach((item) => item.classList.toggle("selected", Number(item.dataset.rating) <= Number(button.dataset.rating))); });

$("#book-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const book = getBook($("#book-id").value);
  if (!book) return;
  const values = { title: $("#book-title").value.trim(), author: $("#book-author").value.trim(), genre: $("#book-genre").value.trim() || "Uncategorized", pages: Math.max(1, Number($("#book-pages").value) || 0), cover: $("#book-cover").value.trim() };
  if (!values.title || !values.author) return;
  Object.assign(book, values);
  saveState(); render(); $("#book-dialog").close(); showToast("Book details updated");
});

$("#progress-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const book = getBook($("#progress-id").value); if (!book) return;
  const progress = Math.max(0, Math.min(100, Number($("#progress-number").value) || 0));
  book.status = progress >= 100 ? "completed" : "reading"; book.progress = progress;
  if (progress >= 100) { book.completedAt = new Date().toISOString().slice(0, 10); $("#progress-dialog").close(); openCompletionDialog(book); }
  else { saveState(); render(); $("#progress-dialog").close(); showToast(`Progress saved at ${progress}%`); }
});

$("#completion-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const book = getBook($("#completion-id").value); if (!book) return;
  const reviewOnly = $("#completion-dialog").dataset.mode === "review";
  if (!reviewOnly) { book.status = "completed"; book.progress = 100; book.completedAt = book.completedAt || new Date().toISOString().slice(0, 10); }
  book.rating = Number($("#rating-picker").dataset.rating || 0); book.note = $("#completion-note").value.trim();
  saveState(); render(); $("#completion-dialog").close(); showToast(reviewOnly ? "Review saved" : "Added to your reading log");
});

$("#goal-setter-form").addEventListener("submit", (event) => { event.preventDefault(); saveGoalFromForm(); });
$("#gs-target").addEventListener("input", updateGoalPreview);
$("#gs-deadline").addEventListener("input", updateGoalPreview);

// Click on a dialog's dimmed backdrop closes it.
$$("dialog.modal").forEach((dialog) => dialog.addEventListener("mousedown", (event) => { if (event.target === dialog) dialog.close("cancel"); }));

$("#book-search").addEventListener("input", debounce(renderLibrary, 140));
$("#book-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  searchOpenLibrary($("#book-search-query").value, "tbr");
});
$("#global-book-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const query = $("#global-book-search-query").value;
  navigate("dashboard");
  searchOpenLibrary(query, "dashboard");
  if (query.trim()) setTimeout(() => $("#home-book-search-wrap").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" }), 80);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { document.body.classList.remove("sidebar-open"); if (menuTrigger) closeMenu(true); }
  if (menuTrigger) handleMenuKeys(event);
  const opener = event.target.closest?.('[role="button"][data-action]');
  if (opener && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); opener.click(); }
});
window.addEventListener("scroll", () => { if (menuTrigger) closeMenu(); }, { passive: true });
window.addEventListener("resize", () => { if (menuTrigger) closeMenu(); });

document.addEventListener("click", (event) => {
  // Cancel / × buttons are plain closers, so they never run a form's save handler.
  const closer = event.target.closest("[data-close-dialog]");
  if (closer) return closer.closest("dialog")?.close("cancel");
  if (document.body.classList.contains("sidebar-open") && !event.target.closest(".sidebar, #mobile-menu")) document.body.classList.remove("sidebar-open");
  if (menuTrigger && !event.target.closest("#menu-pop, [data-action='book-menu'], [data-action='goal-menu']")) closeMenu();
  const menuItem = event.target.closest("[data-menu-action]");
  if (menuItem) { const { menuAction, id } = menuItem.dataset; closeMenu(); return runMenuAction(menuAction, id); }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) return navigate(viewButton.dataset.view);
  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) { activeFilter = filterButton.dataset.filter; $$(".filter-pill").forEach((button) => button.classList.toggle("active", button === filterButton)); return renderLibrary(); }
  const logFilterButton = event.target.closest("[data-log-filter]");
  if (logFilterButton) { logFilter = logFilterButton.dataset.logFilter; $$("[data-log-filter]").forEach((button) => button.classList.toggle("active", button === logFilterButton)); return renderLog(completedBooks()); }
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const book = actionButton.dataset.id ? getBook(actionButton.dataset.id) : null;
  if (actionButton.dataset.action === "focus-search") return focusSearch();
  if (actionButton.dataset.action === "retry-search") return searchOpenLibrary(lastSearchQuery, searchOrigin);
  if (actionButton.dataset.action === "clear-search") return history.state?.search ? history.back() : clearSearch();
  if (actionButton.dataset.action === "goal-step") { const input = $("#gs-target"); input.value = Math.max(1, Math.min(999, (Math.round(Number(input.value)) || 0) + Number(actionButton.dataset.step))); return updateGoalPreview(); }
  if (actionButton.dataset.action === "goal-preset") { $("#gs-target").value = actionButton.dataset.value; return updateGoalPreview(); }
  if (actionButton.dataset.action === "goal-deadline") { $("#gs-deadline").value = presetDeadline(actionButton.dataset.value); return updateGoalPreview(); }
  if (actionButton.dataset.action === "open-progress" && book) return openProgressDialog(book);
  if (actionButton.dataset.action === "start-book" && book) return startBook(book);
  if (actionButton.dataset.action === "edit-book" && book) return openBookDialog(book);
  if (actionButton.dataset.action === "review-book" && book) return openCompletionDialog(book, true);
  if (actionButton.dataset.action === "add-book-search-result") return addOpenLibraryBook(Number(actionButton.dataset.resultIndex));
  if (actionButton.dataset.action === "book-menu" && book) return openMenu(actionButton, bookMenuItems(book));
  if (actionButton.dataset.action === "goal-menu") return openMenu(actionButton, [
    ...(actionButton.dataset.featured ? [{ action: "edit-goal", label: "Edit goal", id: actionButton.dataset.id }, { divider: true }] : []),
    { action: "remove-goal", label: "Remove goal", danger: true, id: actionButton.dataset.id }
  ]);
  if (actionButton.dataset.action === "open-book" && book) return openBook({ id: book.id });
  if (actionButton.dataset.action === "open-result") { const doc = bookSearchResults[Number(actionButton.dataset.resultIndex)]; if (doc) openBook({ doc }); return; }
  if (actionButton.dataset.action === "close-book") return closeBook();
  if (actionButton.dataset.action === "open-related") { const doc = detailRelatedDocs[Number(actionButton.dataset.relatedIndex)]; if (doc) openBook({ doc }); return; }
  if (actionButton.dataset.action === "add-related") return void addDocToShelf(detailRelatedDocs[Number(actionButton.dataset.relatedIndex)]);
  if (actionButton.dataset.action === "retry-related") { const detail = currentDetail(); if (detail) { delete relatedCache[bookKey(detail.book.title, detail.book.author)]; loadRelated(detail.book); renderBookDetail(); } return; }
  if (actionButton.dataset.action === "add-detail-book") return addDetailBook();
});

// Pick a quote that differs from the last one shown, and fade it in.
function showLoaderQuote() {
  const figure = $("#loader-quote");
  if (!figure) return;
  // index.html already put a quote on screen at first paint; just work out how long to keep it up.
  if (figure.dataset.ready) {
    const quoteDuration = 1000 + ($("#loader-quote-text").textContent.split(/\s+/).length * 100);
    LOADER_MIN_MS = window.__hasCachedSession ? LOGGED_IN_LOADER_MS : quoteDuration;
    return;
  }
  let last = -1;
  try { last = Number(localStorage.getItem(QUOTE_KEY)); } catch (error) { /* storage can be blocked */ }
  let index = Math.floor(Math.random() * BOOK_QUOTES.length);
  if (index === last) index = (index + 1) % BOOK_QUOTES.length;
  try { localStorage.setItem(QUOTE_KEY, String(index)); } catch (error) { /* ignore */ }
  const quote = BOOK_QUOTES[index];
  $("#loader-quote-text").textContent = `“${quote.text}”`;
  $("#loader-quote-source").textContent = `— ${quote.source}`;
  LOADER_MIN_MS = window.__hasCachedSession ? LOGGED_IN_LOADER_MS : 1000 + quote.text.split(/\s+/).length * 100;
  window.requestAnimationFrame(() => figure.classList.add("is-in"));
}

// Let a reader who has seen enough tap or press a key to continue.
function allowLoaderSkip() {
  const loader = $("#app-loader");
  if (!loader) return;
  const skip = () => { if (performance.now() - loaderStart > 1000) finishLoading(); };
  loader.addEventListener("click", skip);
  document.addEventListener("keydown", skip, { once: true });
}

showLoaderQuote();
$("#view-eyebrow").textContent = todayLabel();
render();

function finishLoading() {
  const loader = $("#app-loader");
  if (!loader || loader.classList.contains("is-hidden")) return;
  document.body.classList.remove("is-loading");
  document.body.classList.add("is-ready");
  document.body.setAttribute("aria-busy", "false");
  if (loader) {
    const status = $("#loader-status");
    if (status) status.textContent = "Ready";
    loader.classList.add("is-hidden");
    window.setTimeout(() => loader.remove(), 480);
  }
}

// The script is deferred, so the first render has already happened here: keep the loader just long
// enough to feel intentional, then leave. It no longer waits for the window "load" event.
function scheduleLoaderExit() {
  if (window.__hasCachedSession) {
    window.setTimeout(() => window.requestAnimationFrame(finishLoading), LOGGED_IN_LOADER_MS);
    return;
  }
  const wait = Math.max(0, LOADER_MIN_MS - (performance.now() - loaderStart));
  window.setTimeout(() => window.requestAnimationFrame(finishLoading), wait);
}
allowLoaderSkip();
scheduleLoaderExit();

// Seed the history so the first Back press stays inside the app.
try { history.scrollRestoration = "manual"; history.replaceState({ view: "dashboard" }, ""); } catch (error) { /* ignore */ }
