"use strict";
/*
 * Explainery scene runtime. Load once in the host page, after GSAP, as a classic script.
 *
 * Browsers load runtime/scene.js, which `pnpm build:runtime` generates from runtime/scene.ts; edit the .ts file and
 * rebuild, and a test fails while the two disagree.
 *
 * HyperFrames runs each sub-composition script with its own window, document, and gsap, scoped to that composition
 * (its getVariables() returns the instance's data-variable-values, and gsap selectors match only inside it). A global
 * function cannot see that scope, so a scene passes it in:
 *
 *   defineScene({ window, document, gsap }, 'library', (tl, { beat, duration }) => {
 *     tl.fromTo('#marker', { opacity: 0 }, { opacity: 1, duration: 0.4 }, beat('publish-book'));
 *   });
 */
/// <reference types="gsap" />
(function () {
    // Timing values come from float arithmetic; a microsecond is far below one frame.
    const EPSILON = 1e-6;
    const seconds = (value) => Number(value.toFixed(6)) + 's';
    function fillCopy(document, copy) {
        document.querySelectorAll('[data-copy]').forEach(function (element) {
            const text = copy[element.dataset.copy];
            if (typeof text === 'string')
                element.textContent = text;
            else
                element.remove();
        });
    }
    // The theme's copy entrance: accent rule, category, a left-to-right headline wipe, then the supporting line.
    const COPY_ENTRANCE = { headline: { at: .1, duration: .75 }, support: { at: .65, duration: .5 } };
    function copyEntrance(document, timeline) {
        const reveal = function (selector, from, to, at) {
            const element = document.querySelector('.copy ' + selector);
            if (element)
                timeline.fromTo(element, from, to, at);
        };
        return function (at, timing) {
            const headline = Object.assign({}, COPY_ENTRANCE.headline, timing && timing.headline);
            const support = Object.assign({}, COPY_ENTRANCE.support, timing && timing.support);
            reveal('.accent-rule', { opacity: 0 }, { opacity: 1, duration: .3 }, at);
            reveal('[data-copy="category"]', { opacity: 0 }, { opacity: 1, duration: .3 }, at + .05);
            reveal('[data-copy="headline"]', { clipPath: 'inset(0 100% 0 0)', opacity: 0 }, { clipPath: 'inset(0 0% 0 0)', opacity: 1, duration: headline.duration, ease: 'power1.out' }, at + headline.at);
            reveal('[data-copy="support"]', { opacity: 0 }, { opacity: 1, duration: support.duration }, at + support.at);
        };
    }
    function sceneMotion(scope, id, timeline, windows, own) {
        const length = function (index, line) { return line.getTotalLength(); };
        const resolve = function (target) {
            if (typeof target === 'string')
                return Array.prototype.slice.call(scope.document.querySelectorAll(target));
            return scope.gsap.utils.toArray(target);
        };
        return {
            draw: function (target, at, seconds) {
                const duration = seconds === undefined ? .6 : seconds;
                timeline.set(target, { opacity: 1, strokeDasharray: length, strokeDashoffset: length }, at)
                    .to(target, { strokeDashoffset: 0, duration: duration, ease: 'power1.inOut' }, at);
                // A dash hides the stroke but not its markers, so the arrowhead joins the line when the stroke reaches it.
                resolve(target).forEach(function (line) {
                    const marker = typeof line.getAttribute === 'function' ? line.getAttribute('marker-end') : null;
                    if (marker)
                        timeline.set(line, { attr: { 'marker-end': 'none' } }, at).set(line, { attr: { 'marker-end': marker } }, at + duration);
                });
            },
            rise: function (target, at, y) {
                timeline.fromTo(target, { opacity: 0, y: y === undefined ? 24 : y }, { opacity: 1, y: 0, duration: .55, ease: 'power2.out' }, at);
            },
            travel: function (target, points, at, seconds) {
                const step = seconds / Math.max(points.length - 1, 1);
                timeline.set(target, { opacity: 1, x: points[0][0], y: points[0][1] }, at);
                points.slice(1).forEach(function (point, index) {
                    timeline.to(target, { x: point[0], y: point[1], duration: step, ease: 'none' }, at + index * step);
                });
                timeline.to(target, { opacity: 0, duration: .2 }, at + seconds);
            },
            pulse: function (target, origin, at, scale) {
                timeline.fromTo(target, { scale: 1, svgOrigin: origin }, { scale: scale === undefined ? 1.25 : scale, svgOrigin: origin, duration: .25, yoyo: true, repeat: 1 }, at);
            },
            focus: function (keep, at, until, options) {
                const container = scope.document.querySelector(options.within);
                if (!container)
                    throw new Error('scene "' + id + '": focus container "' + options.within + '" not found');
                windows.forEach(function (other) {
                    if (other.within === options.within && at < other.until && other.at < until) {
                        throw new Error('scene "' + id + '": focus windows in "' + options.within + '" overlap at ' + seconds(Math.max(at, other.at)));
                    }
                });
                const kept = resolve(keep);
                const wrappers = Array.prototype.slice.call(container.children).filter(function (child) {
                    return !kept.some(function (element) { return child.contains(element); });
                });
                windows.push({ within: options.within, at: at, until: until, wrappers: wrappers });
                own.add(timeline.to(wrappers, { opacity: options.dim === undefined ? .3 : options.dim, duration: .4 }, at).recent());
                own.add(timeline.to(wrappers, { opacity: 1, duration: .4 }, until).recent());
            },
        };
    }
    function checkFocus(id, timeline, windows, own) {
        windows.forEach(function (focusWindow) {
            focusWindow.wrappers.forEach(function (wrapper) {
                const rival = timeline.getTweensOf(wrapper).some(function (tween) {
                    return !own.has(tween) && ('opacity' in tween.vars || 'autoAlpha' in tween.vars || 'opacity' in (tween.vars.startAt || {}));
                });
                if (rival)
                    throw new Error('scene "' + id + '": focus dims a wrapper in "' + focusWindow.within + '" whose opacity another tween animates; wrap it in a group of its own');
            });
        });
    }
    /**
     * Builds and registers a scene's paused timeline from its composition variables (copy, beats, duration).
     *
     * Elements marked data-copy="<key>" receive the story's copy, or are removed when the story has none for that key.
     * The build can anchor tweens to beat('<id>') so their starts follow narration timing. Tween durations and offsets
     * remain authored seconds; the duration guard below rejects overruns rather than automatically retiming them.
     * enterCopy(at, { headline: { at, duration }, support: { at, duration } }) reveals the copy block from second `at`;
     * the nested offsets are relative to it, default to the theme's entrance, and slots without copy are skipped. A missing
     * beat, or a timeline that runs past the scene, throws instead of registering, so HyperFrames reports a script error.
     */
    const defineScene = function (scope, id, build) {
        const variables = scope.window.__hyperframes.getVariables();
        const duration = variables.duration;
        const beats = variables.beats || {};
        const copy = variables.copy || {};
        if (typeof duration !== 'number')
            throw new Error('scene "' + id + '" received no duration variable; its host needs data-variable-values');
        fillCopy(scope.document, copy);
        const beat = function (name) {
            if (!Object.prototype.hasOwnProperty.call(beats, name))
                throw new Error('scene "' + id + '" has no beat "' + name + '"');
            return beats[name];
        };
        const timeline = scope.gsap.timeline({ paused: true });
        const windows = [];
        const own = new Set();
        build(timeline, { beat: beat, duration: duration, copy: copy, enterCopy: copyEntrance(scope.document, timeline), motion: sceneMotion(scope, id, timeline, windows, own) });
        checkFocus(id, timeline, windows, own);
        if (timeline.duration() > duration + EPSILON) {
            throw new Error('scene "' + id + '" timeline ends at ' + seconds(timeline.duration()) + ', after its ' + seconds(duration));
        }
        scope.window.__timelines[id] = timeline;
        return timeline;
    };
    // Card text deliberately covers whatever scene lies beneath the opaque card. HyperFrames' layout audit exempts only
    // text blocks that carry data-layout-allow-overlap themselves, so each one is marked rather than the card.
    function append(parent, tag, className, text) {
        const child = parent.ownerDocument.createElement(tag);
        child.className = className;
        if (text !== undefined) {
            child.textContent = text;
            child.setAttribute('data-layout-allow-overlap', '');
        }
        parent.appendChild(child);
        return child;
    }
    const pad = (number) => String(number).padStart(2, '0');
    // A chapter card shows its scene's number, title and question beside the roadmap of all scenes, marking where the
    // film stands. An agenda card shows its headline above the same list unmarked, so it serves as the route at the
    // start and as the recap at the end. Text the story leaves out is not drawn.
    function drawCard(layer, slot, scenes, timeline) {
        const chapter = slot.kind === 'chapter';
        const current = slot.scene === undefined ? -1 : slot.scene;
        const card = append(layer, 'div', 'explainery-card ' + slot.kind);
        append(card, 'div', 'background');
        const main = append(card, 'div', 'explainery-card-main');
        append(main, 'div', 'accent-rule');
        if (slot.copy.category)
            append(main, 'p', 'category', slot.copy.category);
        if (chapter)
            append(append(main, 'p', 'explainery-card-number', pad(current + 1)), 'span', 'explainery-card-count', ' / ' + pad(scenes.length));
        const title = append(main, 'h1', 'explainery-card-title', chapter ? scenes[current] : slot.copy.headline);
        const question = chapter && slot.copy.headline ? append(main, 'p', 'explainery-card-question', slot.copy.headline) : undefined;
        if (slot.copy.support)
            append(main, 'p', 'support', slot.copy.support);
        // On an agenda the list follows the headline, so a headline of any length pushes it down instead of overlapping.
        const roadmap = append(chapter ? card : main, 'ol', 'explainery-card-roadmap');
        scenes.forEach(function (name, index) {
            const state = !chapter ? 'next' : index < current ? 'past' : index === current ? 'current' : 'next';
            append(roadmap, 'li', state, pad(index + 1) + '  ' + name);
        });
        // Seconds on the layer clock. The lead line's wipe shrinks on a short card so nothing outlasts the card.
        const end = slot.start + slot.duration;
        const fadeIn = Math.max(slot.fadeIn, .01);
        const fadeOut = Math.max(slot.fadeOut, .01);
        const settle = Math.min(slot.fadeIn + .15, slot.duration * .3);
        const wipe = Math.max(Math.min(.6, slot.duration - slot.fadeOut - settle), .01);
        timeline.fromTo(card, { opacity: 0 }, { opacity: 1, duration: fadeIn }, slot.start);
        timeline.fromTo(question || title, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: wipe, ease: 'power1.out' }, slot.start + settle);
        // A set at the fade's start rather than a deferred fromTo: the card stays hidden until its fade-in, and renders
        // honour the opacity a set applies (src/validate.ts, deferredReveals).
        timeline.set(card, { opacity: 1 }, end - fadeOut).to(card, { opacity: 0, duration: fadeOut }, end - fadeOut);
    }
    /**
     * Draws the story's cards into the card layer composition `id` and registers its timeline through defineScene.
     *
     * explainery assemble passes the cards, every scene title and the layer duration as composition variables. The
     * cards are built here rather than in a core composition file because HyperFrames 0.8.142 skips sub-compositions
     * reached through the node_modules link when it compiles a render, while this script loads like the rest of the
     * runtime. The theme styles them through the explainery-card classes, prefixed so they never match a story's own markup.
     */
    const defineCards = function (scope, id) {
        return defineScene(scope, id, function (timeline) {
            const variables = scope.window.__hyperframes.getVariables();
            const layer = scope.document.querySelector('[data-composition-id="' + id + '"]');
            if (!layer)
                throw new Error('card layer "' + id + '" has no element with its data-composition-id');
            (variables.cards || []).forEach(function (slot) { drawCard(layer, slot, variables.scenes || [], timeline); });
        });
    };
    globalThis.defineScene = defineScene;
    globalThis.defineCards = defineCards;
})();
