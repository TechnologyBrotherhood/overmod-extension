// Bridge between overmod.org pages and the extension.
// The website posts window messages; this content script forwards them to the
// background service worker to update subscribed lists.
// Used on overmod.org to subscribe to lists from the directory there.

(function () {
  function parseListData(data) {
    const { publicKey, listType, name } = data;
    const pk = (publicKey || '').trim();
    if (!pk) return null;
    return { pk, listType, name };
  }

  async function handleMessage(event) {
    // Only trust messages from the same window context
    if (event.source !== window) return;
    // Restrict to overmod.org origins
    const origin = event.origin || '';
    if (!origin.startsWith('https://')) return;
    if (origin !== 'https://overmod.org' && !origin.endsWith('.overmod.org')) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'overmod-site') return;

    const { type } = data;

    switch (type) {
      case 'subscribeList': {
        const parsed = parseListData(data);
        if (!parsed) return;
        try {
          await chrome.runtime.sendMessage({
            type: 'overmod:subscribeList',
            publicKey: parsed.pk,
            listType: parsed.listType || 'block',
            name: parsed.name || null
          });
        } catch (_) {
          // Website doesn't do anything with failed subscribe
        }
        break;
      }

      case 'unsubscribeList': {
        const parsed = parseListData(data);
        if (!parsed) return;
        try {
          await chrome.runtime.sendMessage({
            type: 'overmod:unsubscribeList',
            publicKey: parsed.pk
          });
        } catch (_) {
          // Website doesn't do anything with failed unsubscribe
        }
        break;
      }

      case 'getSubscriptions': {
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'overmod:getState' });
          if (!resp) {
            window.postMessage({ source: 'overmod-extension', type: 'subscriptions', ok: false }, '*');
            return;
          }
          const lists = Array.isArray(resp.subscribedLists) ? resp.subscribedLists : [];
          const overrides = resp.subscribedOverrides || {};
          const labels = resp.subscribedLabels || {};
          window.postMessage({
            source: 'overmod-extension',
            type: 'subscriptions',
            ok: true,
            subscribedLists: lists,
            subscribedOverrides: overrides,
            subscribedLabels: labels
          }, '*');
        } catch (_) {
          try {
            window.postMessage({ source: 'overmod-extension', type: 'subscriptions', ok: false }, '*');
          } catch (_) {}
        }
        break;
      }
    }
  }

  window.addEventListener('message', handleMessage, false);

  // Let the page know the Overmod extension is present on this origin.
  try {
    window.postMessage({ source: 'overmod-extension', type: 'ready' }, '*');
  } catch (_) {
    // Ignore
  }
})();