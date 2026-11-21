// Progressive enhancement only: every page works without this file.

document.addEventListener('submit', e => {
  const button = e.target.querySelector('[type=submit]');
  if (button.dataset.state === 'loading') return e.preventDefault();
  button.dataset.state = 'loading';
  button.setAttribute('aria-disabled', 'true');
});
// Pages restored from the back/forward cache would otherwise keep a spinning button.
addEventListener('pageshow', () => {
  for (const button of document.querySelectorAll('[data-state=loading]')) {
    delete button.dataset.state;
    button.removeAttribute('aria-disabled');
  }
});

document.addEventListener('focusin', e => {
  if (e.target.matches('input[readonly]')) e.target.select();
});

// Plain-http intranet hosts have no Clipboard API, so fall back to execCommand.
document.addEventListener('click', async e => {
  const button = e.target.closest('[data-copy]');
  if (!button) return;
  const input = document.getElementById(button.dataset.copy);
  const label = button.firstElementChild;
  try {
    if (window.isSecureContext && navigator.clipboard) await navigator.clipboard.writeText(input.value);
    else {
      input.select();
      if (!document.execCommand('copy')) throw new Error('copy failed');
    }
    button.dataset.state = 'copied';
    label.textContent = 'Copied';
  } catch {
    input.select();
    button.dataset.state = 'error';
    label.textContent = 'Copy failed';
  }
  clearTimeout(button.resetTimer);
  button.resetTimer = setTimeout(() => {
    delete button.dataset.state;
    label.textContent = 'Copy';
  }, 2500);
});
