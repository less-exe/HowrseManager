// ==UserScript==
// @name         Howrse Manager
// @namespace    https://github.com/less-exe/HowrseManager
// @version      0.4.1
// @description  Умный менеджер табуна для Ловади / Howrse. v0.4.1: миссии без привязки к тексту и кормление с нормами.
// @author       less-exe
// @match        https://www.lowadi.com/*
// @match        http://www.lowadi.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const APP = {
        id: 'howrse-manager',
        name: 'Howrse Manager',
        version: '0.4.1',
        storagePrefix: 'hm:v0.4',
    };

    const PageType = Object.freeze({ HORSE: 'horse', HORSE_LIST: 'horse_list', EC: 'ec', COMPETITIONS: 'competitions', UNKNOWN: 'unknown' });
    const AppStatus = Object.freeze({ IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused', STOPPED: 'stopped', ERROR: 'error' });

    const PageLabels = {
        [PageType.HORSE]: 'Страница лошади',
        [PageType.HORSE_LIST]: 'Список лошадей',
        [PageType.EC]: 'КСК',
        [PageType.COMPETITIONS]: 'Соревнования',
        [PageType.UNKNOWN]: 'Неизвестная страница',
    };

    const CareActions = [
        { id: 'brush', label: 'Чистка', operation: 'Чистка', words: ['Чистить', 'Чистка'] },
        {
            id: 'lesson',
            label: 'Урок / миссия',
            operation: 'Урок / миссия',
            sectionTitle: 'Миссия',
            words: ['Урок', 'Миссия', 'Заготовка леса', 'Транспортировать железо', 'Транспортировать древесину', 'Транспортировать песок'],
        },
        { id: 'stroke', label: 'Ласка', operation: 'Ласка', words: ['Ласкать', 'Ласка'] },
        { id: 'water', label: 'Вода', operation: 'Вода', words: ['Поить', 'Вода'] },
        { id: 'feed', label: 'Корм', operation: 'Корм', words: ['Кормить', 'Корм'], special: 'feed' },
        { id: 'sleep', label: 'Сон', operation: 'Сон', words: ['Отправить спать', 'Спать', 'Сон'] },
    ];

    const settingsSchema = [
        { id: 'appearance', title: 'Внешний вид', description: 'Тема и поведение окна приложения.', fields: [
            { id: 'theme', type: 'select', label: 'Тема', default: 'auto', options: [{ value: 'auto', label: 'Авто' }, { value: 'light', label: 'Светлая' }, { value: 'dark', label: 'Тёмная' }] },
            { id: 'compactMode', type: 'checkbox', label: 'Компактный режим', default: false },
        ] },
        { id: 'run', title: 'Прогон', description: 'Гибридный режим: текущая лошадь → уход → следующая лошадь.', fields: [
            { id: 'limitMode', type: 'select', label: 'Максимум лошадей за запуск', default: 'manual', options: [{ value: 'manual', label: 'Ручной лимит' }, { value: 'auto', label: 'Авто — до конца завода' }] },
            { id: 'maxHorsesPerRun', type: 'number', label: 'Лимит при ручном режиме', default: 25, min: 1, max: 5000, step: 1 },
            { id: 'stopAfterCurrentHorse', type: 'checkbox', label: 'Мягкая остановка после текущей лошади', default: false },
        ] },
        { id: 'care', title: 'Уход', description: 'Порядок: чистка → урок/миссия → ласка → вода → корм → сон.', fields: [
            { id: 'brush', type: 'checkbox', label: 'Чистка', default: true },
            { id: 'lesson', type: 'checkbox', label: 'Урок / миссия', default: true },
            { id: 'stroke', type: 'checkbox', label: 'Ласка', default: true },
            { id: 'water', type: 'checkbox', label: 'Вода', default: true },
            { id: 'feed', type: 'checkbox', label: 'Корм', default: true },
            { id: 'sleep', type: 'checkbox', label: 'Сон', default: true },
        ] },
        { id: 'delays', title: 'Задержки', description: 'Паузы между действиями и перед переходом к следующей лошади.', fields: [
            { id: 'mode', type: 'select', label: 'Режим задержек', default: 'medium', options: [{ value: 'fast', label: 'Быстро' }, { value: 'medium', label: 'Средне' }, { value: 'slow', label: 'Медленно' }] },
        ] },
        { id: 'developer', title: 'Разработчик', description: 'Диагностика поиска страниц, данных и кнопок.', fields: [
            { id: 'enabled', type: 'checkbox', label: 'Включить режим разработчика', default: true },
        ] },
    ];

    class EventBus {
        constructor() { this.listeners = new Map(); }
        on(name, cb) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(cb); return () => this.listeners.get(name)?.delete(cb); }
        emit(name, payload) { (this.listeners.get(name) || []).forEach((cb) => { try { cb(payload); } catch (error) { console.error(`[${APP.name}] event error`, error); } }); }
    }

    class Storage {
        constructor(prefix) { this.prefix = prefix; }
        key(name) { return `${this.prefix}:${name}`; }
        get(name, fallback = null) { try { const value = localStorage.getItem(this.key(name)); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } }
        set(name, value) { try { localStorage.setItem(this.key(name), JSON.stringify(value)); } catch (error) { console.warn(`[${APP.name}] storage write failed`, error); } }
    }

    class Logger {
        constructor(eventBus, storage) { this.eventBus = eventBus; this.storage = storage; this.items = storage.get('log', []); this.maxItems = 400; }
        add(level, message, details = null) {
            const item = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), level, message, details };
            this.items.unshift(item); this.items = this.items.slice(0, this.maxItems); this.storage.set('log', this.items); this.eventBus.emit('log:changed', this.items);
        }
        info(message, details = null) { this.add('info', message, details); }
        success(message, details = null) { this.add('success', message, details); }
        warn(message, details = null) { this.add('warn', message, details); }
        error(message, details = null) { this.add('error', message, details); }
        clear() { this.items = []; this.storage.set('log', this.items); this.eventBus.emit('log:changed', this.items); }
        all() { return [...this.items]; }
    }

    class SettingsManager {
        constructor(eventBus, storage, schema) { this.eventBus = eventBus; this.storage = storage; this.schema = schema; this.defaults = this.createDefaults(schema); this.settings = this.mergeDeep(this.defaults, storage.get('settings', {})); }
        createDefaults(schema) { const out = { version: 6 }; schema.forEach((section) => { out[section.id] = {}; section.fields.forEach((field) => { out[section.id][field.id] = field.default; }); }); return out; }
        mergeDeep(base, override) { const out = Array.isArray(base) ? [...base] : { ...base }; Object.keys(override || {}).forEach((key) => { out[key] = override[key] && typeof override[key] === 'object' && !Array.isArray(override[key]) ? this.mergeDeep(out[key] || {}, override[key]) : override[key]; }); return out; }
        get(sectionId, fieldId = null) { return fieldId ? this.settings?.[sectionId]?.[fieldId] : this.settings[sectionId]; }
        set(sectionId, fieldId, value) { if (!this.settings[sectionId]) this.settings[sectionId] = {}; this.settings[sectionId][fieldId] = value; this.storage.set('settings', this.settings); this.eventBus.emit('settings:changed', this.settings); }
        reset() { this.settings = this.createDefaults(this.schema); this.storage.set('settings', this.settings); this.eventBus.emit('settings:changed', this.settings); }
        all() { return this.settings; }
    }

    class StateManager {
        constructor(eventBus, storage) { this.eventBus = eventBus; this.storage = storage; this.state = this.merge(this.initial(), storage.get('state', {})); }
        initial() { return { status: AppStatus.IDLE, mode: null, currentHorseId: null, currentHorseName: '—', currentOperation: 'Ожидание', progress: { current: 0, total: 0 }, startedAt: null, finishedAt: null, lastActionAt: null, pageType: PageType.UNKNOWN, currentHorse: null, stats: { careActions: 0, errors: 0 }, run: { processedIds: [], softStopRequested: false, lastError: null, limitMode: 'manual' } }; }
        merge(base, saved) { return { ...base, ...saved, progress: { ...base.progress, ...(saved.progress || {}) }, stats: { ...base.stats, ...(saved.stats || {}) }, run: { ...base.run, ...(saved.run || {}) } }; }
        get() { return JSON.parse(JSON.stringify(this.state)); }
        patch(partial) { this.state = this.merge(this.state, partial); this.storage.set('state', this.state); this.eventBus.emit('state:changed', this.get()); }
        start(total = 0, limitMode = 'manual') { this.patch({ status: AppStatus.RUNNING, mode: 'hybrid-herd', currentOperation: 'Запуск табунного режима', progress: { current: 0, total }, stats: { careActions: 0, errors: 0 }, startedAt: Date.now(), finishedAt: null, lastActionAt: Date.now(), run: { processedIds: [], softStopRequested: false, lastError: null, limitMode } }); }
        pause() { this.patch({ status: AppStatus.PAUSED, currentOperation: 'Пауза', lastActionAt: Date.now() }); }
        resume() { this.patch({ status: AppStatus.RUNNING, currentOperation: 'Продолжение работы', lastActionAt: Date.now(), finishedAt: null }); }
        stop(operation = 'Остановлено', resetRun = false) { const patch = { status: AppStatus.STOPPED, mode: null, currentOperation: operation, finishedAt: Date.now(), lastActionAt: Date.now() }; if (resetRun) { patch.progress = { current: 0, total: 0 }; patch.stats = { careActions: 0, errors: 0 }; patch.run = { processedIds: [], softStopRequested: false, lastError: null, limitMode: this.state.run.limitMode || 'manual' }; } this.patch(patch); }
        error(message) { this.patch({ status: AppStatus.ERROR, currentOperation: 'Ошибка', finishedAt: Date.now(), lastActionAt: Date.now(), stats: { ...this.state.stats, errors: (this.state.stats.errors || 0) + 1 }, run: { ...this.state.run, lastError: message } }); }
        requestSoftStop() { this.patch({ run: { ...this.state.run, softStopRequested: true }, currentOperation: 'Мягкая остановка после текущей лошади' }); }
        markHorseProcessed(horse) { const id = horse?.id || `unknown-${Date.now()}`; const processedIds = [...new Set([...(this.state.run.processedIds || []), id])]; this.patch({ currentHorseId: id, currentHorseName: horse?.name || '—', currentHorse: horse, progress: { current: processedIds.length }, run: { ...this.state.run, processedIds }, lastActionAt: Date.now() }); }
        incrementCareActions() { this.patch({ stats: { ...this.state.stats, careActions: (this.state.stats.careActions || 0) + 1 }, lastActionAt: Date.now() }); }
    }

    class DelayManager {
        constructor(settingsManager) { this.settingsManager = settingsManager; }
        wait(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
        range() { return ({ fast: [700, 1400], medium: [1600, 3200], slow: [3200, 6500] })[this.settingsManager.get('delays', 'mode')] || [1600, 3200]; }
        random(min = null, max = null) { const [a, b] = this.range(); const from = min ?? a; const to = max ?? b; return this.wait(Math.floor(Math.random() * (to - from + 1)) + from); }
    }

    class RouteManager {
        getCurrentPageType() { const path = location.pathname; const href = location.href; if (/\/elevage\/chevaux\/cheval/i.test(path) || /[?&]id=\d+/i.test(href)) return PageType.HORSE; if (/centre|centre-equestre|centreEquestre|ecuri/i.test(path)) return PageType.EC; if (/competition|competitions|course/i.test(path)) return PageType.COMPETITIONS; if (/\/elevage\/chevaux\/?$/i.test(path) || /\/elevage\/chevaux/i.test(path)) return PageType.HORSE_LIST; return PageType.UNKNOWN; }
    }

    class HorseParser {
        normalize(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
        parse() { const text = this.normalize(document.body?.innerText || ''); const nextButton = this.findNextHorseButton(); return { id: new URLSearchParams(location.search).get('id') || null, name: this.getHorseName(text), energy: this.percentNear(text, 'Энергия'), health: this.percentNear(text, 'Здоровье'), mood: this.percentNear(text, 'Настроение') ?? this.percentNear(text, 'Мораль'), age: this.getAge(text), sex: this.getSex(text), hasNextHorseButton: Boolean(nextButton), nextHorseButtonSelector: this.describeElement(nextButton), pageTextSample: text.slice(0, 900) }; }
        getHorseName(text) { const title = document.title.replace(/\s*-\s*Ловади\s*$/i, '').replace(/\s*-\s*Howrse\s*$/i, '').trim(); if (title && !/^(lowadi|howrse|ловади)$/i.test(title)) return title; for (const selector of ['#characteristics-body-content h1', '.horse-name', '[class*="horse"] h1', 'h1', 'h2']) { const value = this.normalize(document.querySelector(selector)?.textContent || ''); if (value && value.length <= 80) return value; } const byTabun = text.match(/(?:Табун\s+[^\s]+\s+)?((?:жен|муж)\s+[0-9.,]+)/i); return byTabun ? byTabun[1] : '—'; }
        percentNear(text, label) { const safe = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const direct = text.match(new RegExp(`${safe}\\s*(\\d{1,3})\\s*%`, 'i')); if (direct) return Math.min(100, Number(direct[1])); const reversed = text.match(new RegExp(`(\\d{1,3})\\s*%\\s*${safe}`, 'i')); return reversed ? Math.min(100, Number(reversed[1])) : null; }
        getAge(text) { const candidates = [text.match(/Возраст\s*:?\s*([^|]{1,35}?)(?= Пол| Энергия| Здоровье| Настроение|$)/i), text.match(/(\d+\s*(?:год|года|лет)\s*(?:и\s*)?\d*\s*(?:месяц|месяца|месяцев)?)/i), text.match(/(\d+\s*(?:месяц|месяца|месяцев))/i)]; for (const match of candidates) { const value = this.normalize(match?.[1] || ''); if (value && !/смотреть страницу профиля|обучив/i.test(value)) return value; } return null; }
        getSex(text) { const source = text.toLowerCase(); if (/\bжен\b|кобыла|кобылиц/.test(source)) return 'Женский'; if (/\bмуж\b|жеребец|мерин/.test(source)) return 'Мужской'; return null; }
        findNextHorseButton() { const list = [...document.querySelectorAll('a[href*="go=next"], button[onclick*="go=next"], input[onclick*="go=next"], a[href*="sens=suivant"], a[href*="next"], button[title*="след" i], a[title*="след" i], button, a')]; const byHref = list.find((el) => /go=next|sens=suivant/i.test(el.getAttribute('href') || el.getAttribute('onclick') || '')); if (byHref) return byHref; const byText = list.find((el) => /следующ|suivant|next/i.test(this.normalize(el.textContent || el.title || el.getAttribute('aria-label') || ''))); if (byText) return byText; return [...document.querySelectorAll('a')].filter((el) => { const rect = el.getBoundingClientRect(); const text = this.normalize(el.textContent || el.title || ''); const href = el.getAttribute('href') || ''; const arrow = text === '›' || text === '>' || text === '→' || /arrow|next|suivant/i.test(el.className || ''); return arrow || /go=next/i.test(href) || (rect.width >= 20 && rect.height >= 20 && rect.left > innerWidth * 0.45 && rect.top > innerHeight * 0.45); }).pop() || null; }
        describeElement(element) { if (!element) return null; if (element.id) return `#${element.id}`; const href = element.getAttribute('href'); if (href) return `a[href="${href.slice(0, 90)}${href.length > 90 ? '…' : ''}"]`; const title = element.getAttribute('title') || element.getAttribute('aria-label'); if (title) return `${element.tagName.toLowerCase()}[title="${title}"]`; return element.tagName.toLowerCase(); }
    }

    class LowadiAdapter {
        constructor(routeManager) { this.routeManager = routeManager; this.horseParser = new HorseParser(); this.actionSelector = 'button, a, input[type="button"], input[type="submit"], [onclick], [role="button"], .button, .bouton'; }
        getName() { return 'LowadiAdapter'; }
        isSupported() { return location.hostname === 'www.lowadi.com'; }
        getPageInfo() { const pageType = this.routeManager.getCurrentPageType(); return { hostname: location.hostname, url: location.href, pageType, pageTypeLabel: PageLabels[pageType] || PageLabels[PageType.UNKNOWN], adapter: this.getName(), supported: this.isSupported() }; }
        analyzeHorse() { return this.horseParser.parse(); }
        findNextHorseButton() { return this.horseParser.findNextHorseButton(); }
        normalize(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
        getElementText(element) { return this.normalize([element?.textContent, element?.getAttribute?.('title'), element?.getAttribute?.('aria-label'), element?.getAttribute?.('value'), element?.getAttribute?.('alt')].filter(Boolean).join(' ')); }
        isVisible(element) { if (!element || !element.isConnected) return false; const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.15; }
        isDisabled(element) { if (!element) return true; const disabledText = `${element.className || ''} ${element.getAttribute?.('class') || ''} ${element.parentElement?.className || ''}`; return Boolean(element.disabled || element.getAttribute?.('disabled') !== null || element.getAttribute?.('aria-disabled') === 'true' || /disabled|inactif|desactive|inactive|bouton-disabled|button-disabled/i.test(disabledText)); }
        actionCandidates(root = document) { return [...root.querySelectorAll(this.actionSelector)].filter((el, index, array) => array.indexOf(el) === index); }
        findActionControl(words, options = {}) {
            const root = options.root || document;
            if (options.sectionTitle) {
                const sectionHit = this.findActionInSection(options.sectionTitle, words);
                if (sectionHit) return sectionHit;
            }
            const loweredWords = words.map((word) => String(word).toLowerCase());
            const candidates = this.actionCandidates(root);
            const exact = candidates.find((el) => this.isVisible(el) && !this.isDisabled(el) && loweredWords.some((word) => this.getElementText(el).toLowerCase().includes(word)));
            if (exact) return exact;
            return candidates.find((el) => this.isVisible(el) && !this.isDisabled(el) && loweredWords.some((word) => word.length >= 4 && this.getElementText(el).toLowerCase().includes(word.slice(0, 4)))) || null;
        }
        findActionInSection(sectionTitle, words = []) {
            const section = this.findSectionByTitle(sectionTitle);
            if (!section) return null;
            const loweredWords = words.map((word) => String(word).toLowerCase());
            const controls = this.actionCandidates(section).filter((el) => this.isVisible(el) && !this.isDisabled(el));
            const byWords = controls.find((el) => loweredWords.some((word) => this.getElementText(el).toLowerCase().includes(word)));
            if (byWords) return byWords;
            const byNonTitleText = controls.find((el) => { const text = this.getElementText(el).toLowerCase(); return text && text !== String(sectionTitle).toLowerCase() && !/^[-–—]?$/.test(text); });
            return byNonTitleText || controls[0] || null;
        }
        findSectionByTitle(title) {
            const target = String(title || '').toLowerCase();
            const nodes = [...document.querySelectorAll('h1,h2,h3,h4,h5,caption,th,td,div,span')].filter((el) => this.isVisible(el));
            const headings = nodes.filter((el) => { const text = this.getElementText(el).toLowerCase(); return text === target || (text.includes(target) && text.length <= target.length + 20); });
            for (const heading of headings) {
                let node = heading;
                for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
                    const rect = node.getBoundingClientRect();
                    if (rect.width > 80 && rect.height > 60 && this.actionCandidates(node).some((el) => el !== heading && this.isVisible(el) && !this.isDisabled(el))) return node;
                }
            }
            return null;
        }
        async waitFor(predicate, timeout = 5500, step = 180) { const started = Date.now(); while (Date.now() - started < timeout) { const result = predicate(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, step)); } return null; }
        async completeFeeding(delayManager, logger) {
            const panel = await this.waitFor(() => this.findFeedPanel(), 6500, 200);
            if (!panel) return { success: false, reason: 'Окно кормления не найдено' };
            const needs = this.extractFeedNeeds(panel);
            logger?.info(`Кормление: норма корма ${needs[0]?.remaining ?? '—'}, овса ${needs[1]?.remaining ?? '—'}`);
            const sliders = this.findFeedSliders(panel);
            for (let i = 0; i < Math.min(needs.length, 2); i += 1) {
                const need = needs[i];
                if (!need || need.remaining <= 0) continue;
                const slider = sliders[i] || sliders[0];
                if (!slider) return { success: false, reason: 'Ползунок корма не найден' };
                this.setSliderValue(slider, need.remaining, need.max || need.total || need.remaining);
                await delayManager.random(250, 650);
            }
            const submit = this.findActionControl(['Дать поесть', 'Покормить', 'Накормить', 'Valider', 'Donner à manger', 'Feed'], { root: panel }) || this.findSubmitByText(panel, ['Дать поесть', 'Покормить', 'Накормить']);
            if (!submit) return { success: false, reason: 'Кнопка «Дать поесть» не найдена' };
            submit.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            await delayManager.random(250, 650);
            submit.click();
            return { success: true, needs };
        }
        findFeedPanel() {
            const candidates = [...document.querySelectorAll('div, section, form, table, td')].filter((el) => this.isVisible(el));
            const matching = candidates.filter((el) => { const text = this.normalize(el.innerText || el.textContent || ''); return /Кормить/i.test(text) && /Корм/i.test(text) && /Овес/i.test(text) && /Дать поесть/i.test(text); });
            return matching.sort((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height) - (b.getBoundingClientRect().width * b.getBoundingClientRect().height))[0] || null;
        }
        extractFeedNeeds(panel) {
            const text = this.normalize(panel.innerText || panel.textContent || '');
            const matches = [...text.matchAll(/(\d+)\s*\/\s*(\d+)/g)].map((match) => ({ eaten: Number(match[1]), total: Number(match[2]), remaining: Math.max(0, Number(match[2]) - Number(match[1])) }));
            const maxValues = this.extractSliderMaxValues(panel);
            return matches.slice(0, 2).map((item, index) => ({ ...item, max: Math.max(item.total, maxValues[index] || item.total) }));
        }
        extractSliderMaxValues(panel) {
            const rows = [...panel.querySelectorAll('div, td, tr, span')].map((el) => this.normalize(el.innerText || el.textContent || '')).filter((text) => /\b0\b/.test(text) && /\b2\b/.test(text) && text.length <= 80);
            return rows.slice(0, 2).map((row) => Math.max(...(row.match(/\d+/g) || ['0']).map(Number)));
        }
        findFeedSliders(panel) {
            const selectors = 'input[type="range"], .ui-slider, [class*="slider"], [class*="Slider"], [class*="reglette"], [class*="Reglette"], [class*="jauge"], [class*="quantite"]';
            const direct = [...panel.querySelectorAll(selectors)].filter((el) => this.isVisible(el) && el.getBoundingClientRect().width >= 80).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            if (direct.length >= 2 || direct.some((el) => el.matches('input[type="range"]'))) return [...new Set(direct)];
            const wideRows = [...panel.querySelectorAll('div, table, tbody, tr, td, ul, li')].filter((el) => { const rect = el.getBoundingClientRect(); const text = this.normalize(el.innerText || el.textContent || ''); return this.isVisible(el) && rect.width >= 150 && rect.height >= 12 && rect.height <= 95 && /\b0\b/.test(text) && /\b2\b/.test(text) && (text.match(/\d+/g) || []).length >= 4; }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            return [...new Set(wideRows)].slice(0, 2);
        }
        setSliderValue(slider, value, max) {
            const amount = Math.max(0, Number(value) || 0);
            const upper = Math.max(1, Number(max) || amount || 1);
            if (slider.matches?.('input[type="range"]')) { slider.value = String(amount); slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); return; }
            const rect = slider.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, amount / upper));
            const x = rect.left + Math.max(6, Math.min(rect.width - 6, rect.width * ratio));
            const y = rect.top + rect.height / 2;
            const target = document.elementFromPoint(x, y) || slider;
            this.mouse(target, 'mousemove', x, y);
            this.mouse(target, 'mousedown', x, y);
            this.mouse(target, 'mouseup', x, y);
            this.mouse(target, 'click', x, y);
            ['input', 'change'].forEach((name) => slider.dispatchEvent(new Event(name, { bubbles: true })));
        }
        mouse(target, type, x, y) { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y })); }
        findSubmitByText(root, words) { const lowered = words.map((w) => w.toLowerCase()); return [...root.querySelectorAll('*')].find((el) => this.isVisible(el) && lowered.some((w) => this.getElementText(el).toLowerCase().includes(w))) || null; }
        describeControl(element) { return this.horseParser.describeElement(element); }
    }

    class BasicCareModule {
        constructor({ adapter, settingsManager, stateManager, logger, delayManager }) { this.adapter = adapter; this.settingsManager = settingsManager; this.stateManager = stateManager; this.logger = logger; this.delayManager = delayManager; }
        getEnabledActions() { return CareActions.filter((action) => this.settingsManager.get('care', action.id)); }
        async performCare() {
            const actions = this.getEnabledActions();
            let done = 0; let skipped = 0;
            for (const action of actions) {
                if (this.stateManager.get().status !== AppStatus.RUNNING) break;
                this.stateManager.patch({ currentOperation: action.operation });
                const result = action.special === 'feed' ? await this.performFeed(action) : await this.performSimple(action);
                if (result) { done += 1; this.stateManager.incrementCareActions(); this.logger.success(`${action.label}: выполнено`); await this.delayManager.random(900, 1900); }
                else { skipped += 1; }
            }
            return { success: true, done, skipped };
        }
        async performSimple(action) {
            const control = this.adapter.findActionControl(action.words, { sectionTitle: action.sectionTitle });
            if (!control) { this.logger.warn(`${action.label}: кнопка не найдена или действие недоступно`); return false; }
            await this.safeClick(control, action.label);
            return true;
        }
        async performFeed(action) {
            const control = this.adapter.findActionControl(action.words);
            if (!control) { this.logger.warn(`${action.label}: кнопка кормления не найдена или действие недоступно`); return false; }
            await this.safeClick(control, action.label);
            await this.delayManager.random(700, 1300);
            const result = await this.adapter.completeFeeding(this.delayManager, this.logger);
            if (!result.success) { this.logger.warn(`${action.label}: ${result.reason}`); return false; }
            return true;
        }
        async safeClick(element, label) { element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }); await this.delayManager.random(250, 650); this.logger.info(`Нажимаю: ${label}`); element.click(); }
    }

    class HerdRunner {
        constructor({ adapter, stateManager, settingsManager, logger, delayManager, careModule }) { this.adapter = adapter; this.stateManager = stateManager; this.settingsManager = settingsManager; this.logger = logger; this.delayManager = delayManager; this.careModule = careModule; this.timer = null; this.isExecuting = false; }
        isAutoLimit() { return this.settingsManager.get('run', 'limitMode') === 'auto'; }
        async start() { const pageInfo = this.adapter.getPageInfo(); const max = Number(this.settingsManager.get('run', 'maxHorsesPerRun') || 25); if (pageInfo.pageType !== PageType.HORSE) { this.logger.warn('Откройте страницу лошади для запуска табунного режима'); this.stateManager.patch({ pageType: pageInfo.pageType, currentOperation: 'Нужна страница лошади' }); return; } this.stateManager.start(this.isAutoLimit() ? 0 : max, this.isAutoLimit() ? 'auto' : 'manual'); this.logger.success(this.isAutoLimit() ? 'Табунный режим запущен: Авто до конца завода' : `Табунный режим запущен: лимит ${max}`); await this.processCurrentHorseAndGoNext(); }
        pause() { this.clearTimer(); this.stateManager.pause(); this.logger.warn('Пауза. Продолжение сохранено.'); }
        async resume() { if (this.stateManager.get().status !== AppStatus.PAUSED) return; this.stateManager.resume(); this.logger.success('Продолжаю с текущей страницы'); await this.processCurrentHorseAndGoNext(); }
        stop() { this.clearTimer(); this.stateManager.stop('Остановлено', true); this.logger.warn('Табунный режим остановлен, счётчик обработанных сброшен'); }
        softStop() { this.stateManager.requestSoftStop(); this.logger.warn('Включена мягкая остановка после текущей лошади'); }
        scheduleAutoResume() { const state = this.stateManager.get(); if (state.status !== AppStatus.RUNNING || state.mode !== 'hybrid-herd') return; this.clearTimer(); this.timer = setTimeout(() => this.processCurrentHorseAndGoNext(), 1200); }
        clearTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
        async processCurrentHorseAndGoNext() {
            if (this.isExecuting) return; this.isExecuting = true;
            try {
                const state = this.stateManager.get(); const pageInfo = this.adapter.getPageInfo();
                if (state.status !== AppStatus.RUNNING) return;
                if (pageInfo.pageType !== PageType.HORSE) { this.logger.warn('Текущая страница не является страницей лошади. Останавливаюсь.'); this.stateManager.error('Не страница лошади'); return; }
                const horse = this.adapter.analyzeHorse(); const id = horse.id || location.href; const processedIds = state.run.processedIds || [];
                if (processedIds.includes(id)) { this.stateManager.stop(state.run.limitMode === 'auto' ? 'Завод пройден' : 'Остановлено: круг табуна', false); this.logger.success(state.run.limitMode === 'auto' ? 'Авто-режим завершён: похоже, все лошади пройдены' : 'Похоже, табун пошёл по кругу. Работа остановлена.'); return; }
                this.stateManager.patch({ currentOperation: 'Анализ текущей лошади', pageType: pageInfo.pageType, currentHorse: horse, currentHorseName: horse.name || '—', currentHorseId: id });
                this.logger.info(`Текущая лошадь: ${horse.name || id}`);
                await this.careModule.performCare();
                if (this.stateManager.get().status !== AppStatus.RUNNING) return;
                const freshHorse = this.adapter.analyzeHorse(); this.stateManager.markHorseProcessed({ ...freshHorse, id }); this.logger.success(`Лошадь обработана: ${freshHorse.name || horse.name || id}`);
                const freshState = this.stateManager.get(); const max = freshState.progress.total || Number(this.settingsManager.get('run', 'maxHorsesPerRun') || 25); const stopAfterCurrent = this.settingsManager.get('run', 'stopAfterCurrentHorse') || freshState.run.softStopRequested;
                if (freshState.run.limitMode !== 'auto' && freshState.progress.current >= max) { this.logger.success(`Достигнут лимит запуска: ${max}`); this.stateManager.stop('Достигнут лимит', false); return; }
                if (stopAfterCurrent) { this.logger.success('Мягкая остановка выполнена после текущей лошади'); this.stateManager.stop('Мягкая остановка', false); return; }
                const nextButton = this.adapter.findNextHorseButton(); if (!nextButton) { this.logger.error('Кнопка следующей лошади не найдена'); this.stateManager.error('Нет кнопки следующей лошади'); return; }
                this.stateManager.patch({ currentOperation: 'Переход к следующей лошади' }); await this.delayManager.random(); await this.safeClick(nextButton, 'следующая лошадь');
            } catch (error) { console.error(error); this.logger.error(`Ошибка табунного режима: ${error.message}`); this.stateManager.error(error.message); }
            finally { this.isExecuting = false; }
        }
        async safeClick(element, label) { element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }); await this.delayManager.random(250, 650); this.logger.info(`Нажимаю: ${label}`); element.click(); }
    }

    class UIManager {
        constructor({ eventBus, logger, settingsManager, stateManager, adapter, runner }) { this.eventBus = eventBus; this.logger = logger; this.settingsManager = settingsManager; this.stateManager = stateManager; this.adapter = adapter; this.runner = runner; this.host = null; this.root = null; this.drag = null; this.runtimeTimer = null; this.latestAnalysis = settingsManager.storage.get('latestAnalysis', null); this.activePage = settingsManager.storage.get('ui', {})?.activePage || 'home'; this.pages = [{ id: 'home', icon: '🏠', label: 'Главная' }, { id: 'run', icon: '🐴', label: 'Прогон' }, { id: 'developer', icon: '🧪', label: 'Разработчик' }, { id: 'settings', icon: '⚙', label: 'Настройки' }]; }
        mount() { if (document.getElementById(`${APP.id}-root`)) return; this.host = document.createElement('div'); this.host.id = `${APP.id}-root`; document.documentElement.appendChild(this.host); this.root = this.host.attachShadow({ mode: 'open' }); this.render(); this.startRuntimeTimer(); this.eventBus.on('state:changed', () => this.render()); this.eventBus.on('settings:changed', () => this.render()); this.eventBus.on('log:changed', () => this.render()); }
        getTheme() { const theme = this.settingsManager.get('appearance', 'theme'); if (theme !== 'auto') return theme; return matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
        getRuntimeText() { const state = this.stateManager.get(); if (!state.startedAt) return '00:00'; const end = state.status === AppStatus.RUNNING || state.status === AppStatus.PAUSED ? Date.now() : state.finishedAt || state.lastActionAt || Date.now(); return this.formatDuration(Math.max(0, end - state.startedAt)); }
        startRuntimeTimer() { if (this.runtimeTimer) clearInterval(this.runtimeTimer); this.runtimeTimer = setInterval(() => this.updateRuntimeNodes(), 1000); this.updateRuntimeNodes(); }
        updateRuntimeNodes() { if (!this.root) return; this.root.querySelectorAll('[data-runtime]').forEach((node) => { node.textContent = this.getRuntimeText(); }); }
        render() { const settings = this.settingsManager.all(); const ui = this.settingsManager.storage.get('ui', { x: null, y: null, minimized: false, activePage: 'home' }); this.root.innerHTML = `<style>${this.styles()}</style><div class="hm-app hm-theme-${this.getTheme()} ${settings.appearance.compactMode ? 'hm-compact' : ''} ${ui.minimized ? 'hm-minimized' : ''}" style="${this.positionStyle(ui)}"><div class="hm-shell"><aside class="hm-sidebar"><div class="hm-brand hm-drag-handle"><div class="hm-brand-icon">🐴</div><div><div class="hm-brand-title">Howrse Manager</div><div class="hm-brand-subtitle">v${APP.version}</div></div></div><nav class="hm-nav">${this.pages.map((p) => `<button class="hm-nav-item ${this.activePage === p.id ? 'hm-active' : ''}" data-page="${p.id}"><span>${p.icon}</span><span>${p.label}</span></button>`).join('')}</nav></aside><main class="hm-content"><header class="hm-header hm-drag-handle"><div><div class="hm-kicker">Tampermonkey application</div><h1>${this.title()}</h1></div><div class="hm-window-actions"><button class="hm-icon-button" data-action="toggle-theme">${this.getTheme() === 'dark' ? '🌙' : '☀'}</button><button class="hm-icon-button" data-action="toggle-minimize">${ui.minimized ? '□' : '—'}</button></div></header><section class="hm-page">${this.renderPage()}</section></main></div></div>`; this.bindDynamicEvents(); this.updateRuntimeNodes(); }
        positionStyle(ui) { if (ui.x === null || ui.x === undefined || ui.y === null || ui.y === undefined) return ''; const x = Math.max(12, Math.min(innerWidth - 180, Number(ui.x))); const y = Math.max(12, Math.min(innerHeight - 120, Number(ui.y))); return `left:${x}px;top:${y}px;right:auto;bottom:auto;height:min(720px,calc(100vh - ${y + 16}px));max-height:calc(100vh - ${y + 16}px);`; }
        title() { const page = this.pages.find((p) => p.id === this.activePage); return page ? `${page.icon} ${page.label}` : APP.name; }
        renderPage() { return ({ home: () => this.renderHome(), run: () => this.renderRun(), developer: () => this.renderDeveloper(), settings: () => this.renderSettings() }[this.activePage] || (() => this.renderHome()))(); }
        renderHome() { const state = this.stateManager.get(); return `<div class="hm-grid hm-grid-2"><div class="hm-card"><div class="hm-card-title">Состояние</div><div class="hm-status-row"><span class="hm-status hm-status-${state.status}">${this.statusLabel(state.status)}</span><span class="hm-muted">Время: <span data-runtime>${this.getRuntimeText()}</span></span></div>${this.infoList([['Текущая лошадь', state.currentHorseName || '—'], ['Операция', state.currentOperation || '—'], ['Прогресс', `${state.progress.current} / ${this.formatTotal(state)}`], ['Действий ухода', state.stats.careActions || 0]])}${this.mainButtons()}</div><div class="hm-card hm-card-accent"><div class="hm-card-title">v0.4.1: миссия и кормление</div><p>Миссия ищется по блоку «Миссия», а не только по тексту кнопки. Для корма открывается окно выбора фуража, выставляются остатки нормы корма и овса, затем нажимается «Дать поесть».</p></div></div>${this.logPanel()}`; }
        renderRun() { return `<div class="hm-grid hm-grid-2"><div class="hm-card"><div class="hm-card-title">Гибридный прогон табуна</div><p>Маршрут: текущая лошадь → базовый уход → отметка обработки → следующая лошадь.</p>${this.settingsSection('run')}${this.settingsSection('care')}${this.settingsSection('delays')}</div><div class="hm-card"><div class="hm-card-title">Управление</div>${this.mainButtons()}</div></div>`; }
        renderDeveloper() { const pageInfo = this.adapter.getPageInfo(); const analysis = this.latestAnalysis || this.adapter.analyzeHorse(); return `<div class="hm-grid hm-grid-2"><div class="hm-card"><div class="hm-card-title">Диагностика страницы</div>${this.settingsSection('developer')}${this.infoList([['Домен', pageInfo.hostname], ['Тип страницы', pageInfo.pageTypeLabel], ['Адаптер', pageInfo.adapter], ['Страница лошади', pageInfo.pageType === PageType.HORSE ? 'да' : 'нет']])}<div class="hm-actions hm-actions-left"><button class="hm-button hm-primary" data-action="analyze">Обновить анализ</button></div></div><div class="hm-card"><div class="hm-card-title">Найденные данные</div>${this.renderAnalysis(analysis)}<div class="hm-card-title hm-subtitle">Кнопки ухода</div>${this.careDiagnostics()}</div></div>`; }
        renderAnalysis(a) { if (!a) return '<div class="hm-empty">Пока нет анализа.</div>'; return `${this.infoList([['ID', a.id || '—'], ['Имя', a.name || '—'], ['Энергия', this.valueOrDash(a.energy, '%')], ['Здоровье', this.valueOrDash(a.health, '%')], ['Настроение', this.valueOrDash(a.mood, '%')], ['Возраст', a.age || '—'], ['Пол', a.sex || '—'], ['Кнопка следующей лошади', a.hasNextHorseButton ? 'найдена' : 'не найдена'], ['Селектор кнопки', a.nextHorseButtonSelector || '—']])}<details class="hm-details"><summary>Сырой текст страницы</summary><pre>${this.escapeHtml(a.pageTextSample || '')}</pre></details>`; }
        careDiagnostics() { return this.infoList(CareActions.map((a) => { const control = this.adapter.findActionControl(a.words, { sectionTitle: a.sectionTitle }); return [a.label, control ? 'найдена' : 'не найдена']; })); }
        renderSettings() { return `<div class="hm-card"><div class="hm-card-title">Настройки</div>${this.settingsSection('appearance')}${this.settingsSection('delays')}<div class="hm-actions hm-actions-left"><button class="hm-button hm-danger" data-action="reset-settings">Сбросить настройки</button><button class="hm-button" data-action="clear-log">Очистить лог</button></div></div>`; }
        settingsSection(id) { const section = settingsSchema.find((s) => s.id === id); if (!section) return ''; return `<div class="hm-settings-section"><div class="hm-section-title">${section.title}</div><p class="hm-muted">${section.description}</p>${section.fields.map((f) => this.field(section.id, f)).join('')}</div>`; }
        field(sectionId, f) { const value = this.settingsManager.get(sectionId, f.id); const id = `hm-${sectionId}-${f.id}`; if (f.type === 'checkbox') return `<label class="hm-field hm-field-checkbox" for="${id}"><input id="${id}" type="checkbox" data-setting-section="${sectionId}" data-setting-field="${f.id}" ${value ? 'checked' : ''}><span>${f.label}</span></label>`; if (f.type === 'select') return `<label class="hm-field" for="${id}"><span>${f.label}</span><select id="${id}" data-setting-section="${sectionId}" data-setting-field="${f.id}">${f.options.map((o) => `<option value="${o.value}" ${o.value === value ? 'selected' : ''}>${o.label}</option>`).join('')}</select></label>`; if (f.type === 'number') return `<label class="hm-field" for="${id}"><span>${f.label}</span><input id="${id}" type="number" value="${value}" min="${f.min}" max="${f.max}" step="${f.step || 1}" data-setting-section="${sectionId}" data-setting-field="${f.id}"></label>`; return ''; }
        mainButtons() { return `<div class="hm-actions"><button class="hm-button hm-primary" data-action="start">Старт</button><button class="hm-button" data-action="pause">Пауза</button><button class="hm-button" data-action="resume">Продолжить</button><button class="hm-button hm-danger" data-action="stop">Стоп</button></div><div class="hm-actions hm-actions-left"><button class="hm-small-button" data-action="soft-stop">Остановить после текущей</button><button class="hm-small-button" data-action="analyze">Анализ</button></div>`; }
        logPanel() { const items = this.logger.all().slice(0, 16); return `<div class="hm-card hm-log-card"><div class="hm-card-header"><div class="hm-card-title">Лог</div><button class="hm-small-button" data-action="clear-log">Очистить</button></div><div class="hm-log-list">${items.length ? items.map((i) => `<div class="hm-log-item hm-log-${i.level}"><span>${i.time}</span><strong>${this.escapeHtml(i.message)}</strong></div>`).join('') : '<div class="hm-empty">Лог пока пуст.</div>'}</div></div>`; }
        infoList(rows) { return `<div class="hm-info-list">${rows.map(([k, v]) => `<div><span>${this.escapeHtml(k)}</span><strong>${this.escapeHtml(v)}</strong></div>`).join('')}</div>`; }
        bindDynamicEvents() { this.root.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => { this.activePage = button.dataset.page; const ui = this.settingsManager.storage.get('ui', {}); this.settingsManager.storage.set('ui', { ...ui, activePage: this.activePage }); this.render(); })); this.root.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => this.handleAction(button.dataset.action))); this.root.querySelectorAll('[data-setting-section]').forEach((input) => input.addEventListener('change', () => { const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value; this.settingsManager.set(input.dataset.settingSection, input.dataset.settingField, value); this.logger.info(`Настройка сохранена: ${input.dataset.settingField}`); })); this.bindDrag(); }
        bindDrag() { const app = this.root.querySelector('.hm-app'); const handles = this.root.querySelectorAll('.hm-drag-handle'); if (!app) return; handles.forEach((handle) => handle.addEventListener('mousedown', (event) => { if (event.target.closest('button')) return; const rect = app.getBoundingClientRect(); this.drag = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }; event.preventDefault(); })); const move = (event) => { if (!this.drag) return; const x = Math.max(12, Math.min(innerWidth - 120, event.clientX - this.drag.offsetX)); const y = Math.max(12, Math.min(innerHeight - 120, event.clientY - this.drag.offsetY)); app.style.left = `${x}px`; app.style.top = `${y}px`; app.style.right = 'auto'; app.style.bottom = 'auto'; }; const up = () => { if (!this.drag) return; const rect = app.getBoundingClientRect(); const ui = this.settingsManager.storage.get('ui', {}); this.settingsManager.storage.set('ui', { ...ui, x: Math.round(rect.left), y: Math.round(rect.top), activePage: this.activePage }); this.drag = null; }; document.removeEventListener('mousemove', this._move); document.removeEventListener('mouseup', this._up); this._move = move; this._up = up; document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); }
        async handleAction(action) { const ui = this.settingsManager.storage.get('ui', { minimized: false }); if (action === 'start') return this.runner.start(); if (action === 'pause') return this.runner.pause(); if (action === 'resume') return this.runner.resume(); if (action === 'stop') return this.runner.stop(); if (action === 'soft-stop') return this.runner.softStop(); if (action === 'analyze') { const analysis = this.adapter.analyzeHorse(); this.latestAnalysis = analysis; this.settingsManager.storage.set('latestAnalysis', analysis); this.stateManager.patch({ currentHorse: analysis, currentHorseName: analysis.name || '—', currentHorseId: analysis.id || null, pageType: this.adapter.getPageInfo().pageType }); this.logger.success('Анализ страницы обновлён'); this.activePage = 'developer'; this.settingsManager.storage.set('ui', { ...ui, activePage: this.activePage }); this.render(); return; } if (action === 'clear-log') { this.logger.clear(); this.logger.info('Лог очищен'); return; } if (action === 'reset-settings') { this.settingsManager.reset(); this.logger.warn('Настройки сброшены'); return; } if (action === 'toggle-theme') { const next = this.getTheme() === 'dark' ? 'light' : 'dark'; this.settingsManager.set('appearance', 'theme', next); return; } if (action === 'toggle-minimize') { this.settingsManager.storage.set('ui', { ...ui, minimized: !ui.minimized, activePage: this.activePage }); this.render(); } }
        statusLabel(status) { return ({ idle: 'Ожидание', running: 'Работает', paused: 'Пауза', stopped: 'Остановлено', error: 'Ошибка' })[status] || status; }
        formatTotal(state) { return state.run?.limitMode === 'auto' ? 'Авто' : (state.progress.total || this.settingsManager.get('run', 'maxHorsesPerRun')); }
        formatDuration(ms) { const seconds = Math.floor(ms / 1000); const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0'); const s = (seconds % 60).toString().padStart(2, '0'); return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`; }
        valueOrDash(value, suffix = '') { return value === null || value === undefined || value === '' ? '—' : `${value}${suffix}`; }
        escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
        styles() { return `:host{all:initial;color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}.hm-app{--hm-bg:rgba(248,250,252,.98);--hm-panel:#fff;--hm-panel-soft:#f8fafc;--hm-text:#172033;--hm-muted:#64748b;--hm-border:rgba(148,163,184,.25);--hm-primary:#7c3aed;--hm-primary-2:#a855f7;--hm-primary-soft:rgba(124,58,237,.12);--hm-danger:#e11d48;--hm-success:#059669;--hm-warn:#d97706;--hm-shadow:0 24px 80px rgba(15,23,42,.22);position:fixed;right:24px;bottom:24px;width:900px;max-width:calc(100vw - 32px);height:min(720px,calc(100vh - 32px));max-height:calc(100vh - 32px);z-index:2147483647;color:var(--hm-text);font-size:14px;line-height:1.45}.hm-theme-dark{--hm-bg:rgba(15,23,42,.98);--hm-panel:#111827;--hm-panel-soft:#0f172a;--hm-text:#e5e7eb;--hm-muted:#94a3b8;--hm-border:rgba(148,163,184,.22);--hm-primary:#a78bfa;--hm-primary-2:#7c3aed;--hm-primary-soft:rgba(167,139,250,.16);--hm-danger:#fb7185;--hm-success:#34d399;--hm-warn:#fbbf24;--hm-shadow:0 24px 80px rgba(0,0,0,.5)}.hm-shell{display:grid;grid-template-columns:220px minmax(0,1fr);width:100%;height:100%;min-height:0;overflow:hidden;background:var(--hm-bg);border:1px solid var(--hm-border);border-radius:24px;box-shadow:var(--hm-shadow);backdrop-filter:blur(18px)}.hm-minimized{width:310px;height:76px!important;max-height:76px!important}.hm-minimized .hm-sidebar,.hm-minimized .hm-page,.hm-minimized .hm-kicker{display:none}.hm-minimized .hm-shell{display:block;border-radius:20px}.hm-minimized .hm-content,.hm-minimized .hm-header{height:100%}.hm-sidebar{min-height:0;overflow:auto;padding:18px;border-right:1px solid var(--hm-border);background:linear-gradient(180deg,var(--hm-primary-soft),transparent 55%)}.hm-brand{display:flex;gap:12px;align-items:center;margin-bottom:20px;cursor:move;user-select:none}.hm-brand-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:14px;background:var(--hm-primary-soft);font-size:22px}.hm-brand-title{font-weight:800;letter-spacing:-.03em}.hm-brand-subtitle,.hm-kicker,.hm-muted{color:var(--hm-muted);font-size:12px}.hm-nav{display:grid;gap:6px}.hm-nav-item,.hm-button,.hm-icon-button,.hm-small-button{border:0;font:inherit;color:inherit;cursor:pointer}.hm-nav-item{display:flex;gap:10px;align-items:center;width:100%;padding:10px 12px;border-radius:14px;background:transparent;color:var(--hm-muted);text-align:left;transition:.18s ease}.hm-nav-item:hover,.hm-nav-item.hm-active{color:var(--hm-text);background:var(--hm-primary-soft)}.hm-content{display:flex;flex-direction:column;min-width:0;min-height:0}.hm-header{flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px 22px;border-bottom:1px solid var(--hm-border);cursor:move;user-select:none}.hm-header h1{margin:2px 0 0;font-size:22px;line-height:1.1;letter-spacing:-.04em}.hm-window-actions,.hm-actions{display:flex;gap:8px;align-items:center}.hm-page{flex:1 1 auto;min-height:0;overflow:auto;padding:20px 22px;scrollbar-width:thin;scrollbar-color:var(--hm-primary) transparent}.hm-grid{display:grid;gap:14px;margin-bottom:14px}.hm-grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}.hm-card,.hm-stat{padding:16px;border:1px solid var(--hm-border);border-radius:20px;background:var(--hm-panel)}.hm-card-accent{background:linear-gradient(135deg,var(--hm-primary-soft),var(--hm-panel))}.hm-card-title,.hm-section-title{margin-bottom:10px;font-weight:800;letter-spacing:-.02em}.hm-subtitle{margin-top:16px}.hm-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.hm-status-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.hm-status{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:var(--hm-primary-soft);font-weight:700}.hm-status-running,.hm-log-success{color:var(--hm-success)}.hm-status-paused,.hm-log-warn{color:var(--hm-warn)}.hm-status-error,.hm-log-error{color:var(--hm-danger)}.hm-info-list{display:grid;gap:8px;margin:12px 0 16px}.hm-info-list div{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--hm-border)}.hm-info-list span{color:var(--hm-muted)}.hm-info-list strong{overflow-wrap:anywhere;min-width:0}.hm-actions{justify-content:flex-end;margin-top:12px;flex-wrap:wrap}.hm-actions-left{justify-content:flex-start}.hm-button,.hm-icon-button,.hm-small-button{border-radius:12px;background:var(--hm-panel-soft);transition:.18s ease}.hm-button{padding:9px 13px;font-weight:700}.hm-small-button{padding:6px 10px;color:var(--hm-muted);font-size:12px}.hm-icon-button{display:grid;place-items:center;width:36px;height:36px}.hm-button:hover,.hm-icon-button:hover,.hm-small-button:hover{transform:translateY(-1px);filter:brightness(1.04)}.hm-primary{background:linear-gradient(135deg,var(--hm-primary),var(--hm-primary-2));color:#fff}.hm-danger{background:rgba(225,29,72,.12);color:var(--hm-danger)}.hm-empty{margin-top:12px;padding:12px;border-radius:14px;background:var(--hm-panel-soft);color:var(--hm-muted)}.hm-settings-section{margin-top:14px;padding-top:14px;border-top:1px solid var(--hm-border)}.hm-field{display:grid;grid-template-columns:1fr minmax(150px,230px);align-items:center;gap:12px;margin:10px 0}.hm-field-checkbox{display:flex;justify-content:flex-start}.hm-field input,.hm-field select{width:100%;padding:8px 10px;border:1px solid var(--hm-border);border-radius:12px;background:var(--hm-panel-soft);color:var(--hm-text);font:inherit}.hm-field-checkbox input{width:auto;accent-color:var(--hm-primary)}.hm-log-list{display:grid;gap:7px;max-height:230px;overflow:auto}.hm-log-item{display:grid;grid-template-columns:72px minmax(0,1fr);gap:10px;padding:8px 10px;border-radius:12px;background:var(--hm-panel-soft)}.hm-log-item span{color:var(--hm-muted);font-size:12px}.hm-details{margin-top:12px;color:var(--hm-muted)}.hm-details pre{max-height:150px;overflow:auto;white-space:pre-wrap;padding:12px;border-radius:14px;background:var(--hm-panel-soft);color:var(--hm-text);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:760px){.hm-app{left:12px!important;right:12px!important;bottom:12px;width:auto;height:min(680px,calc(100vh - 24px));max-height:calc(100vh - 24px)}.hm-shell{grid-template-columns:1fr}.hm-sidebar{border-right:0;border-bottom:1px solid var(--hm-border);max-height:220px}.hm-nav{grid-template-columns:repeat(2,minmax(0,1fr))}.hm-grid-2{grid-template-columns:1fr}}`; }
    }

    class Application {
        constructor() { this.eventBus = new EventBus(); this.storage = new Storage(APP.storagePrefix); this.settingsManager = new SettingsManager(this.eventBus, this.storage, settingsSchema); this.logger = new Logger(this.eventBus, this.storage); this.stateManager = new StateManager(this.eventBus, this.storage); this.delayManager = new DelayManager(this.settingsManager); this.routeManager = new RouteManager(); this.adapter = new LowadiAdapter(this.routeManager); this.careModule = new BasicCareModule({ adapter: this.adapter, settingsManager: this.settingsManager, stateManager: this.stateManager, logger: this.logger, delayManager: this.delayManager }); this.runner = new HerdRunner({ adapter: this.adapter, stateManager: this.stateManager, settingsManager: this.settingsManager, logger: this.logger, delayManager: this.delayManager, careModule: this.careModule }); this.ui = new UIManager({ eventBus: this.eventBus, logger: this.logger, settingsManager: this.settingsManager, stateManager: this.stateManager, adapter: this.adapter, runner: this.runner }); }
        start() { const pageInfo = this.adapter.getPageInfo(); const analysis = pageInfo.pageType === PageType.HORSE ? this.adapter.analyzeHorse() : null; const state = this.stateManager.get(); this.stateManager.patch({ pageType: pageInfo.pageType, currentHorse: analysis, currentHorseName: analysis?.name || state.currentHorseName || '—', currentHorseId: analysis?.id || state.currentHorseId || null }); this.storage.set('latestAnalysis', analysis); this.ui.mount(); this.logger.info('Howrse Manager загружен'); this.logger.info(`Адаптер: ${pageInfo.adapter}`); this.runner.scheduleAutoResume(); }
    }

    function bootstrap() { const app = new Application(); app.start(); window.HowrseManager = app; }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    else bootstrap();
}());
