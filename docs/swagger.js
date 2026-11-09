const json = (schema) => ({ 'application/json': { schema } });
const errorRef = (name) => ({ $ref: `#/components/responses/${name}` });
const symbolParam = { name: 'symbol', in: 'query', required: false, schema: { type: 'string', default: 'BTCUSDT', pattern: '^[A-Z0-9]{5,25}$' }, description: 'Торговая пара' };

export const openapiSpec = {
  openapi: '3.0.3',
  info: { title: 'MEXC Indicator API', version: '1.3.0', description: 'REST API терминала мониторинга рынка MEXC.' },
  servers: [{ url: '/', description: 'Текущий сервер' }],
  tags: [
    { name: 'System', description: 'Состояние приложения' },
    { name: 'Market', description: 'Рыночные данные MEXC' },
    { name: 'History', description: 'История показателей ликвидности' },
    { name: 'Scanner', description: 'Сканирование торговых пар' },
    { name: 'Indicators', description: 'Технические индикаторы по свечам MEXC' },
  ],
  paths: {
    '/api/health': {
      get: { tags: ['System'], summary: 'Проверка состояния сервера и MongoDB', responses: { '200': { description: 'Состояние сервиса', content: json({ $ref: '#/components/schemas/Health' }) } } },
    },
    '/api/symbols': {
      get: { tags: ['Market'], summary: 'Список доступных USDT-пар', responses: {
        '200': { description: 'Массив торговых символов', content: json({ type: 'array', items: { type: 'string', example: 'BTCUSDT' } }) },
        '502': errorRef('UpstreamError'),
      } },
    },
    '/api/klines': {
      get: { tags: ['Market'], summary: 'Свечи торговой пары', parameters: [symbolParam, {
        name: 'interval', in: 'query', description: 'Таймфрейм. «1h» приводится к «60m» (так MEXC называет часовой интервал).', schema: { type: 'string', default: '1m', enum: ['1m', '3m', '5m', '15m', '30m', '60m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'] },
      }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 200 }, description: 'Сколько последних свечей вернуть' }], responses: { '200': { description: 'Массив свечей MEXC: [openTime, open, high, low, close, volume, closeTime, quoteVolume]', content: json({ type: 'array', items: { type: 'array', items: {} } }) }, '400': errorRef('BadRequest'), '502': errorRef('UpstreamError') } },
    },
    '/api/indicators/catalog': {
      get: { tags: ['Indicators'], summary: 'Каталог доступных индикаторов', responses: {
        '200': { description: 'Список индикаторов с размещением (поверх свечей или отдельная панель) и ограничениями по таймфрейму', content: json({ type: 'array', items: { $ref: '#/components/schemas/IndicatorInfo' } }) },
      } },
    },
    '/api/indicators': {
      get: { tags: ['Indicators'], summary: 'Рассчитать индикаторы по свечам',
        description: 'Берёт до 500 последних свечей MEXC (для прогрева), считает выбранные индикаторы и возвращает последние `limit` баров. Индикатор Rinar работает только на дневном таймфрейме (`interval=1d`). Время точек — Unix, секунды (как в свечах).',
        parameters: [symbolParam,
          { name: 'interval', in: 'query', schema: { type: 'string', default: '1m' }, description: 'Таймфрейм (см. /api/klines)' },
          { name: 'names', in: 'query', required: true, schema: { type: 'string', example: 'ema20,rsi14,macd' }, description: 'Идентификаторы индикаторов через запятую (не более 8), см. /api/indicators/catalog' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 200 }, description: 'Сколько последних баров вернуть' },
        ],
        responses: { '200': { description: 'Рассчитанные индикаторы', content: json({ $ref: '#/components/schemas/IndicatorsResult' }) }, '400': errorRef('BadRequest'), '502': errorRef('UpstreamError') } },
    },
    '/api/data': {
      get: { tags: ['Market'], summary: 'Текущая цена, стакан и ликвидность', parameters: [symbolParam, {
        name: 'depth', in: 'query', schema: { type: 'number', minimum: 0.1, maximum: 20, default: 5 }, description: 'Глубина расчёта ликвидности в процентах от цены',
      }], responses: {
        '200': { description: 'Рыночные данные', content: json({ $ref: '#/components/schemas/MarketData' }) },
        '400': errorRef('BadRequest'), '502': errorRef('UpstreamError'),
      } },
    },
    '/api/history': {
      get: { tags: ['History'], summary: 'История BID/ASK и imbalance',
        description: 'Возвращает самые НОВЫЕ `limit` точек по возрастанию времени. Данные берутся из MongoDB, а если она недоступна или пуста — из ограниченного буфера в памяти (источник в заголовке `X-History-Source`). При `bucket > 0` время точки — начало корзины.',
        parameters: [symbolParam,
        { name: 'since', in: 'query', schema: { type: 'integer', minimum: 0 }, description: 'Unix timestamp в секундах' },
        { name: 'bucket', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 86400, default: 0 }, description: 'Размер временной корзины в секундах; 0 — без агрегации' },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 20000, default: 2000 } },
      ], responses: {
        '200': { description: 'Исторические записи', headers: { 'X-History-Source': { description: 'Откуда взяты данные', schema: { type: 'string', enum: ['mongodb', 'memory'] } } },
          content: json({ type: 'array', items: { $ref: '#/components/schemas/HistoryPoint' } }) },
        '400': errorRef('BadRequest'),
      } },
    },
    '/api/scan': {
      get: { tags: ['Scanner'], summary: 'Сканирование наиболее ликвидных USDT-пар', parameters: [
        { name: 'depth', in: 'query', schema: { type: 'number', minimum: 0.1, maximum: 20, default: 2 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 } },
      ], responses: { '200': { description: 'Результаты сканирования', content: json({ type: 'array', items: { $ref: '#/components/schemas/ScanRow' } }) }, '400': errorRef('BadRequest'), '502': errorRef('UpstreamError') } },
    },
  },
  components: {
    schemas: {
      Health: {
        type: 'object', required: ['status', 'database', 'timestamp'],
        properties: {
          status: { type: 'string', example: 'ok' }, database: { type: 'string', enum: ['connected', 'disconnected'] },
          history: { type: 'object', properties: {
            store: { type: 'string', enum: ['mongodb', 'memory'] }, persistent: { type: 'boolean' },
            memorySamples: { type: 'integer' }, tracked: { type: 'array', items: { type: 'string' } },
          } },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      HistoryPoint: {
        type: 'object', required: ['timestamp', 'bidUSD', 'askUSD', 'imbalance'],
        properties: {
          timestamp: { type: 'string', format: 'date-time' }, symbol: { type: 'string', example: 'BTCUSDT' }, price: { type: 'number' },
          bidUSD: { type: 'number' }, askUSD: { type: 'number' }, imbalance: { type: 'number' },
        },
      },
      IndicatorInfo: {
        type: 'object', required: ['id', 'label', 'placement'],
        properties: {
          id: { type: 'string', example: 'rsi14' }, label: { type: 'string' }, group: { type: 'string' }, description: { type: 'string' },
          placement: { type: 'string', enum: ['overlay', 'pane'] },
          intervals: { type: 'array', nullable: true, items: { type: 'string' }, description: 'null — любой таймфрейм' },
        },
      },
      IndicatorPoint: { type: 'object', required: ['time', 'value'], properties: { time: { type: 'integer', description: 'Unix, секунды' }, value: { type: 'number' }, color: { type: 'string' } } },
      IndicatorLine: {
        type: 'object', required: ['key', 'label', 'color', 'points'],
        properties: { key: { type: 'string' }, label: { type: 'string' }, color: { type: 'string' }, style: { type: 'string', enum: ['dashed'] }, points: { type: 'array', items: { $ref: '#/components/schemas/IndicatorPoint' } } },
      },
      IndicatorOutput: {
        type: 'object', required: ['id', 'placement', 'lines'],
        properties: {
          id: { type: 'string' }, placement: { type: 'string', enum: ['overlay', 'pane'] },
          lines: { type: 'array', items: { $ref: '#/components/schemas/IndicatorLine' } },
          histogram: { type: 'array', items: { $ref: '#/components/schemas/IndicatorPoint' } },
          markers: { type: 'array', items: { type: 'object', properties: { time: { type: 'integer' }, position: { type: 'string' }, shape: { type: 'string' }, color: { type: 'string' }, text: { type: 'string' } } } },
          levels: { type: 'array', items: { type: 'number' }, description: 'Горизонтальные уровни панели (например 30 и 70 для RSI)' },
          range: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        },
      },
      IndicatorsResult: {
        type: 'object', required: ['symbol', 'interval', 'candles', 'indicators'],
        properties: {
          symbol: { type: 'string' }, interval: { type: 'string' }, candles: { type: 'integer', description: 'Сколько свечей использовано в расчёте' },
          indicators: { type: 'object', additionalProperties: { $ref: '#/components/schemas/IndicatorOutput' } },
        },
      },
      ScanRow: {
        type: 'object', required: ['symbol', 'price', 'change', 'volume', 'bidUSD', 'askUSD', 'imbalance'],
        properties: {
          symbol: { type: 'string' }, price: { type: 'number' }, change: { type: 'number', description: 'Изменение за 24 ч, %' },
          volume: { type: 'number', description: 'Оборот за 24 ч в USDT' }, bidUSD: { type: 'number' }, askUSD: { type: 'number' }, imbalance: { type: 'number' },
        },
      },
      MarketData: {
        type: 'object', required: ['symbol', 'price', 'bidUSD', 'askUSD', 'imbalance', 'book'],
        properties: {
          symbol: { type: 'string', example: 'BTCUSDT' }, price: { type: 'number' },
          bidUSD: { type: 'number' }, askUSD: { type: 'number' }, imbalance: { type: 'number' },
          book: { type: 'object', properties: {
            bids: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            asks: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          } },
        },
      },
    },
    responses: {
      BadRequest: { description: 'Некорректные параметры запроса' },
      UpstreamError: { description: 'Ошибка или тайм-аут API MEXC' },
    },
  },
};
