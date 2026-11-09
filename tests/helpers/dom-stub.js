// Минимальные заглушки DOM и lightweight-charts: позволяют выполнить скрипт страницы терминала в Node без браузера.
export function createEnvironment({ fetchImpl, storage = {} }) {
  const log = { series: [], charts: [], markers: [], priceLines: 0 };

  class El {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.style = {}; this.dataset = {}; this.listeners = {}; this._html = ''; this.textContent = ''; this.innerText = ''; this.value = '';
      const set = new Set(); this.classList = { add: c => set.add(c), remove: c => set.delete(c), toggle: c => (set.has(c) ? set.delete(c) : set.add(c)), contains: c => set.has(c) };
    }
    set innerHTML(v) { this._html = String(v); this._inputs = null; if (!v) this.children = []; }
    get innerHTML() { return this._html; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    appendChild(el) { this.children.push(el); el.parent = this; return el; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
    contains(el) { return el === this || this.children.includes(el); }
    querySelector() { return new El(); }
    querySelectorAll(selector) {
      if (selector === 'input[data-ind]') {
        // Чекбоксы создаются один раз на каждое присваивание innerHTML — как настоящие элементы, к ним привязываются обработчики.
        this._inputs ||= [...this._html.matchAll(/<input type="checkbox" data-ind="([\w]+)"\s*(checked)?\s*(disabled)?/g)].map(m => {
          const box = new El('input'); box.dataset.ind = m[1]; box.checked = Boolean(m[2]); box.disabled = Boolean(m[3]); return box;
        });
        return this._inputs;
      }
      return [];
    }
    click() { (this.listeners.click || []).forEach(fn => fn({ stopPropagation() {}, target: this })); }
  }

  const byId = new Map();
  const tfButtons = [['1m', 60], ['5m', 300], ['15m', 900], ['60m', 3600], ['4h', 14400], ['1d', 86400]].map(([tf, sec]) => { const b = new El('button'); b.dataset.tf = tf; b.dataset.sec = String(sec); return b; });
  const document = {
    getElementById: (id) => { if (!byId.has(id)) byId.set(id, new El()); return byId.get(id); },
    querySelectorAll: (sel) => (sel === '.tf-btn' ? tfButtons : []),
    createElement: (tag) => new El(tag),
    addEventListener() {},
  };

  const makeSeries = (kind) => {
    const s = { kind, data: [], setData(d) { this.data = d; }, update() {}, setMarkers(m) { log.markers.push(m); this.markers = m; },
      createPriceLine() { log.priceLines++; return {}; }, applyOptions() {}, priceScale() { return { applyOptions() {} }; } };
    log.series.push(s); return s;
  };
  const makeChart = () => {
    const subs = [];
    const chart = {
      removed: false, series: [], range: null,
      addCandlestickSeries() { const s = makeSeries('candle'); this.series.push(s); return s; },
      addHistogramSeries() { const s = makeSeries('hist'); this.series.push(s); return s; },
      addLineSeries(opts) { const s = makeSeries('line'); s.opts = opts; this.series.push(s); return s; },
      removeSeries(s) { this.series = this.series.filter(x => x !== s); s.removed = true; },
      priceScale() { return { applyOptions() {} }; },
      timeScale() { const self = this; return {
        subscribeVisibleLogicalRangeChange: fn => subs.push(fn),
        setVisibleLogicalRange(r) { self.range = r; subs.forEach(fn => fn(r)); },
        getVisibleLogicalRange: () => self.range || { from: 0, to: 100 }, fitContent() {},
      }; },
      subscribeCrosshairMove() {}, setCrosshairPosition() {}, clearCrosshairPosition() {},
      remove() { this.removed = true; },
    };
    log.charts.push(chart); return chart;
  };
  const LightweightCharts = { createChart: makeChart, CrosshairMode: { Normal: 0 }, LineStyle: { Solid: 0, Dashed: 2 } };

  const store = { ...storage };
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const intervals = [];
  const sandbox = {
    document, LightweightCharts, localStorage, fetch: fetchImpl, console, URLSearchParams, Math, Date, JSON, Promise, Number, Array, Object, Set, Map, parseFloat, parseInt, isFinite,
    window: { location: { search: '' }, addEventListener() {} },
    setInterval: (fn) => { intervals.push(fn); return intervals.length; }, setTimeout: () => 0, clearTimeout() {},
  };
  return { sandbox, log, byId, tfButtons, store, El };
}
