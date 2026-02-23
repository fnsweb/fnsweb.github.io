'use strict';

// ══════════════════════════════════════════════════════════════════════════
//  CONFIG  — edit these if you change the extraction settings
// ══════════════════════════════════════════════════════════════════════════
const PAGE_EXT   = 'jpg';
const BM_KEY     = 'qr_bookmarks';

// ══════════════════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════════════════
let totalPages  = 874;    // overwritten from metadata.json if available
let currentPage = 1;      // always the first page of the current spread (odd in RTL)
let isRTL       = true;
let isTwoPage   = true;

// ══════════════════════════════════════════════════════════════════════════
//  DOM REFS
// ══════════════════════════════════════════════════════════════════════════
const slotA    = document.getElementById('slot-a');     // first slot
const slotB    = document.getElementById('slot-b');     // second slot
const imgA     = document.getElementById('img-a');
const imgB     = document.getElementById('img-b');
const pagesRow = document.getElementById('pages-row');
const preSlots = [0,1,2,3].map(i => document.getElementById(`slot-pre${i}`));
const preImgs  = [0,1,2,3].map(i => document.getElementById(`img-pre${i}`));

const btnPrev          = document.getElementById('btn-prev');
const btnNext          = document.getElementById('btn-next');
const lblPage          = document.getElementById('lbl-page');
const lblTotal         = document.getElementById('lbl-total');
const jumpInput        = document.getElementById('jump-input');
const sbPage           = document.getElementById('sb-page');
const chkRTL           = document.getElementById('chk-rtl');
const chkTwo           = document.getElementById('chk-twopage');
const sidebar          = document.getElementById('sidebar');
const sbBackdrop       = document.getElementById('sb-backdrop');
const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');

// ══════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════════════════
function pageUrl(n) {
    if (n < 1 || n > totalPages) return null;
    return `pages/${n}.${PAGE_EXT}`;
}

// In RTL two-page mode: slot-a = right page (currentPage), slot-b = left (currentPage+1)
// In LTR two-page mode: slot-a = left page (currentPage),  slot-b = right (currentPage+1)
function rightPage() { return currentPage; }
function leftPage()  { return isTwoPage ? currentPage + 1 : null; }

function snapToSpreadStart(n) {
    // In two-page mode pages are paired: (1,2) (3,4) (5,6)…
    if (!isTwoPage) return Math.max(1, Math.min(totalPages, n));
    n = Math.max(1, Math.min(totalPages, n));
    return (n % 2 === 0) ? n - 1 : n;
}

// ══════════════════════════════════════════════════════════════════════════
//  MOBILE HELPERS
// ══════════════════════════════════════════════════════════════════════════
const MOBILE_BP = 768;
function isMobileView() { return window.innerWidth < MOBILE_BP; }

function openSidebar() {
    sidebar.classList.add('sb-open');
    sbBackdrop.classList.add('sb-open');
}

function closeSidebar() {
    sidebar.classList.remove('sb-open');
    sbBackdrop.classList.remove('sb-open');
}

function toggleSidebar() {
    if (sidebar.classList.contains('sb-open')) closeSidebar();
    else openSidebar();
}

// Swipe up on the book area to go to next page; swipe down for previous.
function setupPageSwipe() {
    const area = document.getElementById('scroll-area');
    let tx = null, ty = null;
    area.addEventListener('touchstart', e => {
        tx = e.touches[0].clientX;
        ty = e.touches[0].clientY;
    }, { passive: true });
    area.addEventListener('touchend', e => {
        if (ty === null) return;
        const dx = e.changedTouches[0].clientX - tx;
        const dy = e.changedTouches[0].clientY - ty;
        tx = ty = null;
        if (Math.abs(dx) > Math.abs(dy) * 1.2) return; // mostly horizontal — ignore
        if (dy < -40) goToNext();  // swipe up   → next page
        if (dy >  40) goToPrev();  // swipe down → previous page
    }, { passive: true });
}

