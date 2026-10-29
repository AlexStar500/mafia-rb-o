# MAFIA relay — Cloudflare Worker + Durable Objects

Этот воркер заменяет и Vercel, и KV-версию: каждая комната — отдельный
**Durable Object** (строгая консистентность, нет гонок, комнаты изолированы),
а публичный список комнат держится в лёгком KV-индексе.

Нужны два binding'а:
- **MAFIA_DO** — Durable Object namespace (класс `RoomObject`).
- **MAFIA_ROOMS** — KV namespace (индекс публичных комнат).

## Вариант A — через wrangler (проще для DO)

1. `npm i -g wrangler` (если ещё нет), затем `wrangler login`.
2. Создай KV namespace и вставь его id в `wrangler.toml` (поле `id`).
   Либо `wrangler kv namespace create MAFIA_ROOMS` — вернёт id.
3. В папке `worker/` запусти `wrangler deploy`.

Класс `RoomObject` создаётся автоматически (новые SQLite-DO с авто-миграцией).

## Вариант B — через дашборд (без wrangler)

1. Cloudflare → **Workers & Pages → KV** → создай namespace `MAFIA_ROOMS`.
2. Cloudflare → **Workers & Pages → Durable Objects** → создай namespace
   (или используй «авто-миграцию» при первом деплое — для SQLite-DO).
3. Открой Worker → **Settings → Variables**:
   - KV Namespace Binding: имя `MAFIA_ROOMS` → твой namespace.
   - Durable Object Binding: имя `MAFIA_DO` → namespace, класс `RoomObject`.
4. Вставь код `worker.js` в редактор → **Deploy**.

> Если в дашборде DO-класс требует «migration» и не даёт создать binding без
> wrangler — проще использовать вариант A (одна команда `wrangler deploy`).

## Проверка

```
https://mafia.aleshkalarin2002.workers.dev/api/health
```
→ `{"ok":true,"service":"mafia-relay","http":true,"protocol":2,...}`

## Почему DO, а не KV

- **KV** — eventual consistency + лимиты на запись (~1000/день). Хватает на
  пару комнат, дальше упирается.
- **Durable Objects** — строгая консистентность, состояние комнаты в памяти
  объекта (без гонок чтения-модификации-записи), комнаты масштабируются
  независимо. Для 100 одновременных комнат нужен именно DO.
- KV остаётся только как дешёвый индекс списка публичных комнат (редкие
  записи на create/meta/close — не на каждый поллинг).

## Про лимиты

100 активных комнат × 8 игроков × поллинг — это тысячи запросов в минуту.
Бесплатный план Workers (~100k запросов/день) такое не потянет; для реальной
нагрузки нужен платный Cloudflare (или VPS). DO решает проблему консистентности
и масштабируемости хранения, но не отменяет лимит на число запросов.
