# MAFIA relay — Cloudflare Worker

Этот воркер заменяет Vercel-relay. Он принимает те же запросы `/api/*`, что и
старый `api/index.mjs`, и хранит комнаты в Workers KV.

## Как задеплоить (без wrangler, через дашборд)

1. Открой Cloudflare → **Workers & Pages** → создай Worker (или открой свой).
2. **KV namespace**: Cloudflare → **Workers & Pages → KV** → «Create namespace»,
   имя `MAFIA_ROOMS`.
3. В настройках Worker: **Settings → Variables → KV Namespace Bindings** →
   «Add binding», имя переменной `MAFIA_ROOMS`, выбрать созданный namespace.
4. Вставь код `index.js` в редактор Worker и нажми **Deploy**.

## Проверка

```
https://mafia.aleshkalarin2002.workers.dev/api/health
```
Должен вернуть:
```json
{"ok":true,"service":"mafia-relay","http":true,"protocol":2,"rooms":0,"uptime":0}
```

## Подключение игры

Игра уже знает этот адрес как основной публичный relay
(`js/net/auto.js` → `PUBLIC_HTTP_RELAY_WORKER`). Можно также вписать его вручную
в **Настройки → Сеть → Адрес relay**:
```
https://mafia.aleshkalarin2002.workers.dev
```
(путь `/api` подставится сам).

## Ограничения KV

- KV **eventually consistent** — после записи значение видно не мгновенно
  (обычно < 1 с). Для переписки в чате это незаметно.
- Есть лимиты на запись (бесплатный тариф ~1000 записей/день). Воркер хранит
  комнату одним JSON-значением и пишет «сердцебиение» раз в минуту, так что
  дружеской партии хватает с запасом.
- Read-modify-write гонки теоретически возможны (две одновременные записи
  могут потерять одну). Для нескольких друзей — ок. Для загруженного
  публичного relay лучше перейти на **Durable Objects** (строгая
  консистентность + WebSocket), но это отдельная работа.