// Swipe left on the strip/sidebar to open; swipe right to close.
function setupSidebarTouch() {
    let tx = null, ty = null;
    sidebar.addEventListener('touchstart', e => {
        tx = e.touches[0].clientX;
        ty = e.touches[0].clientY;
    }, { passive: true });
    sidebar.addEventListener('touchend', e => {
        if (tx === null) return;
        const dx = e.changedTouches[0].clientX - tx;
        const dy = e.changedTouches[0].clientY - ty;
        tx = ty = null;
        if (Math.abs(dy) > Math.abs(dx) * 1.2) return; // mostly vertical — ignore
        if (dx < -36) openSidebar();
        if (dx >  36) closeSidebar();
    }, { passive: true });
}

// Enforce single-page on mobile; restore user preference on desktop.
// Called on init and whenever the viewport crosses the mobile breakpoint.
function applyViewMode() {
    if (isMobileView()) {
        isTwoPage = false;
        document.body.classList.add('single-page');
        closeSidebar();
    } else {
        isTwoPage = chkTwo.checked;
        document.body.classList.toggle('single-page', !isTwoPage);
    }
    currentPage = snapToSpreadStart(currentPage);
    renderSpread();
    checkAutoCollapse();
}

// Auto-collapse sidebar when the two-page spread overflows the scroll area;
// auto-open it when there is room. No-op on mobile (uses transform slide).
function checkAutoCollapse() {
    if (isMobileView()) return;
    function doCheck() {
        const scrollArea = document.getElementById('scroll-area');
        const bookCover  = document.getElementById('book-cover');
        if (!scrollArea || !bookCover) return;
        const bookW = bookCover.offsetWidth;
        if (bookW === 0) return;   // images not yet laid out — skip
        const sidebarW   = parseFloat(getComputedStyle(document.documentElement)
                               .getPropertyValue('--sidebar-w')) || 270;
        // Width available to the book when the sidebar is fully open
        const openScrollW = window.innerWidth - sidebarW;
        if (bookW <= openScrollW) openSidebar();
        else                      closeSidebar();
    }
    requestAnimationFrame(doCheck);
    // Re-check after images have had time to load and affect layout
    setTimeout(() => requestAnimationFrame(doCheck), 400);
}

// ══════════════════════════════════════════════════════════════════════════
//  IMAGE SIZING  — fit book to viewport
// ══════════════════════════════════════════════════════════════════════════
function updateBookHeight() {
    const toolbar  = document.getElementById('toolbar');
    const statusEl = document.getElementById('status-bar');
    const avail    = window.innerHeight
                   - (toolbar?.offsetHeight  || 52)
                   - (statusEl?.offsetHeight || 30)
                   - 8;                       // small breathing room
    document.documentElement.style.setProperty('--book-h', `${avail}px`);
}

let _prevMobile = isMobileView();
window.addEventListener('resize', () => {
    updateBookHeight();
    const nowMobile = isMobileView();
    if (nowMobile !== _prevMobile) {
        _prevMobile = nowMobile;
        applyViewMode();
    }
    checkAutoCollapse(); // returns early on mobile; re-evaluates fit on desktop
});

// ══════════════════════════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════════════════════════
function setSlot(slotEl, imgEl, pageNum) {
    slotEl.dataset.page = pageNum ?? -1;
    const url = pageNum ? pageUrl(pageNum) : null;
    imgEl.src = url ?? '';
    imgEl.alt = url ? `Page ${pageNum}` : '';
    slotEl.style.display = url ? '' : 'none';
}

function renderSpread() {
    const rp = rightPage();
    const lp = leftPage();

    if (isRTL) {
        // Right slot = lower-numbered page, Left slot = higher
        setSlot(slotA, imgA, rp);
        setSlot(slotB, imgB, lp);
        pagesRow.style.flexDirection = 'row';
        slotA.style.order = 2;   // visually right
        slotB.style.order = 1;   // visually left
    } else {
        setSlot(slotA, imgA, rp);
        setSlot(slotB, imgB, lp);
        pagesRow.style.flexDirection = 'row';
        slotA.style.order = 1;
        slotB.style.order = 2;
    }

    updatePreloads();
    pageFlip.refresh();
    updateUI();
    preloadAdjacent();
    updatePeek();
}

