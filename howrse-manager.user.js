// ==UserScript==
// @name         Howrse Manager
// @namespace    https://github.com/less-exe/HowrseManager
// @version      0.2.0
// @description  Умный менеджер табуна для Ловади / Howrse. v0.2: интерфейс, настройки, лог, анализ страницы и текущей лошади.
// @author       less-exe
// @match        https://www.lowadi.com/*
// @match        http://www.lowadi.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lowadi.com
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const APP = {
        id: 'howrse-manager',
        rootId: 'hm-root',
        version: '0.2.0',
        storagePrefix: 'hm.',
        supportedHost: 'www.lowadi.com'
    };

    const DEFAULT_SETTINGS = {
        version: 2,
        ui: {
            theme: 'auto',
            collapsed: false,
            activePage: 'home'
        },
        delays: {
            mode: 'medium',
            min: 700,
            max: 1600
        },
        run: {
            mode: 'hybrid',
            stopAfterCurrentHorse: false,
            maxErrorsInRow: 10
        },
        care: {
            brush: true,
            lesson: true,
            activity: true,
            stroke: true,
            water: true,
            feed: true,
            sleep: true,
            minEnergyPercent: 20,
            finishActivityAtEnergyPercent: 20
        },
        activity: {
            mode: 'auto',
            trainings: true,
            rides: true,
            competitions: false
        },
        ec: {
            autoRegister: false,
            maxPrice: 20,
            duration: 3,
            searchMode: 'smart',
            requirements: {
                fodder: true,
                oats: true,
                carrot: true,
                shower: false,
                vet: false,
                forge: false,
                largeBoxes: false,
                meadow: false
            }
        },
        blacklist: {
            foals: true,
            pregnant: true,
            breeders: false,
            vip: false,
            onSale: true,
            coverings: false,
            blackMarketItems: false
        },
        developer: {
            enabled: true,
            showSelectors: true,
            autoRefresh: true
        }
    };

    const SETTINGS_SCHEMA = {
        run: {
            title: 'Прогон',
            description: 'Базовая последовательность будущего прогона табуна.',
            fields: [
                { path: 'care.brush', type: 'checkbox', label: 'Чистка' },
                { path: 'care.lesson', type: 'checkbox', label: 'Урок' },
                { path: 'care.activity', type: 'checkbox', label: 'Активность' },
                { path: 'care.stroke', type: 'checkbox', label: 'Ласка' },
                { path: 'care.water', type: 'checkbox', label: 'Вода' },
                { path: 'care.feed', type: 'checkbox', label: 'Корм' },
                { path: 'care.sleep', type: 'checkbox', label: 'Сон' },
                { path: 'care.minEnergyPercent', type: 'number', label: 'Не выполнять действия если энергия ниже', min: 0, max: 100, suffix: '%' },
                { path: 'care.finishActivityAtEnergyPercent', type: 'number', label: 'Заканчивать активность при энергии', min: 0, max: 100, suffix: '%' }
            ]
        },
        activity: {
            title: 'Активность',
            description: 'Тренировки, прогулки и соревнования. В v0.2 только настройки, без кликов.',
            fields: [
                { path: 'activity.mode', type: 'select', label: 'Режим', options: [
                    { value: 'auto', label: 'Авто' },
                    { value: 'manual', label: 'Ручной' }
                ] },
                { path: 'activity.trainings', type: 'checkbox', label: 'Тренировки' },
                { path: 'activity.rides', type: 'checkbox', label: 'Прогулки' },
                { path: 'activity.competitions', type: 'checkbox', label: 'Соревнования' }
            ]
        },
        ec: {
            title: 'КСК',
            description: 'Заготовка будущего умного поиска КСК.',
            fields: [
                { path: 'ec.autoRegister', type: 'checkbox', label: 'Автоматическая запись' },
                { path: 'ec.maxPrice', type: 'number', label: 'Максимальная цена', min: 0, max: 10000, suffix: 'экю/день' },
                { path: 'ec.duration', type: 'select', label: 'Длительность', options: [
                    { value: 3, label: '3 дня' },
                    { value: 10, label: '10 дней' },
                    { value: 30, label: '30 дней' },
                    { value: 60, label: '60 дней' }
                ] },
                { path: 'ec.searchMode', type: 'select', label: 'Поведение поиска', options: [
                    { value: 'strict', label: 'Строгий поиск' },
                    { value: 'smart', label: 'Умный поиск' }
                ] },
                { path: 'ec.requirements.fodder', type: 'checkbox', label: 'Фураж' },
                { path: 'ec.requirements.oats', type: 'checkbox', label: 'Овёс' },
                { path: 'ec.requirements.carrot', type: 'checkbox', label: 'Морковь' },
                { path: 'ec.requirements.shower', type: 'checkbox', label: 'Душ' },
                { path: 'ec.requirements.vet', type: 'checkbox', label: 'Ветеринар' },
                { path: 'ec.requirements.forge', type: 'checkbox', label: 'Кузница' },
                { path: 'ec.requirements.largeBoxes', type: 'checkbox', label: 'Большие стойла' },
                { path: 'ec.requirements.meadow', type: 'checkbox', label: 'Пастбище' }
            ]
        },
        blacklist: {
            title: 'Чёрный список',
            description: 'Кого пропускать при будущем табунном прогоне.',
            fields: [
                { path: 'blacklist.foals', type: 'checkbox', label: 'Жеребята' },
                { path: 'blacklist.pregnant', type: 'checkbox', label: 'Беременные' },
                { path: 'blacklist.breeders', type: 'checkbox', label: 'Производители' },
                { path: 'blacklist.vip', type: 'checkbox', label: 'VIP' },
                { path: 'blacklist.onSale', type: 'checkbox', label: 'Лошади в продаже' },
                { path: 'blacklist.coverings', type: 'checkbox', label: 'Лошади на случке' },
                { path: 'blacklist.blackMarketItems', type: 'checkbox', label: 'Лошади с предметами ЧР' }
            ]
        },
        settings: {
            title: 'Настройки',
            description: 'Общие настройки приложения.',
            fields: [
                { path: 'ui.theme', type: 'select', label: 'Тема', options: [
                    { value: 'auto', label: 'Авто' },
                    { value: 'dark', label: 'Тёмная' },
                    { value: 'light', label: 'Светлая' }
                ] },
                { path: 'delays.mode', type: 'select', label: 'Случайные задержки', options: [
                    { value: 'fast', label: 'Быстро' },
                    { value: 'medium', label: 'Средне' },
                    { value: 'slow', label: 'Медленно' },
                    { value: 'custom', label: 'Свои значения' }
                ] },
                { path: 'delays.min', type: 'number', label: 'Минимальная задержка', min: 100, max: 30000, suffix: 'мс' },
                { path: 'delays.max', type: 'number', label: 'Максимальная задержка', min: 100, max: 60000, suffix: 'мс' },
                { path: 'run.stopAfterCurrentHorse', type: 'checkbox', label: 'Мягкая остановка после текущей лошади' },
                { path: 'run.maxErrorsInRow', type: 'number', label: 'Остановиться после ошибок подряд', min: 1, max: 100 }
            ]
        },
        developer: {
            title: 'Разработчик',
            description: 'Инструменты диагностики. В финальной версии можно будет скрыть.',
            fields: [
                { path: 'developer.enabled', type: 'checkbox', label: 'Включить режим разработчика' },
                { path: 'developer.showSelectors', type: 'checkbox', label: 'Показывать найденные селекторы' },
                { path: 'developer.autoRefresh', type: 'checkbox', label: 'Автообновление анализа страницы' }
            ]
        }
    };

    const MENU = [
        { id: 'home', label: 'Главная', icon: '🏠' },
        { id: 'run', label: 'Прогон', icon: '🐴' },
        { id: 'activity', label: 'Активность', icon: '🏇' },
        { id: 'ec', label: 'КСК', icon: '🏡' },
        { id: 'blacklist', label: 'Чёрный список', icon: '🚫' },
        { id: 'statistics', label: 'Статистика', icon: '📊' },
        { id: 'developer', label: 'Разработчик', icon: '🧪' },
        { id: 'settings', label: 'Настройки', icon: '⚙️' }
    ];

    const SELECTORS = {
        horseName: [
            '#horseName',
            '#chevalNom',
            '#nom-cheval',
            '.horse-name',
            '.cheval-name',
            '.chevalNom',
            '[data-testid="horse-name"]',
            'h1'
        ],
        nextHorse: [
            '#nav-next',
            '#horse-next',
            '#cheval-suivant',
            '#boutonSuivant',
            'a[href*="cheval"][title*="След"]',
            'a[href*="cheval"][title*="suivant" i]',
            'a[href*="cheval"][title*="next" i]',
            'a[href*="cheval"] img[alt*="След" i]',
            'a[href*="cheval"] img[alt*="suivant" i]'
        ],
        energy: ['#energie', '#energy', '.energie', '.energy', '[data-energy]'],
        health: ['#sante', '#health', '.sante', '.health', '[data-health]'],
        morale: ['#moral', '#morale', '.moral', '.morale', '[data-morale]'],
        age: ['#age', '.age', '[data-age]'],
        gender: ['#sexe', '#gender', '.sexe', '.gender', '[data-gender]']
    };

    class Utils {
        static nowTime() {
            return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        static escapeHtml(value) {
            return String(value ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        }

        static clone(value) {
            return JSON.parse(JSON.stringify(value));
        }

        static deepMerge(target, source) {
            const result = Utils.clone(target);
            const merge = (left, right) => {
                Object.keys(right || {}).forEach((key) => {
                    if (right[key] && typeof right[key] === 'object' && !Array.isArray(right[key])) {
                        if (!left[key] || typeof left[key] !== 'object') left[key] = {};
                        merge(left[key], right[key]);
                    } else {
                        left[key] = right[key];
                    }
                });
            };
            merge(result, source);
            return result;
        }

        static getPath(object, path) {
            return path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), object);
        }

        static setPath(object, path, value) {
            const keys = path.split('.');
            let cursor = object;
            keys.slice(0, -1).forEach((key) => {
                if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
                cursor = cursor[key];
            });
            cursor[keys[keys.length - 1]] = value;
        }

        static text(element) {
            return (element?.textContent || element?.getAttribute?.('title') || element?.getAttribute?.('alt') || '').replace(/\s+/g, ' ').trim();
        }

        static parsePercent(text) {
            if (!text) return null;
            const normalized = String(text).replace(',', '.');
            const percent = normalized.match(/(-?\d+(?:\.\d+)?)\s*%/);
            if (percent) return Number(percent[1]);
            const simple = normalized.match(/(?:^|\D)(\d{1,3})(?:\D|$)/);
            if (!simple) return null;
            const value = Number(simple[1]);
            return value >= 0 && value <= 100 ? value : null;
        }

        static safeJsonParse(value, fallback) {
            try {
                return value ? JSON.parse(value) : fallback;
            } catch (error) {
                return fallback;
            }
        }
    }

    class EventBus {
        constructor() {
            this.listeners = new Map();
        }

        on(event, callback) {
            if (!this.listeners.has(event)) this.listeners.set(event, new Set());
            this.listeners.get(event).add(callback);
            return () => this.off(event, callback);
        }

        off(event, callback) {
            this.listeners.get(event)?.delete(callback);
        }

        emit(event, payload) {
            this.listeners.get(event)?.forEach((callback) => {
                try {
                    callback(payload);
                } catch (error) {
                    console.error('[Howrse Manager] Event error:', event, error);
                }
            });
        }
    }

    class Storage {
        constructor(prefix) {
            this.prefix = prefix;
        }

        key(name) {
            return `${this.prefix}${name}`;
        }

        get(name, fallback = null) {
            return Utils.safeJsonParse(localStorage.getItem(this.key(name)), fallback);
        }

        set(name, value) {
            localStorage.setItem(this.key(name), JSON.stringify(value));
        }

        remove(name) {
            localStorage.removeItem(this.key(name));
        }
    }

    class Logger {
        constructor(storage, bus) {
            this.storage = storage;
            this.bus = bus;
            this.items = this.storage.get('logs', []);
        }

        add(level, message, meta = {}) {
            const item = {
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                time: Utils.nowTime(),
                level,
                message,
                meta
            };
            this.items.unshift(item);
            this.items = this.items.slice(0, 250);
            this.storage.set('logs', this.items);
            this.bus.emit('log:updated', this.items);
            return item;
        }

        info(message, meta) { return this.add('info', message, meta); }
        success(message, meta) { return this.add('success', message, meta); }
        warn(message, meta) { return this.add('warn', message, meta); }
        error(message, meta) { return this.add('error', message, meta); }

        clear() {
            this.items = [];
            this.storage.set('logs', this.items);
            this.info('Лог очищен');
        }
    }

    class SettingsManager {
        constructor(storage, bus) {
            this.storage = storage;
            this.bus = bus;
            this.settings = Utils.deepMerge(DEFAULT_SETTINGS, this.storage.get('settings', {}));
            this.settings.version = DEFAULT_SETTINGS.version;
            this.save(false);
        }

        get(path = null) {
            return path ? Utils.getPath(this.settings, path) : this.settings;
        }

        set(path, value) {
            Utils.setPath(this.settings, path, value);
            this.save(true);
        }

        save(notify = true) {
            this.storage.set('settings', this.settings);
            if (notify) this.bus.emit('settings:updated', this.settings);
        }

        reset() {
            this.settings = Utils.clone(DEFAULT_SETTINGS);
            this.save(true);
        }
    }

    class StateManager {
        constructor(bus) {
            this.bus = bus;
            this.state = {
                status: 'stopped',
                currentHorseName: '—',
                currentOperation: 'Остановлено',
                progressCurrent: 0,
                progressTotal: 0,
                startedAt: null,
                elapsedSeconds: 0,
                errorsInRow: 0,
                pageInfo: null,
                horseInfo: null
            };
            this.timer = null;
        }

        get() {
            return this.state;
        }

        patch(partial) {
            this.state = { ...this.state, ...partial };
            this.bus.emit('state:updated', this.state);
        }

        start() {
            this.patch({
                status: 'running',
                currentOperation: 'Анализ страницы',
                startedAt: this.state.startedAt || Date.now()
            });
            this.startTimer();
        }

        pause() {
            this.patch({ status: 'paused', currentOperation: 'Пауза' });
        }

        stop() {
            this.patch({
                status: 'stopped',
                currentOperation: 'Остановлено',
                startedAt: null,
                elapsedSeconds: 0
            });
            this.stopTimer();
        }

        startTimer() {
            if (this.timer) return;
            this.timer = window.setInterval(() => {
                if (this.state.startedAt && this.state.status !== 'stopped') {
                    this.patch({ elapsedSeconds: Math.floor((Date.now() - this.state.startedAt) / 1000) });
                }
            }, 1000);
        }

        stopTimer() {
            if (this.timer) window.clearInterval(this.timer);
            this.timer = null;
        }
    }

    class DelayManager {
        constructor(settings) {
            this.settings = settings;
        }

        getRange() {
            const mode = this.settings.get('delays.mode');
            if (mode === 'fast') return [250, 700];
            if (mode === 'slow') return [1800, 4000];
            if (mode === 'custom') return [this.settings.get('delays.min'), this.settings.get('delays.max')];
            return [700, 1600];
        }

        random() {
            const [min, max] = this.getRange();
            return Math.round(min + Math.random() * Math.max(0, max - min));
        }
    }

    class RouteManager {
        getCurrentPage() {
            const { hostname, pathname, href } = window.location;
            const normalized = pathname.toLowerCase();
            let type = 'unknown';
            let label = 'Неизвестная страница';

            if (hostname !== APP.supportedHost) {
                type = 'unsupported';
                label = 'Неподдерживаемый домен';
            } else if (/\/elevage\/chevaux\/?$/.test(normalized)) {
                type = 'horseList';
                label = 'Список лошадей';
            } else if (normalized.includes('/elevage/chevaux/cheval') || href.includes('cheval?id=') || href.includes('id=')) {
                type = 'horse';
                label = 'Страница лошади';
            } else if (normalized.includes('/centre') || normalized.includes('/elevage/centre')) {
                type = 'ec';
                label = 'КСК';
            } else if (normalized.includes('/competition')) {
                type = 'competition';
                label = 'Соревнования';
            } else if (normalized === '/' || normalized.includes('/jouer')) {
                type = 'home';
                label = 'Главная игры';
            }

            return {
                host: hostname,
                path: pathname,
                url: href,
                type,
                label,
                isSupported: hostname === APP.supportedHost,
                isHorsePage: type === 'horse',
                isHorseList: type === 'horseList'
            };
        }
    }

    class SelectorManager {
        constructor(selectors) {
            this.selectors = selectors;
        }

        find(key) {
            const variants = this.selectors[key] || [];
            for (const selector of variants) {
                try {
                    const element = document.querySelector(selector);
                    if (element) return { element, selector };
                } catch (error) {
                    // ignore invalid selector variant
                }
            }
            return { element: null, selector: null };
        }

        findAllTextByWords(words) {
            const result = [];
            const nodes = [...document.querySelectorAll('body *')].slice(0, 4000);
            const lowerWords = words.map((word) => word.toLowerCase());

            for (const node of nodes) {
                const text = Utils.text(node);
                if (!text || text.length > 180) continue;
                const lower = text.toLowerCase();
                if (lowerWords.some((word) => lower.includes(word))) {
                    result.push({ element: node, text });
                }
                if (result.length >= 20) break;
            }
            return result;
        }

        findClickableByWords(words) {
            const candidates = [...document.querySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"]')];
            const lowerWords = words.map((word) => word.toLowerCase());

            for (const element of candidates) {
                const text = `${Utils.text(element)} ${element.getAttribute('title') || ''} ${element.getAttribute('alt') || ''}`.toLowerCase();
                if (lowerWords.some((word) => text.includes(word))) {
                    return { element, selector: this.describeElement(element), text: Utils.text(element) || element.getAttribute('title') || element.getAttribute('alt') };
                }
            }
            return { element: null, selector: null, text: null };
        }

        describeElement(element) {
            if (!element) return null;
            const tag = element.tagName.toLowerCase();
            if (element.id) return `${tag}#${element.id}`;
            if (element.className && typeof element.className === 'string') {
                const classes = element.className.trim().split(/\s+/).slice(0, 3).join('.');
                if (classes) return `${tag}.${classes}`;
            }
            const title = element.getAttribute('title');
            if (title) return `${tag}[title="${title.slice(0, 40)}"]`;
            return tag;
        }
    }

    class HorseParser {
        constructor(selectorManager) {
            this.selectors = selectorManager;
        }

        parse() {
            const name = this.parseName();
            const energy = this.parseMetric('energy', ['энерг', 'energie', 'energy']);
            const health = this.parseMetric('health', ['здоров', 'santé', 'sante', 'health']);
            const morale = this.parseMetric('morale', ['морал', 'moral', 'morale']);
            const age = this.parseTextMetric('age', ['возраст', 'âge', 'age']);
            const gender = this.parseTextMetric('gender', ['пол', 'sexe', 'gender', 'жереб', 'кобыл']);
            const nextHorse = this.parseNextHorseButton();

            const foundSomething = Boolean(name.value || energy.value !== null || health.value !== null || morale.value !== null || age.value || gender.value || nextHorse.found);

            return {
                found: foundSomething,
                name: name.value || '—',
                energy: energy.value,
                health: health.value,
                morale: morale.value,
                age: age.value || '—',
                gender: gender.value || '—',
                nextHorseButton: nextHorse,
                selectors: {
                    name: name.selector,
                    energy: energy.selector,
                    health: health.selector,
                    morale: morale.selector,
                    age: age.selector,
                    gender: gender.selector,
                    nextHorse: nextHorse.selector
                },
                raw: {
                    name: name.raw,
                    energy: energy.raw,
                    health: health.raw,
                    morale: morale.raw,
                    age: age.raw,
                    gender: gender.raw,
                    nextHorse: nextHorse.text
                }
            };
        }

        parseName() {
            const direct = this.selectors.find('horseName');
            if (direct.element) {
                const text = Utils.text(direct.element);
                if (text && text.length <= 80 && !text.toLowerCase().includes('howrse manager')) {
                    return { value: text, selector: direct.selector, raw: text };
                }
            }

            const title = document.title.replace(/\s*-\s*Ловади.*$/i, '').replace(/\s*-\s*Howrse.*$/i, '').trim();
            if (title && title.length <= 80) {
                return { value: title, selector: 'document.title', raw: document.title };
            }
            return { value: null, selector: null, raw: null };
        }

        parseMetric(selectorKey, labelWords) {
            const direct = this.selectors.find(selectorKey);
            if (direct.element) {
                const raw = Utils.text(direct.element) || direct.element.getAttribute('data-value') || direct.element.getAttribute(`data-${selectorKey}`);
                const value = Utils.parsePercent(raw);
                if (value !== null) return { value, selector: direct.selector, raw };
            }

            const labelMatches = this.selectors.findAllTextByWords(labelWords);
            for (const match of labelMatches) {
                const value = Utils.parsePercent(match.text);
                if (value !== null) return { value, selector: this.selectors.describeElement(match.element), raw: match.text };

                const nearby = this.findNearbyPercent(match.element);
                if (nearby.value !== null) return nearby;
            }
            return { value: null, selector: null, raw: null };
        }

        parseTextMetric(selectorKey, labelWords) {
            const direct = this.selectors.find(selectorKey);
            if (direct.element) {
                const raw = Utils.text(direct.element);
                const value = this.cleanupLabelValue(raw, labelWords);
                if (value) return { value, selector: direct.selector, raw };
            }

            const labelMatches = this.selectors.findAllTextByWords(labelWords);
            for (const match of labelMatches) {
                const value = this.cleanupLabelValue(match.text, labelWords);
                if (value) return { value, selector: this.selectors.describeElement(match.element), raw: match.text };

                const nearbyText = this.findNearbyText(match.element, labelWords);
                if (nearbyText.value) return nearbyText;
            }
            return { value: null, selector: null, raw: null };
        }

        parseNextHorseButton() {
            const direct = this.selectors.find('nextHorse');
            if (direct.element) {
                const link = direct.element.closest?.('a') || direct.element;
                return {
                    found: true,
                    selector: direct.selector,
                    text: Utils.text(link) || link.getAttribute('title') || link.getAttribute('href') || 'найдена',
                    href: link.getAttribute('href') || null
                };
            }

            const byText = this.selectors.findClickableByWords(['след', 'suivant', 'next', 'cheval suivant']);
            if (byText.element) {
                return {
                    found: true,
                    selector: byText.selector,
                    text: byText.text || 'найдена',
                    href: byText.element.getAttribute('href') || null
                };
            }
            return { found: false, selector: null, text: null, href: null };
        }

        findNearbyPercent(element) {
            const candidates = [
                element.nextElementSibling,
                element.previousElementSibling,
                element.parentElement,
                element.parentElement?.nextElementSibling,
                element.parentElement?.parentElement
            ].filter(Boolean);

            for (const candidate of candidates) {
                const raw = Utils.text(candidate);
                const value = Utils.parsePercent(raw);
                if (value !== null) {
                    return { value, selector: this.selectors.describeElement(candidate), raw };
                }
            }
            return { value: null, selector: null, raw: null };
        }

        findNearbyText(element, labelWords) {
            const candidates = [
                element.nextElementSibling,
                element.previousElementSibling,
                element.parentElement,
                element.parentElement?.nextElementSibling,
                element.parentElement?.parentElement
            ].filter(Boolean);

            for (const candidate of candidates) {
                const raw = Utils.text(candidate);
                const value = this.cleanupLabelValue(raw, labelWords);
                if (value) {
                    return { value, selector: this.selectors.describeElement(candidate), raw };
                }
            }
            return { value: null, selector: null, raw: null };
        }

        cleanupLabelValue(text, labelWords) {
            if (!text) return null;
            let value = String(text).replace(/\s+/g, ' ').trim();
            for (const word of labelWords) {
                value = value.replace(new RegExp(word, 'ig'), '').trim();
            }
            value = value.replace(/^[:：\-–—\s]+/, '').trim();
            if (!value || value.length > 80) return null;
            if (/^[:：\-–—]*$/.test(value)) return null;
            return value;
        }
    }

    class LowadiAdapter {
        constructor() {
            this.route = new RouteManager();
            this.selectorManager = new SelectorManager(SELECTORS);
            this.horseParser = new HorseParser(this.selectorManager);
        }

        analyzePage() {
            const page = this.route.getCurrentPage();
            const horse = page.isHorsePage ? this.horseParser.parse() : this.trySoftHorseParse(page);
            return {
                adapter: 'LowadiAdapter',
                page,
                horse,
                timestamp: Date.now()
            };
        }

        trySoftHorseParse(page) {
            if (!page.isSupported) {
                return { found: false, name: '—', energy: null, health: null, morale: null, age: '—', gender: '—', nextHorseButton: { found: false }, selectors: {}, raw: {} };
            }
            if (page.isHorseList) {
                return { found: false, name: '—', energy: null, health: null, morale: null, age: '—', gender: '—', nextHorseButton: { found: false }, selectors: {}, raw: {} };
            }
            return this.horseParser.parse();
        }
    }

    class AdapterFactory {
        static create() {
            if (window.location.hostname === APP.supportedHost) return new LowadiAdapter();
            return null;
        }
    }

    class UIManager {
        constructor({ bus, settings, state, logger, adapter }) {
            this.bus = bus;
            this.settings = settings;
            this.state = state;
            this.logger = logger;
            this.adapter = adapter;
            this.activePage = settings.get('ui.activePage') || 'home';
            this.analysis = null;
            this.root = null;
            this.shadow = null;
            this.refreshTimer = null;
        }

        mount() {
            if (document.getElementById(APP.rootId)) return;

            this.root = document.createElement('div');
            this.root.id = APP.rootId;
            document.documentElement.appendChild(this.root);
            this.shadow = this.root.attachShadow({ mode: 'open' });

            this.render();
            this.bindBus();
            this.runAnalysis('initial');
            this.startAutoRefresh();
        }

        bindBus() {
            this.bus.on('settings:updated', () => {
                this.render();
                this.startAutoRefresh();
            });
            this.bus.on('state:updated', () => this.render());
            this.bus.on('log:updated', () => this.render());
        }

        startAutoRefresh() {
            if (this.refreshTimer) window.clearInterval(this.refreshTimer);
            if (!this.settings.get('developer.autoRefresh')) return;
            this.refreshTimer = window.setInterval(() => {
                this.runAnalysis('auto', false);
            }, 3000);
        }

        setActivePage(page) {
            this.activePage = page;
            this.settings.set('ui.activePage', page);
            this.render();
        }

        runAnalysis(source = 'manual', log = true) {
            if (!this.adapter) {
                this.analysis = {
                    adapter: 'Нет адаптера',
                    page: new RouteManager().getCurrentPage(),
                    horse: { found: false, name: '—' }
                };
            } else {
                this.analysis = this.adapter.analyzePage();
            }

            const horse = this.analysis.horse || {};
            const page = this.analysis.page || {};
            this.state.patch({
                pageInfo: page,
                horseInfo: horse,
                currentHorseName: horse.name || '—'
            });

            if (log) {
                this.logger.info(`Анализ страницы: ${page.label || 'неизвестно'}`);
                if (horse?.found) this.logger.success(`Лошадь найдена: ${horse.name || 'без имени'}`);
                if (page?.isHorsePage && !horse?.found) this.logger.warn('Страница похожа на лошадь, но данные пока не найдены');
            }
            if (source !== 'auto') this.render();
        }

        getThemeClass() {
            const theme = this.settings.get('ui.theme');
            if (theme === 'dark') return 'hm-theme-dark';
            if (theme === 'light') return 'hm-theme-light';
            const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
            return prefersDark ? 'hm-theme-dark' : 'hm-theme-light';
        }

        render() {
            if (!this.shadow) return;
            const collapsed = this.settings.get('ui.collapsed');
            const theme = this.getThemeClass();
            this.shadow.innerHTML = `
                <style>${this.styles()}</style>
                <div class="hm-app ${theme} ${collapsed ? 'hm-collapsed' : ''}">
                    ${collapsed ? this.renderBubble() : this.renderPanel()}
                </div>
            `;
            this.bindDomEvents();
        }

        renderBubble() {
            return `<button class="hm-bubble" data-action="expand" title="Открыть Howrse Manager">🐴</button>`;
        }

        renderPanel() {
            const pageConfig = MENU.find((item) => item.id === this.activePage) || MENU[0];
            return `
                <section class="hm-panel" aria-label="Howrse Manager">
                    <aside class="hm-sidebar">
                        <div class="hm-brand">
                            <div class="hm-logo">🐴</div>
                            <div>
                                <div class="hm-title">Howrse Manager</div>
                                <div class="hm-version">v${APP.version}</div>
                            </div>
                        </div>
                        <nav class="hm-menu">
                            ${MENU.map((item) => `
                                <button class="hm-menu-item ${item.id === this.activePage ? 'is-active' : ''}" data-page="${item.id}">
                                    <span>${item.icon}</span><span>${item.label}</span>
                                </button>
                            `).join('')}
                        </nav>
                    </aside>
                    <main class="hm-main">
                        <header class="hm-header">
                            <div>
                                <div class="hm-kicker">Tampermonkey application</div>
                                <h1>${pageConfig.icon} ${pageConfig.label}</h1>
                            </div>
                            <div class="hm-header-actions">
                                <button class="hm-icon-btn" data-action="toggle-theme" title="Сменить тему">${this.getThemeIcon()}</button>
                                <button class="hm-icon-btn" data-action="collapse" title="Свернуть">−</button>
                            </div>
                        </header>
                        <section class="hm-content">
                            ${this.renderPage()}
                        </section>
                    </main>
                </section>
            `;
        }

        getThemeIcon() {
            const theme = this.settings.get('ui.theme');
            if (theme === 'dark') return '🌙';
            if (theme === 'light') return '☀️';
            return '💻';
        }

        renderPage() {
            if (this.activePage === 'home') return this.renderHome();
            if (this.activePage === 'statistics') return this.renderStatistics();
            if (this.activePage === 'developer') return this.renderDeveloper();
            const schema = SETTINGS_SCHEMA[this.activePage];
            if (schema) return this.renderSettingsPage(schema);
            return `<div class="hm-card"><h2>Раздел в разработке</h2></div>`;
        }

        renderHome() {
            const state = this.state.get();
            const horse = state.horseInfo || {};
            const page = state.pageInfo || {};
            return `
                <div class="hm-grid hm-grid-2">
                    <div class="hm-card hm-status-card">
                        <h2>Состояние</h2>
                        <div class="hm-status-line">
                            <span class="hm-pill hm-pill-${state.status}">${this.statusLabel(state.status)}</span>
                            <span>Время: ${this.formatSeconds(state.elapsedSeconds)}</span>
                        </div>
                        <div class="hm-facts">
                            <div><span>Страница</span><strong>${Utils.escapeHtml(page.label || '—')}</strong></div>
                            <div><span>Текущая лошадь</span><strong>${Utils.escapeHtml(horse.name || '—')}</strong></div>
                            <div><span>Операция</span><strong>${Utils.escapeHtml(state.currentOperation)}</strong></div>
                            <div><span>Прогресс</span><strong>${state.progressCurrent} / ${state.progressTotal}</strong></div>
                        </div>
                        ${this.renderHorseMiniCard(horse)}
                        <div class="hm-actions-row">
                            <button class="hm-btn hm-primary" data-action="start">Старт</button>
                            <button class="hm-btn" data-action="pause">Пауза</button>
                            <button class="hm-btn hm-danger" data-action="stop">Стоп</button>
                            <button class="hm-btn hm-ghost" data-action="analyze">Анализ</button>
                        </div>
                    </div>
                    <div class="hm-card hm-hero-card">
                        <h2>v0.2 анализирует страницу</h2>
                        <p>Эта версия уже пытается определить тип страницы, текущую лошадь, энергию, здоровье, мораль, возраст, пол и кнопку следующей лошади.</p>
                        <p class="hm-muted">Она всё ещё не кликает по игре. Это безопасный диагностический этап перед табунным режимом.</p>
                    </div>
                </div>
                ${this.renderLogCard()}
            `;
        }

        renderHorseMiniCard(horse) {
            return `
                <div class="hm-horse-mini">
                    <div class="hm-horse-title">🐴 Данные лошади</div>
                    <div class="hm-metric-grid">
                        ${this.renderMetric('Энергия', horse.energy, '%')}
                        ${this.renderMetric('Здоровье', horse.health, '%')}
                        ${this.renderMetric('Мораль', horse.morale, '%')}
                        ${this.renderMetric('Возраст', horse.age, '')}
                        ${this.renderMetric('Пол', horse.gender, '')}
                        ${this.renderMetric('Следующая', horse.nextHorseButton?.found ? 'найдена' : '—', '')}
                    </div>
                </div>
            `;
        }

        renderMetric(label, value, suffix) {
            const display = value === null || value === undefined || value === '' ? '—' : `${Utils.escapeHtml(value)}${suffix}`;
            return `<div class="hm-metric"><span>${label}</span><strong>${display}</strong></div>`;
        }

        renderSettingsPage(schema) {
            return `
                <div class="hm-card">
                    <h2>${Utils.escapeHtml(schema.title)}</h2>
                    <p class="hm-muted">${Utils.escapeHtml(schema.description)}</p>
                    <div class="hm-form">
                        ${schema.fields.map((field) => this.renderField(field)).join('')}
                    </div>
                </div>
            `;
        }

        renderField(field) {
            const value = this.settings.get(field.path);
            if (field.type === 'checkbox') {
                return `
                    <label class="hm-field hm-check">
                        <input type="checkbox" data-setting="${field.path}" ${value ? 'checked' : ''}>
                        <span>${Utils.escapeHtml(field.label)}</span>
                    </label>
                `;
            }
            if (field.type === 'select') {
                return `
                    <label class="hm-field">
                        <span>${Utils.escapeHtml(field.label)}</span>
                        <select data-setting="${field.path}">
                            ${field.options.map((option) => `<option value="${option.value}" ${String(value) === String(option.value) ? 'selected' : ''}>${Utils.escapeHtml(option.label)}</option>`).join('')}
                        </select>
                    </label>
                `;
            }
            return `
                <label class="hm-field">
                    <span>${Utils.escapeHtml(field.label)}</span>
                    <div class="hm-input-with-suffix">
                        <input type="number" data-setting="${field.path}" value="${Utils.escapeHtml(value)}" min="${field.min ?? ''}" max="${field.max ?? ''}">
                        ${field.suffix ? `<em>${Utils.escapeHtml(field.suffix)}</em>` : ''}
                    </div>
                </label>
            `;
        }

        renderDeveloper() {
            const state = this.state.get();
            const page = state.pageInfo || {};
            const horse = state.horseInfo || {};
            return `
                <div class="hm-grid hm-grid-2">
                    <div class="hm-card">
                        <h2>Диагностика страницы</h2>
                        <div class="hm-facts hm-facts-compact">
                            <div><span>URL</span><strong title="${Utils.escapeHtml(page.url || location.href)}">${Utils.escapeHtml(page.url || location.href)}</strong></div>
                            <div><span>Домен</span><strong>${Utils.escapeHtml(page.host || location.hostname)}</strong></div>
                            <div><span>Тип страницы</span><strong>${Utils.escapeHtml(page.label || '—')}</strong></div>
                            <div><span>Адаптер</span><strong>${Utils.escapeHtml(this.analysis?.adapter || '—')}</strong></div>
                            <div><span>Страница лошади</span><strong>${page.isHorsePage ? 'да' : 'нет'}</strong></div>
                            <div><span>Список лошадей</span><strong>${page.isHorseList ? 'да' : 'нет'}</strong></div>
                        </div>
                        <div class="hm-actions-row">
                            <button class="hm-btn hm-primary" data-action="analyze">Обновить анализ</button>
                        </div>
                    </div>
                    <div class="hm-card">
                        <h2>Найденные данные</h2>
                        <div class="hm-facts hm-facts-compact">
                            <div><span>Имя</span><strong>${Utils.escapeHtml(horse.name || '—')}</strong></div>
                            <div><span>Энергия</span><strong>${horse.energy ?? '—'}${horse.energy != null ? '%' : ''}</strong></div>
                            <div><span>Здоровье</span><strong>${horse.health ?? '—'}${horse.health != null ? '%' : ''}</strong></div>
                            <div><span>Мораль</span><strong>${horse.morale ?? '—'}${horse.morale != null ? '%' : ''}</strong></div>
                            <div><span>Возраст</span><strong>${Utils.escapeHtml(horse.age || '—')}</strong></div>
                            <div><span>Пол</span><strong>${Utils.escapeHtml(horse.gender || '—')}</strong></div>
                            <div><span>Кнопка следующей лошади</span><strong>${horse.nextHorseButton?.found ? 'найдена' : 'не найдена'}</strong></div>
                        </div>
                    </div>
                </div>
                ${this.renderSelectorsCard(horse)}
                ${this.renderSettingsPage(SETTINGS_SCHEMA.developer)}
            `;
        }

        renderSelectorsCard(horse) {
            if (!this.settings.get('developer.showSelectors')) return '';
            const selectors = horse.selectors || {};
            const raw = horse.raw || {};
            return `
                <div class="hm-card">
                    <h2>Селекторы и сырой текст</h2>
                    <div class="hm-debug-table">
                        ${['name', 'energy', 'health', 'morale', 'age', 'gender', 'nextHorse'].map((key) => `
                            <div><span>${key}</span><strong>${Utils.escapeHtml(selectors[key] || '—')}</strong><em>${Utils.escapeHtml(raw[key] || '')}</em></div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        renderStatistics() {
            return `
                <div class="hm-card">
                    <h2>Статистика</h2>
                    <div class="hm-stats">
                        <div><strong>0</strong><span>Обработано</span></div>
                        <div><strong>0</strong><span>Тренировок</span></div>
                        <div><strong>0</strong><span>Соревнований</span></div>
                        <div><strong>0</strong><span>КСК</span></div>
                        <div><strong>0</strong><span>Ошибок</span></div>
                    </div>
                    <p class="hm-muted">Статистика начнёт заполняться после добавления игровых действий.</p>
                </div>
                ${this.renderLogCard()}
            `;
        }

        renderLogCard() {
            const logs = this.logger.items || [];
            return `
                <div class="hm-card hm-log-card">
                    <div class="hm-card-head">
                        <h2>Лог</h2>
                        <button class="hm-link-btn" data-action="clear-log">Очистить</button>
                    </div>
                    <div class="hm-log-list">
                        ${logs.length ? logs.slice(0, 30).map((item) => `
                            <div class="hm-log-item hm-log-${item.level}">
                                <span>${Utils.escapeHtml(item.time)}</span>
                                <strong>${Utils.escapeHtml(item.message)}</strong>
                            </div>
                        `).join('') : '<div class="hm-empty">Пока записей нет</div>'}
                    </div>
                </div>
            `;
        }

        statusLabel(status) {
            return ({ running: 'Работает', paused: 'Пауза', stopped: 'Остановлено', error: 'Ошибка' })[status] || status;
        }

        formatSeconds(seconds) {
            const min = Math.floor(seconds / 60).toString().padStart(2, '0');
            const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
            return `${min}:${sec}`;
        }

        bindDomEvents() {
            this.shadow.querySelectorAll('[data-page]').forEach((button) => {
                button.addEventListener('click', () => this.setActivePage(button.dataset.page));
            });

            this.shadow.querySelectorAll('[data-action]').forEach((element) => {
                element.addEventListener('click', () => this.handleAction(element.dataset.action));
            });

            this.shadow.querySelectorAll('[data-setting]').forEach((input) => {
                input.addEventListener('change', () => {
                    let value;
                    if (input.type === 'checkbox') value = input.checked;
                    else if (input.type === 'number') value = Number(input.value);
                    else value = input.value;
                    this.settings.set(input.dataset.setting, value);
                    if (input.dataset.setting === 'ui.theme') this.logger.info(`Тема изменена: ${this.themeLabel(value)}`);
                });
            });
        }

        handleAction(action) {
            if (action === 'collapse') {
                this.settings.set('ui.collapsed', true);
                return;
            }
            if (action === 'expand') {
                this.settings.set('ui.collapsed', false);
                return;
            }
            if (action === 'toggle-theme') {
                const current = this.settings.get('ui.theme');
                const next = current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark';
                this.settings.set('ui.theme', next);
                this.logger.info(`Тема изменена: ${this.themeLabel(next)}`);
                return;
            }
            if (action === 'start') {
                this.state.start();
                this.logger.success('Скрипт запущен в диагностическом режиме');
                this.runAnalysis('start');
                return;
            }
            if (action === 'pause') {
                this.state.pause();
                this.logger.warn('Пауза');
                return;
            }
            if (action === 'stop') {
                this.state.stop();
                this.logger.warn('Стоп');
                return;
            }
            if (action === 'clear-log') {
                this.logger.clear();
                return;
            }
            if (action === 'analyze') {
                this.runAnalysis('manual');
            }
        }

        themeLabel(value) {
            return ({ dark: 'Тёмная', light: 'Светлая', auto: 'Авто' })[value] || value;
        }

        styles() {
            return `
                :host { all: initial; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
                * { box-sizing: border-box; }
                button, input, select { font: inherit; }
                .hm-app { position: fixed; z-index: 2147483647; inset: auto 18px 18px auto; color: var(--hm-text); }
                .hm-theme-dark {
                    --hm-bg: #0f172a; --hm-panel: rgba(15, 23, 42, .96); --hm-sidebar: rgba(30, 31, 68, .94);
                    --hm-card: rgba(15, 23, 42, .78); --hm-soft: rgba(124, 92, 255, .16); --hm-border: rgba(148, 163, 184, .22);
                    --hm-text: #f8fafc; --hm-muted: #aeb8cc; --hm-primary: #a78bfa; --hm-primary-2: #7c3aed; --hm-danger: #fb7185;
                    --hm-shadow: 0 24px 80px rgba(0, 0, 0, .45);
                }
                .hm-theme-light {
                    --hm-bg: #f8fafc; --hm-panel: rgba(255, 255, 255, .96); --hm-sidebar: rgba(245, 243, 255, .96);
                    --hm-card: rgba(255, 255, 255, .86); --hm-soft: rgba(124, 92, 255, .12); --hm-border: rgba(51, 65, 85, .16);
                    --hm-text: #172033; --hm-muted: #64748b; --hm-primary: #8b5cf6; --hm-primary-2: #6d28d9; --hm-danger: #e11d48;
                    --hm-shadow: 0 24px 80px rgba(15, 23, 42, .20);
                }
                .hm-bubble { width: 66px; height: 66px; border: 0; border-radius: 24px; cursor: pointer; background: linear-gradient(135deg, var(--hm-primary), var(--hm-primary-2)); color: white; font-size: 32px; box-shadow: var(--hm-shadow); }
                .hm-panel { width: min(1380px, calc(100vw - 36px)); height: min(760px, calc(100vh - 36px)); display: grid; grid-template-columns: 270px 1fr; overflow: hidden; border: 1px solid var(--hm-border); border-radius: 34px; background: var(--hm-panel); box-shadow: var(--hm-shadow); backdrop-filter: blur(18px); }
                .hm-sidebar { padding: 24px 18px; background: var(--hm-sidebar); border-right: 1px solid var(--hm-border); display: flex; flex-direction: column; gap: 24px; }
                .hm-brand { display: flex; align-items: center; gap: 14px; padding: 0 6px; }
                .hm-logo { width: 54px; height: 54px; border-radius: 20px; display: grid; place-items: center; background: var(--hm-soft); font-size: 28px; }
                .hm-title { font-size: 19px; font-weight: 850; letter-spacing: -.03em; }
                .hm-version, .hm-kicker, .hm-muted, .hm-log-item span, .hm-field > span, .hm-facts span, .hm-metric span { color: var(--hm-muted); }
                .hm-menu { display: flex; flex-direction: column; gap: 8px; }
                .hm-menu-item { display: flex; align-items: center; gap: 12px; width: 100%; border: 0; border-radius: 18px; padding: 14px 16px; background: transparent; color: var(--hm-muted); cursor: pointer; text-align: left; font-weight: 750; font-size: 16px; }
                .hm-menu-item:hover, .hm-menu-item.is-active { color: var(--hm-text); background: var(--hm-soft); }
                .hm-main { min-width: 0; overflow: auto; background: linear-gradient(145deg, rgba(124,92,255,.08), transparent 35%); }
                .hm-header { min-height: 112px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 26px 34px; border-bottom: 1px solid var(--hm-border); }
                .hm-header h1 { margin: 4px 0 0; font-size: 32px; line-height: 1.1; letter-spacing: -.04em; color: var(--hm-text); }
                .hm-header-actions { display: flex; gap: 10px; }
                .hm-icon-btn { width: 46px; height: 46px; border: 0; border-radius: 16px; cursor: pointer; color: var(--hm-text); background: rgba(15, 23, 42, .06); }
                .hm-content { padding: 26px 34px 34px; display: flex; flex-direction: column; gap: 22px; }
                .hm-grid { display: grid; gap: 22px; }
                .hm-grid-2 { grid-template-columns: 1fr 1fr; }
                .hm-card { border: 1px solid var(--hm-border); border-radius: 28px; padding: 24px; background: var(--hm-card); }
                .hm-card h2 { margin: 0 0 14px; color: var(--hm-text); font-size: 21px; letter-spacing: -.03em; }
                .hm-card p { font-size: 17px; line-height: 1.45; }
                .hm-hero-card { background: linear-gradient(135deg, var(--hm-soft), var(--hm-card)); }
                .hm-status-line, .hm-card-head, .hm-actions-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
                .hm-status-line { justify-content: space-between; margin-bottom: 20px; color: var(--hm-muted); }
                .hm-pill { display: inline-flex; align-items: center; padding: 8px 14px; border-radius: 999px; background: var(--hm-soft); color: var(--hm-text); font-weight: 850; }
                .hm-pill-running { background: rgba(34, 197, 94, .18); }
                .hm-pill-paused { background: rgba(251, 191, 36, .20); }
                .hm-pill-error { background: rgba(251, 113, 133, .18); }
                .hm-facts { display: grid; gap: 12px; margin: 14px 0 20px; }
                .hm-facts div, .hm-metric, .hm-debug-table div { display: grid; grid-template-columns: 170px 1fr; gap: 12px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--hm-border); }
                .hm-facts-compact div { grid-template-columns: 160px minmax(0, 1fr); }
                .hm-facts strong, .hm-metric strong { color: var(--hm-text); overflow: hidden; text-overflow: ellipsis; }
                .hm-horse-mini { margin: 18px 0; padding: 16px; border-radius: 22px; background: rgba(127, 127, 127, .08); border: 1px solid var(--hm-border); }
                .hm-horse-title { font-weight: 850; margin-bottom: 12px; }
                .hm-metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
                .hm-metric { grid-template-columns: 1fr auto; padding: 8px 0; }
                .hm-btn { border: 0; border-radius: 16px; padding: 12px 18px; cursor: pointer; font-weight: 850; color: var(--hm-text); background: var(--hm-soft); }
                .hm-btn:hover { transform: translateY(-1px); }
                .hm-primary { background: linear-gradient(135deg, var(--hm-primary), var(--hm-primary-2)); color: white; }
                .hm-danger { background: rgba(251, 113, 133, .16); color: var(--hm-danger); }
                .hm-ghost { background: transparent; border: 1px solid var(--hm-border); }
                .hm-link-btn { margin-left: auto; border: 0; background: transparent; color: var(--hm-muted); cursor: pointer; font-weight: 750; }
                .hm-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 18px; }
                .hm-field { display: grid; gap: 8px; padding: 14px; border: 1px solid var(--hm-border); border-radius: 18px; background: rgba(127, 127, 127, .05); }
                .hm-check { display: flex; align-items: center; flex-direction: row; color: var(--hm-text); font-weight: 750; }
                .hm-check input { width: 18px; height: 18px; accent-color: var(--hm-primary); }
                .hm-field input:not([type='checkbox']), .hm-field select { width: 100%; border: 1px solid var(--hm-border); border-radius: 14px; padding: 10px 12px; color: var(--hm-text); background: rgba(127, 127, 127, .08); outline: none; }
                .hm-input-with-suffix { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; }
                .hm-input-with-suffix em { color: var(--hm-muted); font-style: normal; }
                .hm-log-list { display: grid; gap: 8px; max-height: 260px; overflow: auto; }
                .hm-log-item { display: grid; grid-template-columns: 90px 1fr; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 14px; background: rgba(127, 127, 127, .06); }
                .hm-log-item strong { color: var(--hm-text); }
                .hm-log-success strong { color: #34d399; }
                .hm-log-warn strong { color: #fbbf24; }
                .hm-log-error strong { color: #fb7185; }
                .hm-empty { color: var(--hm-muted); padding: 18px 0; }
                .hm-debug-table { display: grid; gap: 4px; }
                .hm-debug-table div { grid-template-columns: 110px minmax(120px, 1fr) minmax(120px, 1fr); }
                .hm-debug-table span { color: var(--hm-muted); }
                .hm-debug-table strong { color: var(--hm-text); }
                .hm-debug-table em { color: var(--hm-muted); font-style: normal; overflow: hidden; text-overflow: ellipsis; }
                .hm-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
                .hm-stats div { padding: 18px; border: 1px solid var(--hm-border); border-radius: 18px; background: rgba(127, 127, 127, .06); }
                .hm-stats strong { display: block; font-size: 30px; color: var(--hm-text); }
                .hm-stats span { color: var(--hm-muted); }
                @media (max-width: 980px) {
                    .hm-panel { grid-template-columns: 1fr; height: calc(100vh - 24px); width: calc(100vw - 24px); }
                    .hm-sidebar { border-right: 0; border-bottom: 1px solid var(--hm-border); }
                    .hm-menu { display: grid; grid-template-columns: repeat(2, 1fr); }
                    .hm-grid-2, .hm-form { grid-template-columns: 1fr; }
                }
            `;
        }
    }

    class Application {
        constructor() {
            this.bus = new EventBus();
            this.storage = new Storage(APP.storagePrefix);
            this.settings = new SettingsManager(this.storage, this.bus);
            this.logger = new Logger(this.storage, this.bus);
            this.state = new StateManager(this.bus);
            this.delay = new DelayManager(this.settings);
            this.adapter = AdapterFactory.create();
            this.ui = new UIManager({
                bus: this.bus,
                settings: this.settings,
                state: this.state,
                logger: this.logger,
                adapter: this.adapter
            });
        }

        init() {
            const mount = () => {
                this.ui.mount();
                this.logger.info(`Howrse Manager v${APP.version} загружен`);
                if (!this.adapter) this.logger.warn('Для текущего домена пока нет адаптера');
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', mount, { once: true });
            } else {
                mount();
            }
        }
    }

    new Application().init();
})();
