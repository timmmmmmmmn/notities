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
// Elk apparaat houdt een cursor bij (de hoogste seq die het kent). Elke wijziging krijgt het volgende
// nummer uit de gezamenlijke teller; dat gebeurt in dezelfde batch (transactie), zodat een apparaat
// nooit een wijziging overslaat, ook niet in notities die iemand anders met je deelt.

const NOTE_COLS = 'n.id, n.title, n.body, n.kind, n.pinned, n.labels, n.color, n.archived_at, n.remind_at, n.deleted_at, n.purged, n.created_at, n.updated_at, n.rev, n.seq';
const PAGE = 2000;

function parseLabels(v) {
  try { return JSON.parse(v); } catch { return []; }
}

function out(n) {
  return { ...n, labels: parseLabels(n.labels), pinned: !!n.pinned, purged: !!n.purged };
}

// Een gedeelde notitie zoals de ontvanger hem ziet: tekst van de eigenaar, ordening van zichzelf.
function outShared(r) {
  if (r.deleted_at || r.purged) return { id: r.id, purged: true, seq: r.seq };
  return {
    ...out(r), pinned: !!r.s_pinned, labels: parseLabels(r.s_labels), color: r.s_color,
    archived_at: r.s_archived_at, remind_at: r.s_remind_at, deleted_at: null,
    owner_name: r.owner_name, can_write: !!r.can_write
  };
}

