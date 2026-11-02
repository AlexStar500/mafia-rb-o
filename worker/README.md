# MAFIA relay — Cloudflare Worker (HTTP proxy к Vercel)

Это простой **прокси**: браузер ходит на `*.workers.dev` (он доступен там, где
Vercel заблокирован), а воркер просто пересылает запросы на Vercel. Вся логика
комнат остаётся на Vercel (`api/index.mjs`).

**Без KV, без Durable Objects, без bindings, без wrangler.**

## Как выложить (только дашборд)

1. Cloudflare → **Workers & Pages** → **Create** → Worker (или открой свой).
2. Вставь код `worker.js` целиком в редактор.
3. Нажми **Deploy**.

Всё. Никаких переменных и bindings не нужно.

## Проверка

```
https://mafia.aleshkalarin2002.workers.dev/api/health
```
Должен вернуть:
```json
{"ok":true,"service":"mafia-relay","http":true,"protocol":2,"rooms":0,"uptime":0}
```

Если вернул JSON — прокси работает, и игра уже ходит через него (адрес
`https://mafia.aleshkalarin2002.workers.dev/api` прописан в `js/net/auto.js`
как основной публичный relay).

## Как это работает

```
игрок → https://mafia.aleshkalarin2002.workers.dev/api/health
      → (worker пересылает) https://mafiarbovercel.vercel.app/api/health
      → Vercel relay (api/index.mjs)
```

## Ограничение

Комнаты на Vercel живут в памяти инстанса функции. Для дружеских партий этого
хватает (тёплый инстанс переиспользуется). При большой нагрузке Vercel может
разнести комнаты по разным инстансам — тогда комнаты друг друга не увидят.