function updatePeek() {
    const aboveImg = document.getElementById('peek-above-img');
    const belowImg = document.getElementById('peek-below-img');
    if (!aboveImg || !belowImg) return;
    const prev = currentPage - 1;
    const next = currentPage + (isTwoPage ? 2 : 1);
    aboveImg.src = prev >= 1          ? pageUrl(prev) : '';
    belowImg.src = next <= totalPages ? pageUrl(next) : '';
}

// ── Preload pool — supplies back/dest images for the flip animation ──────
function updatePreloads() {
    // When flipping slot-b (left, going next in RTL):
    //   back = leftPage+1, dest = leftPage+2
    // When flipping slot-a (right, going prev in RTL):
    //   back = rightPage-1, dest = rightPage-2
    const rp = rightPage();
    const lp = leftPage() ?? rp;
    const pages = [lp + 1, lp + 2, rp - 1, rp - 2];
    pages.forEach((p, i) => {
        preSlots[i].dataset.page = p;
        preImgs[i].src = pageUrl(p) ?? '';
    });
}

const _preloaded = new Set();
function preload(n) {
    if (!n || n < 1 || n > totalPages || _preloaded.has(n)) return;
    _preloaded.add(n);
    const img = new Image();
    img.src = pageUrl(n);
}
function preloadAdjacent() {
    const rp = rightPage();
    for (let i = -4; i <= 8; i++) preload(rp + i);
}

// ══════════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════════════════════════
function goToPage(n, skipFlipRefresh = false) {
    const snapped = snapToSpreadStart(n);
    if (snapped === currentPage) return;
    currentPage = snapped;
    renderSpread();
}

function goToNext() {
    const step = isTwoPage ? 2 : 1;
    goToPage(currentPage + step);
}
function goToPrev() {
    const step = isTwoPage ? 2 : 1;
    goToPage(currentPage - step);
}

// ══════════════════════════════════════════════════════════════════════════
//  UI UPDATES
// ══════════════════════════════════════════════════════════════════════════
function updateUI() {
    lblPage.textContent  = currentPage;
    lblTotal.textContent = totalPages;
    sbPage.textContent   = isTwoPage
        ? `Pages ${currentPage}–${Math.min(currentPage + 1, totalPages)} of ${totalPages}`
        : `Page ${currentPage} of ${totalPages}`;
    btnPrev.disabled = currentPage <= 1;
    btnNext.disabled = currentPage + (isTwoPage ? 2 : 1) > totalPages;
}

