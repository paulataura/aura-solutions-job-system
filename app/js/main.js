// App entry: sign-in, role-based routing (#/...), shared page shell.
import { currentProfile, signIn, signOut } from './supa.js?v=1.0.2';
import { esc, toast, errText, busy } from './util.js?v=1.0.2';
import { APP_VERSION } from './config.js?v=1.0.2';

const app = document.getElementById('app');
export const state = { profile: null };
export const DASHBOARD = '../'; // the main Aura dashboard (customers, sites, calendar, job creation)
export const isManagement = () => ['admin', 'manager'].includes(state.profile?.role);

export function shell({ title, sub = '', back = null, tabs = '', wide = false, body = '' }) {
  app.innerHTML = `
    <header class="topbar">
      ${back ? `<button class="back" data-back aria-label="Back">‹</button>` : `<img class="logo" src="img/logo.png" alt="Aura Solutions">`}
      <div><div class="title">${esc(title)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
      <div class="spacer"></div>
      ${state.profile && !back ? `<button class="btn ghost small" data-signout>Sign out</button>` : ''}
    </header>
    ${navigator.onLine ? '' : '<div class="offline-banner">No signal — changes will fail until you are back online</div>'}
    ${tabs}
    <main class="${wide ? 'wide' : ''}">${body}</main>`;
  const b = app.querySelector('[data-back]');
  if (b) b.onclick = () => { if (back.startsWith('#')) location.hash = back; else location.href = back; };
  const so = app.querySelector('[data-signout]');
  if (so) so.onclick = async () => { await signOut().catch(() => {}); state.profile = null; history.replaceState(null, '', location.pathname); location.reload(); };
  return app.querySelector('main');
}

export function managementTabs(active) {
  const t = [['#/review', 'Awaiting review', 'review'], ['#/approved', 'Approved', 'approved'], ['#/live', 'Live jobs', 'live'], ['#/jobs', 'My jobs', 'mine']];
  return `<nav class="tabs">${t.map(([h, l, k]) => `<a href="${h}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}</nav>`;
}

function loginPage(msg = '') {
  app.innerHTML = `
    <div class="login">
      <img class="logo" src="img/logo.png" alt="Aura Solutions">
      <div class="card">
        <h1 class="center">Sign in</h1>
        ${msg ? `<div class="danger" style="margin-bottom:12px">${esc(msg)}</div>` : ''}
        <form id="loginForm">
          <label class="f"><span>Email</span><input type="email" name="email" autocomplete="username" required></label>
          <label class="f"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
          <button class="btn block big" type="submit">Sign in</button>
        </form>
      </div>
      <p class="center muted small">Aura Solutions job system · v${APP_VERSION}</p>
    </div>`;
  const f = document.getElementById('loginForm');
  f.onsubmit = async e => {
    e.preventDefault();
    await busy(f.querySelector('button'), async () => {
      try {
        await signIn(f.email.value.trim(), f.password.value);
        state.profile = await currentProfile();
        // Opened from a dashboard link (e.g. a job to review)? Go there after signing in.
        if (/^#\/(check|job)\//.test(location.hash)) { route(); return; }
        if (isManagement()) { location.replace(DASHBOARD); return; }
        const target = '#/jobs';
        if (location.hash === target) route(); else location.hash = target;
      } catch (err) { loginPage(/invalid/i.test(err.message) ? 'Email or password not recognised.' : errText(err)); }
    }, 'Signing in…');
  };
}

let routing = Promise.resolve();
export function route() { routing = routing.then(doRoute, doRoute); return routing; }
async function doRoute() {
  try {
    if (!state.profile) state.profile = await currentProfile();
    if (!state.profile) return loginPage();
    if (!state.profile.active) return loginPage('Your account is not active. Please contact the office.');

    const [, page, id] = (location.hash || '').split('/');
    const mgmt = isManagement();
    // Management works from the main dashboard; this app only provides the job and review screens.
    if (mgmt && (!page || ['review', 'approved', 'live', 'jobs', 'login'].includes(page))) { location.replace(DASHBOARD); return; }
    if (!page) { location.hash = '#/jobs'; return; }

    if (page === 'jobs') return (await import('./operator.js?v=1.0.2')).jobList();
    if (page === 'job' && id) return (await import('./operator.js?v=1.0.2')).jobPage(id);
    if (mgmt && ['review', 'approved', 'live'].includes(page)) return (await import('./review.js?v=1.0.2')).reviewList(page);
    if (mgmt && page === 'check' && id) return (await import('./review.js?v=1.0.2')).reviewPage(id);
    if (mgmt) location.replace(DASHBOARD); else location.hash = '#/jobs';
  } catch (e) {
    console.error(e);
    app.innerHTML = `<main><div class="card"><h2>Something went wrong</h2><p class="danger">${esc(errText(e))}</p><button class="btn" onclick="location.reload()">Try again</button></div></main>`;
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('online', () => toast('Back online'));
window.addEventListener('offline', () => toast('No signal', 'err'));
route();