async function changesSince(env, user, since) {
  const [own, shared, gone] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ${NOTE_COLS}, (SELECT COUNT(*) FROM note_shares s WHERE s.note_id = n.id) AS shared_count
         FROM notes n WHERE n.user_id = ? AND n.seq > ? ORDER BY n.seq LIMIT ${PAGE}`
    ).bind(user.id, since),
    env.DB.prepare(
      `SELECT ${NOTE_COLS}, s.can_write, s.pinned AS s_pinned, s.labels AS s_labels, s.color AS s_color,
              s.archived_at AS s_archived_at, s.remind_at AS s_remind_at, u.full_name AS owner_name
         FROM note_shares s JOIN notes n ON n.id = s.note_id JOIN users u ON u.id = n.user_id
        WHERE s.user_id = ? AND n.seq > ?`
    ).bind(user.id, since),
    env.DB.prepare('SELECT note_id AS id, seq FROM share_removals WHERE user_id = ? AND seq > ?').bind(user.id, since)
  ]);
  const more = own.results.length === PAGE;
  // Bij een volle pagina alleen meesturen tot waar we zijn, de rest komt de volgende keer.
  const limit = more ? own.results[own.results.length - 1].seq : Infinity;
  const notes = [
    ...own.results.map(out),
    ...shared.results.filter((r) => r.seq <= limit).map(outShared),
    ...gone.results.filter((r) => r.seq <= limit).map((r) => ({ id: r.id, purged: true, seq: r.seq }))
  ].sort((a, b) => a.seq - b.seq);
  const cursor = notes.length ? Math.max(since, notes[notes.length - 1].seq) : since;
  return { notes, cursor, more };
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
    pinned: 'pinned' in c ? (c.pinned ? 1 : 0) : cur.pinned ?? 0,
    deleted_at: c.deleted_at ? Number(c.deleted_at) || now() : null,
    updated_at: Number.isFinite(t) ? Math.min(t, now() + 60e3) : now()
  };
}

const bump = (env) => env.DB.prepare('UPDATE counter SET n = n + 1 WHERE id = 1');
const SEQ = '(SELECT n FROM counter WHERE id = 1)';

async function sync(env, user, request) {
  const b = await body(request);
  const since = Number(b.since) || 0;
  const changes = Array.isArray(b.changes) ? b.changes.slice(0, MAX_CHANGES) : [];
  const ids = changes.map((c) => String(c?.id ?? '')).filter((id) => NOTE_ID_RE.test(id));
  const existing = new Map();
  const shares = new Map();
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    const [notes, mine] = await env.DB.batch([
      env.DB.prepare(
        `SELECT id, user_id, title, body, kind, rev, purged, updated_at, pinned, labels, color, archived_at, remind_at FROM notes WHERE id IN (${marks})`
      ).bind(...ids),
      env.DB.prepare(
        `SELECT note_id, can_write, pinned, labels, color, archived_at, remind_at FROM note_shares WHERE user_id = ? AND note_id IN (${marks})`
      ).bind(user.id, ...ids)
    ]);
    for (const r of notes.results) existing.set(r.id, r);
    for (const r of mine.results) shares.set(r.note_id, r);
  }

  const stmts = [];
  const conflicts = [];
  const t = now();

  // Tekst is gewijzigd: zo nodig de oude tekst bewaren en de nieuwe opslaan (of een conflict melden).
  const writeText = (id, cur, n, base) => {
    const sameText = cur.title === n.title && cur.body === n.body && cur.kind === n.kind;
    if (sameText) return false;
    if (Number(base) !== cur.rev) {
      // Op twee apparaten tegelijk bewerkt: de versie op de server blijft staan,
      // die van dit apparaat komt ernaast als kopie (van jezelf), zodat er niets verloren gaat.
      conflicts.push(id);
      if (!n.deleted_at) {
        stmts.push(bump(env), env.DB.prepare(
          `INSERT INTO notes (id, user_id, title, body, kind, pinned, labels, color, deleted_at, created_at, updated_at, rev, seq)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, 1, ${SEQ})`
        ).bind(randomToken(12), user.id, `${n.title || 'Notitie'} (andere versie)`.slice(0, MAX_TITLE), n.body, n.kind, n.labels, n.color, t, n.updated_at));
      }
      return null;
    }
    if (cur.title || cur.body) {
      // De oude tekst bewaren als de laatste bewaarde versie ouder is dan een kwartier.
      stmts.push(env.DB.prepare(
        `INSERT INTO note_versions (note_id, title, body, kind, saved_at)
         SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM note_versions WHERE note_id = ? AND saved_at > ?)`
      ).bind(id, cur.title, cur.body, cur.kind, cur.updated_at, id, t - VERSION_GAP));
    }
    return true;
  };

  for (const c of changes) {
    const id = String(c?.id ?? '');
    if (!NOTE_ID_RE.test(id)) continue;
    const cur = existing.get(id);
    if (cur?.purged) continue;

    // Notitie van iemand anders die met mij gedeeld is.
    if (cur && cur.user_id !== user.id) {
      const share = shares.get(id);
      if (!share) continue;
      if (c.purged || c.deleted_at) {
        // "Weghalen" betekent hier: niet meer met mij delen.
        stmts.push(
          env.DB.prepare('DELETE FROM note_shares WHERE note_id = ? AND user_id = ?').bind(id, user.id),
          bump(env),
          env.DB.prepare(`INSERT INTO share_removals (note_id, user_id, seq) VALUES (?, ?, ${SEQ})`).bind(id, user.id),
          bump(env),
          env.DB.prepare(`UPDATE notes SET seq = ${SEQ} WHERE id = ?`).bind(id)
        );
        continue;
      }
      const mine = clean(c, share);
      stmts.push(env.DB.prepare(
        'UPDATE note_shares SET pinned = ?, labels = ?, color = ?, archived_at = ?, remind_at = ? WHERE note_id = ? AND user_id = ?'
      ).bind(mine.pinned, mine.labels, mine.color, mine.archived_at, mine.remind_at, id, user.id));
      const n = clean(c, cur);
      const text = share.can_write ? writeText(id, cur, n, c.base_rev) : false;
      stmts.push(bump(env), text
        ? env.DB.prepare(`UPDATE notes SET title = ?, body = ?, kind = ?, updated_at = ?, rev = rev + 1, seq = ${SEQ} WHERE id = ?`)
          .bind(n.title, n.body, n.kind, n.updated_at, id)
        : env.DB.prepare(`UPDATE notes SET seq = ${SEQ} WHERE id = ?`).bind(id));
      continue;
    }

    if (c.purged) {
      if (!cur) continue;
      stmts.push(bump(env), env.DB.prepare(
        `UPDATE notes SET title = '', body = '', labels = '[]', remind_at = NULL, pinned = 0, purged = 1, deleted_at = COALESCE(deleted_at, ?), rev = rev + 1, seq = ${SEQ} WHERE id = ?`
      ).bind(t, id), env.DB.prepare('DELETE FROM note_versions WHERE note_id = ?').bind(id),
      // Wie hem gedeeld kreeg, moet hem ook kwijtraken.
      env.DB.prepare(`INSERT INTO share_removals (note_id, user_id, seq) SELECT ?, user_id, ${SEQ} FROM note_shares WHERE note_id = ?`).bind(id, id),
      env.DB.prepare('DELETE FROM note_shares WHERE note_id = ?').bind(id));
      continue;
    }

    const n = clean(c, cur);
    if (!cur) {
      stmts.push(bump(env), env.DB.prepare(
        `INSERT INTO notes (id, user_id, title, body, kind, pinned, labels, color, archived_at, remind_at, deleted_at, created_at, updated_at, rev, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ${SEQ})`
      ).bind(id, user.id, n.title, n.body, n.kind, n.pinned, n.labels, n.color, n.archived_at, n.remind_at, n.deleted_at, Number(c.created_at) || t, n.updated_at));
      continue;
    }

    if (writeText(id, cur, n, c.base_rev) === null) continue;
    stmts.push(bump(env), env.DB.prepare(
      `UPDATE notes SET title = ?, body = ?, kind = ?, pinned = ?, labels = ?, color = ?, archived_at = ?, remind_at = ?, deleted_at = ?, updated_at = ?, rev = rev + 1, seq = ${SEQ} WHERE id = ?`
    ).bind(n.title, n.body, n.kind, n.pinned, n.labels, n.color, n.archived_at, n.remind_at, n.deleted_at, n.updated_at, id));
  }

  if (stmts.length) await env.DB.batch(stmts);
  const res = await changesSince(env, user, since);
  // De serverversie van een conflict kan ouder zijn dan de cursor van het apparaat: altijd meesturen.
  const missing = conflicts.filter((id) => !res.notes.some((n) => n.id === id));
  for (const id of missing) {
    const one = await noteFor(env, user, id);
    if (one) res.notes.push(one);
  }
  return json({ ...res, conflicts });
}

// Eén notitie zoals deze gebruiker hem ziet (eigen of gedeeld), of null.
async function noteFor(env, user, id) {
  const own = await env.DB.prepare(
    `SELECT ${NOTE_COLS}, (SELECT COUNT(*) FROM note_shares s WHERE s.note_id = n.id) AS shared_count FROM notes n WHERE n.id = ? AND n.user_id = ?`
  ).bind(id, user.id).first();
  if (own) return out(own);
  const shared = await env.DB.prepare(
    `SELECT ${NOTE_COLS}, s.can_write, s.pinned AS s_pinned, s.labels AS s_labels, s.color AS s_color,
            s.archived_at AS s_archived_at, s.remind_at AS s_remind_at, u.full_name AS owner_name
       FROM note_shares s JOIN notes n ON n.id = s.note_id JOIN users u ON u.id = n.user_id
      WHERE n.id = ? AND s.user_id = ?`
  ).bind(id, user.id).first();
  return shared ? outShared(shared) : null;
}

async function canRead(env, user, id) {
  const row = await env.DB.prepare(
    `SELECT 1 FROM notes n WHERE n.id = ? AND n.purged = 0
        AND (n.user_id = ? OR EXISTS (SELECT 1 FROM note_shares s WHERE s.note_id = n.id AND s.user_id = ?))`
  ).bind(id, user.id, user.id).first();
  if (!row) throw new HttpError(404, 'Notitie niet gevonden');
}

async function versions(env, user, id) {
  await canRead(env, user, id);
  await env.DB.prepare(
    `DELETE FROM note_versions WHERE note_id = ? AND id NOT IN (SELECT id FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC LIMIT ${MAX_VERSIONS})`
  ).bind(id, id).run();
  const { results } = await env.DB.prepare(
    'SELECT id, title, body, kind, saved_at FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC'
  ).bind(id).all();
  return json(results);
}

// ---------- Delen ----------

async function ownNote(env, user, id) {
  const note = await env.DB.prepare('SELECT id FROM notes WHERE id = ? AND user_id = ? AND purged = 0').bind(id, user.id).first();
  if (!note) throw new HttpError(404, 'Alleen de eigenaar kan deze notitie delen');
}

async function listShares(env, user, id) {
  await ownNote(env, user, id);
  const { results } = await env.DB.prepare(
    `SELECT u.id AS user_id, u.username, u.full_name, s.can_write
       FROM note_shares s JOIN users u ON u.id = s.user_id WHERE s.note_id = ? ORDER BY u.full_name`
  ).bind(id).all();
  return json(results.map((r) => ({ ...r, can_write: !!r.can_write })));
}

async function addShare(env, user, id, request) {
  await ownNote(env, user, id);
  const b = await body(request);
  const target = await env.DB.prepare("SELECT id, full_name FROM users WHERE username = ? AND status = 'active'")
    .bind(str(b.username, 32).toLowerCase()).first();
  if (!target) throw new HttpError(404, 'Geen actieve gebruiker met deze gebruikersnaam');
  if (target.id === user.id) throw new HttpError(400, 'Je kunt een notitie niet met jezelf delen');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO note_shares (note_id, user_id, can_write, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (note_id, user_id) DO UPDATE SET can_write = excluded.can_write`
    ).bind(id, target.id, b.can_write === false ? 0 : 1, now()),
    // Nieuw nummer, zodat de ontvanger (en je eigen apparaten) de notitie meteen binnenkrijgen.
    bump(env),
    env.DB.prepare(`UPDATE notes SET seq = ${SEQ} WHERE id = ?`).bind(id)
  ]);
  return json({ ok: true, full_name: target.full_name });
}

