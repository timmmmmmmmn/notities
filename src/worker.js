// Notities: JSON-API op /api/..., de rest zijn de statische bestanden in public/.

import {
  HttpError, json, fail, now, hashPassword, verifyPassword, createSession, destroySession,
  clearSessionCookie, sessionUser, tooManyAttempts, recordAttempt, clientIp, randomToken
} from './util.js';

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const NOTE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_TITLE = 300;
const MAX_BODY = 200000;
const MAX_CHANGES = 100;
const COLORS = ['', 'rood', 'oranje', 'geel', 'groen', 'blauw', 'paars', 'grijs'];
const VERSION_GAP = 15 * 60e3;
const MAX_VERSIONS = 50;

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Ongeldige invoer');
  }
}

function str(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Wachtwoord moet minimaal 10 tekens zijn');
  if (pw.length > 200) throw new HttpError(400, 'Wachtwoord is te lang');
}

// ---------- Account ----------

async function register(env, request) {
  const ip = clientIp(request);
  if (await tooManyAttempts(env, `reg|${ip}`, 5, 3600e3)) throw new HttpError(429, 'Te veel pogingen, probeer het later opnieuw');
  const b = await body(request);
  const username = str(b.username, 32).toLowerCase();
  const fullName = str(b.full_name, 100);
  const email = str(b.email, 200).toLowerCase();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Gebruikersnaam: 3–32 tekens, kleine letters, cijfers, . _ of -');
  if (fullName.length < 2) throw new HttpError(400, 'Vul je volledige naam in');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Vul een geldig e-mailadres in');
  checkPassword(b.password);
  const exists = await env.DB.prepare('SELECT username, email FROM users WHERE username = ? OR email = ?').bind(username, email).first();
  if (exists) throw new HttpError(409, exists.username === username ? 'Deze gebruikersnaam is al bezet' : 'Er is al een account met dit e-mailadres');
  await recordAttempt(env, `reg|${ip}`);

  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const first = n === 0;
  const res = await env.DB.prepare(
    'INSERT INTO users (username, full_name, email, password_hash, status, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id'
  ).bind(username, fullName, email, await hashPassword(b.password), first ? 'active' : 'pending', first ? 1 : 0, now()).first();

  if (!first) return json({ status: 'pending' }, 201);
  return json({ status: 'active' }, 201, { 'set-cookie': await createSession(env, res.id, true) });
}

async function login(env, request) {
  const b = await body(request);
  const id = str(b.login, 200).toLowerCase();
  const ip = clientIp(request);
  if (await tooManyAttempts(env, `login|${ip}`, 20, 900e3) || await tooManyAttempts(env, `login|${id}`, 10, 900e3)) {
    throw new HttpError(429, 'Te veel mislukte pogingen. Wacht een kwartier en probeer het opnieuw.');
  }
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ? OR email = ?').bind(id, id).first();
  if (!user || !(await verifyPassword(String(b.password ?? ''), user.password_hash))) {
    await recordAttempt(env, `login|${ip}`);
    await recordAttempt(env, `login|${id}`);
    throw new HttpError(401, 'Gebruikersnaam of wachtwoord klopt niet');
  }
  if (user.status === 'pending') throw new HttpError(403, 'Je account wacht nog op goedkeuring');
  if (user.status !== 'active') throw new HttpError(403, 'Dit account is uitgeschakeld');
  return json({ ok: true }, 200, { 'set-cookie': await createSession(env, user.id, b.remember !== false) });
}

async function updateMe(env, user, request) {
  const b = await body(request);
  const fullName = str(b.full_name, 100);
  const email = str(b.email, 200).toLowerCase();
  if (fullName.length < 2) throw new HttpError(400, 'Vul je volledige naam in');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Vul een geldig e-mailadres in');
  const taken = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?').bind(email, user.id).first();
  if (taken) throw new HttpError(409, 'Er is al een account met dit e-mailadres');
  await env.DB.prepare('UPDATE users SET full_name = ?, email = ? WHERE id = ?').bind(fullName, email, user.id).run();
  return json({ ok: true });
}

async function changePassword(env, user, request) {
  const b = await body(request);
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
  if (!(await verifyPassword(String(b.current ?? ''), row.password_hash))) throw new HttpError(400, 'Huidig wachtwoord klopt niet');
  checkPassword(b.password);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(b.password), user.id).run();
  return json({ ok: true });
}

// ---------- Synchronisatie ----------
// Elk apparaat houdt een cursor bij (de hoogste seq die het kent). Bij elke wijziging krijgt
// de notitie het volgende nummer uit users.note_seq; dat gebeurt in dezelfde batch (transactie),
// zodat een apparaat nooit een wijziging overslaat.

const NOTE_COLS = 'id, title, body, kind, pinned, labels, color, archived_at, remind_at, deleted_at, purged, created_at, updated_at, rev, seq';

function out(n) {
  let labels = [];
  try { labels = JSON.parse(n.labels); } catch {}
  return { ...n, labels, pinned: !!n.pinned, purged: !!n.purged };
}

