'use strict';

window.pdfInterop = (() => {
    let observer        = null;
    let renderedSet     = new Set();
    let scrollTrackerOn = false;

    // ── PDF.js state ──────────────────────────────────────────────────────
    // pdf.min.mjs and pdf.worker.min.mjs are served from the same /js/ folder.
    const PDFJS_SRC    = new URL('js/pdf.min.mjs', location.href).href;
    const WORKER_SRC   = new URL('js/pdf.worker.min.mjs', location.href).href;

    let _pdfjsLib = null;
    let _pdfDoc   = null;

    async function ensurePdfJs() {
        if (_pdfjsLib) return _pdfjsLib;
        const mod = await import(PDFJS_SRC);
        _pdfjsLib = mod;
        _pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
        return _pdfjsLib;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  PAGE FLIP  — unchanged from desktop version
    // ══════════════════════════════════════════════════════════════════════
    const pageFlip = (() => {
        let dotNet     = null;
        let active     = false;
        let navDir     = null;
        let cornerSide = null;
        let startX     = 0;
        let pageWidth  = 0;
        let pageRect   = null;
        let ov         = null;
        let bMove      = null;
        let bUp        = null;

        function setup(dn) { dotNet = dn; }

        function refresh() {
            document.querySelectorAll('.flip-corner-zone').forEach(el => el.remove());

            document.querySelectorAll('.book-cover .pages-row').forEach(row => {
                const slots = [...row.querySelectorAll(':scope > .page-slot')];
                if (slots.length === 0) return;

                const isRTL     = row.style.direction === 'rtl';
                const rightSlot = isRTL ? slots[0] : slots[slots.length - 1];
                const leftSlot  = isRTL ? slots[slots.length - 1] : slots[0];

                addCorner(rightSlot, 'right', isRTL ? 'prev' : 'next');
                if (slots.length > 1)
                    addCorner(leftSlot, 'left', isRTL ? 'next' : 'prev');
            });
        }

        function addCorner(slot, side, dir) {
            if (!slot) return;
            const zone = document.createElement('div');
            zone.className = `flip-corner-zone flip-corner-${side}`;
            zone.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                startDrag(e, slot, side, dir);
            });
            slot.appendChild(zone);
        }

        function startDrag(e, slot, side, dir) {
            active     = true;
            cornerSide = side;
            navDir     = dir;
            startX     = e.clientX;
            pageWidth  = slot.offsetWidth;
            pageRect   = slot.getBoundingClientRect();

            buildOverlay(slot, pageRect, side, dir);

            document.body.style.cursor     = 'grabbing';
            document.body.style.userSelect = 'none';
            bMove = onMove;
            bUp   = onUp;
            document.addEventListener('mousemove', bMove);
            document.addEventListener('mouseup',   bUp);
        }

        function buildOverlay(slot, rect, side, dir) {
            const backGrad   = side === 'right' ? 'right' : 'left';
            const perspOrigX = side === 'right' ? '100%' : '0%';
            const foldEdge   = side === 'right' ? 'left'  : 'right';
            const creaseDir  = side === 'right' ? 'right' : 'left';
            const shadowSide = side === 'right' ? 'right' : 'left';

            const frontImg = slot.querySelector('img.pdf-canvas');

            const container = document.createElement('div');
            container.className = 'flip-overlay-container';
            container.style.cssText = `
                position: fixed;
                left: ${rect.left}px; top: ${rect.top}px;
                width: ${rect.width}px; height: ${rect.height}px;
                perspective: 2100px;
                perspective-origin: ${perspOrigX} 72%;
                pointer-events: none;
                z-index: 9100;
                overflow: visible;
            `;

            const face = document.createElement('div');
            face.className = 'flip-overlay-face';
            face.style.cssText = `
                position: absolute; inset: 0;
                transform-origin: ${foldEdge} center;
                transform-style: preserve-3d;
                will-change: transform;
            `;

            const currentPageNum = parseInt(slot.dataset.page) || 1;
            const backPageNum    = dir === 'next' ? currentPageNum + 1 : currentPageNum - 1;
            const backImg        = backPageNum >= 1
                ? document.querySelector(`.page-slot[data-page="${backPageNum}"] img.pdf-canvas`)
                : null;

            const front = document.createElement('div');
            front.style.cssText = `
                position: absolute; inset: 0;
                backface-visibility: hidden;
                -webkit-backface-visibility: hidden;
                overflow: hidden;
            `;
            if (frontImg) {
                const frontImgEl = document.createElement('img');
                frontImgEl.src = frontImg.src;
                frontImgEl.style.cssText = `
                    position: absolute;
                    width: ${rect.width}px; height: 100%;
                    left: 0; top: 0; display: block;
                `;
                front.appendChild(frontImgEl);
            } else {
                front.style.background = '#faf8f3';
            }

            const crease = document.createElement('div');
            crease.style.cssText = `
                position: absolute; inset: 0;
                background: linear-gradient(to ${creaseDir},
                    rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.18) 8%, transparent 35%);
                opacity: 0;
                pointer-events: none;
            `;
            front.appendChild(crease);

            const back = document.createElement('div');
            back.style.cssText = `
                position: absolute; inset: 0;
                backface-visibility: hidden;
                -webkit-backface-visibility: hidden;
                transform: rotateY(180deg);
                background: linear-gradient(to ${backGrad},
                    #cac5b8 0%, #ddd8cc 15%, #eceae2 45%, #f8f6f0 100%);
                overflow: hidden;
            `;
            if (backImg) {
                const backImgEl = document.createElement('img');
                backImgEl.src = backImg.src;
                backImgEl.style.cssText = `
                    position: absolute;
                    width: ${rect.width}px; height: 100%;
                    left: 0; top: 0; display: block;
                `;
                back.appendChild(backImgEl);
            }

            const shadow = document.createElement('div');
            shadow.style.cssText = `
                position: absolute;
                top: 0; bottom: 0;
                ${shadowSide}: 100%;
                width: ${rect.width * 0.55}px;
                background: linear-gradient(to ${shadowSide},
                    rgba(0,0,0,0.28) 0%, transparent 100%);
                pointer-events: none;
                opacity: 0;
            `;

            face.appendChild(front);
            face.appendChild(back);
            container.appendChild(shadow);
            container.appendChild(face);
            document.body.appendChild(container);

            ov = { container, face, crease, shadow, rect };

            const destPageNum = dir === 'next' ? currentPageNum + 2 : currentPageNum - 2;
            if (destPageNum >= 1) {
                const destImg = document.querySelector(
                    `.page-slot[data-page="${destPageNum}"] img.pdf-canvas`);
                if (destImg) {
                    const destOverlay = document.createElement('div');
                    destOverlay.style.cssText = `
                        position: fixed;
                        left: ${rect.left}px; top: ${rect.top}px;
                        width: ${rect.width}px; height: ${rect.height}px;
                        pointer-events: none;
                        z-index: 9099;
                        overflow: hidden;
                    `;
                    const destImgEl = document.createElement('img');
                    destImgEl.src = destImg.src;
                    destImgEl.style.cssText = `width: 100%; height: 100%; display: block;`;
                    destOverlay.appendChild(destImgEl);
                    document.body.appendChild(destOverlay);
                    ov.destOverlay = destOverlay;
                }
            }

            const spineDir = side === 'right' ? 'right' : 'left';
            const bindingStrip = `linear-gradient(to ${spineDir},
                rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.18) 1.6%, transparent 3.6%)`;
            const spineGrad = `linear-gradient(to ${spineDir},
                rgba(0,0,0,0.45)   0%,
                rgba(0,0,0,0.25)   3%,
                rgba(0,0,0,0.12)   7%,
                rgba(0,0,0,0.04)  13%,
                transparent        22%,
                transparent        70%,
                rgba(0,0,0,0.05)  78%,
                rgba(0,0,0,0.18)  88%,
                rgba(0,0,0,0.30)  96%,
                rgba(0,0,0,0.22) 100%)`;

            const shadowCap = document.createElement('div');
            shadowCap.style.cssText = `
                position: fixed;
                left: ${rect.left}px; top: ${rect.top}px;
                width: ${rect.width}px; height: ${rect.height}px;
                pointer-events: none;
                z-index: 9101;
                background: ${bindingStrip}, ${spineGrad};
            `;
            document.body.appendChild(shadowCap);

            const spineX = side === 'right' ? rect.left - 1 : rect.right - 1;
            const ridge = document.createElement('div');
            ridge.style.cssText = `
                position: fixed;
                left: ${spineX}px; top: ${rect.top}px;
                width: 2px; height: ${rect.height}px;
                pointer-events: none;
                z-index: 9101;
                background: linear-gradient(180deg,
                    rgba(255,255,255,0.0)  0%,
                    rgba(255,255,255,0.28) 6%,
                    rgba(255,255,255,0.28) 92%,
                    rgba(255,255,255,0.0) 100%);
            `;
            document.body.appendChild(ridge);

            ov.shadowCap = shadowCap;
            ov.ridge     = ridge;
        }

        function calcProgress(clientX) {
            const dx     = clientX - startX;
            const signed = cornerSide === 'right' ? -dx : dx;
            return Math.max(0, Math.min(1, signed / pageWidth));
        }

        function applyProgress(t) {
            const { face, crease, shadow } = ov;
            const angle = cornerSide === 'right' ? -t * 180 : t * 180;
            face.style.transform = `rotateY(${angle}deg)`;
            crease.style.opacity = String(Math.sin(t * Math.PI) * 0.9);
            shadow.style.opacity = String(Math.min(t * 2, 1));
        }

        function onMove(e) {
            if (!active || !ov) return;
            applyProgress(calcProgress(e.clientX));
        }

        function onUp(e) {
            if (!active) return;
            active = false;
            document.removeEventListener('mousemove', bMove);
            document.removeEventListener('mouseup',   bUp);
            document.body.style.cursor     = '';
            document.body.style.userSelect = '';

            if (calcProgress(e.clientX) >= 0.25) completeFlip();
            else                                  cancelFlip();
        }

        function completeFlip() {
            const { face, crease, shadow } = ov;
            const dur  = '0.30s';
            const ease = 'cubic-bezier(0.4,0,0.2,1)';
            const finalAngle = cornerSide === 'right' ? -180 : 180;

            face.style.transition   = `transform ${dur} ${ease}`;
            crease.style.transition = `opacity ${dur} ease`;
            shadow.style.transition = `opacity ${dur} ease`;

            face.style.transform = `rotateY(${finalAngle}deg)`;
            crease.style.opacity = '0';
            shadow.style.opacity = '0';

            const dir = navDir;
            setTimeout(() => {
                if (dir === 'next') dotNet.invokeMethodAsync('KbDown');
                else                dotNet.invokeMethodAsync('KbUp');

                setTimeout(() => {
                    const { container, destOverlay, shadowCap, ridge } = ov ?? {};
                    const fade = el => {
                        if (el) { el.style.transition = 'opacity 0.15s ease'; el.style.opacity = '0'; }
                    };
                    fade(container); fade(destOverlay); fade(shadowCap); fade(ridge);
                    setTimeout(() => { removeOverlay(); setTimeout(refresh, 300); }, 150);
                }, 120);
            }, 300);
        }

        function cancelFlip() {
            const { face, crease, shadow } = ov;
            face.style.transition   = 'transform 0.20s ease-out';
            crease.style.transition = 'opacity 0.20s ease';
            shadow.style.transition = 'opacity 0.20s ease';
            face.style.transform = 'rotateY(0deg)';
            crease.style.opacity = '0';
            shadow.style.opacity = '0';
            setTimeout(removeOverlay, 200);
        }

        function removeOverlay() {
            if (ov) {
                ov.container.remove();
                ov.destOverlay?.remove();
                ov.shadowCap?.remove();
                ov.ridge?.remove();
                ov = null;
            }
        }

        return { setup, refresh };
    })();

    // ══════════════════════════════════════════════════════════════════════
    //  BOOKMARKS  — persisted in localStorage
    // ══════════════════════════════════════════════════════════════════════
    const BM_KEY = 'qr_bookmarks';

    function _bmLoad() {
        try { return JSON.parse(localStorage.getItem(BM_KEY) || '[]'); } catch { return []; }
    }
    function _bmSave(list) { localStorage.setItem(BM_KEY, JSON.stringify(list)); }

    // ══════════════════════════════════════════════════════════════════════
    //  PUBLIC API
    // ══════════════════════════════════════════════════════════════════════
    return {

        // ── Keyboard / scroll / flip (same as desktop) ───────────────────
        registerKeyboard(dotNetRef) {
            pageFlip.setup(dotNetRef);
            document.addEventListener('keydown', (e) => {
                const tag = document.activeElement?.tagName?.toLowerCase();
                if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
                switch (e.key) {
                    case 'ArrowLeft':  e.preventDefault(); dotNetRef.invokeMethodAsync('KbLeft');  break;
                    case 'ArrowRight': e.preventDefault(); dotNetRef.invokeMethodAsync('KbRight'); break;
                    case 'PageUp':     e.preventDefault(); dotNetRef.invokeMethodAsync('KbUp');    break;
                    case 'PageDown':   e.preventDefault(); dotNetRef.invokeMethodAsync('KbDown');  break;
                }
            });
        },

        setupPageObserver(dotNetRef) {
            renderedSet.clear();
            if (observer) { observer.disconnect(); observer = null; }

            observer = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const pageNum = parseInt(entry.target.dataset.page);
                    if (renderedSet.has(pageNum)) continue;
                    renderedSet.add(pageNum);
                    dotNetRef.invokeMethodAsync('OnPageVisible', pageNum);
                }
            }, { rootMargin: '800px 0px' });

            this.observeSlots();

            if (!scrollTrackerOn) {
                scrollTrackerOn = true;
                const area = document.getElementById('scroll-area');
                if (area) {
                    let timer = null;
                    area.addEventListener('scroll', () => {
                        clearTimeout(timer);
                        timer = setTimeout(() => {
                            const slots = document.querySelectorAll('.page-slot[data-page]');
                            for (const slot of slots) {
                                if (slot.getBoundingClientRect().bottom > 60) {
                                    dotNetRef.invokeMethodAsync('SetCurrentPage',
                                        parseInt(slot.dataset.page));
                                    break;
                                }
                            }
                        }, 150);
                    }, { passive: true });
                }
            }
        },

        observeSlots() {
            if (!observer) return;
            document.querySelectorAll('.page-slot[data-page]').forEach(el => {
                if (!renderedSet.has(parseInt(el.dataset.page))) observer.observe(el);
            });
        },

        refreshPageFlip() { pageFlip.refresh(); },

        scrollToPage(pageNum) {
            const el = document.getElementById(`page-${pageNum}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },

        // ── PDF.js — load & render ────────────────────────────────────────

        async loadPdf(url) {
            const lib = await ensurePdfJs();
            const absUrl = new URL(url, location.href).href;
            _pdfDoc = await lib.getDocument(absUrl).promise;
            return _pdfDoc.numPages;
        },

        async renderPage(pageIndex, scale) {
            if (!_pdfDoc) return null;
            const page = await _pdfDoc.getPage(pageIndex + 1);   // PDF.js is 1-based
            const dpr       = window.devicePixelRatio || 1;
            const cssScale  = scale * 96 / 72;                   // points → CSS pixels
            const viewport  = page.getViewport({ scale: cssScale });
            const cssWidth  = Math.round(viewport.width);
            const cssHeight = Math.round(viewport.height);

            const canvas = document.createElement('canvas');
            canvas.width  = Math.round(cssWidth  * dpr);
            canvas.height = Math.round(cssHeight * dpr);

            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            await page.render({ canvasContext: ctx, viewport }).promise;

            const base64 = canvas.toDataURL('image/png').split(',')[1];
            return { Base64: base64, CssWidth: cssWidth, CssHeight: cssHeight };
        },

        // ── PDF.js — document outline ────────────────────────────────────

        async getOutline() {
            if (!_pdfDoc) return [];
            const raw = await _pdfDoc.getOutline();
            if (!raw) return [];

            const result = [];
            const flatten = async (items, level) => {
                for (const item of items) {
                    let pageNum = 0;
                    try {
                        if (item.dest) {
                            let dest = item.dest;
                            if (typeof dest === 'string')
                                dest = await _pdfDoc.getDestination(dest);
                            if (dest && dest[0]) {
                                const idx = await _pdfDoc.getPageIndex(dest[0]);
                                pageNum = idx + 1;   // 1-based
                            }
                        }
                    } catch { /* skip unresolvable dest */ }

                    result.push({ Title: item.title || '', PageNumber: pageNum, Level: level });
                    if (item.items?.length) await flatten(item.items, level + 1);
                }
            };

            await flatten(raw, 0);
            return result;
        },

        // ── Bookmarks (localStorage) ──────────────────────────────────────

        getBookmarks() { return _bmLoad(); },

        addBookmark(pageNum, label) {
            const list = _bmLoad();
            const id   = Date.now();
            list.push({ Id: id, PageNumber: pageNum, Label: label });
            _bmSave(list);
            return id;
        },

        updateBookmark(id, label) {
            const list = _bmLoad();
            const bm   = list.find(b => b.Id === id);
            if (bm) { bm.Label = label; _bmSave(list); }
        },

        deleteBookmark(id) {
            _bmSave(_bmLoad().filter(b => b.Id !== id));
        },
    };
})();