// ══════════════════════════════════════════════════════════════════════════
//  PAGE FLIP  — adapted from the Blazor pdfInterop.js, pure JS now
//  Changes: removed DotNetRef / invokeMethodAsync → direct goToNext/Prev()
// ══════════════════════════════════════════════════════════════════════════
const pageFlip = (() => {
    let active     = false;
    let navDir     = null;
    let cornerSide = null;
    let startX     = 0;
    let pageWidth  = 0;
    let ov         = null;
    let bMove      = null;
    let bUp        = null;
    let bTouchMove = null;
    let bTouchUp   = null;

    // ── Public: rebuild corner zones after every navigation ───────────────
    function refresh() {
        document.querySelectorAll('.flip-corner-zone').forEach(el => el.remove());

        document.querySelectorAll('.book-cover .pages-row').forEach(row => {
            const slots = [...row.querySelectorAll(':scope > .page-slot')]
                          .filter(s => s.style.display !== 'none');
            if (slots.length === 0) return;

            const rtl       = isRTL;
            // In RTL: slot with lower order = right side visually
            const rightSlot = rtl
                ? slots.find(s => s.style.order === '2') ?? slots[0]
                : slots.find(s => s.style.order === '1') ?? slots[0];
            const leftSlot  = rtl
                ? slots.find(s => s.style.order === '1') ?? slots[slots.length - 1]
                : slots.find(s => s.style.order === '2') ?? slots[slots.length - 1];

            addCorner(rightSlot, 'right', rtl ? 'prev' : 'next');
            if (isTwoPage && slots.length > 1)
                addCorner(leftSlot, 'left', rtl ? 'next' : 'prev');
        });
    }

    function addCorner(slot, side, dir) {
        if (!slot) return;
        // Don't add a corner zone when there's nowhere to go in that direction
        const step = isTwoPage ? 2 : 1;
        if (dir === 'next' && currentPage + step > totalPages) return;
        if (dir === 'prev' && currentPage <= 1) return;
        const zone = document.createElement('div');
        zone.className = `flip-corner-zone flip-corner-${side}`;

        // Visible curl-hint: folded-corner triangle + shadow layer
        const hint = document.createElement('div');
        hint.className = `flip-curl-hint flip-curl-${side}`;
        zone.appendChild(hint);

        const hintShadow = document.createElement('div');
        hintShadow.className = `flip-curl-shadow flip-curl-shadow-${side}`;
        zone.appendChild(hintShadow);

        zone.addEventListener('mousedown', e => {
            e.preventDefault(); e.stopPropagation();
            startDrag(e.clientX, slot, side, dir);
        });
        zone.addEventListener('touchstart', e => {
            e.preventDefault(); e.stopPropagation();
            startDrag(e.touches[0].clientX, slot, side, dir);
        }, { passive: false });
        slot.appendChild(zone);
    }

    function startDrag(clientX, slot, side, dir) {
        try {
            active     = true;
            cornerSide = side;
            navDir     = dir;
            startX     = clientX;
            pageWidth  = slot.offsetWidth;
            buildOverlay(slot, slot.getBoundingClientRect(), side, dir);
            document.body.style.cursor     = 'grabbing';
            document.body.style.userSelect = 'none';
            bMove = onMove; bUp = onUp;
            bTouchMove = onTouchMove; bTouchUp = onTouchEnd;
            document.addEventListener('mousemove', bMove);
            document.addEventListener('mouseup',   bUp);
            document.addEventListener('touchmove', bTouchMove, { passive: false });
            document.addEventListener('touchend',  bTouchUp);
        } catch (err) {
            console.warn('[Flip] startDrag:', err);
            active = false; ov = null;
        }
    }

    function buildOverlay(slot, rect, side, dir) {
        const backGrad   = side === 'right' ? 'right' : 'left';
        const perspOrigX = side === 'right' ? '100%' : '0%';
        const foldEdge   = side === 'right' ? 'left'  : 'right';
        const creaseDir  = side === 'right' ? 'right' : 'left';
        const shadowSide = side === 'right' ? 'right' : 'left';

        const frontImg = slot.querySelector('img.pdf-canvas');

        const container = document.createElement('div');
        container.style.cssText = `
            position:fixed; left:${rect.left}px; top:${rect.top}px;
            width:${rect.width}px; height:${rect.height}px;
            perspective:2100px; perspective-origin:${perspOrigX} 72%;
            pointer-events:none; z-index:9100; overflow:visible;`;

        // skewY gives the fold crease a diagonal sweep (bottom corner leads).
        // That requires dropping preserve-3d (CSS spec flattens it when skew is
        // present), so we use JS opacity to switch front/back faces instead of
        // backface-visibility.
        const face = document.createElement('div');
        face.style.cssText = `
            position:absolute; inset:0;
            transform-origin:${foldEdge} center;
            will-change:transform;`;

        const currentPageNum = parseInt(slot.dataset.page) || 1;
        const backPageNum    = dir === 'next' ? currentPageNum + 1 : currentPageNum - 1;
        const backImgEl      = (backPageNum >= 1 && backPageNum <= totalPages)
            ? document.querySelector(`.page-slot[data-page="${backPageNum}"] img.pdf-canvas`)
            : null;

        // ── Front face ────────────────────────────────────────────────────────
        const front = document.createElement('div');
        front.style.cssText = 'position:absolute; inset:0; overflow:hidden;';
        if (frontImg) {
            const fi = document.createElement('img');
            fi.src = frontImg.src;
            fi.style.cssText = `position:absolute; width:${rect.width}px; height:100%; left:0; top:0; display:block;`;
            front.appendChild(fi);
        } else { front.style.background = '#faf8f3'; }

        // Spine-shadow crease — gradient updated dynamically in applyProgress
        // so its angle follows the diagonal sweep of the curl.
        const crease = document.createElement('div');
        crease.style.cssText = 'position:absolute; inset:0; opacity:0; pointer-events:none;';
        front.appendChild(crease);

        // Fold-ridge: bright stripe sweeping corner→spine, simulating reflected
        // light on the peak of the curling paper.
        const foldRidge = document.createElement('div');
        foldRidge.style.cssText = `
            position:absolute; top:0; bottom:0; width:48px; opacity:0; pointer-events:none;
            ${side === 'right' ? 'right' : 'left'}:0;
            background:linear-gradient(to ${creaseDir},
                transparent 0%, rgba(255,255,255,0.42) 46%,
                rgba(255,255,255,0.14) 58%, transparent 100%);`;
        front.appendChild(foldRidge);

        // ── Back face ─────────────────────────────────────────────────────────
        // scaleX(-1) pre-mirrors the content so that when the face itself is
        // past 90° (and CSS naturally shows it flipped), the two mirrors cancel
        // and the back-page image appears correctly oriented.
        const back = document.createElement('div');
        back.style.cssText = `
            position:absolute; inset:0; overflow:hidden; opacity:0;
            transform:scaleX(-1);
            background:linear-gradient(to ${backGrad},
                #cac5b8 0%, #ddd8cc 15%, #eceae2 45%, #f8f6f0 100%);`;
        if (backImgEl) {
            const bi = document.createElement('img');
            bi.src = backImgEl.src;
            bi.style.cssText = `position:absolute; width:${rect.width}px; height:100%; left:0; top:0; display:block;`;
            back.appendChild(bi);
        }

        const shadow = document.createElement('div');
        shadow.style.cssText = `
            position:absolute; top:0; bottom:0; ${shadowSide}:100%;
            width:${rect.width * 0.55}px; opacity:0; pointer-events:none;
            background:linear-gradient(to ${shadowSide}, rgba(0,0,0,0.28) 0%, transparent 100%);`;

        face.appendChild(front); face.appendChild(back);
        container.appendChild(shadow); container.appendChild(face);
        document.body.appendChild(container);

        ov = { container, face, front, back, crease, shadow, foldRidge, rect };

        // Destination overlay (page revealed after flip)
        const destPageNum = dir === 'next' ? currentPageNum + 2 : currentPageNum - 2;
        const destImgEl   = (destPageNum >= 1 && destPageNum <= totalPages)
            ? document.querySelector(`.page-slot[data-page="${destPageNum}"] img.pdf-canvas`)
            : null;
        if (destImgEl) {
            const destOv = document.createElement('div');
            destOv.style.cssText = `
                position:fixed; left:${rect.left}px; top:${rect.top}px;
                width:${rect.width}px; height:${rect.height}px;
                pointer-events:none; z-index:9099; overflow:hidden;`;
            const di = document.createElement('img');
            di.src = destImgEl.src;
            di.style.cssText = 'width:100%; height:100%; display:block;';
            destOv.appendChild(di);
            document.body.appendChild(destOv);
            ov.destOverlay = destOv;
        }

        // Spine shadow cap
        const spineDir = side === 'right' ? 'right' : 'left';
        const shadowCap = document.createElement('div');
        shadowCap.style.cssText = `
            position:fixed; left:${rect.left}px; top:${rect.top}px;
            width:${rect.width}px; height:${rect.height}px;
            pointer-events:none; z-index:9101;
            background:linear-gradient(to ${spineDir},
                rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.18) 1.6%, transparent 3.6%),
                linear-gradient(to ${spineDir},
                    rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.04) 13%,
                    transparent 22%, transparent 70%,
                    rgba(0,0,0,0.30) 96%, rgba(0,0,0,0.22) 100%);`;
        document.body.appendChild(shadowCap);

        const spineX = side === 'right' ? rect.left - 1 : rect.right - 1;
        const ridge = document.createElement('div');
        ridge.style.cssText = `
            position:fixed; left:${spineX}px; top:${rect.top}px;
            width:2px; height:${rect.height}px;
            pointer-events:none; z-index:9101;
            background:linear-gradient(180deg,
                rgba(255,255,255,0) 0%, rgba(255,255,255,0.28) 6%,
                rgba(255,255,255,0.28) 92%, rgba(255,255,255,0) 100%);`;
        document.body.appendChild(ridge);
        ov.shadowCap = shadowCap; ov.ridge = ridge;
    }

    function calcProgress(clientX) {
        const dx     = clientX - startX;
        const signed = cornerSide === 'right' ? -dx : dx;
        return Math.max(0, Math.min(1, signed / pageWidth));
    }

    function applyProgress(t) {
        const { face, front, back, crease, shadow, foldRidge, rect } = ov;

        // ── Core rotation + curl skew ─────────────────────────────────────────
        // skewY makes the fold crease diagonal: the bottom corner (where the
        // drag zone sits) leads the top, just like real paper curling from a
        // corner.  Peak skew is at t=0.5 (edge-on), zero at start/end.
        const baseAngle = cornerSide === 'right' ? -t * 180 : t * 180;
        const skewDeg   = Math.sin(t * Math.PI) * 14 * (cornerSide === 'right' ? -1 : 1);
        face.style.transform = `rotateY(${baseAngle}deg) skewY(${skewDeg}deg)`;

        // ── JS face-swap (replaces backface-visibility, needed after skew) ────
        const pastMid = Math.abs(baseAngle) > 90;
        front.style.opacity = pastMid ? '0' : '1';
        back.style.opacity  = pastMid ? '1' : '0';

        // ── Crease: diagonal gradient that rotates as the fold sweeps ─────────
        // Angle goes from ~45° (diagonal near corner) toward ~82° (near-vertical
        // near spine), mirroring the arc a real page curl traces.
        const creaseBase  = cornerSide === 'right' ? 90  : 270;   // axis direction
        const creaseSwing = cornerSide === 'right' ? -45 :  45;   // swing toward diagonal
        const creaseAngle = creaseBase + creaseSwing * (1 - t);
        crease.style.background = `linear-gradient(${creaseAngle}deg,
            rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.24) 5%,
            rgba(255,255,255,0.12) 7.5%, transparent 26%)`;
        crease.style.opacity = String(Math.sin(t * Math.PI) * 0.88);

        shadow.style.opacity = String(Math.min(t * 2, 1));

        // ── Fold-ridge: bright stripe sweeping corner → spine ─────────────────
        const ridgeW    = 48;
        const pos       = (1 - t) * (rect.width - ridgeW);
        const ridgeProp = cornerSide === 'right' ? 'right' : 'left';
        foldRidge.style[ridgeProp] = `${pos}px`;
        foldRidge.style.opacity = String(Math.sin(t * Math.PI) * 0.55);
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
        document.removeEventListener('touchmove', bTouchMove);
        document.removeEventListener('touchend',  bTouchUp);
        document.body.style.cursor     = '';
        document.body.style.userSelect = '';
        try {
            if (calcProgress(e.clientX) >= 0.25) completeFlip();
            else                                   cancelFlip();
        } catch (err) {
            console.warn('[Flip] onUp:', err);
            removeOverlay();
        }
    }

    function onTouchMove(e) {
        if (!active || !ov) return;
        e.preventDefault(); // prevent scroll while dragging the curl
        applyProgress(calcProgress(e.touches[0].clientX));
    }

    function onTouchEnd(e) {
        if (!active) return;
        active = false;
        document.removeEventListener('mousemove', bMove);
        document.removeEventListener('mouseup',   bUp);
        document.removeEventListener('touchmove', bTouchMove);
        document.removeEventListener('touchend',  bTouchUp);
        document.body.style.cursor     = '';
        document.body.style.userSelect = '';
        try {
            if (calcProgress(e.changedTouches[0].clientX) >= 0.25) completeFlip();
            else                                                      cancelFlip();
        } catch (err) {
            console.warn('[Flip] onTouchEnd:', err);
            removeOverlay();
        }
    }

    function completeFlip() {
        if (!ov) return;
        const { face, front, back, crease, shadow } = ov;
        const dur = '0.30s', ease = 'cubic-bezier(0.4,0,0.2,1)';
        const finalAngle = cornerSide === 'right' ? -180 : 180;
        face.style.transition   = `transform ${dur} ${ease}`;
        crease.style.transition = `opacity ${dur} ease`;
        shadow.style.transition = `opacity ${dur} ease`;
        // skewY(0deg) — curl unwinds as the page lands flat
        face.style.transform    = `rotateY(${finalAngle}deg) skewY(0deg)`;
        front.style.opacity     = '0';
        back.style.opacity      = '1';
        crease.style.opacity    = '0';
        shadow.style.opacity    = '0';

        const flipDir = navDir;
        setTimeout(() => {
            try {
                if (flipDir === 'next') goToNext();
                else                    goToPrev();
            } catch (err) { console.warn('[Flip] nav:', err); }

            setTimeout(() => {
                try {
                    const { container, destOverlay, shadowCap, ridge } = ov ?? {};
                    const fade = el => {
                        if (el) { el.style.transition = 'opacity 0.15s ease'; el.style.opacity = '0'; }
                    };
                    fade(container); fade(destOverlay); fade(shadowCap); fade(ridge);
                    setTimeout(() => { removeOverlay(); setTimeout(refresh, 300); }, 150);
                } catch (err) { console.warn('[Flip] fade:', err); removeOverlay(); }
            }, 120);
        }, 300);
    }

    function cancelFlip() {
        if (!ov) return;
        const { face, front, back, crease, shadow } = ov;
        face.style.transition   = 'transform 0.20s ease-out';
        crease.style.transition = 'opacity 0.20s ease';
        shadow.style.transition = 'opacity 0.20s ease';
        // skewY(0deg) — curl unwinds as the page springs back
        face.style.transform    = 'rotateY(0deg) skewY(0deg)';
        front.style.opacity     = '1';
        back.style.opacity      = '0';
        crease.style.opacity    = '0';
        shadow.style.opacity    = '0';
        setTimeout(removeOverlay, 200);
    }

    function removeOverlay() {
        if (ov) {
            ov.container?.remove(); ov.destOverlay?.remove();
            ov.shadowCap?.remove(); ov.ridge?.remove();
            ov = null;
        }
    }

    return { refresh };
})();