async function changesSince(env, user, since) {
  const { results } = await env.DB.prepare(
    `SELECT ${NOTE_COLS} FROM notes WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 2000`
  ).bind(user.id, since).all();
  const cursor = results.length ? results[results.length - 1].seq : since;
  return { notes: results.map(out), cursor, more: results.length === 2000 };
}

// Velden die een (oudere) app niet meestuurt, blijven zoals ze op de server staan.
function clean(c, cur = {}) {
  const kind = c.kind === 'lijst' ? 'lijst' : 'tekst';
  const t = Number(c.updated_at);
  const time = (v) => (v && Number.isFinite(Number(v)) ? Number(v) : null);
  const labels = Array.isArray(c.labels)
    ? JSON.stringify([...new Set(c.labels.map((l) => String(l).trim().slice(0, 40)).filter(Boolean))].slice(0, 20))
    : cur.labels ?? '[]';
  return {
    labels,
    color: 'color' in c ? (COLORS.includes(c.color) ? c.color : '') : cur.color ?? '',
    archived_at: 'archived_at' in c ? time(c.archived_at) : cur.archived_at ?? null,
    remind_at: 'remind_at' in c ? time(c.remind_at) : cur.remind_at ?? null,
    title: String(c.title ?? '').slice(0, MAX_TITLE),
    body: String(c.body ?? '').slice(0, MAX_BODY),
    kind,
    pinned: c.pinned ? 1 : 0,
    deleted_at: c.deleted_at ? Number(c.deleted_at) || now() : null,
    updated_at: Number.isFinite(t) ? Math.min(t, now() + 60e3) : now()
  };
}

async function sync(env, user, request) {
  const b = await body(request);
  const since = Number(b.since) || 0;
  const changes = Array.isArray(b.changes) ? b.changes.slice(0, MAX_CHANGES) : [];
  const ids = changes.map((c) => String(c?.id ?? '')).filter((id) => NOTE_ID_RE.test(id));
  const existing = new Map();
  if (ids.length) {
    const { results } = await env.DB.prepare(
      `SELECT id, user_id, title, body, kind, rev, purged, updated_at, labels, color, archived_at, remind_at FROM notes WHERE id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all();
    for (const r of results) existing.set(r.id, r);
  }

  const bump = () => env.DB.prepare('UPDATE users SET note_seq = note_seq + 1 WHERE id = ?').bind(user.id);
  const seq = '(SELECT note_seq FROM users WHERE id = ?)';
  const stmts = [];
  const conflicts = [];
  const t = now();

  for (const c of changes) {
    const id = String(c?.id ?? '');
    if (!NOTE_ID_RE.test(id)) continue;
    const cur = existing.get(id);
    if (cur && (cur.user_id !== user.id || cur.purged)) continue;

    if (c.purged) {
      if (!cur) continue;
      stmts.push(bump(), env.DB.prepare(
        `UPDATE notes SET title = '', body = '', labels = '[]', remind_at = NULL, pinned = 0, purged = 1, deleted_at = COALESCE(deleted_at, ?), rev = rev + 1, seq = ${seq} WHERE id = ?`
      ).bind(t, user.id, id), env.DB.prepare('DELETE FROM note_versions WHERE note_id = ?').bind(id));
      continue;
    }

    const n = clean(c, cur);
    if (!cur) {
      stmts.push(bump(), env.DB.prepare(
        `INSERT INTO notes (id, user_id, title, body, kind, pinned, labels, color, archived_at, remind_at, deleted_at, created_at, updated_at, rev, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ${seq})`
      ).bind(id, user.id, n.title, n.body, n.kind, n.pinned, n.labels, n.color, n.archived_at, n.remind_at, n.deleted_at, Number(c.created_at) || t, n.updated_at, user.id));
      continue;
    }

    const sameText = cur.title === n.title && cur.body === n.body && cur.kind === n.kind;
    if (Number(c.base_rev) !== cur.rev && !sameText) {
      // Op twee apparaten tegelijk bewerkt: de versie op de server blijft staan,
      // die van dit apparaat komt ernaast als kopie, zodat er niets verloren gaat.
      conflicts.push(id);
      if (!n.deleted_at) {
        stmts.push(bump(), env.DB.prepare(
          `INSERT INTO notes (id, user_id, title, body, kind, pinned, labels, color, deleted_at, created_at, updated_at, rev, seq)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, 1, ${seq})`
        ).bind(randomToken(12), user.id, `${n.title || 'Notitie'} (andere versie)`.slice(0, MAX_TITLE), n.body, n.kind, n.labels, n.color, t, n.updated_at, user.id));
      }
      continue;
    }
    // Tekst flink gewijzigd en de laatste versie is ouder dan een kwartier: oude tekst bewaren.
    if (!sameText && (cur.title || cur.body)) {
      stmts.push(env.DB.prepare(
        `INSERT INTO note_versions (note_id, title, body, kind, saved_at)
         SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM note_versions WHERE note_id = ? AND saved_at > ?)`
      ).bind(id, cur.title, cur.body, cur.kind, cur.updated_at, id, t - VERSION_GAP));
    }
    stmts.push(bump(), env.DB.prepare(
      `UPDATE notes SET title = ?, body = ?, kind = ?, pinned = ?, labels = ?, color = ?, archived_at = ?, remind_at = ?, deleted_at = ?, updated_at = ?, rev = rev + 1, seq = ${seq} WHERE id = ?`
    ).bind(n.title, n.body, n.kind, n.pinned, n.labels, n.color, n.archived_at, n.remind_at, n.deleted_at, n.updated_at, user.id, id));
  }

  if (stmts.length) await env.DB.batch(stmts);
  const res = await changesSince(env, user, since);
  // De serverversie van een conflict kan ouder zijn dan de cursor van het apparaat: altijd meesturen.
  const missing = conflicts.filter((id) => !res.notes.some((n) => n.id === id));
  if (missing.length) {
    const { results } = await env.DB.prepare(
      `SELECT ${NOTE_COLS} FROM notes WHERE user_id = ? AND id IN (${missing.map(() => '?').join(',')})`
    ).bind(user.id, ...missing).all();
    res.notes.push(...results.map(out));
  }
  return json({ ...res, conflicts });
}

async function versions(env, user, id) {
  const note = await env.DB.prepare('SELECT id FROM notes WHERE id = ? AND user_id = ? AND purged = 0').bind(id, user.id).first();
  if (!note) throw new HttpError(404, 'Notitie niet gevonden');
  await env.DB.prepare(
    `DELETE FROM note_versions WHERE note_id = ? AND id NOT IN (SELECT id FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC LIMIT ${MAX_VERSIONS})`
  ).bind(id, id).run();
  const { results } = await env.DB.prepare(
    'SELECT id, title, body, kind, saved_at FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC'
  ).bind(id).all();
  return json(results);
}

// ---------- Beheer ----------

function requireAdmin(user) {
  if (!user.is_admin) throw new HttpError(403, 'Alleen voor beheerders');
}

async function adminUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.full_name, u.email, u.status, u.is_admin, u.created_at,
            (SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id AND n.purged = 0) AS notes
       FROM users u ORDER BY u.status = 'pending' DESC, u.created_at DESC`
  ).all();
  return json(results.map((u) => ({ ...u, is_admin: !!u.is_admin })));
}

