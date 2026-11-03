(function () {
  var WIDGET_SCRIPT_ID = 'twitter-wjs';

  function safeTweetUrl(value) {
    try {
      var url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
      var host = url.hostname.toLowerCase();
      if (host === 'www.x.com' || host === 'mobile.x.com') host = 'x.com';
      if (host === 'www.twitter.com' || host === 'mobile.twitter.com') host = 'twitter.com';
      if (host !== 'x.com' && host !== 'twitter.com') return '';
      if (!/^\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(url.pathname)) return '';
      return url.origin + url.pathname;
    } catch (error) {
      return '';
    }
  }

  function asText(value) {
    return typeof value === 'string' ? value : '';
  }

  function itemTime(item) {
    var parsed = Date.parse(item && item.date);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }

  function sortNewest(items) {
    return items.slice().sort(function (a, b) {
      return itemTime(b) - itemTime(a);
    });
  }

  function validCategories(data) {
    if (!data || !Array.isArray(data.categories)) return [];
    return data.categories.filter(function (category) {
      return category
        && typeof category.id === 'string'
        && /^[a-z0-9-]+$/.test(category.id)
        && typeof category.name === 'string';
    });
  }

  function knownCategoryIds(categories) {
    var ids = new Set();
    categories.forEach(function (category) {
      ids.add(category.id);
    });
    return ids;
  }

  function resolveCategory(item, known) {
    var id = item && typeof item.category === 'string' ? item.category : '';
    return known.has(id) ? id : 'other';
  }

  function appendText(parent, className, text) {
    if (!text) return;
    var node = document.createElement('p');
    node.className = className;
    node.textContent = text;
    parent.appendChild(node);
  }

  function stringList(value) {
    if (!Array.isArray(value)) return '';
    return value.filter(function (entry) {
      return typeof entry === 'string' && entry.trim();
    }).join('・');
  }

  function createLabCard(item) {
    var card = document.createElement('article');
    card.className = 'lab-card';

    var heading = document.createElement('h4');
    var emoji = asText(item.emoji);
    heading.textContent = (emoji ? emoji + ' ' : '') + asText(item.title);
    card.appendChild(heading);

    appendText(card, 'lab-card-date', asText(item.date));
    appendText(card, 'lab-card-desc', asText(item.description));
    var tools = stringList(item.tools);
    var tags = stringList(item.tags);
    appendText(card, 'lab-card-tools', tools ? 'ツール：' + tools : '');
    appendText(card, 'lab-card-tags', tags ? 'タグ：' + tags : '');

    var tweetUrl = safeTweetUrl(item.tweet_url);
    if (tweetUrl) {
      var quote = document.createElement('blockquote');
      quote.className = 'twitter-tweet';
      quote.setAttribute('data-theme', 'light');
      quote.setAttribute('data-width', '100%');
      var link = document.createElement('a');
      link.href = tweetUrl;
      link.textContent = 'ポストを読み込み中...';
      quote.appendChild(link);
      card.appendChild(quote);
    } else {
      appendText(card, 'lab-card-missing', '投稿のURLを確認できませんでした。');
    }
    return card;
  }

  function ensureTwitterWidgets(done) {
    var twttr = window.twttr = window.twttr || {};
    if (twttr.widgets) {
      done(twttr);
      return;
    }
    twttr._e = twttr._e || [];
    twttr.ready = twttr.ready || function (fn) {
      twttr._e.push(fn);
    };
    twttr.ready(function (readyTwttr) {
      done(readyTwttr || window.twttr);
    });
    if (document.getElementById(WIDGET_SCRIPT_ID)) return;
    var script = document.createElement('script');
    script.id = WIDGET_SCRIPT_ID;
    script.async = true;
    script.charset = 'utf-8';
    script.src = 'https://platform.twitter.com/widgets.js';
    document.body.appendChild(script);
  }

  function loadTwitterEmbeds(grid) {
    if (!grid || grid.dataset.widgetsLoaded === '1') return;
    var quotes = Array.prototype.slice.call(grid.querySelectorAll('blockquote.twitter-tweet, blockquote[data-tweet-pending]'));
    if (!quotes.length) return;
    grid.dataset.widgetsLoaded = '1';
    quotes.forEach(function (quote) {
      quote.classList.remove('twitter-tweet');
      quote.setAttribute('data-tweet-pending', '1');
    });
    ensureTwitterWidgets(function (twttr) {
      window.setTimeout(function () {
        quotes.forEach(function (quote) {
          quote.classList.add('twitter-tweet');
        });
        if (twttr && twttr.widgets) twttr.widgets.load(grid);
      }, 0);
    });
  }

  function renderCards(items, grid) {
    var fragment = document.createDocumentFragment();
    var count = 0;
    items.forEach(function (item) {
      if (!item || typeof item.title !== 'string' || !item.title) return;
      fragment.appendChild(createLabCard(item));
      count += 1;
    });
    grid.replaceChildren(fragment);
    return count;
  }

  function latestLabel(items) {
    if (!items.length) return '最新の作品はまだありません';
    var latest = sortNewest(items)[0];
    var emoji = asText(latest.emoji);
    var title = asText(latest.title) || '無題';
    return '最新：' + (emoji ? emoji + ' ' : '') + title;
  }

  function createRoomLink(category, items) {
    var link = document.createElement('a');
    link.className = 'room-switch-btn lab-room-link';
    link.href = 'lab/' + category.id + '.html';

    var strong = document.createElement('strong');
    var emoji = asText(category.emoji);
    strong.textContent = (emoji ? emoji + ' ' : '') + category.name;

    var description = document.createElement('small');
    description.textContent = asText(category.description);

    var count = document.createElement('span');
    count.className = 'lab-room-count';
    count.textContent = items.length + '件';

    var latest = document.createElement('span');
    latest.className = 'lab-room-latest';
    latest.textContent = latestLabel(items);

    link.append(strong, description, count, latest);
    return link;
  }

  function setStatus(id, text) {
    var status = document.getElementById(id);
    if (status) status.textContent = text;
  }

  function renderEntrance(data, grid) {
    var categories = validCategories(data);
    var items = Array.isArray(data.items) ? data.items.filter(function (item) {
      return item && typeof item === 'object';
    }) : [];
    if (!categories.length) {
      renderCards(sortNewest(items), grid);
      loadTwitterEmbeds(grid);
      setStatus('lab-status', items.length + '件の作品を表示しています。');
      return;
    }

    var known = knownCategoryIds(categories);
    var grouped = new Map();
    categories.forEach(function (category) {
      grouped.set(category.id, []);
    });
    var otherItems = [];
    items.forEach(function (item) {
      var id = resolveCategory(item, known);
      if (grouped.has(id)) grouped.get(id).push(item);
      else otherItems.push(item);
    });

    grid.className = 'room-switch-grid lab-entrance-grid';
    grid.removeAttribute('style');
    grid.setAttribute('aria-label', '作品の部屋一覧');
    grid.replaceChildren();
    categories.forEach(function (category) {
      grid.appendChild(createRoomLink(category, grouped.get(category.id) || []));
    });
    if (otherItems.length) {
      grid.appendChild(createRoomLink({
        id: 'other',
        emoji: '📚',
        name: 'その他',
        description: 'カテゴリが付いていない作品です。'
      }, otherItems));
    }
    var roomCount = categories.length + (otherItems.length ? 1 : 0);
    setStatus('lab-status', roomCount + 'つの部屋に、' + items.length + '件の作品をまとめています。');
  }

  function renderRoom(data, roomId, grid) {
    var categories = validCategories(data);
    var known = knownCategoryIds(categories);
    var items = (Array.isArray(data.items) ? data.items : []).filter(function (item) {
      return item && typeof item === 'object' && resolveCategory(item, known) === roomId;
    });
    items = sortNewest(items);
    var category = null;
    categories.forEach(function (entry) {
      if (entry.id === roomId) category = entry;
    });
    var lead = document.getElementById('lab-room-lead');
    if (lead && category && typeof category.description === 'string') {
      lead.textContent = category.description;
    }
    if (!items.length) {
      var empty = document.createElement('p');
      empty.textContent = 'この部屋の作品はまだありません。';
      grid.replaceChildren(empty);
      setStatus('lab-room-count', '0件');
      return;
    }
    var shown = renderCards(items, grid);
    setStatus('lab-room-count', shown + '件・新しい順');
    loadTwitterEmbeds(grid);
  }

  function showEntranceFallback(grid) {
    setStatus('lab-status', '作品データを読み込めなかったため、これまでの一覧を表示しています。');
    loadTwitterEmbeds(grid);
  }

  function showRoomError(grid) {
    grid.replaceChildren();
    var message = document.createElement('p');
    message.textContent = '作品を読み込めませんでした。ページを再読み込みしてください。';
    grid.appendChild(message);
  }

  function labJsonUrl() {
    return document.body.dataset.labRoom ? '../lab.json' : 'lab.json';
  }

  async function start() {
    var grid = document.getElementById('lab-grid');
    if (!grid) return;
    var roomId = document.body.dataset.labRoom || '';
    var controller = new AbortController();
    var timer = window.setTimeout(function () {
      controller.abort();
    }, 15000);
    try {
      var response = await fetch(labJsonUrl(), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();
      if (!data || !Array.isArray(data.items)) throw new Error('lab.jsonの形式を確認してください');
      if (roomId) renderRoom(data, roomId, grid);
      else renderEntrance(data, grid);
    } catch (error) {
      if (roomId) showRoomError(grid);
      else showEntranceFallback(grid);
    } finally {
      window.clearTimeout(timer);
    }
  }

  document.addEventListener('DOMContentLoaded', start);
})();