async function removeShare(env, user, id, userId) {
  await ownNote(env, user, id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM note_shares WHERE note_id = ? AND user_id = ?').bind(id, Number(userId)),
    bump(env),
    env.DB.prepare(`INSERT INTO share_removals (note_id, user_id, seq) VALUES (?, ?, ${SEQ})`).bind(id, Number(userId)),
    bump(env),
    env.DB.prepare(`UPDATE notes SET seq = ${SEQ} WHERE id = ?`).bind(id)
  ]);
  return json({ ok: true });
}

// Wie er zijn om mee te delen (actieve gebruikers behalve jijzelf).
async function people(env, user) {
  const { results } = await env.DB.prepare(
    "SELECT username, full_name FROM users WHERE status = 'active' AND id != ? ORDER BY full_name"
  ).bind(user.id).all();
  return json(results);
}

// ---------- Beheer ----------

function requireAdmin(user) {
  if (!user.is_admin) throw new HttpError(403, 'Alleen voor beheerders');
}

async function adminUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.full_name, u.email, u.status, u.is_admin, u.created_at,
            (SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id AND n.purged = 0 AND n.deleted_at IS NULL) AS notes
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
  if (p === 'people' && m === 'GET') return people(env, user);
  if (a === 'notes' && NOTE_ID_RE.test(b || '')) {
    if (c === 'versions' && !d && m === 'GET') return versions(env, user, b);
    if (c === 'shares' && !d && m === 'GET') return listShares(env, user, b);
    if (c === 'shares' && !d && m === 'POST') return addShare(env, user, b, request);
    if (c === 'shares' && d && m === 'DELETE') return removeShare(env, user, b, d);
  }
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