async function adminSetStatus(env, user, id, request) {
  const b = await body(request);
  if (!['active', 'disabled'].includes(b.status)) throw new HttpError(400, 'Ongeldige status');
  if (Number(id) === user.id) throw new HttpError(400, 'Je kunt je eigen account niet uitschakelen');
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(b.status, Number(id)),
    ...(b.status === 'disabled' ? [env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(Number(id))] : [])
  ]);
  return json({ ok: true });
}

async function adminDelete(env, user, id) {
  if (Number(id) === user.id) throw new HttpError(400, 'Je kunt je eigen account niet verwijderen');
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(Number(id)).run();
  return json({ ok: true });
}

async function adminResetPassword(env, user, id) {
  const password = randomToken(9);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), Number(id)),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(Number(id))
  ]);
  return json({ password });
}

// ---------- Router ----------

async function route(request, env) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const m = request.method.toUpperCase();

  if (m !== 'GET' && m !== 'HEAD') {
    // Alleen verzoeken van onze eigen pagina's (tegen CSRF).
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Verzoek van een andere site geweigerd');
  }

  if (p === 'register' && m === 'POST') return register(env, request);
  if (p === 'login' && m === 'POST') return login(env, request);
  if (p === 'logout' && m === 'POST') {
    await destroySession(env, request);
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
  }

  const user = await sessionUser(env, request);
  if (!user) throw new HttpError(401, 'Niet ingelogd');

  if (p === 'me' && m === 'GET') return json({ ...user, is_admin: !!user.is_admin });
  if (p === 'me' && m === 'PATCH') return updateMe(env, user, request);
  if (p === 'me/password' && m === 'POST') return changePassword(env, user, request);
  if (p === 'sync' && m === 'GET') return json(await changesSince(env, user, Number(url.searchParams.get('since')) || 0));
  if (p === 'sync' && m === 'POST') return sync(env, user, request);

  const [a, b, c, d] = p.split('/');
  if (a === 'notes' && NOTE_ID_RE.test(b || '') && c === 'versions' && !d && m === 'GET') return versions(env, user, b);
  if (a === 'admin') {
    requireAdmin(user);
    if (b === 'users' && !c && m === 'GET') return adminUsers(env);
    if (b === 'users' && c && !d && m === 'PATCH') return adminSetStatus(env, user, c, request);
    if (b === 'users' && c && !d && m === 'DELETE') return adminDelete(env, user, c);
    if (b === 'users' && c && d === 'reset-password' && m === 'POST') return adminResetPassword(env, user, c);
  }
  throw new HttpError(404, 'Niet gevonden');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await route(request, env);
      } catch (err) {
        if (err instanceof HttpError) return fail(err.status, err.message);
        console.error(err);
        return fail(500, 'Er ging iets mis op de server');
      }
    }
    return env.ASSETS.fetch(request);
  }
};
