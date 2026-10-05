(function () {
  window.createDrRosaSessionLock = function ({ getSession, advanceAuthEpoch, clearSession, login }) {
    let user = null;
  function unlockSession() {
    document.getElementById('drrosa-session-lock')?.remove();
    document.querySelectorAll('[data-drrosa-session-inert]').forEach(node => {
      node.inert = false;
      node.removeAttribute('data-drrosa-session-inert');
    });
    user = null;
  }

  function lockSession(message = 'Sesija je istekla. Prijavite se ponovo.', previousUser) {
    user = user || previousUser || getSession();
    if (getSession()) advanceAuthEpoch();
    clearSession();
    document.getElementById('drrosa-session-warning')?.remove();
    if (!document.body || location.pathname.endsWith('/login.html') || document.getElementById('drrosa-session-lock')) return;
    const overlay = document.createElement('section');
    overlay.id = 'drrosa-session-lock';
    overlay.className = 'session-lock';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'session-lock-title');
    overlay.innerHTML = `<form class="session-lock-card"><h2 id="session-lock-title">Ponovna prijava</h2>
      <p class="session-lock-message"></p><p>Unos u otvorenoj stranici ostaje sačuvan dok je ne zatvorite.</p>
      <label>Email<input name="email" type="email" autocomplete="username" required readonly></label>
      <label>Lozinka<input name="password" type="password" autocomplete="current-password" required></label>
      <label hidden>2FA kod<input name="code" inputmode="numeric" autocomplete="one-time-code"></label>
      <p class="session-lock-error" role="alert"></p><button type="submit">Prijavi se i nastavi</button>
      <a href="login.html">Otvori login stranicu</a></form>`;
    overlay.querySelector('.session-lock-message').textContent = message;
    overlay.querySelector('[name=email]').value = user?.email || '';
    Array.from(document.body.children).forEach(node => {
      if (!node.inert && !['SCRIPT', 'STYLE'].includes(node.tagName)) {
        node.inert = true;
        node.setAttribute('data-drrosa-session-inert', '');
      }
    });
    document.body.appendChild(overlay);
    overlay.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(overlay.querySelectorAll('input,button,a')).filter(node => !node.closest('[hidden]'));
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    });
    overlay.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        const authenticated = await login(form.elements.email.value, form.elements.password.value, user?.role, form.elements.code.value);
        if (authenticated?.requires2fa) { form.elements.code.closest('label').hidden = false; form.elements.code.focus(); return; }
        if (authenticated.id !== user?.id || authenticated.role !== user?.role) { location.reload(); return; }
        unlockSession();
      } catch (error) {
        form.querySelector('.session-lock-error').textContent = error.message;
      } finally { button.disabled = false; }
    });
    overlay.querySelector('[name=password]').focus();
  }

    return { lock: lockSession, unlock: unlockSession, get user() { return user; } };
  };
})();