// ══════════════════════════════════════════════════════════════════════════
//  KEYBOARD
// ══════════════════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    switch (e.key) {
        case 'ArrowLeft':  e.preventDefault(); isRTL ? goToNext() : goToPrev(); break;
        case 'ArrowRight': e.preventDefault(); isRTL ? goToPrev() : goToNext(); break;
        case 'PageDown':   e.preventDefault(); goToNext(); break;
        case 'PageUp':     e.preventDefault(); goToPrev(); break;
        case 'Home':       e.preventDefault(); goToPage(1); break;
        case 'End':        e.preventDefault(); goToPage(totalPages); break;
    }
});

// ══════════════════════════════════════════════════════════════════════════
//  TOOLBAR EVENTS
// ══════════════════════════════════════════════════════════════════════════
btnPrev.addEventListener('click', goToPrev);
btnNext.addEventListener('click', goToNext);
btnSidebarToggle.addEventListener('click', toggleSidebar);
sbBackdrop.addEventListener('click', closeSidebar);
document.getElementById('sb-strip').addEventListener('click', toggleSidebar);
setupSidebarTouch();
setupPageSwipe();

jumpInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const n = parseInt(jumpInput.value);
    if (!isNaN(n)) { goToPage(n); jumpInput.value = ''; }
});

