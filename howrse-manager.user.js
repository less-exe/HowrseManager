// ==UserScript==
// @name         Howrse Manager
// @namespace    https://github.com/less-exe/HowrseManager
// @version      0.2.1
// @description  Умный менеджер-ассистент для Ловади / Howrse. MVP «Глаза»: анализ лошади и красивый интерфейс (без действий).
// @author       less-exe
// @match        https://www.lowadi.com/*
// @match        http://www.lowadi.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /* ===== КОНСТАНТЫ ===== */
    const APP = {
        id: 'howrse-manager',
        name: 'Howrse Manager',
        version: '0.2.1',
        storagePrefix: 'hm:',
        // Заглушка подписки. Позже подключим реальную проверку.
        subscription: { active: true, plan: 'Демо-версия', expires: '2099-01-01' },
        // Режимы скорости — читаются «мозгом» HumanizedDelay
        speedModes: {
            normal: { label: '⚡ Обычный',     base: 1200, spread: 800,  thinkChance: 0.15, thinkTime: [1500, 4000],  desc: 'Быстро. Подходит для небольших табунов.' },
            safe:   { label: '🛡️ Безопасный',  base: 3000, spread: 2500, thinkChance: 0.35, thinkTime: [3000, 9000],  desc: 'Медленнее, но максимально похоже на живого игрока. Рекомендуется.' },
            night:  { label: '🌙 Ночной',      base: 6000, spread: 5000, thinkChance: 0.5,  thinkTime: [5000, 20000], desc: 'Очень медленно, с большими паузами. Для работы в фоне.' },
        },
    };

    const PageType = Object.freeze({ HORSE: 'horse', HORSE_LIST: 'horse_list', EC: 'ec', COMPETITIONS: 'competitions', UNKNOWN: 'unknown' });
    const AppStatus = Object.freeze({ IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused', STOPPED: 'stopped', DONE: 'done', ERROR: 'error' });
    const PageLabels = {
        [PageType.HORSE]: 'Страница лошади', [PageType.HORSE_LIST]: 'Список лошадей',
        [PageType.EC]: 'КСК', [PageType.COMPETITIONS]: 'Соревнования', [PageType.UNKNOWN]: 'Неизвестная страница',
    };

    // Пункты меню. dev:true — показывается только при включённом режиме разработчика
    const MENU = [
        { id: 'home',      icon: '🏠',   label: 'Главная',     ready: true },
        { id: 'run',       icon: '🐴',   label: 'Прогон',      ready: true },
        { id: 'ksk',       icon: '🏡',   label: 'КСК',         ready: false },
        { id: 'breeding',  icon: '💕',   label: 'Разведение',  ready: false },
        { id: 'training',  icon: '🏇',   label: 'Тренировки',  ready: false },
        { id: 'profiles',  icon: '📁',   label: 'Профили',     ready: false },
        { id: 'stats',     icon: '📊',   label: 'Статистика',  ready: true },
        { id: 'settings',  icon: '⚙️',   label: 'Настройки',   ready: true },
        { id: 'about',     icon: 'ℹ️',   label: 'О проекте',   ready: true },
        { id: 'developer', icon: '🧑‍💻', label: 'Разработчик', ready: true, dev: true },
    ];

    // Схема настроек — из неё авто-строится раздел «Настройки»
    const settingsSchema = [
        {
            id: 'speed',
            title: '⏱️ Скорость и безопасность',
            description: 'Как быстро приложение работает. Чем медленнее — тем безопаснее для аккаунта.',
            fields: [
                {
                    id: 'mode', label: 'Режим скорости', type: 'select',
                    options: [
                        { value: 'normal', label: APP.speedModes.normal.label },
                        { value: 'safe',   label: APP.speedModes.safe.label },
                        { value: 'night',  label: APP.speedModes.night.label },
                    ],
                    default: 'safe',
                },
            ],
        },
        {
            id: 'advanced',
            title: '🧑‍💻 Для продвинутых',
            description: 'Дополнительные возможности. Обычным игрокам не нужны.',
            fields: [
                { id: 'devMode', label: 'Показать раздел «Разработчик»', type: 'checkbox', default: false },
            ],
        },
        {
            id: 'appearance', title: 'Внешний вид', description: 'Тема и поведение окна.',
            fields: [
                { id: 'theme', type: 'select', label: 'Тема', default: 'dark', options: [
                    { value: 'dark', label: 'Тёмная' }, { value: 'light', label: 'Светлая' }, { value: 'auto', label: 'Авто' } ] },
                { id: 'compactMode', type: 'checkbox', label: 'Компактный режим', default: false },
            ],
        },
    ];

    /* ===== ШИНА СОБЫТИЙ ===== */
    class EventBus {
        constructor() { this.listeners = new Map(); }
        on(name, cb) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(cb); return () => this.off(name, cb); }
        off(name, cb) { this.listeners.get(name)?.delete(cb); }
        emit(name, payload) { this.listeners.get(name)?.forEach((cb) => { try { cb(payload); } catch (e) { console.error(`[${APP.name}]`, e); } }); }
    }

    /* ===== ХРАНИЛИЩЕ (localStorage) ===== */
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

    /* ===== «МОЗГ» СКОРОСТИ — имитация живого игрока ===== */
    class HumanizedDelay {
        constructor(settings) { this.settings = settings; this._cancelled = false; }
        reset() { this._cancelled = false; }
        cancel() { this._cancelled = true; }
        currentMode() {
            const key = this.settings?.get('speed', 'mode') || 'safe';
            return APP.speedModes[key] || APP.speedModes.safe;
        }
        rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
        // ПРАВКА №7: добавлен метод random() — движок вызывает именно его
        random(min, max) { return this._sleep(this.rand(min, max)); }
        // Базовая пауза между действиями (с «человеческим» разбросом)
        nextDelay() {
            const m = this.currentMode();
            const jitter = this.rand(-m.spread * 0.4, m.spread);
            return Math.max(300, m.base + jitter);
        }
        // Иногда «человек задумывается» — редкая длинная пауза
        maybeThink() {
            const m = this.currentMode();
            if (Math.random() < m.thinkChance) return this.rand(m.thinkTime[0], m.thinkTime[1]);
            return 0;
        }
        async wait(extraLabel = null) {
            const base = this.nextDelay();
            const think = this.maybeThink();
            const total = base + think;
            await this._sleep(total);
            return { base, think, total, thought: think > 0, label: extraLabel };
        }
        _sleep(ms) {
            return new Promise((resolve, reject) => {
                const start = Date.now();
                const tick = () => {
                    if (this._cancelled) return reject(new Error('cancelled'));
                    if (Date.now() - start >= ms) return resolve();
                    setTimeout(tick, Math.min(120, ms));
                };
                tick();
            });
        }
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

    // 👉 ПРОДОЛЖЕНИЕ В ЧАСТИ 2
     /* ===== АДАПТЕР ЛОВАДИ — читает данные страницы ===== */
    class LowadiAdapter {
        constructor(ctx) {
            this.name = 'LowadiAdapter';
            this.route = new RouteManager();
            this.logger = ctx.logger;
        }
        // ── helpers ──
        text(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }
        num(str) { const m = String(str).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; }
        pageText() { return document.body ? this.text(document.body).slice(0, 12000) : ''; }

        getPageInfo() {
            const pageType = this.route.getCurrentPageType();
            return {
                adapter: this.name,
                supported: /lowadi\.com/i.test(location.host),
                pageType,
                pageTypeLabel: PageLabels[pageType] || PageLabels[PageType.UNKNOWN],
                url: location.href.slice(0, 120),
            };
        }
        findNextHorseButton() {
            const selectors = ['#nav-next', 'a[rel="next"]', '.suivant', '.next', 'a[href*="suivant"]', 'a[href*="next"]'];
            for (const sel of selectors) { const el = document.querySelector(sel); if (el) return { el, selector: sel }; }
            // По тексту
            const links = Array.from(document.querySelectorAll('a, button'));
            const byText = links.find((a) => /следующ|вперёд|вперед|next|→/i.test(this.text(a)));
            return byText ? { el: byText, selector: 'по тексту «следующая»' } : null;
        }

        // ── ГЛАВНОЕ: анализ лошади ──
        analyzeHorse() {
            const full = this.pageText();
            const h = {
                name: this._findName(),
                energy: this._findBar('энерги'),
                health: this._findBar('здоров'),
                mood: this._findBar('настроен'),
                age: this._findAge(full),
                sex: this._findSex(full),
                canBreed: this._findCanBreed(full),
                breed: this._findLabeled(['Порода']),
                coat: this._findLabeled(['Масть']),
                kind: this._findKind(full),        // ПРАВКА №11 — Вид
                skills: this._findSkills(),         // навыки по отдельности
                gp: this._findGP(),                 // ГП по отдельности (если доступно)
                food: this._findFood(full),
                mission: this._findMission(full),
                nextHorseButtonSelector: this.findNextHorseButton()?.selector || null,
                hasNextHorseButton: Boolean(this.findNextHorseButton()),
                pageTextSample: full.slice(0, 600),
            };
            return h;
        }

        _findName() {
            const sels = ['h1', '.nomCheval', '.horse-name', '#nomCheval', '.cheval-nom'];
            for (const s of sels) { const t = this.text(document.querySelector(s)); if (t && t.length > 1 && t.length < 80) return t; }
            const m = this.pageText().match(/([a-zа-я]?\s?\d{2,4}\/\d{2,4}\/\d{2,4}\/\d{1,3})/i);
            return m ? m[1].trim() : '—';
        }
        _findBar(word) {
            // Ищем полоски-статусы (энергия/здоровье/настроение) по title или тексту рядом
            const all = Array.from(document.querySelectorAll('[title], [data-title], .barre, .gauge, .progress'));
            for (const el of all) {
                const label = (el.getAttribute('title') || el.getAttribute('data-title') || this.text(el)).toLowerCase();
                if (label.includes(word)) { const n = this.num(label); if (n != null && n <= 100) return n; }
            }
            // Резерв: ищем "энергия ... 80%"
            const re = new RegExp(word + '[^0-9%]{0,30}(\\d{1,3})\\s*%', 'i');
            const m = this.pageText().match(re);
            return m ? parseInt(m[1], 10) : null;
        }
        _findAge(full) {
            let m = full.match(/(\d+)\s*(лет|год|года)\s*(и)?\s*(\d+)?\s*(мес)/i);
            if (m) return `${m[1]} ${m[2]}${m[4] ? ' ' + m[4] + ' мес.' : ''}`;
            m = full.match(/(несколько часов|меньше года|\d+\s*(?:лет|год|года|мес(?:яц|яцев|яца)?|дн(?:я|ей)|час))/i);
            return m ? m[0].trim() : null;
        }
        _findSex(full) {
            if (/\bкобыл/i.test(full)) return 'Женский';
            if (/\bмерин/i.test(full)) return 'Мужской (мерин)';
            if (/\bжеребец|\bжеребч/i.test(full)) return 'Мужской';
            return null;
        }
        _findCanBreed(full) {
            if (/мерин/i.test(full)) return false;       // мерин не размножается
            if (/младше 6 месяцев|жеребёнок|жеребенок/i.test(full)) return false;
            return true;
        }
        // ПРАВКА №11 — правильный «Вид»
        _findKind(full) {
            const kinds = ['Верховая лошадь', 'Верховой Пегас', 'Верховой Единорог', 'Тяжеловоз', 'Тяжеловозный Пегас',
                'Пони', 'Пони Единорог', 'Пони Пегас', 'Единорог', 'Пегас', 'Осёл', 'Осел', 'Мул', 'Лошадь'];
            const m = full.match(/Виды?\s*:?\s*([А-Яа-яЁё ]{3,40})/i);
            if (m) { const val = m[1].trim(); const hit = kinds.find((k) => val.toLowerCase().startsWith(k.toLowerCase())); if (hit) return hit; return val.split(/\s{2,}|Пол|Рост|Возраст/i)[0].trim(); }
            const found = kinds.find((k) => new RegExp('\\b' + k + '\\b', 'i').test(full));
            return found || null;
        }
        _findLabeled(labels) {
            // Ищем "Порода: Шагия", "Масть: Светло-серый"
            const full = this.pageText();
            for (const lbl of labels) {
                const re = new RegExp(lbl + '\\s*:?\\s*([А-Яа-яЁё-]+(?:\\s[А-Яа-яЁё-]+)?)', 'i');
                const m = full.match(re);
                if (m) return m[1].trim();
            }
            return null;
        }
        _findFood(full) {
            const m = full.match(/(проголодал|голод|корм|накорм|не хватает)[^.]{0,60}?(\d+)/i);
            if (m) return { raw: m[0].trim().slice(0, 80), remaining: parseInt(m[2], 10) };
            if (/сыт|наелась|наелся|не голоден/i.test(full)) return { raw: 'Сыта', remaining: 0 };
            return null;
        }
        _findMission(full) {
            const m = full.match(/(миссия|урок|задание|восхождение на олимп)[^.]{0,80}/i);
            return m ? m[0].trim().slice(0, 100) : null;
        }

        // ── НАВЫКИ (видимая вкладка «Навыки») ──
        _findSkills() {
            const wanted = ['Выносливость', 'Скорость', 'Выездка', 'Галоп', 'Рысь', 'Прыжки'];
            const result = { list: {}, total: null };
            const full = this.pageText();
            wanted.forEach((w) => {
                const re = new RegExp(w + '[^0-9]{0,20}(\\d+(?:[.,]\\d+)?)', 'i');
                const m = full.match(re);
                if (m) result.list[w] = parseFloat(m[1].replace(',', '.'));
            });
            const t = full.match(/(итог|общий|всего)[^0-9]{0,15}(\d+(?:[.,]\\d+)?)/i);
            if (t) result.total = parseFloat(t[2].replace(',', '.'));
            return Object.keys(result.list).length || result.total != null ? result : null;
        }

        // ── ГП: пробуем прочитать БЕЗ клика ──
        _findGP() {
            // Ищем вкладку ГП, даже если она скрыта, и читаем цифры из её содержимого
            const gpContainers = this._collectGpContainers();
            if (!gpContainers.length) return { available: false, note: 'блок ГП не найден в HTML' };
            const skills = ['Выносливость', 'Скорость', 'Выездка', 'Галоп', 'Рысь', 'Прыжки'];
            const list = {};
            let total = null;
            for (const c of gpContainers) {
                const txt = this.text(c);
                skills.forEach((s) => {
                    if (list[s] != null) return;
                    const re = new RegExp(s + '[^0-9]{0,20}(\\d+(?:[.,]\\d+)?)', 'i');
                    const m = txt.match(re);
                    if (m) list[s] = parseFloat(m[1].replace(',', '.'));
                });
                const t = txt.match(/(итог|общий|всего|потенциал)[^0-9]{0,15}(\d+(?:[.,]\\d+)?)/i);
                if (t && total == null) total = parseFloat(t[2].replace(',', '.'));
            }
            const found = Object.keys(list).length || total != null;
            return { available: found, list, total, note: found ? 'прочитано без клика' : 'блок найден, но цифры не распознаны' };
        }
        _collectGpContainers() {
            // 1) по id/классу
            const bySel = Array.from(document.querySelectorAll('[id*="gp" i], [class*="gp" i], [id*="potentiel" i], [class*="potentiel" i]'));
            // 2) по подписи вкладки
            const tabs = Array.from(document.querySelectorAll('a, li, div, span, button')).filter((el) => /^гп$|гп[^а-я]|потенциал/i.test(this.text(el)) && this.text(el).length < 25);
            const targets = new Set(bySel);
            tabs.forEach((tab) => {
                // берём связанный контейнер (по href="#id" или соседний блок)
                const href = tab.getAttribute('href');
                if (href && href.startsWith('#')) { const t = document.getElementById(href.slice(1)); if (t) targets.add(t); }
                if (tab.parentElement) targets.add(tab.parentElement);
            });
            return Array.from(targets);
        }

        // ── 🔬 РАЗВЕДЧИК: диагностика для поиска данных ГП ──
        scanHiddenData() {
            const report = [];
            const push = (title, value) => report.push({ title, value });

            // A. Скрытые элементы, где встречается слово ГП/потенциал/навык
            const skillWords = /гп|потенциал|выносливост|галоп|выездк/i;
            const hiddenHits = [];
            Array.from(document.querySelectorAll('div, section, table, ul, span')).forEach((el) => {
                const style = window.getComputedStyle(el);
                const isHidden = style.display === 'none' || style.visibility === 'hidden' || el.hidden;
                if (isHidden && skillWords.test(this.text(el)) && this.text(el).length > 10) {
                    hiddenHits.push({ tag: el.tagName.toLowerCase(), id: el.id || '', cls: el.className?.toString().slice(0, 60) || '', sample: this.text(el).slice(0, 120) });
                }
            });
            push('Скрытые блоки с данными навыков/ГП', hiddenHits.length ? hiddenHits : 'не найдено');

            // B. data-атрибуты с цифрами
            const dataHits = [];
            Array.from(document.querySelectorAll('*')).slice(0, 4000).forEach((el) => {
                for (const attr of el.attributes || []) {
                    if (/^data-/.test(attr.name) && /\d/.test(attr.value) && attr.value.length < 40) {
                        if (/gp|potentiel|skill|comp|note|valeur/i.test(attr.name)) dataHits.push(`${el.tagName.toLowerCase()}[${attr.name}="${attr.value}"]`);
                    }
                }
            });
            push('Атрибуты data-* с цифрами (похоже на ГП)', dataHits.slice(0, 30).length ? dataHits.slice(0, 30) : 'не найдено');

            // C. Ссылки/вкладки ГП (адрес запроса)
            const tabLinks = Array.from(document.querySelectorAll('a, [onclick]')).filter((el) => /гп|потенциал|potentiel/i.test(this.text(el)) || /gp|potentiel/i.test(el.getAttribute('href') || '') || /gp|potentiel/i.test(el.getAttribute('onclick') || ''));
            push('Ссылки/вкладки ГП (адрес запроса)', tabLinks.slice(0, 10).map((el) => ({ text: this.text(el).slice(0, 30), href: el.getAttribute('href') || '', onclick: (el.getAttribute('onclick') || '').slice(0, 80) })));

            // D. Глобальные JS-переменные с данными лошади
            const globals = [];
            ['horse', 'cheval', 'chevalData', 'HORSE', 'gp', 'GP', 'skills', 'competences', 'data'].forEach((k) => {
                try { if (window[k] && typeof window[k] === 'object') globals.push(k + ' = {' + Object.keys(window[k]).slice(0, 12).join(', ') + '}'); } catch (e) {}
            });
            push('Глобальные переменные JS с данными', globals.length ? globals : 'не найдено');

            // E. Inline-скрипты, где есть цифры навыков
            const scriptHits = [];
            Array.from(document.querySelectorAll('script:not([src])')).forEach((sc) => {
                const t = sc.textContent || '';
                if (/gp|potentiel|competence|skill|note/i.test(t) && /\d/.test(t)) {
                    const idx = t.search(/gp|potentiel|competence|skill/i);
                    scriptHits.push(t.slice(Math.max(0, idx - 20), idx + 160).replace(/\s+/g, ' '));
                }
            });
            push('Данные внутри <script> на странице', scriptHits.slice(0, 6).length ? scriptHits.slice(0, 6) : 'не найдено');

            return report;
        }
        // ── 🔎 УНИВЕРСАЛЬНЫЙ ПОИСК ПО СЛОВУ ──
        // query — что ищем: "морковь", "случить", "записать", "корм" и т.д.
        universalSearch(query) {
            const q = (query || '').trim().toLowerCase();
            if (!q) return [];
            const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            const results = [];
            const seen = new Set();
            const cssPath = (el) => {
                if (el.id) return '#' + el.id;
                let path = el.tagName.toLowerCase();
                if (el.className && typeof el.className === 'string') path += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
                return path;
            };
            // 1) Видимые/скрытые элементы, где встречается слово
            Array.from(document.querySelectorAll('a, button, span, div, li, td, th, label, h1, h2, h3, input')).forEach((el) => {
                const t = this.text(el);
                const val = el.value || '';
                const title = el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
                const haystack = (t + ' ' + val + ' ' + title);
                if (haystack.length < 2 || haystack.length > 200) return;
                if (!re.test(haystack)) return;
                const style = window.getComputedStyle(el);
                const hidden = style.display === 'none' || style.visibility === 'hidden' || el.hidden;
                const sel = cssPath(el);
                const key = sel + '|' + t.slice(0, 30);
                if (seen.has(key)) return; seen.add(key);
                results.push({
                    tag: el.tagName.toLowerCase(),
                    clickable: /^(a|button|input)$/.test(el.tagName.toLowerCase()) || Boolean(el.onclick) || el.getAttribute('role') === 'button',
                    hidden,
                    selector: sel,
                    href: el.getAttribute('href') || '',
                    onclick: (el.getAttribute('onclick') || '').slice(0, 80),
                    text: t.slice(0, 60) || val.slice(0, 40) || title.slice(0, 40),
                });
            });
            // 2) data-атрибуты
            Array.from(document.querySelectorAll('*')).slice(0, 5000).forEach((el) => {
                for (const attr of el.attributes || []) {
                    if (/^data-/.test(attr.name) && re.test(attr.name + ' ' + attr.value) && attr.value.length < 60) {
                        const sel = cssPath(el);
                        const key = 'attr|' + sel + attr.name;
                        if (seen.has(key)) return; seen.add(key);
                        results.push({ tag: el.tagName.toLowerCase(), clickable: false, hidden: false, selector: sel, attr: `${attr.name}="${attr.value}"`, text: '(data-атрибут)' });
                    }
                }
            });
            return results.slice(0, 40);
        }
    }

    /* ===== ДВИЖОК (пока только «Глаза» — читает, не действует) ===== */
    class Engine {
        constructor(ctx) {
            this.eventBus = ctx.eventBus; this.state = ctx.state; this.logger = ctx.logger;
            this.settings = ctx.settings; this.adapter = ctx.adapter;
            this.delay = new HumanizedDelay(this.settings); // «мозг» скорости
        }
        _mode() { return this.delay.currentMode(); }

        async analyzeCurrent() {
            const info = this.adapter.getPageInfo();
            if (info.pageType !== PageType.HORSE) { this.logger.warn('Это не страница лошади. Открой карточку лошади. 🐴'); return null; }
            this.logger.info('Читаю данные лошади…');
            try {
                const horse = this.adapter.analyzeHorse();
                this.state.markHorseAnalyzed(horse);
                const parts = [`Имя: ${horse.name}`];
                if (horse.energy != null) parts.push(`энергия ${horse.energy}%`);
                if (horse.skills?.total != null) parts.push(`навыки ${horse.skills.total}`);
                this.logger.success(`Прочитано: ${parts.join(', ')}`, horse);
                return horse;
            } catch (e) { this.state.error(e.message); this.logger.error('Не смогла прочитать лошадь: ' + e.message); return null; }
        }
        async start() {
            const info = this.adapter.getPageInfo();
            if (info.pageType !== PageType.HORSE) { this.logger.warn('Открой карточку лошади и нажми «Старт». 🐴'); return; }
            this.delay.reset();
            this.state.start(1);
            const mode = this._mode();
            this.logger.info(`Старт в режиме «${mode.label}». Пока это безопасный режим «Глаза» — только читаю. 👁️`);
            try {
                const info2 = await this.delay.wait('чтение');
                if (info2.thought) this.logger.info('…задумалась на секунду, как живой игрок 🤔');
                await this.analyzeCurrent();
                this.state.done('Лошадь прочитана. Действия появятся в следующих версиях. ✨');
            } catch (e) {
                if (e.message === 'cancelled') { this.logger.info('Остановлено.'); this.state.stop(); }
                else { this.state.error(e.message); this.logger.error('Ошибка: ' + e.message); }
            }
        }
        pause() { this.delay.cancel(); this.state.pause(); this.logger.info('Пауза.'); }
        resume() { this.delay.reset(); this.state.resume(); this.logger.info('Продолжаю.'); }
        stop() { this.delay.cancel(); this.state.stop(); this.logger.info('Остановлено вручную.'); }
        softStop() { this.state.requestSoftStop(); this.logger.info('Остановлюсь после текущей лошади.'); }
    }

    // 👉 ПРОДОЛЖЕНИЕ В ЧАСТИ 3 (интерфейс)
        /* ===== СТИЛИ ===== */
    const STYLES = `
    #${APP.id}-fab{position:fixed;right:24px;bottom:24px;width:56px;height:56px;border:none;border-radius:50%;background:linear-gradient(135deg,#7c5cf6,#a78bfa);color:#fff;font-size:26px;cursor:pointer;z-index:2147483000;box-shadow:0 8px 24px rgba(124,92,246,.5);display:grid;place-items:center;transition:transform .2s;}
    #${APP.id}-fab:hover{transform:scale(1.08);}
    #${APP.id}-root{position:fixed;right:24px;top:24px;width:820px;max-width:calc(100vw - 40px);height:640px;max-height:calc(100vh - 40px);z-index:2147483000;border-radius:20px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.5);font-family:-apple-system,'Segoe UI',Roboto,sans-serif;display:flex;}
    #${APP.id}-root[data-theme="dark"]{--bg:#171727;--panel:#1f1f35;--panel2:#26263f;--text:#eef;--muted:#9aa;--accent:#7c5cf6;--accent2:#a78bfa;--border:rgba(255,255,255,.08);--ok:#34d399;--err:#f87171;--warn:#fbbf24;}
    #${APP.id}-root[data-theme="light"]{--bg:#f4f4fb;--panel:#fff;--panel2:#f0f0f8;--text:#222;--muted:#778;--accent:#7c5cf6;--accent2:#8b5cf6;--border:rgba(0,0,0,.08);--ok:#059669;--err:#dc2626;--warn:#d97706;}
    #${APP.id}-root *{box-sizing:border-box;margin:0;padding:0;}
    #${APP.id}-root .hm-body{display:flex;width:100%;background:var(--bg);color:var(--text);}
    #${APP.id}-root .hm-sidebar{width:230px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:14px;}
    #${APP.id}-root .hm-brand{display:flex;align-items:center;gap:10px;padding:6px 6px 12px;cursor:grab;}
    #${APP.id}-root .hm-brand-logo{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#7c5cf6,#a78bfa);display:grid;place-items:center;font-size:22px;}
    #${APP.id}-root .hm-brand-name{font-weight:700;font-size:15px;}
    #${APP.id}-root .hm-brand-ver{font-size:11px;color:var(--muted);}
    #${APP.id}-root .hm-sub-badge{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:8px 12px;border-radius:12px;font-size:12px;font-weight:600;}
    #${APP.id}-root .hm-sub-badge.active{background:rgba(124,92,246,.15);color:var(--accent2);}
    #${APP.id}-root .hm-sub-badge.inactive{background:rgba(239,68,68,.12);color:var(--err);}
    #${APP.id}-root .hm-sub-dot{width:8px;height:8px;border-radius:50%;background:currentColor;}
    #${APP.id}-root .hm-nav{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:2px;}
    #${APP.id}-root .hm-nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;font-size:14px;color:var(--muted);transition:.15s;}
    #${APP.id}-root .hm-nav-item:hover{background:var(--panel2);color:var(--text);}
    #${APP.id}-root .hm-nav-item.active{background:linear-gradient(135deg,rgba(124,92,246,.25),rgba(167,139,250,.15));color:var(--text);font-weight:600;}
    #${APP.id}-root .hm-lock{margin-left:auto;font-size:12px;opacity:.6;}
    #${APP.id}-root .hm-foot{display:flex;align-items:center;gap:8px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--muted);}
    #${APP.id}-root .hm-dot{width:8px;height:8px;border-radius:50%;background:var(--ok);}
    #${APP.id}-root .hm-main{flex:1;display:flex;flex-direction:column;min-width:0;}
    #${APP.id}-root .hm-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);cursor:grab;}
    #${APP.id}-root .hm-title{font-size:18px;font-weight:700;}
    #${APP.id}-root .hm-header-actions{display:flex;gap:8px;}
    #${APP.id}-root .hm-icon-btn{width:34px;height:34px;border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:10px;cursor:pointer;font-size:15px;}
    #${APP.id}-root .hm-icon-btn:hover{background:var(--panel2);}
    #${APP.id}-root .hm-content{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:16px;}
    #${APP.id}-root .hm-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
    #${APP.id}-root .hm-card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:18px;}
    #${APP.id}-root .hm-card-title{font-weight:700;font-size:15px;margin-bottom:14px;}
    #${APP.id}-root .hm-status-big{font-size:20px;font-weight:700;}
    #${APP.id}-root .hm-status-sub{color:var(--muted);font-size:13px;margin:4px 0 10px;}
    #${APP.id}-root .hm-status-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:var(--panel2);}
    #${APP.id}-root .hm-progress-head{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin:16px 0 6px;}
    #${APP.id}-root .hm-progress-track{height:8px;background:var(--panel2);border-radius:20px;overflow:hidden;}
    #${APP.id}-root .hm-progress-fill{height:100%;width:0;background:linear-gradient(90deg,#7c5cf6,#a78bfa);border-radius:20px;transition:width .4s;}
    #${APP.id}-root .hm-tiles{display:flex;flex-direction:column;gap:8px;margin-top:16px;}
    #${APP.id}-root .hm-tile{display:flex;align-items:center;gap:12px;background:var(--panel2);border-radius:12px;padding:12px 14px;}
    #${APP.id}-root .hm-tile-ic{font-size:20px;}
    #${APP.id}-root .hm-tile-num{font-size:20px;font-weight:700;min-width:34px;}
    #${APP.id}-root .hm-tile-lbl{color:var(--muted);font-size:13px;}
    #${APP.id}-root .hm-controls{display:flex;flex-wrap:wrap;gap:8px;}
    #${APP.id}-root .hm-btn{padding:9px 16px;border:1px solid var(--border);background:var(--panel2);color:var(--text);border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;transition:.15s;}
    #${APP.id}-root .hm-btn:hover{transform:translateY(-1px);}
    #${APP.id}-root .hm-btn.primary{background:linear-gradient(135deg,#7c5cf6,#a78bfa);border:none;color:#fff;}
    #${APP.id}-root .hm-btn.danger{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.3);color:var(--err);}
    #${APP.id}-root .hm-btn.ghost{background:transparent;}
    #${APP.id}-root .hm-kv{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13.5px;}
    #${APP.id}-root .hm-kv:last-child{border-bottom:none;}
    #${APP.id}-root .hm-kv-k{color:var(--muted);min-width:150px;}
    #${APP.id}-root .hm-kv-v{font-weight:600;}
    #${APP.id}-root .hm-kv-v.ok{color:var(--ok);}
    #${APP.id}-root .hm-kv-v.bad{color:var(--err);}
    #${APP.id}-root .hm-field{display:flex;align-items:center;justify-content:space-between;padding:10px 0;}
    #${APP.id}-root .hm-field-lbl{font-size:14px;}
    #${APP.id}-root .hm-switch{width:44px;height:24px;border-radius:20px;background:var(--panel2);position:relative;cursor:pointer;transition:.2s;border:1px solid var(--border);}
    #${APP.id}-root .hm-switch::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s;}
    #${APP.id}-root .hm-switch.on{background:var(--accent);}
    #${APP.id}-root .hm-switch.on::after{left:22px;}
    #${APP.id}-root select{padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font-size:13px;}
    #${APP.id}-root input[type="text"]{padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font-size:13px;flex:1;}
    #${APP.id}-root .hm-speed-hint{margin:-4px 0 10px;padding:10px 12px;border-radius:10px;background:rgba(124,92,246,.1);color:var(--accent2);font-size:12px;line-height:1.5;}
    #${APP.id}-root .hm-empty{text-align:center;padding:50px 20px;color:var(--muted);}
    #${APP.id}-root .hm-empty-ic{font-size:48px;margin-bottom:12px;}
    #${APP.id}-root .hm-empty-title{font-size:17px;font-weight:700;color:var(--text);margin-bottom:6px;}
    #${APP.id}-root .hm-log-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
    #${APP.id}-root .hm-log{max-height:200px;overflow-y:auto;font-size:12.5px;font-family:monospace;display:flex;flex-direction:column;gap:4px;}
    #${APP.id}-root .hm-log-item{display:flex;gap:8px;padding:4px 8px;border-radius:6px;background:var(--panel2);}
    #${APP.id}-root .hm-log-time{color:var(--muted);}
    #${APP.id}-root .hm-log-item.success{color:var(--ok);}
    #${APP.id}-root .hm-log-item.warn{color:var(--warn);}
    #${APP.id}-root .hm-log-item.error{color:var(--err);}
    #${APP.id}-root .hm-pre{background:var(--panel2);border-radius:10px;padding:12px;font-size:11px;font-family:monospace;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow-y:auto;color:var(--muted);margin-top:6px;}
    #${APP.id}-root .hm-faq-item{border:1px solid var(--border);border-radius:12px;margin-bottom:8px;padding:0 14px;}
    #${APP.id}-root .hm-faq-item summary{cursor:pointer;padding:12px 0;font-weight:600;list-style:none;}
    #${APP.id}-root .hm-faq-item summary::-webkit-details-marker{display:none;}
    #${APP.id}-root .hm-faq-item summary::before{content:'▸ ';color:var(--accent2);}
    #${APP.id}-root .hm-faq-item[open] summary::before{content:'▾ ';}
    #${APP.id}-root .hm-faq-item>div{padding:0 0 12px;font-size:13px;line-height:1.6;color:var(--muted);}
    #${APP.id}-root .hm-scout-row{display:flex;gap:8px;margin-bottom:12px;}
    #${APP.id}-root .hm-scout-hit{padding:8px 10px;border-radius:8px;background:var(--panel2);font-size:11.5px;font-family:monospace;margin-bottom:5px;word-break:break-word;}
    #${APP.id}-root .hm-scout-hit .tag{display:inline-block;padding:1px 6px;border-radius:5px;font-size:10px;font-weight:700;margin-right:6px;}
    #${APP.id}-root .hm-scout-hit .tag.click{background:rgba(52,211,153,.2);color:var(--ok);}
    #${APP.id}-root .hm-scout-hit .tag.hidden{background:rgba(251,191,36,.2);color:var(--warn);}
    #${APP.id}-root[data-compact="true"] .hm-content{padding:12px;gap:10px;}
    #${APP.id}-root[data-compact="true"] .hm-card{padding:12px;}
    `;

    const T = { placeholder: 'Этот раздел появится в одном из следующих обновлений. Спасибо, что ждёшь! 💜', statusTitle: {
        [AppStatus.IDLE]: 'Готов к работе 😊', [AppStatus.RUNNING]: 'Работаю…', [AppStatus.PAUSED]: 'Пауза',
        [AppStatus.STOPPED]: 'Остановлено', [AppStatus.DONE]: 'Готово! 🎉', [AppStatus.ERROR]: 'Ошибка 😔' } };

    /* ===== ИНТЕРФЕЙС ===== */
    class UIManager {
        constructor(ctx) {
            this.eventBus = ctx.eventBus; this.state = ctx.state; this.settings = ctx.settings;
            this.logger = ctx.logger; this.engine = ctx.engine; this.adapter = ctx.adapter; this.storage = ctx.storage;
            this.root = null; this.fab = null;
            this.activeSection = this.storage.get('ui:section', 'home');
            this.isOpen = this.storage.get('ui:open', true);
            this.scoutResults = null; // результаты разведчика
        }
        init() {
            this.injectStyles(); this.buildFab(); this.buildRoot();
            this.applyTheme(); this.restorePosition(); this.renderSection(); this.setOpen(this.isOpen);
            this.eventBus.on('state:changed', () => this.refreshDynamic());
            this.eventBus.on('log:changed', () => this.refreshLog());
            this.eventBus.on('settings:changed', () => { this.applyTheme(); if (this.activeSection === 'developer') this.renderSection(); });
        }
        injectStyles() { if (document.getElementById(`${APP.id}-styles`)) return; const s = document.createElement('style'); s.id = `${APP.id}-styles`; s.textContent = STYLES; document.head.appendChild(s); }
        buildFab() { this.fab = document.createElement('button'); this.fab.id = `${APP.id}-fab`; this.fab.textContent = '🐴'; this.fab.title = `${APP.name} v${APP.version}`; this.fab.addEventListener('click', () => this.setOpen(true)); document.body.appendChild(this.fab); }
        visibleMenu() { const devOn = this.settings.get('advanced', 'devMode') === true; return MENU.filter((m) => !m.dev || devOn); }
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
                        <div class="hm-sub-badge ${APP.subscription.active ? 'active' : 'inactive'}">
                            <span class="hm-sub-dot"></span>
                            <span>${APP.subscription.active ? APP.subscription.plan : 'Подписка неактивна'}</span>
                        </div>
                        <nav class="hm-nav">${this.visibleMenu().map((m) => `
                            <div class="hm-nav-item" data-section="${m.id}">
                                <span class="hm-ic">${m.icon}</span><span>${m.label}</span>
                                ${m.ready ? '' : '<span class="hm-lock">🔒</span>'}
                            </div>`).join('')}
                        </nav>
                        <div class="hm-foot"><span class="hm-dot" data-role="dot"></span><span data-role="foot-status">Готов к работе 😊</span><span style="margin-left:auto">v${APP.version}</span></div>
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
            this.root.querySelectorAll('.hm-nav-item').forEach((el) => {
                el.addEventListener('click', () => { this.activeSection = el.dataset.section; this.storage.set('ui:section', this.activeSection); this.scoutResults = null; this.renderSection(); });
            });
            this.root.querySelector('[data-role="theme"]').addEventListener('click', () => this.toggleTheme());
            this.root.querySelector('[data-role="minimize"]').addEventListener('click', () => this.setOpen(false));
            this.enableDrag();
        }
        // ПРАВКА №12 — запоминаем позицию окна
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
            const onUp = () => { if (!dragging) return; dragging = false; this.savePosition(); };
            this.root.querySelectorAll('.hm-drag').forEach((el) => el.addEventListener('mousedown', onDown));
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }
        savePosition() {
            const r = this.root.getBoundingClientRect();
            this.storage.set('ui:pos', { left: r.left, top: r.top });
        }
        restorePosition() {
            const p = this.storage.get('ui:pos', null);
            if (p && typeof p.left === 'number') { this.root.style.right = 'auto'; this.root.style.left = `${p.left}px`; this.root.style.top = `${p.top}px`; }
        }
        setOpen(open) { this.isOpen = open; this.storage.set('ui:open', open); this.root.style.display = open ? 'flex' : 'none'; this.fab.style.display = open ? 'none' : 'grid'; }
        applyTheme() {
            let theme = this.settings.get('appearance', 'theme');
            if (theme === 'auto') theme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
            this.root.setAttribute('data-theme', theme);
            this.root.setAttribute('data-compact', String(Boolean(this.settings.get('appearance', 'compactMode'))));
            const btn = this.root.querySelector('[data-role="theme"]'); if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
        }
        toggleTheme() { const cur = this.root.getAttribute('data-theme'); this.settings.set('appearance', 'theme', cur === 'light' ? 'dark' : 'light'); }
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
            this.bindSectionEvents(); this.refreshDynamic(); this.refreshLog();
        }
        renderPlaceholder(menu) {
            return `<div class="hm-empty"><div class="hm-empty-ic">${menu.icon}</div>
                <div class="hm-empty-title">Раздел «${menu.label}»</div><div>${T.placeholder}</div></div>`;
        }
        // ГЛАВНАЯ — ПРАВКА №1: аккуратные плитки-строки
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
                        <div class="hm-tile"><span class="hm-tile-ic">📋</span><span class="hm-tile-num" data-role="t-left">0</span><span class="hm-tile-lbl">Осталось</span></div>
                        <div class="hm-tile"><span class="hm-tile-ic">✅</span><span class="hm-tile-num" data-role="t-done">0</span><span class="hm-tile-lbl">Выполнено</span></div>
                        <div class="hm-tile"><span class="hm-tile-ic">⏳</span><span class="hm-tile-num" data-role="t-proc">0</span><span class="hm-tile-lbl">В процессе</span></div>
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
        renderSettings() {
            const sections = settingsSchema.map((sec) => `
                <div class="hm-card"><div class="hm-card-title">${sec.title}</div>
                    <div style="color:var(--muted);font-size:12.5px;margin-bottom:8px">${sec.description}</div>
                    ${sec.fields.map((f) => {
                        const val = this.settings.get(sec.id, f.id);
                        let control = '';
                        if (f.type === 'checkbox') control = `<div class="hm-switch ${val ? 'on' : ''}" data-set="${sec.id}.${f.id}" data-type="checkbox"></div>`;
                        else if (f.type === 'select') control = `<select data-set="${sec.id}.${f.id}" data-type="select">${f.options.map((o) => `<option value="${o.value}" ${o.value === val ? 'selected' : ''}>${o.label}</option>`).join('')}</select>`;
                        let hint = '';
                        if (sec.id === 'speed' && f.id === 'mode') { const mode = APP.speedModes[val] || APP.speedModes.safe; hint = `<div class="hm-speed-hint">${mode.desc}</div>`; }
                        return `<div class="hm-field"><span class="hm-field-lbl">${f.label}</span>${control}</div>${hint}`;
                    }).join('')}
                </div>`).join('');
            return `${sections}<div class="hm-card"><div class="hm-controls"><button class="hm-btn danger" data-act="reset-settings">Сбросить настройки</button></div></div>`;
        }
        renderAbout() {
            return `<div class="hm-card"><div class="hm-card-title">ℹ️ О проекте</div>
                <div style="line-height:1.8;font-size:14px">
                    <b>${APP.name}</b> v${APP.version} • ${APP.subscription.plan}<br>
                    Умный помощник для игры <b>Ловади</b>. 🐴<br><br>
                    <span style="color:var(--muted)">Заботится о твоих лошадках, экономит время и работает бережно — как настоящий игрок. 💜</span>
                </div>
            </div>
            <div class="hm-card"><div class="hm-card-title">❓ Справка / FAQ</div>
                <details class="hm-faq-item"><summary>С чего начать?</summary><div>Открой карточку любой лошади и нажми «Старт» на Главной. В версии ${APP.version} приложение только читает данные — это безопасно.</div></details>
                <details class="hm-faq-item"><summary>Это безопасно для аккаунта?</summary><div>Да. В «Настройках» выбери режим скорости. Рекомендуем <b>🛡️ Безопасный</b>. Для фона — <b>🌙 Ночной</b>.</div></details>
                <details class="hm-faq-item"><summary>Данные куда-то отправляются?</summary><div>Нет. Всё работает локально в твоём браузере.</div></details>
                <details class="hm-faq-item"><summary>Что-то не находится?</summary><div>Включи Настройки → «Для продвинутых» → раздел «Разработчик», открой его на странице лошади и воспользуйся 🔎 Разведчиком — пришли отчёт разработчику. 😊</div></details>
            </div>
            <div class="hm-card"><div class="hm-card-title">🔒 Безопасность</div>
                <div style="color:var(--muted);font-size:13.5px;line-height:1.7">Всё работает локально в твоём браузере. Никакие данные никуда не отправляются.</div>
            </div>`;
        }
        // РАЗРАБОТЧИК + УНИВЕРСАЛЬНЫЙ РАЗВЕДЧИК
        renderDeveloper() {
            const info = this.adapter.getPageInfo();
            const horse = info.pageType === PageType.HORSE ? this.adapter.analyzeHorse() : null;
            const yn = (v) => v ? '<span class="hm-kv-v ok">✅ найдено</span>' : '<span class="hm-kv-v bad">❌ не найдено</span>';
            const skillsBlock = (obj) => {
                if (!obj) return yn(false);
                if (obj.available === false) return `<span class="hm-kv-v bad">${obj.note || 'нет'}</span>`;
                const list = obj.list || {};
                const rows = Object.keys(list).map((k) => `${k}: ${list[k]}`).join(' • ');
                return `<span class="hm-kv-v ok">${rows || '—'}${obj.total != null ? ' • Итог: ' + obj.total : ''}</span>`;
            };
            const horseRows = horse ? `
                <div class="hm-kv"><span class="hm-kv-k">Имя</span>${yn(horse.name && horse.name !== '—')} <span class="hm-kv-v">${horse.name || ''}</span></div>
                <div class="hm-kv"><span class="hm-kv-k">Энергия</span>${horse.energy != null ? `<span class="hm-kv-v ok">${horse.energy}%</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Здоровье</span>${horse.health != null ? `<span class="hm-kv-v ok">${horse.health}%</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Настроение</span>${horse.mood != null ? `<span class="hm-kv-v ok">${horse.mood}%</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Возраст</span>${horse.age ? `<span class="hm-kv-v ok">${horse.age}</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Пол</span>${horse.sex ? `<span class="hm-kv-v ok">${horse.sex}</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Может размножаться</span>${horse.canBreed == null ? yn(false) : `<span class="hm-kv-v ok">${horse.canBreed ? 'Да' : 'Нет'}</span>`}</div>
                <div class="hm-kv"><span class="hm-kv-k">Вид</span>${horse.kind ? `<span class="hm-kv-v ok">${horse.kind}</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Порода</span>${horse.breed ? `<span class="hm-kv-v ok">${horse.breed}</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Масть</span>${horse.coat ? `<span class="hm-kv-v ok">${horse.coat}</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Навыки</span>${skillsBlock(horse.skills)}</div>
                <div class="hm-kv"><span class="hm-kv-k">ГП (без клика)</span>${skillsBlock(horse.gp)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Корм</span>${horse.food ? `<span class="hm-kv-v ok">${horse.food.raw}</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Миссия/урок</span>${horse.mission ? `<span class="hm-kv-v ok">${horse.mission}</span>` : yn(false)}</div>
                <div class="hm-kv"><span class="hm-kv-k">Кнопка «следующая»</span>${yn(horse.hasNextHorseButton)} <span class="hm-kv-v">${horse.nextHorseButtonSelector || ''}</span></div>
                <div style="margin-top:14px;color:var(--muted);font-size:12px">Образец текста страницы:</div>
                <pre class="hm-pre">${(horse.pageTextSample || '').replace(/</g, '&lt;')}</pre>` : '<div style="color:var(--muted);font-size:13px;padding:8px 0">Открой карточку лошади, чтобы увидеть анализ данных. 🐴</div>';
            // Блок разведчика
            let scoutHtml = '';
            if (this.scoutResults) {
                if (this.scoutResults.length) {
                    scoutHtml = this.scoutResults.map((r) => `<div class="hm-scout-hit">
                        <span class="tag ${r.clickable ? 'click' : ''} ${r.hidden ? 'hidden' : ''}">${r.tag}${r.clickable ? ' 🖱' : ''}${r.hidden ? ' 👻' : ''}</span>
                        <b>${(r.text || '').replace(/</g, '&lt;')}</b><br>
                        селектор: <code>${r.selector}</code>${r.href ? `<br>href: ${r.href.slice(0, 60)}` : ''}${r.onclick ? `<br>onclick: ${r.onclick.replace(/</g, '&lt;')}` : ''}${r.attr ? `<br>${r.attr}` : ''}
                    </div>`).join('');
                } else scoutHtml = '<div style="color:var(--muted);font-size:13px">Ничего не нашлось по этому слову. Попробуй другое. 🤔</div>';
            }
            return `
            <div class="hm-card">
                <div class="hm-card-title">🧑‍💻 Диагностика страницы</div>
                <div class="hm-kv"><span class="hm-kv-k">Адаптер</span><span class="hm-kv-v ${info.supported ? 'ok' : 'bad'}">${info.adapter} ${info.supported ? '(поддерживается)' : ''}</span></div>
                <div class="hm-kv"><span class="hm-kv-k">Тип страницы</span><span class="hm-kv-v">${info.pageTypeLabel}</span></div>
                <div class="hm-kv"><span class="hm-kv-k">Адрес</span><span class="hm-kv-v" style="word-break:break-all">${info.url}</span></div>
                <div class="hm-controls" style="margin-top:16px">
                    <button class="hm-btn primary" data-act="dev-refresh">🔄 Обновить анализ</button>
                    <button class="hm-btn" data-act="dev-copy">📋 Скопировать отчёт</button>
                </div>
            </div>
            <div class="hm-card">
                <div class="hm-card-title">🔎 Разведчик — универсальный поиск</div>
                <div style="color:var(--muted);font-size:12.5px;line-height:1.6;margin-bottom:12px">
                    Найдёт где угодно на странице: кнопки, ссылки, скрытые данные, атрибуты. Введи слово (например: <b style="color:var(--accent2)">морковь</b>, <b style="color:var(--accent2)">случить</b>, <b style="color:var(--accent2)">записать</b>, <b style="color:var(--accent2)">миссия</b>) и нажми поиск. 🕵️
                </div>
                <div class="hm-scout-row">
                    <input type="text" data-role="scout-input" placeholder="Что ищем? например: корм">
                    <button class="hm-btn primary" data-act="scout-search">Найти</button>
                </div>
                <div class="hm-controls" style="margin-bottom:12px">
                    <button class="hm-btn" data-act="scout-gp">🔬 Сканировать ГП</button>
                    <button class="hm-btn" data-act="scout-copy">📋 Скопировать находки</button>
                </div>
                <div>${scoutHtml}</div>
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
            content.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('click', () => this.handleAction(el.dataset.act)));
            content.querySelectorAll('[data-set]').forEach((el) => {
                                const [sec, field] = el.dataset.set.split('.');
                if (el.dataset.type === 'checkbox') {
                    el.addEventListener('click', () => { const cur = this.settings.get(sec, field); this.settings.set(sec, field, !cur); this.renderSection(); });
                } else if (el.dataset.type === 'select') {
                    el.addEventListener('change', () => { this.settings.set(sec, field, el.value); this.renderSection(); });
                }
            });
        }
        handleAction(act) {
            switch (act) {
                case 'start': this.engine.start(); break;
                case 'pause': this.engine.pause(); break;
                case 'resume': this.engine.resume(); break;
                case 'stop': this.engine.stop(); break;
                case 'soft': this.engine.softStop(); break;
                case 'analyze': this.engine.analyzeCurrent(); break;
                case 'clear-log': this.logger.clear(); break;
                case 'reset-settings': this.settings.reset(); this.renderSection(); this.logger.info('Настройки сброшены.'); break;
                case 'goto-dev': this.activeSection = 'developer'; this.storage.set('ui:section', 'developer'); this.renderSection(); break;
                case 'dev-refresh': this.renderSection(); this.logger.info('Анализ обновлён.'); break;
                case 'dev-copy': this.copyDevReport(); break;
                case 'scout-search': this.runScoutSearch(); break;
                case 'scout-gp': this.runScoutGp(); break;
                case 'scout-copy': this.copyScout(); break;
            }
        }
        // 🔎 Разведчик — поиск по слову
        runScoutSearch() {
            const input = this.root.querySelector('[data-role="scout-input"]');
            const q = input ? input.value.trim() : '';
            if (!q) { this.logger.warn('Введи слово для поиска. 🔎'); return; }
            this.scoutResults = this.adapter.universalSearch(q);
            this.logger.success(`Разведчик: по слову «${q}» найдено ${this.scoutResults.length} совпадений.`);
            this.renderSection();
            this.root.querySelector('[data-role="scout-input"]').value = q;
        }
        // 🔬 Разведчик — скан ГП (детальный отчёт A–E)
        runScoutGp() {
            const report = this.adapter.scanHiddenData();
            const flat = [];
            report.forEach((r) => {
                if (Array.isArray(r.value)) r.value.forEach((v) => flat.push({ tag: r.title, text: typeof v === 'string' ? v : JSON.stringify(v), selector: '(см. отчёт ГП)', clickable: false, hidden: false }));
                else flat.push({ tag: r.title, text: String(r.value), selector: '(см. отчёт ГП)', clickable: false, hidden: false });
            });
            this.scoutResults = flat;
            this._lastGpReport = report;
            this.logger.success('🔬 Скан ГП завершён. Пришли отчёт разработчику!');
            this.renderSection();
        }
        copyScout() {
            let text = `=== Разведчик (${APP.name} v${APP.version}) ===\nURL: ${location.href}\n\n`;
            if (this._lastGpReport) { this._lastGpReport.forEach((r) => { text += `## ${r.title}\n${JSON.stringify(r.value, null, 2)}\n\n`; }); }
            if (this.scoutResults) this.scoutResults.forEach((r) => { text += `[${r.tag}] "${r.text}" → ${r.selector}${r.href ? ' href=' + r.href : ''}${r.onclick ? ' onclick=' + r.onclick : ''}${r.attr ? ' ' + r.attr : ''}\n`; });
            this.copyToClipboard(text, 'Находки разведчика скопированы! 📋');
        }
        copyDevReport() {
            const info = this.adapter.getPageInfo();
            const horse = info.pageType === PageType.HORSE ? this.adapter.analyzeHorse() : null;
            const text = `=== ${APP.name} v${APP.version} — отчёт ===\nURL: ${location.href}\nТип: ${info.pageTypeLabel}\n\nЛошадь:\n${JSON.stringify(horse, null, 2)}`;
            this.copyToClipboard(text, 'Отчёт скопирован! Пришли его разработчику. 📋');
        }
        copyToClipboard(text, msg) {
            try {
                if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => this.logger.success(msg));
                else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); this.logger.success(msg); }
            } catch (e) { this.logger.error('Не удалось скопировать: ' + e.message); }
        }
        // Динамическое обновление главной
        refreshDynamic() {
            const s = this.state.get();
            const foot = this.root.querySelector('[data-role="foot-status"]');
            if (foot) foot.textContent = T.statusTitle[s.status] || 'Готов к работе 😊';
            const dot = this.root.querySelector('[data-role="dot"]');
            if (dot) dot.style.background = s.status === AppStatus.ERROR ? 'var(--err)' : s.status === AppStatus.RUNNING ? 'var(--warn)' : 'var(--ok)';
            const setText = (role, val) => { const el = this.root.querySelector(`[data-role="${role}"]`); if (el) el.textContent = val; };
            setText('status-title', T.statusTitle[s.status] || '—');
            setText('status-sub', `Лошадь: ${s.currentHorseName} • Операция: ${s.currentOperation}`);
            setText('status-badge', `● ${s.currentOperation}`);
            const total = s.progress.total || 0, cur = s.progress.current || 0;
            const pct = total > 0 ? Math.min(100, Math.round((cur / total) * 100)) : 0;
            setText('pct', pct + '%');
            const fill = this.root.querySelector('[data-role="fill"]'); if (fill) fill.style.width = pct + '%';
            setText('t-left', Math.max(0, total - cur));
            setText('t-done', s.stats.analyzed || 0);
            setText('t-proc', s.status === AppStatus.RUNNING ? 1 : 0);
            // кнопка next на «Прогоне»
            const runNext = this.root.querySelector('[data-role="run-next"]');
            if (runNext) { const btn = this.adapter.findNextHorseButton(); runNext.innerHTML = btn ? `<span class="hm-kv-v ok">✅ ${btn.selector}</span>` : '<span class="hm-kv-v bad">❌ не найдено</span>'; }
        }
        refreshLog() {
            const box = this.root.querySelector('[data-role="log"]');
            if (!box) return;
            const items = this.logger.all().slice(0, 60);
            box.innerHTML = items.length ? items.map((it) => `<div class="hm-log-item ${it.level}"><span class="hm-log-time">${it.time}</span><span>${(it.message || '').replace(/</g, '&lt;')}</span></div>`).join('')
                : '<div style="color:var(--muted);padding:8px">Лог пуст. Нажми «Старт» или «Анализировать». 😊</div>';
        }
    }

    /* ===== ЗАПУСК ПРИЛОЖЕНИЯ ===== */
    class App {
        constructor() {
            const eventBus = new EventBus();
            const storage = new Storage(APP.storagePrefix + APP.version.split('.').slice(0, 2).join('_'));
            const logger = new Logger(eventBus, storage);
            const settings = new SettingsManager(eventBus, storage, settingsSchema);
            const state = new StateManager(eventBus, storage);
            const adapter = new LowadiAdapter({ logger });
            const engine = new Engine({ eventBus, state, logger, settings, adapter });
            const ui = new UIManager({ eventBus, state, settings, logger, engine, adapter, storage });
            this.ctx = { eventBus, storage, logger, settings, state, adapter, engine, ui };
        }
        start() {
            this.ctx.ui.init();
            this.ctx.logger.info(`${APP.name} v${APP.version} запущен. Режим «Глаза» 👁️`);
        }
    }

    function boot() {
        if (window.__howrseManagerStarted) return;
        window.__howrseManagerStarted = true;
        try { new App().start(); }
        catch (e) { console.error(`[${APP.name}] Ошибка запуска:`, e); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

})();
