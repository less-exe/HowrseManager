// ==UserScript==
// @name         Howrse Manager
// @namespace    https://github.com/less-exe/HowrseManager
// @version      0.1.0
// @description  Умный менеджер-ассистент для Ловади / Howrse. v0.1 MVP «Глаза»: анализ лошади и красивый интерфейс (без действий).
// @author       less-exe
// @match        https://www.lowadi.com/*
// @match        http://www.lowadi.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /* ===== КОНСТАНТЫ ===== */
    const APP = { id: 'howrse-manager', name: 'Howrse Manager', version: '0.1.0', storagePrefix: 'hm:v1' };

    const PageType = Object.freeze({ HORSE: 'horse', HORSE_LIST: 'horse_list', EC: 'ec', COMPETITIONS: 'competitions', UNKNOWN: 'unknown' });
    const AppStatus = Object.freeze({ IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused', STOPPED: 'stopped', DONE: 'done', ERROR: 'error' });
    const PageLabels = {
        [PageType.HORSE]: 'Страница лошади', [PageType.HORSE_LIST]: 'Список лошадей',
        [PageType.EC]: 'КСК', [PageType.COMPETITIONS]: 'Соревнования', [PageType.UNKNOWN]: 'Неизвестная страница',
    };

    const MENU = [
        { id: 'home',      icon: '🏠', label: 'Главная',    ready: true },
        { id: 'run',       icon: '🐴', label: 'Прогон',     ready: true },
        { id: 'ec',        icon: '🏡', label: 'КСК',        ready: false },
        { id: 'breeding',  icon: '💕', label: 'Разведение', ready: false },
        { id: 'training',  icon: '🐎', label: 'Тренировки', ready: false },
        { id: 'profiles',  icon: '🗂', label: 'Профили',    ready: false },
        { id: 'stats',     icon: '📊', label: 'Статистика', ready: true },
        { id: 'settings',  icon: '⚙️', label: 'Настройки',  ready: true },
        { id: 'about',     icon: 'ℹ️', label: 'О проекте',  ready: true },
        { id: 'developer', icon: '🧑‍💻', label: 'Разработчик', ready: true },
    ];

    const settingsSchema = [
        { id: 'appearance', title: 'Внешний вид', description: 'Тема и поведение окна.', fields: [
            { id: 'theme', type: 'select', label: 'Тема', default: 'dark', options: [
                { value: 'dark', label: 'Тёмная' }, { value: 'light', label: 'Светлая' }, { value: 'auto', label: 'Авто' } ] },
            { id: 'compactMode', type: 'checkbox', label: 'Компактный режим', default: false } ] },
        { id: 'developer', title: 'Разработчик', description: 'Диагностика поиска данных.', fields: [
            { id: 'enabled', type: 'checkbox', label: 'Включить режим разработчика', default: true } ] },
    ];

    /* ===== ШИНА СОБЫТИЙ ===== */
    class EventBus {
        constructor() { this.listeners = new Map(); }
        on(name, cb) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(cb); return () => this.off(name, cb); }
        off(name, cb) { this.listeners.get(name)?.delete(cb); }
        emit(name, payload) { this.listeners.get(name)?.forEach((cb) => { try { cb(payload); } catch (e) { console.error(`[${APP.name}]`, e); } }); }
    }

    /* ===== ХРАНИЛИЩЕ ===== */
    class Storage {
        constructor(prefix) { this.prefix = prefix; }
        key(name) { return `${this.prefix}:${name}`; }
        get(name, fallback = null) {
            try { const v = window.localStorage.getItem(this.key(name)); return v === null ? fallback : JSON.parse(v); }
            catch (e) { console.warn(`[${APP.name}] read`, name, e); return fallback; }
        }
        set(name, value) { try { window.localStorage.setItem(this.key(name), JSON.stringify(value)); } catch (e) { console.warn(`[${APP.name}] write`, name, e); } }
    }

    /* ===== ЛОГГЕР ===== */
    class Logger {
        constructor(eventBus, storage) { this.eventBus = eventBus; this.storage = storage; this.maxItems = 400; this.items = this.storage.get('log', []); }
        add(level, message, details = null) {
            const item = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                level, message, details };
            this.items.unshift(item); this.items = this.items.slice(0, this.maxItems);
            this.storage.set('log', this.items); this.eventBus.emit('log:changed', this.items);
        }
        info(m, d) { this.add('info', m, d); }
        success(m, d) { this.add('success', m, d); }
        warn(m, d) { this.add('warn', m, d); }
        error(m, d) { this.add('error', m, d); }
        clear() { this.items = []; this.storage.set('log', this.items); this.eventBus.emit('log:changed', this.items); }
        all() { return [...this.items]; }
    }

    /* ===== НАСТРОЙКИ ===== */
    class SettingsManager {
        constructor(eventBus, storage, schema) { this.eventBus = eventBus; this.storage = storage; this.schema = schema; this.defaults = this.createDefaults(schema); this.settings = this.load(); }
        createDefaults(schema) { const d = { version: 1 }; schema.forEach((s) => { d[s.id] = {}; s.fields.forEach((f) => { d[s.id][f.id] = f.default; }); }); return d; }
        load() { return this.mergeDeep(this.defaults, this.storage.get('settings', {})); }
        mergeDeep(base, override) {
            const out = Array.isArray(base) ? [...base] : { ...base };
            Object.keys(override || {}).forEach((k) => {
                if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k])) out[k] = this.mergeDeep(out[k] || {}, override[k]);
                else out[k] = override[k];
            });
            return out;
        }
        get(sectionId, fieldId = null) { return fieldId ? this.settings?.[sectionId]?.[fieldId] : this.settings[sectionId]; }
        set(sectionId, fieldId, value) { if (!this.settings[sectionId]) this.settings[sectionId] = {}; this.settings[sectionId][fieldId] = value; this.storage.set('settings', this.settings); this.eventBus.emit('settings:changed', this.settings); }
        reset() { this.settings = this.createDefaults(this.schema); this.storage.set('settings', this.settings); this.eventBus.emit('settings:changed', this.settings); }
        all() { return this.settings; }
    }

    /* ===== СОСТОЯНИЕ ===== */
    class StateManager {
        constructor(eventBus, storage) { this.eventBus = eventBus; this.storage = storage; this.state = this.createInitialState(); }
        createInitialState() {
            return { status: AppStatus.IDLE, currentHorseName: '—', currentOperation: 'Ожидание',
                progress: { current: 0, total: 0 }, startedAt: null, finishedAt: null, lastActionAt: null,
                pageType: PageType.UNKNOWN, currentHorse: null, stats: { analyzed: 0, errors: 0 },
                run: { softStopRequested: false, lastError: null } };
        }
        mergeState(base, saved) { return { ...base, ...saved, progress: { ...base.progress, ...(saved.progress || {}) }, stats: { ...base.stats, ...(saved.stats || {}) }, run: { ...base.run, ...(saved.run || {}) } }; }
        get() { return JSON.parse(JSON.stringify(this.state)); }
        patch(partial) { this.state = this.mergeState(this.state, partial); this.eventBus.emit('state:changed', this.get()); }
        start(total = 0) { this.patch({ status: AppStatus.RUNNING, currentOperation: 'Анализ табуна', progress: { current: 0, total }, stats: { analyzed: 0, errors: 0 }, startedAt: Date.now(), finishedAt: null, lastActionAt: Date.now(), run: { softStopRequested: false, lastError: null } }); }
        pause() { this.patch({ status: AppStatus.PAUSED, currentOperation: 'Пауза', lastActionAt: Date.now() }); }
        resume() { this.patch({ status: AppStatus.RUNNING, currentOperation: 'Продолжение', lastActionAt: Date.now(), finishedAt: null }); }
        stop(op = 'Остановлено') { this.patch({ status: AppStatus.STOPPED, currentOperation: op, finishedAt: Date.now(), lastActionAt: Date.now(), progress: { current: 0, total: 0 }, startedAt: null, run: { softStopRequested: false, lastError: null } }); }
        done(op = 'Готово! Всё выполнено 🎉') { this.patch({ status: AppStatus.DONE, currentOperation: op, finishedAt: Date.now(), lastActionAt: Date.now() }); }
        error(msg) { this.patch({ status: AppStatus.ERROR, currentOperation: 'Ошибка', finishedAt: Date.now(), lastActionAt: Date.now(), stats: { ...this.state.stats, errors: (this.state.stats.errors || 0) + 1 }, run: { ...this.state.run, lastError: msg } }); }
        requestSoftStop() { this.patch({ run: { ...this.state.run, softStopRequested: true }, currentOperation: 'Остановка после текущей' }); }
        markHorseAnalyzed(horse) { this.patch({ currentHorseName: horse?.name || '—', currentHorse: horse, progress: { current: (this.state.progress.current || 0) + 1 }, stats: { ...this.state.stats, analyzed: (this.state.stats.analyzed || 0) + 1 }, lastActionAt: Date.now() }); }
    }

    /* ===== ЗАДЕРЖКИ ===== */
    class DelayManager {
        wait(ms) { return new Promise((r) => window.setTimeout(r, ms)); }
        random(min = 1200, max = 2400) { return this.wait(Math.floor(Math.random() * (max - min + 1)) + min); }
    }

    /* ===== ТИП СТРАНИЦЫ ===== */
    class RouteManager {
        getCurrentPageType() {
            const path = window.location.pathname; const href = window.location.href;
            if (/\/elevage\/chevaux\/cheval/i.test(path) || /[?&]id=\d+/i.test(href)) return PageType.HORSE;
            if (/centre|centre-equestre|centreEquestre|ecuri/i.test(path)) return PageType.EC;
            if (/competition|competitions|course/i.test(path)) return PageType.COMPETITIONS;
            if (/\/elevage\/chevaux/i.test(path)) return PageType.HORSE_LIST;
            return PageType.UNKNOWN;
        }
    }

    /* ===== ПАРСЕР ЛОШАДИ (ТОЛЬКО ЧТЕНИЕ) ===== */
    class HorseParser {
        parse() {
            const text = this.normalize(document.body?.innerText || '');
            const name = this.getHorseName(text);
            const nextButton = this.findNextHorseButton();
            return {
                id: this.getHorseId(), name,
                energy: this.getPercentNearLabel(text, 'Энергия'),
                health: this.getPercentNearLabel(text, 'Здоровье'),
                mood: this.getPercentNearLabel(text, 'Настроение') ?? this.getPercentNearLabel(text, 'Мораль'),
                age: this.getAge(text), sex: this.getSex(text, name),
                food: this.getFood(text), mission: this.getMission(text),
                hasNextHorseButton: Boolean(nextButton),
                nextHorseButtonSelector: this.describeElement(nextButton),
                pageTextSample: text.slice(0, 900),
            };
        }
        normalize(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
        getHorseId() { return new URLSearchParams(window.location.search).get('id') || null; }
        getHorseName(text) {
            const title = document.title.replace(/\s*-\s*Ловади\s*$/i, '').replace(/\s*-\s*Howrse\s*$/i, '').trim();
            if (title && !/^(lowadi|howrse|ловади)$/i.test(title)) return title;
            for (const s of ['#characteristics-body-content h1', '.horse-name', '[class*="horse"] h1', 'h1', 'h2']) {
                const c = this.normalize(document.querySelector(s)?.textContent || '');
                if (c && c.length <= 80) return c;
            }
            const m = text.match(/(?:Табун\s+[^\s]+\s+)?((?:жен|муж)\s+[0-9.,]+)/i);
            return m ? m[1] : '—';
        }
        getPercentNearLabel(text, label) {
            const e = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const d = text.match(new RegExp(`${e}\\s*(\\d{1,3})\\s*%`, 'i')); if (d) return Math.min(100, Number(d[1]));
            const r = text.match(new RegExp(`(\\d{1,3})\\s*%\\s*${e}`, 'i')); if (r) return Math.min(100, Number(r[1]));
            return null;
        }
        getAge(text) {
            const cands = [
                text.match(/Возраст\s*:?\s*([^|]{1,35}?)(?= Пол| Энергия| Здоровье| Настроение|$)/i),
                text.match(/(\d+\s*(?:год|года|лет)\s*(?:и\s*)?\d*\s*(?:месяц|месяца|месяцев)?)/i),
                text.match(/(\d+\s*(?:месяц|месяца|месяцев))/i),
            ];
            for (const m of cands) { const v = this.normalize(m?.[1] || ''); if (v && !/смотреть страницу профиля|обучив/i.test(v)) return v; }
            return null;
        }
        getSex(text, name) {
            const s = `${name} ${text}`.toLowerCase();
            if (/\bжен\b|кобыла|кобылиц/.test(s)) return 'Женский';
            if (/\bмуж\b|жеребец|мерин/.test(s)) return 'Мужской';
            return null;
        }
        getFood(text) {
            for (const p of [/Корм[а-я]*\s*:?\s*(\d+)\s*\/\s*(\d+)/i, /(\d+)\s*\/\s*(\d+)\s*Корм/i]) {
                const m = text.match(p);
                if (m) { const eaten = Number(m[1]), norm = Number(m[2]); return { eaten, norm, remaining: Math.max(0, norm - eaten), raw: `${eaten} / ${norm}` }; }
            }
            return null;
        }
        getMission(text) { const m = text.match(/Миссия\s*:?\s*([^|]{1,60}?)(?= Энергия| Здоровье| Настроение| Возраст|$)/i); return m ? this.normalize(m[1]) : null; }
        findNextHorseButton() {
            const cands = [
                ...document.querySelectorAll('a[href*="go=next"], button[onclick*="go=next"], input[onclick*="go=next"]'),
                ...document.querySelectorAll('a[href*="sens=suivant"], a[href*="next"], button[title*="след" i], a[title*="след" i]'),
                ...document.querySelectorAll('button, a'),
            ];
            const byHref = cands.find((el) => /go=next|sens=suivant/i.test(el.getAttribute('href') || el.getAttribute('onclick') || '')); if (byHref) return byHref;
            const byText = cands.find((el) => /следующ|suivant|next/i.test(this.normalize(el.textContent || el.title || el.getAttribute('aria-label') || ''))); if (byText) return byText;
            return null;
        }
        describeElement(el) {
            if (!el) return null;
            if (el.id) return `#${el.id}`;
            const href = el.getAttribute('href'); if (href) return `a[href="${href.slice(0, 90)}${href.length > 90 ? '…' : ''}"]`;
            const title = el.getAttribute('title') || el.getAttribute('aria-label'); if (title) return `${el.tagName.toLowerCase()}[title="${title}"]`;
            return el.tagName.toLowerCase();
        }
    }

    /* ===== АДАПТЕРЫ ИГР ===== */
    class GameAdapter {
        constructor(routeManager) { this.routeManager = routeManager; this.horseParser = new HorseParser(); }
        getName() { return 'BaseAdapter'; }
        isSupported() { return false; }
        getPageInfo() {
            const pageType = this.routeManager.getCurrentPageType();
            return { hostname: window.location.hostname, url: window.location.href, pageType, pageTypeLabel: PageLabels[pageType] || PageLabels[PageType.UNKNOWN], adapter: this.getName(), supported: this.isSupported() };
        }
        analyzeHorse() { return this.horseParser.parse(); }
        findNextHorseButton() { return this.horseParser.findNextHorseButton(); }
    }
    class LowadiAdapter extends GameAdapter {
        getName() { return 'LowadiAdapter'; }
        isSupported() { return window.location.hostname === 'www.lowadi.com'; }
    }
    class AdapterFactory {
        static create(routeManager) { return window.location.hostname === 'www.lowadi.com' ? new LowadiAdapter(routeManager) : new GameAdapter(routeManager); }
    }

    // 👉 ПРОДОЛЖЕНИЕ В ЧАСТИ 2
        /* ===== ДВИЖОК «ГЛАЗА» (только анализ, без действий!) ===== */
    class RunEngine {
        constructor({ eventBus, state, logger, adapter, delay }) {
            this.eventBus = eventBus; this.state = state; this.logger = logger;
            this.adapter = adapter; this.delay = delay;
            this.isBusy = false;
        }
        // Анализ ТЕКУЩЕЙ лошади на странице — главное действие MVP
        async analyzeCurrent() {
            const pageInfo = this.adapter.getPageInfo();
            if (pageInfo.pageType !== PageType.HORSE) {
                this.logger.warn('Это не страница лошади — открой карточку лошади для анализа', pageInfo);
                return null;
            }
            const horse = this.adapter.analyzeHorse();
            this.state.markHorseAnalyzed(horse);
            this.logHorse(horse);
            return horse;
        }
        // Красивый вывод параметров лошади в лог
        logHorse(horse) {
            const parts = [];
            if (horse.energy != null) parts.push(`⚡ Энергия ${horse.energy}%`);
            if (horse.health != null) parts.push(`❤️ Здоровье ${horse.health}%`);
            if (horse.mood != null) parts.push(`😊 Настроение ${horse.mood}%`);
            if (horse.age) parts.push(`🎂 ${horse.age}`);
            if (horse.sex) parts.push(`⚧ ${horse.sex}`);
            if (horse.food) parts.push(`🥕 Корм ${horse.food.raw} (не хватает ${horse.food.remaining})`);
            if (horse.mission) parts.push(`🎯 ${horse.mission}`);
            this.logger.success(`Проанализирована лошадь: ${horse.name || '—'}`, { horse });
            if (parts.length) this.logger.info(parts.join('  •  '));
            else this.logger.warn('Параметры не распознаны — пришли скрин раздела «Разработчик» 🙏');
        }
        // Запуск «прогона»: MVP анализирует текущую лошадь (без переходов и действий!)
        async start() {
            if (this.isBusy) return;
            this.isBusy = true;
            this.state.start(1);
            this.logger.info('▶️ Старт анализа (режим «Глаза»: только читаем, не действуем)');
            try {
                await this.delay.random(400, 800);
                const horse = await this.analyzeCurrent();
                if (horse) this.state.done('Анализ завершён 👁️');
                else this.state.stop('Нет данных для анализа');
            } catch (error) {
                this.logger.error(`Ошибка анализа: ${error.message}`, { stack: error.stack });
                this.state.error(error.message);
            } finally {
                this.isBusy = false;
            }
        }
        pause() { this.state.pause(); this.logger.warn('⏸ Пауза'); }
        resume() { this.state.resume(); this.logger.info('▶️ Продолжаем'); }
        stop() { this.state.stop('Остановлено'); this.logger.warn('⏹ Остановлено'); this.isBusy = false; }
        softStop() { this.state.requestSoftStop(); this.logger.info('Остановимся после текущей лошади'); }
    }

    /* ===== СЛОВАРЬ ТЕКСТОВ (центр локализации) ===== */
    const T = {
        statusTitle: {
            [AppStatus.IDLE]: 'Готов к работе 🙂',
            [AppStatus.RUNNING]: 'Работаем! Всё идёт по плану 😊',
            [AppStatus.PAUSED]: 'Пауза ⏸',
            [AppStatus.STOPPED]: 'Остановлено',
            [AppStatus.DONE]: 'Готово! Всё выполнено 🎉',
            [AppStatus.ERROR]: 'Возникла ошибка 🚩',
        },
        placeholder: 'В этом разделе в будущем появится новый функционал. Мы уже над ним думаем! ✨',
    };

    /* ===== СТИЛИ ===== */
    const STYLES = `
    #${APP.id}-root, #${APP.id}-root * { box-sizing: border-box; }
    #${APP.id}-root {
        --bg: #0f1120; --bg2: #171a2e; --card: #1b1f38; --card2: #20254191;
        --text: #eef1ff; --muted: #9aa3c7; --accent: #7c5cff; --accent2: #9d7bff;
        --ok: #34d399; --warn: #fbbf24; --err: #f87171; --info: #60a5fa;
        --border: #2a2f52; --radius: 18px; --shadow: 0 20px 50px rgba(0,0,0,.45);
        position: fixed; top: 40px; right: 40px; width: 860px; max-width: calc(100vw - 40px);
        height: 620px; max-height: calc(100vh - 60px);
        z-index: 2147483000; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        color: var(--text); border-radius: var(--radius); overflow: hidden;
        box-shadow: var(--shadow); border: 1px solid var(--border);
        background: linear-gradient(150deg, #0f1120 0%, #171a2e 55%, #1a1d38 100%);
        display: flex; flex-direction: column; animation: hm-fade .25s ease;
    }
    #${APP.id}-root[data-theme="light"] {
        --bg: #f3f4fb; --bg2: #e9ebf7; --card: #ffffff; --card2: #f6f7fd;
        --text: #1e2340; --muted: #6b7192; --border: #e2e5f2; --shadow: 0 20px 50px rgba(60,60,120,.18);
        background: linear-gradient(150deg, #f6f7fd 0%, #eef0fb 55%, #e9ebf9 100%);
    }
    #${APP.id}-root[data-compact="true"] { width: 700px; height: 560px; }
    @keyframes hm-fade { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }

    #${APP.id}-root .hm-body { display: flex; flex: 1; min-height: 0; }
    #${APP.id}-root .hm-drag { cursor: move; }

    /* Меню */
    #${APP.id}-root .hm-sidebar {
        width: 234px; min-width: 234px; padding: 20px 14px; display: flex; flex-direction: column; gap: 6px;
        background: rgba(255,255,255,.02); border-right: 1px solid var(--border);
    }
    #${APP.id}-root .hm-brand { display: flex; align-items: center; gap: 12px; padding: 6px 8px 16px; }
    #${APP.id}-root .hm-brand-logo { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center;
        font-size: 24px; background: linear-gradient(135deg, var(--accent), var(--accent2)); box-shadow: 0 8px 20px rgba(124,92,255,.4); }
    #${APP.id}-root .hm-brand-name { font-weight: 700; font-size: 16px; }
    #${APP.id}-root .hm-brand-ver { font-size: 12px; color: var(--muted); }
    #${APP.id}-root .hm-nav { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; flex: 1; }
    #${APP.id}-root .hm-nav-item {
        display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 12px;
        cursor: pointer; color: var(--muted); font-size: 14.5px; transition: .15s; border: 1px solid transparent; user-select: none;
    }
    #${APP.id}-root .hm-nav-item:hover { background: rgba(124,92,255,.10); color: var(--text); }
    #${APP.id}-root .hm-nav-item.active { background: linear-gradient(120deg, rgba(124,92,255,.28), rgba(157,123,255,.14));
        color: var(--text); border-color: rgba(124,92,255,.4); font-weight: 600; }
    #${APP.id}-root .hm-nav-item .hm-ic { font-size: 17px; width: 22px; text-align: center; }
    #${APP.id}-root .hm-nav-item .hm-lock { margin-left: auto; font-size: 11px; opacity: .6; }
    #${APP.id}-root .hm-foot { display: flex; align-items: center; gap: 8px; padding: 12px 8px 2px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--border); margin-top: 6px; }
    #${APP.id}-root .hm-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
    #${APP.id}-root .hm-dot.on { background: var(--ok); box-shadow: 0 0 8px var(--ok); }

    /* Правая часть */
    #${APP.id}-root .hm-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    #${APP.id}-root .hm-header { display: flex; align-items: center; gap: 14px; padding: 18px 24px; border-bottom: 1px solid var(--border); }
    #${APP.id}-root .hm-title { font-size: 22px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
    #${APP.id}-root .hm-header-actions { margin-left: auto; display: flex; gap: 8px; }
    #${APP.id}-root .hm-icon-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border);
        background: var(--card2); color: var(--text); cursor: pointer; font-size: 16px; display: grid; place-items: center; transition: .15s; }
    #${APP.id}-root .hm-icon-btn:hover { background: rgba(124,92,255,.18); }
    #${APP.id}-root .hm-content { flex: 1; overflow-y: auto; padding: 22px 24px; }

    /* Карточки */
    #${APP.id}-root .hm-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
        padding: 20px 22px; margin-bottom: 18px; }
    #${APP.id}-root .hm-card-title { font-size: 15px; font-weight: 700; margin-bottom: 16px; color: var(--text); }
    #${APP.id}-root .hm-grid2 { display: grid; grid-template-columns: 1.2fr .9fr; gap: 18px; }
    @media (max-width: 760px) { #${APP.id}-root .hm-grid2 { grid-template-columns: 1fr; } }

    /* Статус */
    #${APP.id}-root .hm-status-big { font-size: 21px; font-weight: 700; margin-bottom: 4px; }
    #${APP.id}-root .hm-status-sub { color: var(--muted); font-size: 13px; margin-bottom: 18px; }
    #${APP.id}-root .hm-status-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px;
        font-size: 13px; font-weight: 600; background: var(--card2); border: 1px solid var(--border); }
    #${APP.id}-root .hm-status-badge.running { color: var(--ok); border-color: rgba(52,211,153,.4); }
    #${APP.id}-root .hm-status-badge.paused { color: var(--warn); border-color: rgba(251,191,36,.4); }
    #${APP.id}-root .hm-status-badge.error { color: var(--err); border-color: rgba(248,113,113,.4); }

    /* Прогрессбар */
    #${APP.id}-root .hm-progress-head { display: flex; justify-content: space-between; font-size: 13px; color: var(--muted); margin: 16px 0 8px; }
    #${APP.id}-root .hm-progress-pct { color: var(--text); font-weight: 700; }
    #${APP.id}-root .hm-progress-track { height: 14px; border-radius: 999px; background: var(--card2); overflow: hidden; border: 1px solid var(--border); }
    #${APP.id}-root .hm-progress-fill { height: 100%; border-radius: 999px; width: 0%; transition: width .5s ease;
        background: linear-gradient(90deg, var(--accent), var(--accent2)); position: relative; overflow: hidden; }
    #${APP.id}-root .hm-progress-fill::after { content: ''; position: absolute; inset: 0;
        background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.35) 50%, transparent 70%);
        animation: hm-shine 1.8s linear infinite; }
    @keyframes hm-shine { from { transform: translateX(-100%); } to { transform: translateX(100%); } }

    /* Плитки */
    #${APP.id}-root .hm-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 18px; }
    #${APP.id}-root .hm-tile { background: var(--card2); border: 1px solid var(--border); border-radius: 14px; padding: 14px; text-align: center; }
    #${APP.id}-root .hm-tile-ic { font-size: 20px; }
    #${APP.id}-root .hm-tile-num { font-size: 22px; font-weight: 800; margin: 4px 0 2px; }
    #${APP.id}-root .hm-tile-lbl { font-size: 12px; color: var(--muted); }

    /* Кнопки (компактные, аккуратные — как просила Лиля) */
    #${APP.id}-root .hm-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 6px; }
    #${APP.id}-root .hm-btn { padding: 9px 18px; border-radius: 11px; border: 1px solid var(--border); background: var(--card2);
        color: var(--text); font-size: 13.5px; font-weight: 600; cursor: pointer; transition: .15s; }
    #${APP.id}-root .hm-btn:hover { transform: translateY(-1px); }
    #${APP.id}-root .hm-btn:disabled { opacity: .4; cursor: not-allowed; transform: none; }
    #${APP.id}-root .hm-btn.primary { background: linear-gradient(135deg, var(--accent), var(--accent2)); border-color: transparent;
        box-shadow: 0 8px 18px rgba(124,92,255,.35); }
    #${APP.id}-root .hm-btn.danger { color: var(--err); border-color: rgba(248,113,113,.4); }
    #${APP.id}-root .hm-btn.ghost { background: transparent; color: var(--muted); border-color: transparent; }
    #${APP.id}-root .hm-btn.ghost:hover { color: var(--text); }

    /* Лог */
    #${APP.id}-root .hm-log-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    #${APP.id}-root .hm-log { display: flex; flex-direction: column; gap: 2px; max-height: 300px; overflow-y: auto; }
    #${APP.id}-root .hm-log-row { display: flex; gap: 12px; padding: 9px 10px; border-radius: 10px; font-size: 13px; align-items: flex-start; }
    #${APP.id}-root .hm-log-row:hover { background: rgba(255,255,255,.03); }
    #${APP.id}-root .hm-log-time { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 62px; font-size: 12px; padding-top: 1px; }
    #${APP.id}-root .hm-log-ic { width: 18px; }
    #${APP.id}-root .hm-log-msg { flex: 1; }
    #${APP.id}-root .hm-log-row.success .hm-log-msg { color: var(--ok); }
    #${APP.id}-root .hm-log-row.warn .hm-log-msg { color: var(--warn); }
    #${APP.id}-root .hm-log-row.error .hm-log-msg { color: var(--err); }
    #${APP.id}-root .hm-log-empty { color: var(--muted); font-size: 13px; text-align: center; padding: 24px; }

    /* Поля / настройки */
    #${APP.id}-root .hm-field { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 13px 0; border-bottom: 1px solid var(--border); }
    #${APP.id}-root .hm-field:last-child { border-bottom: none; }
    #${APP.id}-root .hm-field-lbl { font-size: 14px; }
    #${APP.id}-root select, #${APP.id}-root input[type="text"] { background: var(--card2); color: var(--text);
        border: 1px solid var(--border); border-radius: 9px; padding: 8px 12px; font-size: 13px; min-width: 150px; }
    #${APP.id}-root .hm-switch { width: 46px; height: 26px; border-radius: 999px; background: var(--card2); border: 1px solid var(--border);
        position: relative; cursor: pointer; transition: .2s; }
    #${APP.id}-root .hm-switch.on { background: linear-gradient(135deg, var(--accent), var(--accent2)); border-color: transparent; }
    #${APP.id}-root .hm-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px;
        border-radius: 50%; background: #fff; transition: .2s; }
    #${APP.id}-root .hm-switch.on::after { left: 22px; }

    /* Заглушки */
    #${APP.id}-root .hm-empty { text-align: center; padding: 60px 20px; color: var(--muted); }
    #${APP.id}-root .hm-empty-ic { font-size: 48px; margin-bottom: 16px; }
    #${APP.id}-root .hm-empty-title { font-size: 18px; font-weight: 700; color: var(--text); margin-bottom: 8px; }

    /* Разработчик */
    #${APP.id}-root .hm-kv { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    #${APP.id}-root .hm-kv-k { color: var(--muted); min-width: 150px; }
    #${APP.id}-root .hm-kv-v { color: var(--text); word-break: break-word; }
    #${APP.id}-root .hm-kv-v.ok { color: var(--ok); }
    #${APP.id}-root .hm-kv-v.bad { color: var(--err); }
    #${APP.id}-root pre.hm-pre { background: var(--card2); border: 1px solid var(--border); border-radius: 10px; padding: 12px;
        font-size: 11.5px; overflow-x: auto; max-height: 220px; color: var(--muted); white-space: pre-wrap; }

    /* Кнопка-открывашка */
    #${APP.id}-fab { position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px; border-radius: 50%;
        background: linear-gradient(135deg, #7c5cff, #9d7bff); color: #fff; font-size: 26px; border: none; cursor: pointer;
        box-shadow: 0 12px 28px rgba(124,92,255,.5); z-index: 2147483000; display: grid; place-items: center; transition: .2s; }
    #${APP.id}-fab:hover { transform: scale(1.08); }
    `;

    // 👉 ПРОДОЛЖЕНИЕ В ЧАСТИ 3
        /* ===== ИНТЕРФЕЙС ===== */
    class UIManager {
        constructor(ctx) {
            this.eventBus = ctx.eventBus; this.state = ctx.state; this.settings = ctx.settings;
            this.logger = ctx.logger; this.engine = ctx.engine; this.adapter = ctx.adapter; this.storage = ctx.storage;
            this.root = null; this.fab = null;
            this.activeSection = this.storage.get('ui:section', 'home');
            this.isOpen = this.storage.get('ui:open', true);
        }
        init() {
            this.injectStyles();
            this.buildFab();
            this.buildRoot();
            this.applyTheme();
            this.renderSection();
            this.setOpen(this.isOpen);
            // Подписки на изменения — интерфейс сам обновляется
            this.eventBus.on('state:changed', () => this.refreshDynamic());
            this.eventBus.on('log:changed', () => this.refreshLog());
            this.eventBus.on('settings:changed', () => { this.applyTheme(); if (this.activeSection === 'developer') this.renderSection(); });
        }
        injectStyles() {
            if (document.getElementById(`${APP.id}-styles`)) return;
            const style = document.createElement('style');
            style.id = `${APP.id}-styles`; style.textContent = STYLES;
            document.head.appendChild(style);
        }
        buildFab() {
            this.fab = document.createElement('button');
            this.fab.id = `${APP.id}-fab`; this.fab.textContent = '🐴'; this.fab.title = `${APP.name} v${APP.version}`;
            this.fab.addEventListener('click', () => this.setOpen(true));
            document.body.appendChild(this.fab);
        }
        buildRoot() {
            this.root = document.createElement('div');
            this.root.id = `${APP.id}-root`;
            this.root.innerHTML = `
                <div class="hm-body">
                    <aside class="hm-sidebar">
                        <div class="hm-brand hm-drag">
                            <div class="hm-brand-logo">🐴</div>
                            <div><div class="hm-brand-name">${APP.name}</div><div class="hm-brand-ver">v${APP.version}</div></div>
                        </div>
                        <nav class="hm-nav">${MENU.map((m) => `
                            <div class="hm-nav-item" data-section="${m.id}">
                                <span class="hm-ic">${m.icon}</span><span>${m.label}</span>
                                ${m.ready ? '' : '<span class="hm-lock">🔒</span>'}
                            </div>`).join('')}
                        </nav>
                        <div class="hm-foot">
                            <span class="hm-dot" data-role="dot"></span>
                            <span data-role="foot-status">Готов</span>
                            <span style="margin-left:auto">v${APP.version}</span>
                        </div>
                    </aside>
                    <div class="hm-main">
                        <header class="hm-header hm-drag">
                            <div class="hm-title" data-role="title">🏠 Главная</div>
                            <div class="hm-header-actions">
                                <button class="hm-icon-btn" data-role="theme" title="Сменить тему">🌙</button>
                                <button class="hm-icon-btn" data-role="minimize" title="Свернуть">—</button>
                            </div>
                        </header>
                        <div class="hm-content" data-role="content"></div>
                    </div>
                </div>`;
            document.body.appendChild(this.root);

            // Навигация
            this.root.querySelectorAll('.hm-nav-item').forEach((el) => {
                el.addEventListener('click', () => { this.activeSection = el.dataset.section; this.storage.set('ui:section', this.activeSection); this.renderSection(); });
            });
            this.root.querySelector('[data-role="theme"]').addEventListener('click', () => this.toggleTheme());
            this.root.querySelector('[data-role="minimize"]').addEventListener('click', () => this.setOpen(false));
            this.enableDrag();
        }
        enableDrag() {
            let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
            const onDown = (e) => {
                if (e.target.closest('button, input, select, .hm-nav-item')) return;
                dragging = true; const rect = this.root.getBoundingClientRect();
                sx = e.clientX; sy = e.clientY; ox = rect.left; oy = rect.top;
                this.root.style.right = 'auto'; this.root.style.left = `${ox}px`; this.root.style.top = `${oy}px`;
                e.preventDefault();
            };
            const onMove = (e) => { if (!dragging) return; this.root.style.left = `${ox + e.clientX - sx}px`; this.root.style.top = `${oy + e.clientY - sy}px`; };
            const onUp = () => { dragging = false; };
            this.root.querySelectorAll('.hm-drag').forEach((el) => el.addEventListener('mousedown', onDown));
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }
        setOpen(open) {
            this.isOpen = open; this.storage.set('ui:open', open);
            this.root.style.display = open ? 'flex' : 'none';
            this.fab.style.display = open ? 'none' : 'grid';
        }
        applyTheme() {
            let theme = this.settings.get('appearance', 'theme');
            if (theme === 'auto') theme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
            this.root.setAttribute('data-theme', theme);
            this.root.setAttribute('data-compact', String(Boolean(this.settings.get('appearance', 'compactMode'))));
            const btn = this.root.querySelector('[data-role="theme"]');
            if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
        }
        toggleTheme() {
            const current = this.root.getAttribute('data-theme');
            this.settings.set('appearance', 'theme', current === 'light' ? 'dark' : 'light');
        }
        setActiveNav() {
            this.root.querySelectorAll('.hm-nav-item').forEach((el) => el.classList.toggle('active', el.dataset.section === this.activeSection));
            const menu = MENU.find((m) => m.id === this.activeSection);
            if (menu) this.root.querySelector('[data-role="title"]').innerHTML = `${menu.icon} ${menu.label}`;
        }
        renderSection() {
            this.setActiveNav();
            const content = this.root.querySelector('[data-role="content"]');
            const menu = MENU.find((m) => m.id === this.activeSection);
            if (!menu.ready) { content.innerHTML = this.renderPlaceholder(menu); return; }
            const renderers = {
                home: () => this.renderHome(), run: () => this.renderRun(), stats: () => this.renderStats(),
                settings: () => this.renderSettings(), about: () => this.renderAbout(), developer: () => this.renderDeveloper(),
            };
            content.innerHTML = (renderers[this.activeSection] || (() => this.renderPlaceholder(menu)))();
            this.bindSectionEvents();
            this.refreshLog();
        }
        renderPlaceholder(menu) {
            return `<div class="hm-empty"><div class="hm-empty-ic">${menu.icon}</div>
                <div class="hm-empty-title">Раздел «${menu.label}»</div><div>${T.placeholder}</div></div>`;
        }
        // ГЛАВНАЯ
        renderHome() {
            return `
            <div class="hm-grid2">
                <div class="hm-card">
                    <div class="hm-card-title">Состояние</div>
                    <div class="hm-status-big" data-role="status-title">${T.statusTitle[AppStatus.IDLE]}</div>
                    <div class="hm-status-sub" data-role="status-sub">Лошадь: — • Операция: Ожидание</div>
                    <span class="hm-status-badge" data-role="status-badge">● Ожидание</span>
                    <div class="hm-progress-head"><span>Прогресс</span><span class="hm-progress-pct" data-role="pct">0%</span></div>
                    <div class="hm-progress-track"><div class="hm-progress-fill" data-role="fill"></div></div>
                    <div class="hm-tiles">
                        <div class="hm-tile"><div class="hm-tile-ic">✅</div><div class="hm-tile-num" data-role="t-done">0</div><div class="hm-tile-lbl">Выполнено</div></div>
                        <div class="hm-tile"><div class="hm-tile-ic">🔄</div><div class="hm-tile-num" data-role="t-proc">0</div><div class="hm-tile-lbl">В процессе</div></div>
                        <div class="hm-tile"><div class="hm-tile-ic">📋</div><div class="hm-tile-num" data-role="t-left">0</div><div class="hm-tile-lbl">Осталось</div></div>
                    </div>
                    <div class="hm-controls" style="margin-top:20px">
                        <button class="hm-btn primary" data-act="start">Старт</button>
                        <button class="hm-btn" data-act="pause">Пауза</button>
                        <button class="hm-btn" data-act="resume">Продолжить</button>
                        <button class="hm-btn danger" data-act="stop">Стоп</button>
                        <button class="hm-btn ghost" data-act="soft">Остановить после текущей</button>
                    </div>
                </div>
                <div class="hm-card">
                    <div class="hm-card-title">👁️ Режим «Глаза» (v${APP.version})</div>
                    <div style="color:var(--muted);font-size:13.5px;line-height:1.6">
                        Сейчас приложение работает в безопасном режиме: <b style="color:var(--text)">только смотрит и записывает</b>, но <b style="color:var(--text)">ничего не нажимает</b> в игре.<br><br>
                        Открой карточку лошади и нажми <b style="color:var(--accent2)">«Старт»</b> — я прочитаю её параметры и запишу в лог. 😊
                    </div>
                </div>
            </div>
            ${this.renderLogCard()}`;
        }
        // ПРОГОН
        renderRun() {
            const info = this.adapter.getPageInfo();
            return `
            <div class="hm-card">
                <div class="hm-card-title">🐴 Прогон табуна (чтение)</div>
                <div style="color:var(--muted);font-size:13.5px;line-height:1.6;margin-bottom:16px">
                    В версии ${APP.version} прогон <b style="color:var(--text)">только анализирует</b> текущую лошадь. Переходы и действия появятся позже.
                </div>
                <div class="hm-kv"><span class="hm-kv-k">Текущая страница</span><span class="hm-kv-v ${info.pageType === PageType.HORSE ? 'ok' : 'bad'}">${info.pageTypeLabel}</span></div>
                <div class="hm-kv"><span class="hm-kv-k">Кнопка «следующая»</span><span class="hm-kv-v" data-role="run-next">проверяется…</span></div>
                <div class="hm-controls" style="margin-top:18px">
                    <button class="hm-btn primary" data-act="analyze">Анализировать лошадь</button>
                    <button class="hm-btn ghost" data-act="goto-dev">Открыть Разработчик</button>
                </div>
            </div>
            ${this.renderLogCard()}`;
        }
        // СТАТИСТИКА
        renderStats() {
            const s = this.state.get();
            return `<div class="hm-card"><div class="hm-card-title">📊 Статистика сессии</div>
                <div class="hm-kv"><span class="hm-kv-k">Проанализировано лошадей</span><span class="hm-kv-v">${s.stats.analyzed}</span></div>
                <div class="hm-kv"><span class="hm-kv-k">Ошибок</span><span class="hm-kv-v ${s.stats.errors ? 'bad' : ''}">${s.stats.errors}</span></div>
                <div class="hm-kv"><span class="hm-kv-k">Последняя лошадь</span><span class="hm-kv-v">${s.currentHorseName}</span></div>
                <div class="hm-kv"><span class="hm-kv-k">Записей в логе</span><span class="hm-kv-v">${this.logger.all().length}</span></div>
            </div>
            <div class="hm-card"><div class="hm-card-title">Скоро здесь появится</div>
                <div style="color:var(--muted);font-size:13.5px;line-height:1.6">Графики, история кормления, статистика по КСК и породам. ✨</div>
            </div>`;
        }
        // НАСТРОЙКИ
        renderSettings() {
            const sections = settingsSchema.map((sec) => `
                <div class="hm-card"><div class="hm-card-title">${sec.title}</div>
                    <div style="color:var(--muted);font-size:12.5px;margin-bottom:8px">${sec.description}</div>
                    ${sec.fields.map((f) => {
                        const val = this.settings.get(sec.id, f.id);
                        let control = '';
                        if (f.type === 'checkbox') control = `<div class="hm-switch ${val ? 'on' : ''}" data-set="${sec.id}.${f.id}" data-type="checkbox"></div>`;
                        else if (f.type === 'select') control = `<select data-set="${sec.id}.${f.id}" data-type="select">${f.options.map((o) => `<option value="${o.value}" ${o.value === val ? 'selected' : ''}>${o.label}</option>`).join('')}</select>`;
                        return `<div class="hm-field"><span class="hm-field-lbl">${f.label}</span>${control}</div>`;
                    }).join('')}
                </div>`).join('');
            return `${sections}<div class="hm-card"><div class="hm-controls"><button class="hm-btn danger" data-act="reset-settings">Сбросить настройки</button></div></div>`;
        }
        // О ПРОЕКТЕ
        renderAbout() {
            return `<div class="hm-card"><div class="hm-card-title">ℹ️ О проекте</div>
                <div style="line-height:1.8;font-size:14px">
                    <b>${APP.name}</b> v${APP.version}<br>
                    Умный помощник для игры <b>Ловади</b>. 🐴<br><br>
                    <span style="color:var(--muted)">Текущая версия — MVP «Глаза»: приложение учится правильно видеть данные лошади. Действия (кормление, уход, прогон) добавим на следующих шагах — аккуратно и по одному.</span><br><br>
                    GitHub: <span style="color:var(--accent2)">less-exe/HowrseManager</span>
                </div>
            </div>
            <div class="hm-card"><div class="hm-card-title">🔒 Безопасность</div>
                <div style="color:var(--muted);font-size:13.5px;line-height:1.7">Всё работает локально в твоём браузере. Никакие данные никуда не отправляются. Настройки хранятся только у тебя.</div>
            </div>`;
        }
        // РАЗРАБОТЧИК
        renderDeveloper() {
            const info = this.adapter.getPageInfo();
            const horse = info.pageType === PageType.HORSE ? this.adapter.analyzeHorse() : null;
            const yn = (v) => v ? '<span class="hm-kv-v ok">✅ найдено</span>' : '<span class="hm-kv-v bad">❌ не найдено</span>';
            const horseRows = horse ? `
                <div class="hm-kv"><span class="hm-kv-k">Имя</span>${yn(horse.name && horse.name !== '—')} <span class="hm-kv-v">${horse.name || ''}</span></div>
                <div class="hm-kv"><span class="hm-kv-k">Энергия</span>${horse.energy != null ? `<span class="hm-kv-v ok">${horse.energy}%</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Здоровье</span>${horse.health != null ? `<span class="hm-kv-v ok">${horse.health}%</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Настроение</span>${horse.mood != null ? `<span class="hm-kv-v ok">${horse.mood}%</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Возраст</span>${horse.age ? `<span class="hm-kv-v ok">${horse.age}</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Пол</span>${horse.sex ? `<span class="hm-kv-v ok">${horse.sex}</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Корм</span>${horse.food ? `<span class="hm-kv-v ok">${horse.food.raw} (не хватает ${horse.food.remaining})</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Миссия/урок</span>${horse.mission ? `<span class="hm-kv-v ok">${horse.mission}</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Кнопка «следующая»</span>${yn(horse.hasNextHorseButton)} <span class="hm-kv-v">${horse.nextHorseButtonSelector || ''}</span></div>
                <div style="margin-top:14px;color:var(--muted);font-size:12px">Образец текста страницы:</div>
                <pre class="hm-pre">${(horse.pageTextSample || '').replace(/</g, '&lt;')}</pre>` : '<div style="color:var(--muted);font-size:13px;padding:8px 0">Открой карточку лошади, чтобы увидеть анализ данных. 🐴</div>';
            return `
            <div class="hm-card">
                <div class="hm-card-title">🧑‍💻 Диагностика страницы</div>
                <div class="hm-kv"><span class="hm-kv-k">Адаптер</span><span class="hm-kv-v ${info.supported ? 'ok' : 'bad'}">${info.adapter} ${info.supported ? '(поддерживается)' : ''}</span></div>
                <div class="hm-kv"><span class="hm-kv-k">Тип страницы</span><span class="hm-kv-v">${info.pageTypeLabel}</span></div>
                <div class="hm-kv"><span class="hm-kv-k">Адрес</span><span class="hm-kv-v">${info.url}</span></div>
                <div class="hm-controls" style="margin-top:16px">
                    <button class="hm-btn primary" data-act="dev-refresh">🔄 Обновить анализ</button>
                    <button class="hm-btn" data-act="dev-copy">📋 Скопировать отчёт</button>
                </div>
            </div>
            <div class="hm-card"><div class="hm-card-title">🐴 Что нашлось на карточке лошади</div>${horseRows}</div>
            ${this.renderLogCard()}`;
        }
        renderLogCard() {
            return `<div class="hm-card"><div class="hm-log-head"><div class="hm-card-title" style="margin:0">Лог</div>
                <button class="hm-btn ghost" data-act="clear-log">Очистить</button></div>
                <div class="hm-log" data-role="log"></div></div>`;
        }
        bindSectionEvents() {
            const content = this.root.querySelector('[data-role="content"]');
            content.querySelectorAll('[data-act]').forEach((el) => {
                el.addEventListener('click', () => this.handleAction(el.dataset.act));
            });
            content.querySelectorAll('[data-set]').forEach((el) => {
                const [sec, field] = el.dataset.set.split('.');
                if (el.dataset.type === 'checkbox') el.addEventListener('click', () => { const nv = !el.classList.contains('on'); el.classList.toggle('on', nv); this.settings.set(sec, field, nv); });
                else if (el.dataset.type === 'select') el.addEventListener('change', () => this.settings.set(sec, field, el.value));
            });
            // Показать статус кнопки «следующая» на Прогоне
            const runNext = content.querySelector('[data-role="run-next"]');
            if (runNext) { const has = Boolean(this.adapter.findNextHorseButton()); runNext.innerHTML = has ? '<span style="color:var(--ok)">✅ найдена</span>' : '<span style="color:var(--err)">❌ не найдена</span>'; }
        }
        handleAction(act) {
            switch (act) {
                case 'start': this.engine.start(); break;
                case 'pause': this.engine.pause(); break;
                case 'resume': this.engine.resume(); break;
                case 'stop': this.engine.stop(); break;
                case 'soft': this.engine.softStop(); break;
                case 'analyze': this.engine.analyzeCurrent(); break;
                case 'goto-dev': this.activeSection = 'developer'; this.storage.set('ui:section', 'developer'); this.renderSection(); break;
                case 'clear-log': this.logger.clear(); break;
                case 'reset-settings': this.settings.reset(); this.renderSection(); this.logger.info('Настройки сброшены'); break;
                case 'dev-refresh': this.renderSection(); this.logger.info('Анализ страницы обновлён'); break;
                case 'dev-copy': this.copyReport(); break;
            }
        }
        copyReport() {
            const info = this.adapter.getPageInfo();
            const horse = info.pageType === PageType.HORSE ? this.adapter.analyzeHorse() : null;
            const report = { app: `${APP.name} v${APP.version}`, page: info, horse, log: this.logger.all().slice(0, 20) };
            const text = JSON.stringify(report, null, 2);
            navigator.clipboard?.writeText(text).then(
                () => this.logger.success('Отчёт скопирован — можно прислать разработчику 📋'),
                () => this.logger.warn('Не удалось скопировать. Скопируй вручную из образца текста.')
            );
        }

        // Динамическое обновление Главной
        refreshDynamic() {
            const s = this.state.get();
            const dot = this.root.querySelector('[data-role="dot"]');
            const footStatus = this.root.querySelector('[data-role="foot-status"]');
            const running = s.status === AppStatus.RUNNING;
            if (dot) dot.classList.toggle('on', running);
            if (footStatus) footStatus.textContent = T.statusTitle[s.status] || 'Готов';

            // Обновляем блоки только если открыта Главная
            if (this.activeSection !== 'home') return;
            const set = (role, value) => { const el = this.root.querySelector(`[data-role="${role}"]`); if (el) el.textContent = value; };
            set('status-title', T.statusTitle[s.status] || '—');
            set('status-sub', `Лошадь: ${s.currentHorseName} • Операция: ${s.currentOperation}`);

            const badge = this.root.querySelector('[data-role="status-badge"]');
            if (badge) {
                const map = { [AppStatus.RUNNING]: 'running', [AppStatus.PAUSED]: 'paused', [AppStatus.ERROR]: 'error' };
                badge.className = `hm-status-badge ${map[s.status] || ''}`;
                badge.textContent = `● ${s.currentOperation}`;
            }

            const total = s.progress.total || 0, current = s.progress.current || 0;
            const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : (s.status === AppStatus.DONE ? 100 : 0);
            set('pct', `${pct}%`);
            const fill = this.root.querySelector('[data-role="fill"]');
            if (fill) fill.style.width = `${pct}%`;

            set('t-done', s.stats.analyzed);
            set('t-proc', running ? 1 : 0);
            set('t-left', Math.max(0, total - current));
        }
        // Обновление лога
        refreshLog() {
            const box = this.root.querySelector('[data-role="log"]');
            if (!box) return;
            const items = this.logger.all();
            if (!items.length) { box.innerHTML = `<div class="hm-log-empty">Лог пуст. Нажми «Старт» или «Анализировать лошадь» 🐴</div>`; return; }
            const icons = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '🚩' };
            box.innerHTML = items.map((it) => `
                <div class="hm-log-row ${it.level}">
                    <span class="hm-log-time">${it.time}</span>
                    <span class="hm-log-ic">${icons[it.level] || 'ℹ️'}</span>
                    <span class="hm-log-msg">${String(it.message).replace(/</g, '&lt;')}</span>
                </div>`).join('');
        }
    }

    /* ===== СБОРКА ПРИЛОЖЕНИЯ ===== */
    class Application {
        constructor() {
            this.eventBus = new EventBus();
            this.storage = new Storage(APP.storagePrefix);
            this.logger = new Logger(this.eventBus, this.storage);
            this.settings = new SettingsManager(this.eventBus, this.storage, settingsSchema);
            this.state = new StateManager(this.eventBus, this.storage);
            this.delay = new DelayManager();
            this.route = new RouteManager();
            this.adapter = AdapterFactory.create(this.route);
            this.engine = new RunEngine({
                eventBus: this.eventBus, state: this.state, logger: this.logger,
                adapter: this.adapter, delay: this.delay,
            });
            this.ui = new UIManager({
                eventBus: this.eventBus, state: this.state, settings: this.settings,
                logger: this.logger, engine: this.engine, adapter: this.adapter, storage: this.storage,
            });
        }
        start() {
            const info = this.adapter.getPageInfo();
            this.state.patch({ pageType: info.pageType });
            this.ui.init();
            this.logger.info(`${APP.name} v${APP.version} запущен ✨`);
            this.logger.info(`Определена страница: ${info.pageTypeLabel}`);
            if (!info.supported) this.logger.warn('Этот сайт не является Ловади — работаю в ограниченном режиме');
            this.ui.refreshDynamic();
        }
    }

    /* ===== ЗАПУСК ===== */
    function boot() {
        try {
            if (window.top !== window.self) return; // не запускаемся во фреймах
            if (document.getElementById(`${APP.id}-root`)) return; // защита от повторного запуска
            const app = new Application();
            app.start();
            window.__howrseManager = app; // для отладки в консоли
        } catch (error) {
            console.error(`[${APP.name}] Boot failed`, error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