chkRTL.addEventListener('change', () => {
    isRTL = chkRTL.checked;
    renderSpread();
});

chkTwo.addEventListener('change', () => {
    if (isMobileView()) return;
    isTwoPage = chkTwo.checked;
    document.body.classList.toggle('single-page', !isTwoPage);
    currentPage = snapToSpreadStart(currentPage);
    renderSpread();
    checkAutoCollapse();
});

// ══════════════════════════════════════════════════════════════════════════
//  USER BOOKMARKS  (localStorage)
// ══════════════════════════════════════════════════════════════════════════
function bmLoad() {
    try { return JSON.parse(localStorage.getItem(BM_KEY) || '[]'); } catch { return []; }
}
function bmSave(list) { localStorage.setItem(BM_KEY, JSON.stringify(list)); }

function renderUserBookmarks() {
    const list = bmLoad();
    const el   = document.getElementById('bm-user-list');
    if (list.length === 0) {
        el.innerHTML = '<div class="sb-empty">No bookmarks yet.<br/>Click ＋ to add one.</div>';
        return;
    }
    el.innerHTML = '';
    list.forEach(bm => {
        const row = document.createElement('div');
        row.className = 'bm-item';
        row.innerHTML = `
            <div class="bm-badge">${bm.page}</div>
            <span class="bm-label" title="${bm.label}">${bm.label}</span>
            <button class="bm-del" title="Delete">✕</button>`;
        row.querySelector('.bm-label').addEventListener('click', () => { goToPage(bm.page); if (isMobileView()) closeSidebar(); });
        row.querySelector('.bm-badge').addEventListener('click', () => { goToPage(bm.page); if (isMobileView()) closeSidebar(); });
        row.querySelector('.bm-del').addEventListener('click', e => {
            e.stopPropagation();
            bmSave(bmLoad().filter(b => b.id !== bm.id));
            renderUserBookmarks();
        });
        el.appendChild(row);
    });
}

