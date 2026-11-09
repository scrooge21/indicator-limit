// Вспомогательные функции для HTTP-запросов между сервисами и к бирже.

export function qs(params) {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
    }
    return u.toString();
}

export async function getJson(url, { timeoutMs = 8000 } = {}) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res  = await fetch(url, { signal: ctrl.signal });
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch { /* ответ не JSON */ }
        if (!res.ok) {
            const err = new Error(`HTTP ${res.status} ${url}`);
            err.status = res.status;
            err.body = data;
            throw err;
        }
        return data;
    } finally {
        clearTimeout(timer);
    }
}
