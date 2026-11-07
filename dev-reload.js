// Connects to dev-server.js. Without that server (e.g. a static host) this does nothing.
const source = new EventSource('/__reload');
let connectedBefore = false;

source.addEventListener('open', () => {
  // A reconnect usually means the server restarted, so files may have changed.
  if (connectedBefore) location.reload();
  connectedBefore = true;
});

source.addEventListener('message', (e) => {
  const message = JSON.parse(e.data);
  if (message.type !== 'css') return location.reload();
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    const url = new URL(link.href);
    if (message.files.includes(url.pathname)) {
      url.searchParams.set('t', Date.now());
      link.href = url.href;
    }
  }
});
