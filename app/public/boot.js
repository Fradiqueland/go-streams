// A classic script can still show recovery when a module fails to load.
(() => {
  const panel = document.getElementById('startup-status');
  if (!panel) return;
  let ready = false;
  const retry = document.getElementById('startup-retry');
  const message = document.getElementById('startup-message');
  const slow = () => {
    if (ready || !panel.isConnected) return;
    message.textContent = 'The studio is taking longer to open. Retry here; you do not need to restart your computer.';
    retry.hidden = false;
  };
  const timer = setTimeout(slow, 12000);
  document.addEventListener('go-streams-ready', () => { ready = true; clearTimeout(timer); }, { once: true });
  window.addEventListener('error', slow);
  window.addEventListener('unhandledrejection', slow);
  retry.addEventListener('click', () => location.reload());
})();