document.getElementById('btn-add-bm').addEventListener('click', () => {
    const list  = bmLoad();
    const label = `Page ${currentPage}`;
    list.push({ id: Date.now(), page: currentPage, label });
    bmSave(list);
    renderUserBookmarks();
});

// ══════════════════════════════════════════════════════════════════════════
//  PDF BOOKMARKS  (from bookmarks.json)
// ══════════════════════════════════════════════════════════════════════════
async function loadPdfBookmarks() {
    try {
        const res  = await fetch('bookmarks.json');
        if (!res.ok) return;
        const data = await res.json();
        const el   = document.getElementById('bm-pdf-list');
        const hdr  = document.getElementById('pdf-bm-header');
        if (!data.length) return;
        hdr.style.display = '';
        data.forEach(bm => {
            const row = document.createElement('div');
            row.className = 'bm-item bm-pdf-item';
            if (bm.level > 0) row.style.paddingLeft = `${10 + bm.level * 12}px`;
            row.innerHTML = `
                <div class="bm-badge bm-pdf-badge">${bm.page}</div>
                <span class="bm-label" title="${bm.title}">${bm.title}</span>`;
            row.addEventListener('click', () => { goToPage(bm.page); if (isMobileView()) closeSidebar(); });
            el.appendChild(row);
        });
    } catch { /* bookmarks.json not available yet */ }
}

// ══════════════════════════════════════════════════════════════════════════
//  METADATA  (optional — sets totalPages from metadata.json)
// ══════════════════════════════════════════════════════════════════════════
async function loadMetadata() {
    try {
        const res  = await fetch('metadata.json');
        if (!res.ok) return;
        const meta = await res.json();
        if (meta.totalPages) {
            totalPages = meta.totalPages;
            jumpInput.max = totalPages;
        }
    } catch { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════════════════
//  ORIENTATION LOCK  — request landscape on tablets/phones when supported
//  (only works for installed PWAs / fullscreen; silently ignored otherwise)
// ══════════════════════════════════════════════════════════════════════════
if (screen.orientation?.lock) {
    screen.orientation.lock('landscape').catch(() => {});
}

// ══════════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════════
(async () => {
    await loadMetadata();
    updateBookHeight();
    applyViewMode();          // sets single-page on mobile, renders spread
    renderUserBookmarks();
    await loadPdfBookmarks();
})();
