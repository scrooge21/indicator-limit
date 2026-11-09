# MEXC Indicator

Модульный терминал мониторинга ликвидности MEXC с интерфейсом EJS, REST API, MongoDB и Swagger UI.

## Требования
- Node.js 20+
- MongoDB (необязательна: без неё история индикатора хранится в ограниченном буфере в памяти)

## Запуск
```bash
cp .env.example .env
npm install
npm start
```
Откройте `http://localhost:10000`. Сканер: `/scanner`. Документация API: `/api-docs`. JSON OpenAPI: `/openapi.json`.

## Структура
- `src/config` — конфигурация и подключение MongoDB
- `src/controllers`, `src/routes` — HTTP-слой
- `src/services` — интеграция MEXC, расчёты ликвидности и история
- `src/models` — модели MongoDB
- `views/pages` и `views/partials` — EJS-страницы и переиспользуемые фрагменты
- `public` — CSS и статические ресурсы
- `docs/swagger.js` — OpenAPI 3.0

## API
- `GET /api/health`
- `GET /api/symbols`
- `GET /api/klines?symbol=BTCUSDT&interval=1m&limit=200` (`limit` 1–500; часовой интервал: `60m` или `1h`)
- `GET /api/indicators/catalog` — список индикаторов
- `GET /api/indicators?symbol=BTCUSDT&interval=1d&names=ema20,rsi14,rinar&limit=200` — расчёт по свечам MEXC
- `GET /api/data?symbol=BTCUSDT&depth=5`
- `GET /api/history?symbol=BTCUSDT&limit=2000&bucket=0` (самые новые точки; заголовок `X-History-Source`)
- `GET /api/scan?depth=2&limit=100`

Секреты и `.env` не включаются в репозиторий. Исторические CSV из исходного проекта сохранены в `data/`.

## Тесты и демонстрация
```bash
npm test                  # все автотесты (122, ~3 с; без MongoDB и интернета)
npm run test:spec         # то же, построчный отчёт
npm run test:coverage     # то же с покрытием
npm run test:ci           # для CI: отчёт в консоль + reports/junit.xml
npm run test:smoke -- https://ваш-домен   # проверка уже запущенного сервера по HTTP
npm run test:smoke:live   # то же + реальные запросы к MEXC
npm run demo:break        # демонстрация: тесты ловят внесённые баги (исходники не меняются)
```
CI настроен в `.github/workflows/test.yml`. Сценарий показа проекта и тестов, запуск тестов на сервере и объяснение исправления истории индикатора — в [DEMO.md](DEMO.md).

## Индикаторы на графике
Кнопка **ƒ Индикаторы** в шапке терминала (выбор запоминается в браузере, данные обновляются раз в 15 с).

| id | Что это | Где | Таймфрейм |
|---|---|---|---|
| `ema20`, `sma50`, `sma200` | скользящие средние | поверх свечей | любой |
| `bollinger` | полосы Боллинджера (20, 2) | поверх свечей | любой |
| `dema_atr` | DEMA ATR Channels 40/15 из `rinar_bot` | поверх свечей | любой |
| `rinar` | уровни Rinar (зелёная, жёлтая, фиолетовая, оранжевая, красная, RSI 25D и 14W) и метки медвежьей дивергенции MACD 64/270/9 | поверх свечей | только `1d` |
| `rsi14` | RSI по Уайлдеру, уровни 30/70 | отдельная панель | любой |
| `macd` | MACD (12, 26, 9) с гистограммой | отдельная панель | любой |

Формулы Rinar, DEMA ATR, RSI, MACD и дивергенции портированы из Python-проекта `rinar_bot` и сверены с ним на эталонных данных (`tests/fixtures/`). Расчёт — на сервере (`src/services/indicators.js`), по последним 500 свечам MEXC; на график отдаются последние `limit` баров.
Не перенесены индикаторы Average RSI (корзины альтов) и ончейн-индикаторы (CVDD, MVRV, SOPR): им нужны данные не из API MEXC.

## Хранение истории (настройки в `.env`)
`HISTORY_MIN_INTERVAL_MS`, `HISTORY_MAX_DOCS`, `HISTORY_TTL_SECONDS`, `HISTORY_MEMORY_PER_SYMBOL`, `LOG_INTERVAL_MS`,
`WATCH_MAX_SYMBOLS`, `WATCH_TTL_MS` — см. `.env.example`.
