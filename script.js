/**
 * Homepage: multiple GLBs from assets.redo.design, normalized (max axis 2), laid out on a shallow arc (bbox widths + gap, centered on x=0).
 * GLB cache bust only on localhost (see GLB_USE_CACHE_BUST). Production loads use stable URLs for HTTP caching.
 *
 * Expected same-origin assets (see index.html <head> comment + document.baseURI):
 *   ./script.js (this file), ./styles.css, Assets/* for UI and step-3 thumbnails.
 */
/** Step 2 — sequential copy before design options appear (tune pacing here) */
const STEP2_ANALYSIS_MESSAGES = [
    'Analyzing material',
    'Detecting reference object',
    'Estimating dimensions from scale',
    'Assessing condition and usability',
    'Mapping usable geometry',
    'Preparing design options'
];
const STEP2_ANALYSIS_LINE_MS = 720;

/** Step 2 — “Processing image” delay when entering from Step 1 only (0 with reduced motion) */
const STEP2_IMAGE_PROCESSING_MS = 420;

/** Step 3 — sequential copy after leaving Step 2, before previews resolve */
const STEP3_BUILD_MESSAGES = [
    'Building selected design',
    'Analyzing structural logic',
    'Checking stability and assembly feasibility',
    'Preparing fabrication steps',
    'Generating final output'
];
const STEP3_BUILD_LINE_MS = 720;

/** Minimum time Step 3 overlay stays up after image URLs are set (load + perceived polish) */
const STEP3_GEN_MIN_MS = 2400;

const MODEL_ASSETS_BASE = 'https://assets.redo.design/';
/** When true, append ?v=timestamp so GLBs never cache (dev iteration). False in production for faster repeat visits. */
const GLB_USE_CACHE_BUST =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const MODEL_FILE_STEM = 'text';
const MODEL_COUNT = 5;

/** After load, largest bbox dimension is scaled to this (world units) */
const targetMaxDimension = 2.0;

/** Minimum chord gap between adjacent pivot centers (arc spacing baseline) */
const MODEL_ROW_GAP = 0.80;

/**
 * After layout, scale each hero model by (distance from camera / distance to center chair) so side chairs
 * match center apparent size (arc depth + perspective otherwise shrinks the left/right).
 */
const HERO_PERSPECTIVE_UNIFORM_SCALE = true;
/** Clamp perspective compensation so end chairs (e.g. 5th GLB) are not over-scaled vs center */
const HERO_PERSPECTIVE_SCALE_MIN = 0.9;
const HERO_PERSPECTIVE_SCALE_MAX = 1.02;
/** Push last arc chair farther from camera (world −Z) so it matches #1 apparent size */
const HERO_LAST_MODEL_Z_OFFSET = 0.62;

/** Arc: circle radius in XZ (tune for composition); may grow slightly to satisfy spacing / max span */
const ARC_RADIUS = 5.0;
/** Multiply required chord (width halves + gap) to keep motion / AABB error from clipping */
const ARC_SAFETY_MULT = 1.5;
/** If equal angular steps exceed this total span, radius is increased (shallower arc) */
const ARC_MAX_HALF_SPAN_RAD = 0.72;
/** 0 = fully face outward from arc center; 1 = same yaw as center chair (silhouette blend) */
const ARC_YAW_INWARD_BLEND = 0.14;

/** Vertical FOV (deg). ~20% wider vs 36° baseline — shorter effective focal length / zoomed-out framing */
const VIEW_CAMERA_FOV = 40;
/** Baseline Z distance; widened FOV + multi-model boost keep the row framed with breathing room */
const VIEW_CAMERA_BASE_Z = 8.0;
/** Slightly lower eye line vs look-at for a neutral premium product view (less low-angle). */
const VIEW_CAMERA_POSITION = new THREE.Vector3(0, 0.81, VIEW_CAMERA_BASE_Z);
const VIEW_CAMERA_LOOK_AT = new THREE.Vector3(0, 0.57, 0);
/** Extra Z per half-row-width when more than one model: z = baseZ + (rowWidth/2) * this */
const VIEW_CAMERA_ROW_Z_SCALE = 0.6;

/** BAM-style presentation (pivot); ambient motion applied on top in animate() */
const HERO_PIVOT_ROT_X = -0.08;
const HERO_PIVOT_ROT_Y_BASE = 0.55;
/** Lower entire arc in world Y (floorline below mid-screen, more top surface visible) */
const HERO_ARRANGEMENT_Y_OFFSET = -0.22;
/** Continuous yaw (rad/s); rAF + elapsed — shared across all chairs (slightly restrained for cinematic feel) */
const HERO_SPIN_RAD_PER_SEC = 0.23;
/** Vertical bob (world units); sin(elapsed * freq + phase) */
const HERO_FLOAT_FREQ_RAD_S = 0.48;
const HERO_FLOAT_AMP = 0.018;
/** Curated initial Y offset per chair (rad); ambient yaw uses elapsed * HERO_SPIN_RAD_PER_SEC (shared) */
const HERO_SPIN_START_OFFSETS = [-0.8, -0.2, 0.5, 1.1, 1.8];
/** Alternating depth on Z after arc placement: even index → −mag, odd → +mag (layered from camera at +Z). X unchanged. */
const HERO_DEPTH_STAGGER_Z = 0.55;
/** Extra +Z on chairs with arc x > 0 (right side) for depth separation toward camera at +Z */
const HERO_DEPTH_RIGHT_EXTRA_Z = 0.24;

/** Hover emphasis (1.15–1.25 range); selection uses separate multipliers below */
const HOVER_SCALE_MULTIPLIER = 1.2;
/** Rest scale when a chair is chosen (reads clearly vs neighbors) */
const SELECTED_MODEL_SCALE_MULT = 1.28;
/** Combined when selected + hover */
const SELECTED_HOVER_MODEL_SCALE_MULT = 1.55;
/** Tween.js duration for hover scale in/out (discrete transition; rAF does not write model.scale) */
const HOVER_SCALE_DURATION_MS = 380;
/** NDC inset when testing AABB overlap (smaller = stricter “no touch” in screen space) */
const HERO_SCREEN_OVERLAP_INSET_NDC = 0.015;
const HERO_SCREEN_SEP_STEP_X = 0.15;
const HERO_SCREEN_SEP_STEP_Z = 0.15;
const HERO_SCREEN_SEP_MAX_ITERS = 50;

function heroSpinStartRadForIndex(index) {
    const arr = HERO_SPIN_START_OFFSETS;
    if (!arr.length) return 0;
    return arr[index % arr.length];
}

function buildModelUrls() {
    const urls = [];
    for (let n = 1; n <= MODEL_COUNT; n++) {
        const MODEL_NAME = `${MODEL_FILE_STEM}${n}.glb`;
        urls.push(`${MODEL_ASSETS_BASE}${MODEL_NAME}`);
    }
    return urls;
}

const R2_MODEL_URLS = buildModelUrls();

/**
 * Step 4 — maps Step 3 selected output (data-option-index 0–2) to R2 GLB + local diagram + instructions text.
 * op1_1 → 1.glb; middle → text8.glb; op3_3 → text15.glb (host these on the same R2 bucket as hero GLBs).
 * If the mapped GLB fails to load, the viewer falls back to text1.glb (STEP4_FALLBACK_GLB).
 * Tabs on Step 4 switch which panel is visible (3D vs diagram vs instructions), not which design bundle is loaded.
 */
const STEP4_ASSEMBLY_DIAGRAM = 'Assets/assemblydiagram.png';
const STEP4_OUTPUT_SPECS = [
    { glb: '1.glb', diagram: STEP4_ASSEMBLY_DIAGRAM, instructionsTxt: 'Assets/Instructions_op1.txt' },
    { glb: 'text8.glb', diagram: STEP4_ASSEMBLY_DIAGRAM, instructionsTxt: 'Assets/Instructions_op1.txt' },
    { glb: 'text15.glb', diagram: STEP4_ASSEMBLY_DIAGRAM, instructionsTxt: 'Assets/Instructions_op1.txt' }
];

/** R2 default when the mapped output GLB is missing or fails to load (same bucket as MODEL_ASSETS_BASE). */
const STEP4_FALLBACK_GLB = 'text1.glb';

function step4ResolveGlbUrl(filename) {
    const base = `${MODEL_ASSETS_BASE}${filename}`;
    if (GLB_USE_CACHE_BUST && !base.includes('?')) return `${base}?v=${Date.now()}`;
    return base;
}

function step4GlbUrlSameAsset(a, b) {
    const strip = (u) => {
        try {
            const path = new URL(u, typeof window !== 'undefined' ? window.location.href : 'https://redo.design/').pathname;
            const file = path.split('/').pop() || '';
            return file.split('?')[0];
        } catch {
            return String(u).split('?')[0].split('/').pop() || '';
        }
    };
    return strip(a) === strip(b);
}

function step4NormalizeAndGround(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    /* Slightly smaller world size + wider FOV / camera pullback = full model in frame */
    const target = 1.38;
    model.scale.multiplyScalar(target / maxDim);
    box.setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    box.setFromObject(model);
    const minY = box.min.y;
    model.position.y -= minY;
}

/** Ensure textured GLBs show full-color maps (no stale grayscale; keeps originalMap refs for restore). */
function redoFinalizeGltfMaterialsForColor(model) {
    if (!model) return;
    model.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat) => {
            if (mat.map && !mat.userData.originalMap) {
                mat.userData.originalMap = mat.map;
            }
            if (mat.color && !mat.userData.originalColor) {
                mat.userData.originalColor = mat.color.clone();
            }
            if (mat.userData.grayMap) {
                try {
                    mat.userData.grayMap.dispose?.();
                } catch (_) {}
                delete mat.userData.grayMap;
            }
            if (mat.userData.originalMap) {
                mat.map = mat.userData.originalMap;
            }
            if (mat.color && mat.userData.originalColor) {
                mat.color.copy(mat.userData.originalColor);
            }
            mat.needsUpdate = true;
        });
    });
}

/** Lightweight single-model viewer for Step 4 (separate from hero arc scene). */
class Step4ModelViewer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff);
        /* Wider FOV + farther camera = shorter effective focal length, more of GLB in view */
        this.camera = new THREE.PerspectiveCamera(52, 1, 0.06, 80);
        this.camera.position.set(0.32, 0.48, 2.85);
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        if (THREE.sRGBEncoding !== undefined) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        this.controls = new THREE.OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.target.set(0, 0.34, 0);
        this.root = new THREE.Group();
        this.scene.add(this.root);
        /* Studio-style fill on white ground so dark GLBs read clearly */
        const hemi = new THREE.HemisphereLight(0xffffff, 0xf0f0f0, 0.92);
        const dir = new THREE.DirectionalLight(0xffffff, 0.55);
        dir.position.set(2.2, 4.5, 3.2);
        this.scene.add(hemi, dir);
        this._raf = 0;
        this._loadToken = 0;
        this._resizeObs = null;
    }

    init() {
        this._resize();
        this._resizeObs = new ResizeObserver(() => this._resize());
        const vp = this.canvas.closest('.step-4-viewport');
        if (vp) this._resizeObs.observe(vp);
        window.addEventListener('resize', () => this._resize());
        this._loop();
    }

    _resize() {
        const vp = this.canvas.closest('.step-4-viewport');
        const w = Math.max(1, vp ? vp.clientWidth : this.canvas.clientWidth || 320);
        const h = Math.max(1, vp ? vp.clientHeight : 280);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);
    }

    _loop = () => {
        this._raf = requestAnimationFrame(this._loop);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    };

    clearModel() {
        while (this.root.children.length) {
            const o = this.root.children[0];
            this.root.remove(o);
            o.traverse((c) => {
                if (c.isMesh) {
                    c.geometry?.dispose?.();
                    const mats = Array.isArray(c.material) ? c.material : [c.material];
                    mats.forEach((m) => {
                        if (m && typeof m.dispose === 'function') m.dispose();
                    });
                }
            });
        }
    }

    loadGlb(url) {
        const token = (this._loadToken += 1);
        this.clearModel();
        const fallbackUrl = step4ResolveGlbUrl(STEP4_FALLBACK_GLB);
        const loader = new THREE.GLTFLoader();
        if (typeof loader.setCrossOrigin === 'function') {
            loader.setCrossOrigin('anonymous');
        }
        const onSuccess = (gltf) => {
            if (token !== this._loadToken) return;
            const model = gltf.scene;
            this.root.add(model);
            step4NormalizeAndGround(model);
            redoFinalizeGltfMaterialsForColor(model);
            this.controls.target.set(0, 0.34, 0);
            this.camera.position.set(0.32, 0.48, 2.85);
            this.controls.update();
        };
        const tryLoad = (loadUrl, isFallbackAttempt) => {
            loader.load(
                loadUrl,
                onSuccess,
                undefined,
                (err) => {
                    if (token !== this._loadToken) return;
                    console.warn('[Step 4] GLB failed:', loadUrl, err);
                    if (
                        !isFallbackAttempt &&
                        !step4GlbUrlSameAsset(loadUrl, fallbackUrl)
                    ) {
                        tryLoad(fallbackUrl, true);
                    }
                }
            );
        };
        tryLoad(url, false);
    }

    dispose() {
        cancelAnimationFrame(this._raf);
        this._resizeObs?.disconnect();
        this.clearModel();
        this.renderer.dispose();
    }
}

/** Resolve repo static paths against document.baseURI (set via <base> in index.html). */
function redoAssetPath(relativePath) {
    const p = String(relativePath || '').replace(/^\/+/, '');
    try {
        return new URL(p, document.baseURI).href;
    } catch (e) {
        return p;
    }
}

const REDO_BLUEPRINT_PENDING = 'redo-blueprint-pending';
const REDO_BLUEPRINT_REVEALED = 'redo-blueprint-revealed';

function redoBlueprintRevealSupported() {
    return (
        typeof IntersectionObserver === 'function' &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
}

function redoObserveBlueprintImg(img) {
    if (!img || img.tagName !== 'IMG') return;
    const io = window._redoBlueprintIO;
    if (!io) return;
    io.unobserve(img);
    img.classList.remove(REDO_BLUEPRINT_REVEALED);
    img.classList.add(REDO_BLUEPRINT_PENDING);
    io.observe(img);
}

function initRedoBlueprintReveal() {
    if (!redoBlueprintRevealSupported()) return;
    if (window._redoBlueprintIO) return;
    window._redoBlueprintIO = new IntersectionObserver(
        (entries) => {
            entries.forEach((ent) => {
                if (!ent.isIntersecting) return;
                const el = ent.target;
                el.classList.remove(REDO_BLUEPRINT_PENDING);
                el.classList.add(REDO_BLUEPRINT_REVEALED);
                window._redoBlueprintIO.unobserve(el);
            });
        },
        { threshold: 0.14, rootMargin: '0px 0px -6% 0px' }
    );
    document.querySelectorAll('.image-thumbnail img').forEach((img) => redoObserveBlueprintImg(img));
}

function initRedoStepContentReveal() {
    if (typeof IntersectionObserver === 'undefined' || window._redoStepContentRevealIO) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    window._redoStepContentRevealIO = new IntersectionObserver(
        (entries) => {
            entries.forEach((ent) => {
                if (!ent.isIntersecting || ent.intersectionRatio < 0.055) return;
                ent.target.classList.add('step-content--revealed');
            });
        },
        { threshold: [0, 0.06, 0.12, 0.2, 0.35], root: null, rootMargin: '0px' }
    );

    document.querySelectorAll('.step-slide .canvas-content').forEach((el) => {
        window._redoStepContentRevealIO.observe(el);
    });
}

/** White hint + square on dark UI (viewport, dragger, nav, dimmed adjacent columns) */
function redoCursorUseLightHint(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(
        [
            '.step-4-viewport',
            '#step-4-model-canvas',
            '.step-4-diagram-frame',
            '.step-4-diagram-img',
            '.nav-step.active .step-circle',
            /* Forward handle is dark; back (.slider-left) is light — keep black cursor there */
            '.canvas-slider.slider-right .progress-circle',
            '.help-fab',
            '.step-slide.step-slide--adjacent-prev',
            '.step-slide.step-slide--adjacent-next'
        ].join(', ')
    );
}

/** I-beam only where native text editing / copy-paste applies (not instruction body) */
function isRedoCopyPasteCursorSurface(el) {
    if (!el || !el.closest) return false;
    if (el.closest('#redo-cursor-hint')) return false;
    return !!el.closest('input, textarea, select');
}

function hideRedoCursorHint() {
    clearRedoCursorAll();
}

function clearRedoCursorAll() {
    const hint = document.getElementById('redo-cursor-hint');
    const dot = document.getElementById('redo-cursor-dot');
    if (hint) {
        hint.classList.remove(
            'redo-cursor-hint--visible',
            'redo-cursor-hint--invert',
            'redo-cursor-hint--drag-dark'
        );
        hint.textContent = '';
    }
    if (dot) dot.classList.remove('redo-cursor-dot--visible', 'redo-cursor-dot--invert');
    document.body.classList.remove('redo-cursor-hint-active', 'redo-cursor-ibeam');
    document.documentElement.classList.remove('redo-cursor-lock');
}

/** Step 4 instructions: three bands — scroll down | scroll down · scroll up | scroll up */
function redoStep4InstructionScrollHint(shell) {
    if (!shell || shell.scrollHeight <= shell.clientHeight + 4) return null;
    const st = shell.scrollTop;
    const ch = shell.clientHeight;
    const sh = shell.scrollHeight;
    const maxScroll = Math.max(0, sh - ch);
    if (maxScroll < 8) return null;
    const t = st / maxScroll;
    if (t <= 1 / 3) return 'scroll down';
    if (t >= 2 / 3) return 'scroll up';
    return 'scroll down · scroll up';
}

function applyRedoCursorSquare(clientX, clientY, pick) {
    const dot = document.getElementById('redo-cursor-dot');
    if (!dot) return;
    dot.style.left = `${clientX}px`;
    dot.style.top = `${clientY}px`;
    const light = pick && redoCursorUseLightHint(pick);
    dot.classList.toggle('redo-cursor-dot--invert', !!light);
    dot.classList.add('redo-cursor-dot--visible');
    document.documentElement.classList.add('redo-cursor-lock');
}

function updateRedoCursorHint(clientX, clientY) {
    const hint = document.getElementById('redo-cursor-hint');
    const dot = document.getElementById('redo-cursor-dot');
    if (!hint) return;

    if (!document.body.classList.contains('redo-chrome-visible')) {
        clearRedoCursorAll();
        return;
    }

    const pick = document.elementFromPoint(clientX, clientY);
    if (!pick || pick === hint || pick.closest('#redo-cursor-hint')) {
        clearRedoCursorAll();
        return;
    }

    if (isRedoCopyPasteCursorSurface(pick)) {
        clearRedoCursorAll();
        document.body.classList.add('redo-cursor-ibeam');
        return;
    }

    document.body.classList.remove('redo-cursor-ibeam');

    applyRedoCursorSquare(clientX, clientY, pick);

    hint.style.left = `${clientX + 16}px`;
    hint.style.top = `${clientY + 16}px`;

    const flow = parseInt(document.body.dataset.activeFlowStep || '1', 10);

    let hintText = '';
    let hintLight = false;

    if (pick.closest('.canvas-slider.slider-left .progress-circle')) {
        hintText = 'click';
        hintLight = redoCursorUseLightHint(pick);
    } else if (flow === 1 && pick.closest('.image-thumbnail')) {
        hintText = 'select';
        hintLight = redoCursorUseLightHint(pick);
    } else if (flow === 3 && pick.closest('.step-3-option')) {
        hintText = 'choose your favourite';
        hintLight = redoCursorUseLightHint(pick);
    } else if (flow === 4) {
        const panels = document.getElementById('step-4-panels');
        const view = panels?.getAttribute('data-step4-view') || '3d';

        if (view === '3d') {
            const in3dPanel = pick.closest('#step-4-panel-3d');
            const vp = pick.closest('.step-4-viewport');
            if (in3dPanel && vp && !pick.closest('button, a, [role="tab"], .step-4-output-tab')) {
                hintText = 'left + drag';
                hintLight = false;
            }
        }

        if (view === 'instructions') {
            const shell = pick.closest('.step-4-code-shell');
            if (shell && shell.closest('#step-4-panel-instructions')) {
                const scrollMsg = redoStep4InstructionScrollHint(shell);
                if (scrollMsg) {
                    hintText = scrollMsg;
                    hintLight = redoCursorUseLightHint(pick);
                }
            }
        }
    }

    if (hintText) {
        hint.textContent = hintText;
        hint.classList.toggle('redo-cursor-hint--invert', hintLight);
        hint.classList.toggle(
            'redo-cursor-hint--drag-dark',
            hintText === 'left + drag' && !hintLight
        );
        hint.classList.add('redo-cursor-hint--visible');
        document.body.classList.add('redo-cursor-hint-active');
    } else {
        hint.textContent = '';
        hint.classList.remove(
            'redo-cursor-hint--visible',
            'redo-cursor-hint--invert',
            'redo-cursor-hint--drag-dark'
        );
        document.body.classList.remove('redo-cursor-hint-active');
    }
}

function initRedoCursorHint() {
    if (typeof document === 'undefined' || window._redoCursorHintInit) return;
    if (!document.getElementById('redo-cursor-hint')) return;
    window._redoCursorHintInit = true;

    let raf = 0;
    let lastX = 0;
    let lastY = 0;

    const flush = () => {
        raf = 0;
        updateRedoCursorHint(lastX, lastY);
    };

    const scheduleFlush = () => {
        if (raf) return;
        raf = requestAnimationFrame(flush);
    };

    window.addEventListener(
        'pointermove',
        (e) => {
            lastX = e.clientX;
            lastY = e.clientY;
            scheduleFlush();
        },
        { passive: true }
    );

    document.querySelector('.step-4-code-shell')?.addEventListener(
        'scroll',
        () => {
            scheduleFlush();
        },
        { passive: true }
    );

    window.addEventListener('blur', () => clearRedoCursorAll());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') clearRedoCursorAll();
    });
}

/** DRAG arc label: cursor-follow lean + click-without-horizontal-move shake hint */
let _redoDragLabelShakePending = null;

function initDragLabelMagnetic() {
    if (typeof document === 'undefined') return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const bindGlobalShakeOnce = () => {
        if (window._redoDragLabelShakeBound) return;
        window._redoDragLabelShakeBound = true;

        const trackPeakDx = (e) => {
            const pending = _redoDragLabelShakePending;
            if (!pending || e.pointerId !== pending.pointerId) return;
            const d = Math.abs(e.clientX - pending.downX);
            if (d > pending.peakDx) pending.peakDx = d;
        };

        const finish = (e) => {
            const pending = _redoDragLabelShakePending;
            if (!pending) return;
            if (e && Number.isFinite(e.pointerId) && e.pointerId !== pending.pointerId) {
                return;
            }
            _redoDragLabelShakePending = null;
            if (reduceMotion) return;
            if (pending.peakDx >= 10) return;
            const svg = pending.svg;
            svg.classList.remove('drag-label--shake');
            void svg.offsetWidth;
            svg.classList.add('drag-label--shake');
            window.setTimeout(() => svg.classList.remove('drag-label--shake'), 480);
        };

        const cancel = (e) => {
            const pending = _redoDragLabelShakePending;
            if (!pending) return;
            if (Number.isFinite(e.pointerId) && e.pointerId !== pending.pointerId) return;
            _redoDragLabelShakePending = null;
        };

        window.addEventListener('pointermove', trackPeakDx, { passive: true });
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', cancel);
    };

    bindGlobalShakeOnce();

    document.querySelectorAll('svg.drag-label').forEach((svg) => {
        if (svg.dataset.dragMagneticInit === '1') return;
        svg.dataset.dragMagneticInit = '1';

        const group = svg.querySelector('.drag-magnetic-group');
        if (!group) return;

        const cx = 45;
        const cy = 45;
        const mag = 5;
        const maxRot = 6;
        const maxSkew = 3.5;

        const labelVisible = () => {
            const st = getComputedStyle(svg);
            const o = parseFloat(st.opacity);
            return !Number.isNaN(o) && o > 0.02;
        };

        const setNeutral = () => {
            group.removeAttribute('transform');
        };

        const applyMagnetic = (clientX, clientY) => {
            if (reduceMotion || !labelVisible()) return;
            const rect = svg.getBoundingClientRect();
            if (rect.width < 4 || rect.height < 4) return;
            const nx = (clientX - rect.left) / rect.width - 0.5;
            const ny = (clientY - rect.top) / rect.height - 0.5;
            const tx = nx * mag * 2;
            const ty = ny * mag * 2;
            const rot = nx * maxRot;
            const sk = nx * maxSkew;
            group.setAttribute(
                'transform',
                `translate(${cx} ${cy}) translate(${tx.toFixed(2)} ${ty.toFixed(2)}) rotate(${rot.toFixed(2)}) skewX(${sk.toFixed(2)}) translate(${-cx} ${-cy})`
            );
        };

        svg.addEventListener('pointermove', (e) => {
            if (!labelVisible()) return;
            applyMagnetic(e.clientX, e.clientY);
        });

        svg.addEventListener('pointerleave', () => {
            setNeutral();
        });

        if (!reduceMotion) {
            svg.addEventListener('pointerdown', (e) => {
                if (!labelVisible()) return;
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                _redoDragLabelShakePending = {
                    svg,
                    downX: e.clientX,
                    peakDx: 0,
                    pointerId: e.pointerId
                };
            });
        }

        document.addEventListener(
            'pointerdown',
            (e) => {
                if (!svg.contains(e.target)) setNeutral();
            },
            true
        );
    });
}

/** ESM entry for Motion (Framer spring API in vanilla JS) — cached after first snap */
const REDO_MOTION_ESM = 'https://cdn.jsdelivr.net/npm/motion@11.18.2/+esm';
let _redoMotionAnimate = null;

async function redoLoadMotionAnimate() {
    if (_redoMotionAnimate) return _redoMotionAnimate;
    const mod = await import(REDO_MOTION_ESM);
    _redoMotionAnimate = mod.animate;
    return _redoMotionAnimate;
}

/** Spring to match Framer Motion `type: "spring", stiffness: 300, damping: 20` (mass 1) */
function redoSpringTranslateXY(el, x0, y0, x1, y1, onDone) {
    const stiffness = 300;
    const damping = 20;
    const mass = 1;
    const k = stiffness / mass;
    const c = damping / mass;
    let x = x0;
    let y = y0;
    let vx = 0;
    let vy = 0;
    let last = performance.now();

    function step(now) {
        const dt = Math.min((now - last) / 1000, 0.055);
        last = now;
        const ax = -k * (x - x1) - c * vx;
        const ay = -k * (y - y1) - c * vy;
        vx += ax * dt;
        vy += ay * dt;
        x += vx * dt;
        y += vy * dt;
        el.style.transform = `translate3d(${x}px,${y}px,0)`;
        if (
            Math.abs(x - x1) < 0.5 &&
            Math.abs(y - y1) < 0.5 &&
            Math.abs(vx) < 6 &&
            Math.abs(vy) < 6
        ) {
            el.style.transform = `translate3d(${x1}px,${y1}px,0)`;
            onDone();
            return;
        }
        requestAnimationFrame(step);
    }
    el.style.transform = `translate3d(${x0}px,${y0}px,0)`;
    requestAnimationFrame(step);
}

function redoDistPointToRect(px, py, rect) {
    const cx = Math.min(Math.max(px, rect.left), rect.right);
    const cy = Math.min(Math.max(py, rect.top), rect.bottom);
    return Math.hypot(px - cx, py - cy);
}

/**
 * Drag catalog thumbnails into the Step 1 upload slot: 50px magnetic zone, Motion spring snap, ghost preview.
 */
function initThumbnailDragToSlot(scene) {
    const bottomImages = document.querySelector('.bottom-images');
    const uploadBox = document.querySelector('.upload-box');
    if (!bottomImages || !uploadBox || bottomImages.dataset.redoThumbDropInit === '1') return;
    bottomImages.dataset.redoThumbDropInit = '1';

    const SNAP_PX = 50;
    const DRAG_THRESHOLD_PX = 9;
    const GHOST_LERP = 0.22;
    const MAGNET_STRENGTH = 0.48;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    async function springGhost(ghost, x0, y0, x1, y1) {
        if (reduceMotion) {
            ghost.style.transform = `translate3d(${x1}px,${y1}px,0)`;
            return;
        }
        ghost.style.transform = `translate3d(${x0}px,${y0}px,0)`;
        try {
            const animate = await redoLoadMotionAnimate();
            const ctrl = animate(
                ghost,
                { transform: `translate3d(${x1}px,${y1}px,0)` },
                { type: 'spring', stiffness: 300, damping: 20 }
            );
            if (ctrl && ctrl.finished) await ctrl.finished;
            else if (ctrl && typeof ctrl.then === 'function') await ctrl;
        } catch {
            await new Promise((resolve) => {
                redoSpringTranslateXY(ghost, x0, y0, x1, y1, resolve);
            });
        }
    }

    bottomImages.addEventListener('pointerdown', (e) => {
        const thumb = e.target && e.target.closest('.image-thumbnail');
        if (!thumb || !bottomImages.contains(thumb)) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (scene.currentStep !== 1) return;

        const img = thumb.querySelector('img');
        if (!img || !img.src) return;

        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;
        let ghost = null;
        let gx = 0;
        let gy = 0;
        let cursorX = startX;
        let cursorY = startY;
        let rafId = 0;
        const pointerId = e.pointerId;

        const stopRaf = () => {
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = 0;
            }
        };

        const ghostLoop = () => {
            if (!dragging || !ghost) {
                rafId = 0;
                return;
            }
            tick();
            rafId = requestAnimationFrame(ghostLoop);
        };

        const readGhostSize = () => {
            const r = thumb.getBoundingClientRect();
            return { w: r.width, h: r.height };
        };

        let gw = 0;
        let gh = 0;

        const tick = () => {
            rafId = 0;
            if (!ghost) return;
            const boxRect = uploadBox.getBoundingClientRect();
            const dist = redoDistPointToRect(cursorX, cursorY, boxRect);
            const inZone = dist <= SNAP_PX;
            if (inZone) {
                uploadBox.classList.add('drop-target--active');
            } else {
                uploadBox.classList.remove('drop-target--active');
            }

            let targetX = cursorX - gw / 2;
            let targetY = cursorY - gh / 2;
            if (inZone && !reduceMotion) {
                const cx = boxRect.left + boxRect.width / 2 - gw / 2;
                const cy = boxRect.top + boxRect.height / 2 - gh / 2;
                const pull = MAGNET_STRENGTH * (1 - Math.min(dist, SNAP_PX) / SNAP_PX);
                targetX += (cx - targetX) * pull;
                targetY += (cy - targetY) * pull;
            }

            const lerp = reduceMotion ? 1 : GHOST_LERP;
            gx += (targetX - gx) * lerp;
            gy += (targetY - gy) * lerp;
            ghost.style.transform = `translate3d(${gx}px,${gy}px,0)`;
        };

        const startGhostLoop = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(ghostLoop);
        };

        const onMove = (ev) => {
            if (ev.pointerId !== pointerId) return;
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            cursorX = ev.clientX;
            cursorY = ev.clientY;

            if (!dragging) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
                dragging = true;
                thumb.classList.add('image-thumbnail--dragging');
                thumb.dataset.suppressNextClick = '1';
                document.body.style.cursor = 'grabbing';

                const br = readGhostSize();
                gw = br.w;
                gh = br.h;
                gx = startX - gw / 2;
                gy = startY - gh / 2;

                ghost = document.createElement('img');
                ghost.className = 'redo-drag-ghost';
                ghost.src = img.src;
                ghost.alt = '';
                ghost.draggable = false;
                ghost.style.width = `${gw}px`;
                ghost.style.height = `${gh}px`;
                document.body.appendChild(ghost);
                ghost.style.transform = `translate3d(${gx}px,${gy}px,0)`;

                try {
                    thumb.setPointerCapture(pointerId);
                } catch {
                    /* ignore */
                }
                startGhostLoop();
            }
        };

        const onUp = async (ev) => {
            if (ev.pointerId !== pointerId) return;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);

            if (!dragging) return;

            stopRaf();
            dragging = false;
            document.body.style.cursor = '';
            thumb.classList.remove('image-thumbnail--dragging');
            uploadBox.classList.remove('drop-target--active');

            const boxRect = uploadBox.getBoundingClientRect();
            const dist = redoDistPointToRect(cursorX, cursorY, boxRect);
            const inZone = dist <= SNAP_PX;

            const ghostEl = ghost;
            const endX = gx;
            const endY = gy;
            ghost = null;

            try {
                thumb.releasePointerCapture(pointerId);
            } catch {
                /* ignore */
            }

            if (inZone && ghostEl) {
                const targetX = boxRect.left + boxRect.width / 2 - gw / 2;
                const targetY = boxRect.top + boxRect.height / 2 - gh / 2;
                await springGhost(ghostEl, endX, endY, targetX, targetY);
                if (ghostEl.parentNode) ghostEl.parentNode.removeChild(ghostEl);
                scene.selectCatalogThumbnail(thumb);
            } else if (ghostEl) {
                const tr = thumb.getBoundingClientRect();
                const homeX = tr.left + tr.width / 2 - gw / 2;
                const homeY = tr.top + tr.height / 2 - gh / 2;
                await springGhost(ghostEl, endX, endY, homeX, homeY);
                if (ghostEl.parentNode) ghostEl.parentNode.removeChild(ghostEl);
            }
        };

        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    });
}

class Scene3D {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.raycaster = null;
        this.models = [];
        this.isLoading = true;
        this.originalPositions = [];
        this.modelPivots = [];

        // Motion and interaction state
        this.clock = new THREE.Clock();
        this.pointer = new THREE.Vector2(0, 0); // normalized device coords
        this.parallaxStrength = 0.15; // Subtle parallax like BAM Works
        this.pointerActive = false;
        this.hoveredModel = null;
        this.intersectTargets = [];
        this.selectedModel = null; // Click-to-select “chosen design” (visual only; camera unchanged)
        this._heroRotateDrag = false;
        this._heroLastDragXY = { x: 0, y: 0 };
        this._heroSkipClickFromDrag = false;
        this.maxFlowStepReached = 1; // Unlocks bottom nav Step 4 after user has reached it once

        // Slider smoothing state
        this.currentSliderValue = 1; // smoothed value
        this.targetSliderValue = 1; // target value from input
        this.sliderAnimating = false;
        this.imageSelected = false; // track if image is selected (required for steps 2+)
        this.currentStep = 1; // current active step (1-4)
        this.selectedDesignOption = null; // track which design option was selected in Step 2 (1, 2, or 3)
        this._forwardDraggerLogKey = '';
        /** Step nav handles: click-only (one-time bind) */
        this._stepNavHandlesBound = false;
        /** Step 3 forward dragger stays idle (white/grey) until generation finishes — mirrors Step 2 + design-selected */
        this._step3OutputsReady = false;
        this._step3GenRunId = 0;
        this._step3GenCompleteTimer = null;
        this._step3SeqTimer = null;
        this._crossfade23Timer = null;
        this._step2AnalysisRunId = 0;
        this._step2SeqTimer = null;
        this._step2MaterialImageSrc = '';
        this._step2ImageRevealRunId = 0;
        this._step2ImageRevealTimer = null;

        // Boundary positions for canvas transitions (in vw)
        // Each boundary represents the position between two steps
        // Minimum step width: 25vw to ensure each step is always visible
        // Initial state: All 4 steps visible with equal 25vw width
        this.boundaries = {
            '1-2': 25,  // Step 1: 25vw
            '2-3': 50,  // Step 2: 25vw
            '3-4': 75   // Step 3: 25vw, Step 4: 25vw
        };
        
        this.modelFiles = R2_MODEL_URLS;

        /** Homepage intro handoff: GLBs preload while copy runs; one dismiss when both are ready */
        this._introRemoved = false;
        this._modelsReadyForHandoff = false;
        this._mainRevealDone = false;
        this._introExitStarted = false;
        this._introExitCompleted = false;
        this._introPhaseAdvanceTimer = null;
        this._introPhaseTransitionTimer = null;
        this._introPhase2AutoExitTimer = null;
        this._boundSkipIntro = null;
        this._step2InteractionsBound = false;
        this._step3InteractionsBound = false;
        this._step4Viewer = null;
        this._step4PanelBound = false;
        this._step4LastText = '';
        this._step4LastFilename = 'redo-instructions.txt';

        this.init();
        if (this.renderer && this.camera && this.controls) {
            this.setupEventListeners();
        }
    }
    
    init() {
        try {
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0xf5f5f5);

            this.camera = new THREE.PerspectiveCamera(
                VIEW_CAMERA_FOV,
                window.innerWidth / window.innerHeight,
                0.1,
                1000
            );
            this.camera.position.copy(VIEW_CAMERA_POSITION);
            this.camera.lookAt(VIEW_CAMERA_LOOK_AT);

            this.renderer = new THREE.WebGLRenderer({ antialias: true });
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.renderer.setPixelRatio(window.devicePixelRatio);
            /* Correct albedo / texture display vs default linear output (r128) */
            if (THREE.sRGBEncoding !== undefined) {
                this.renderer.outputEncoding = THREE.sRGBEncoding;
            }
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            this.renderer.domElement.style.display = 'block';
            this.renderer.domElement.style.width = '100%';
            this.renderer.domElement.style.height = '100%';
            /* Orbit zoom uses wheel; Lenis smooths page scroll — don’t double-handle on canvas */
            this.renderer.domElement.setAttribute('data-lenis-prevent-wheel', '');

            document.getElementById('container').appendChild(this.renderer.domElement);

            this._lenis = null;
            if (typeof Lenis !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                try {
                    this._lenis = new Lenis({
                        smoothWheel: true,
                        syncTouch: false,
                        lerp: 0.12
                    });
                } catch (lenisErr) {
                    console.warn('Lenis init failed:', lenisErr);
                }
            }

            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            /* Static hero camera — chairs rotate via rAF; user cannot orbit / zoom / pan */
            this.controls.enableRotate = false;
            this.controls.enableZoom = false;
            this.controls.enablePan = false;
            this.controls.enableDamping = false;
            this.controls.autoRotate = false;
            this.controls.target.copy(VIEW_CAMERA_LOOK_AT);
            this.controls.update();

            this.raycaster = new THREE.Raycaster();

            this.setupLighting();

            this._loadOverlayDismissed = false;
            this.startHomeIntro();
            this.loadModels().catch((err) => {
                console.error('loadModels rejected:', err);
                this._modelsReadyForHandoff = true;
                this._tryRevealAfterIntro();
            });

            this.animate();
        } catch (err) {
            console.error('Scene3D init failed:', err);
            this.isLoading = false;
            document.getElementById('home-intro')?.classList.add('home-intro--gone', 'home-intro--exiting');
            this._introRemoved = true;
            document.getElementById('loading-screen')?.classList.add('hidden');
            document.body.classList.add('redo-chrome-visible');
            const notice = document.getElementById('model-load-notice');
            if (notice) {
                notice.textContent =
                    (err && err.message) ||
                    '3D view failed to start (WebGL or setup error). See console.';
                notice.classList.remove('hidden');
            }
        }
    }

    _clearIntroSequenceTimers() {
        if (this._introPhaseAdvanceTimer) {
            clearTimeout(this._introPhaseAdvanceTimer);
            this._introPhaseAdvanceTimer = null;
        }
        if (this._introPhaseTransitionTimer) {
            clearTimeout(this._introPhaseTransitionTimer);
            this._introPhaseTransitionTimer = null;
        }
        if (this._introPhase2AutoExitTimer) {
            clearTimeout(this._introPhase2AutoExitTimer);
            this._introPhase2AutoExitTimer = null;
        }
    }

    startHomeIntro() {
        const root = document.getElementById('home-intro');
        if (!root) {
            this._introRemoved = true;
            this._tryRevealAfterIntro();
            return;
        }
        this._clearIntroSequenceTimers();
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) {
            root.classList.add('home-intro--reduce-motion');
        }
        this._boundSkipIntro = () => {
            this.skipHomeIntro();
        };
        root.addEventListener('click', this._boundSkipIntro);
        root.addEventListener('wheel', this._boundSkipIntro, { passive: true });

        const phase1TotalMs = reduce ? 1000 : 4800;
        this._introPhaseAdvanceTimer = setTimeout(() => this._goIntroPhase2(), phase1TotalMs);
    }

    _goIntroPhase2() {
        if (this._introExitStarted || this._introRemoved) return;
        this._introPhaseAdvanceTimer = null;

        const p1 = document.getElementById('home-intro-phase1');
        const p2 = document.getElementById('home-intro-phase2');
        if (!p1 || !p2) {
            this._beginIntroExit(false);
            return;
        }

        const reduce = document.getElementById('home-intro')?.classList.contains('home-intro--reduce-motion');
        const exitMs = reduce ? 120 : 520;

        p1.classList.add('home-intro__phase--exiting');
        this._introPhaseTransitionTimer = setTimeout(() => {
            this._introPhaseTransitionTimer = null;
            if (this._introExitStarted || this._introRemoved) return;

            p1.classList.add('home-intro__phase--off');
            p1.setAttribute('aria-hidden', 'true');

            p2.classList.remove('home-intro__phase--hidden');
            p2.setAttribute('aria-hidden', 'false');
            requestAnimationFrame(() => {
                p2.classList.add('home-intro__phase--visible');
            });

            const phase2HoldMs = reduce ? 1400 : 2600;
            this._introPhase2AutoExitTimer = setTimeout(() => this._beginIntroExit(false), phase2HoldMs);
        }, exitMs);
    }

    skipHomeIntro() {
        if (this._introExitStarted) return;
        if (this._introScrambleRunning) return;

        const root = document.getElementById('home-intro');
        const reduce = root?.classList.contains('home-intro--reduce-motion');
        if (reduce || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this._beginIntroExit(true);
            return;
        }

        const p2 = document.getElementById('home-intro-phase2');
        const p2visible =
            p2 &&
            !p2.classList.contains('home-intro__phase--hidden') &&
            p2.classList.contains('home-intro__phase--visible');

        const el = p2visible
            ? document.getElementById('home-intro-tagline')
            : document.getElementById('home-intro-line-4');

        const finalText = el && el.textContent ? el.textContent : '';
        if (!finalText.trim()) {
            this._beginIntroExit(true);
            return;
        }

        const pool = '01█▒░╱╲·°∴┤├▖▗';
        const scrambleChar = (ch) => {
            if (!/\S/.test(ch)) return ch;
            if (/[→•…]/.test(ch)) return ch;
            return pool[Math.floor(Math.random() * pool.length)];
        };

        this._introScrambleRunning = true;
        const start = performance.now();
        const duration = 300;

        const tick = (now) => {
            if (this._introExitStarted) {
                el.textContent = finalText;
                this._introScrambleRunning = false;
                return;
            }
            if (now - start >= duration) {
                el.textContent = finalText;
                this._introScrambleRunning = false;
                this._beginIntroExit(true);
                return;
            }
            el.textContent = [...finalText].map(scrambleChar).join('');
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    _beginIntroExit(isSkip) {
        if (this._introExitStarted) return;
        this._introExitStarted = true;
        this._introScrambleRunning = false;
        this._clearIntroSequenceTimers();

        // Do not open the step slider here: the full-viewport GLB scene (load + chair choice)
        // must show first; user opens the flow via bottom nav (step 1) when ready.

        const root = document.getElementById('home-intro');
        root?.classList.add('home-intro--exiting');
        const ms = isSkip ? 240 : 580;
        setTimeout(() => this._finalizeIntroLayer(), ms);
    }

    _finalizeIntroLayer() {
        if (this._introExitCompleted) return;
        this._introExitCompleted = true;
        const root = document.getElementById('home-intro');
        if (root && this._boundSkipIntro) {
            root.removeEventListener('click', this._boundSkipIntro);
            root.removeEventListener('wheel', this._boundSkipIntro);
            this._boundSkipIntro = null;
        }
        root?.classList.add('home-intro--gone');
        root?.setAttribute('aria-hidden', 'true');
        document.getElementById('step-slider')?.classList.remove('step-slider--raise-above-intro');
        this._introRemoved = true;
        if (!this._modelsReadyForHandoff) {
            document.getElementById('loading-screen')?.classList.remove('hidden');
        }
        this._tryRevealAfterIntro();
    }

    _tryRevealAfterIntro() {
        if (this._mainRevealDone) return;
        if (!this._introRemoved || !this._modelsReadyForHandoff) return;
        this._mainRevealDone = true;
        this.dismissLoadingOverlay(this.models.length);
    }
    
    setupLighting() {
        /* Cooler, lower ambient + keyed sun so albedo textures read richer / darker than prior flat fill */
        const ambientLight = new THREE.AmbientLight(0xc9ccd4, 0.38);
        this.scene.add(ambientLight);

        const fillLight = new THREE.DirectionalLight(0xe8eaef, 0.22);
        fillLight.position.set(-6, 6, -4);
        this.scene.add(fillLight);

        const directionalLight = new THREE.DirectionalLight(0xfff6ed, 0.58);
        directionalLight.position.set(8, 11, 5);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);
    }
    
    dismissLoadingOverlay(loadedCount) {
        if (this._loadOverlayDismissed) return;
        this._loadOverlayDismissed = true;

        const overlay = document.getElementById('loading-screen');
        const notice = document.getElementById('model-load-notice');
        if (notice) {
            if (loadedCount === 0) {
                notice.textContent =
                    '3D models failed to load from R2. Enable CORS on the bucket (GET/HEAD) and allow your page origin (e.g. http://localhost:8080).';
                notice.classList.remove('hidden');
            } else {
                notice.classList.add('hidden');
            }
        }
        const delayMs = loadedCount === 0 ? 100 : 600;
        setTimeout(() => {
            if (overlay) overlay.classList.add('hidden');
            this.isLoading = false;
            document.body.classList.add('redo-chrome-visible');
        }, delayMs);
    }

    disposeObjectSubtree(root) {
        root.traverse((obj) => {
            if (!obj.isMesh) return;
            obj.geometry?.dispose?.();
            const mats = obj.material;
            if (Array.isArray(mats)) mats.forEach((m) => m.dispose?.());
            else mats?.dispose?.();
        });
    }

    clearLoadedModels() {
        if (!this.scene) return;
        this.modelPivots.forEach((pivot) => {
            this.scene.remove(pivot);
            this.disposeObjectSubtree(pivot);
        });
        this.modelPivots = [];
        this.models = [];
        this.intersectTargets = [];
        this.originalPositions = [];
    }

    /** World-space AABB width along X after pivot + model transforms (for row spacing). */
    getPivotWorldWidthX(pivot) {
        pivot.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(pivot);
        if (box.isEmpty()) return 0;
        return Math.max(0, box.max.x - box.min.x);
    }

    /** World AABB of pivot projected to camera NDC (x,y in ~[-1,1]) for silhouette overlap tests. */
    getPivotNDCBounds(pivot, camera) {
        pivot.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(pivot);
        if (box.isEmpty()) return null;
        const mx = box.min.x;
        const my = box.min.y;
        const mz = box.min.z;
        const Mx = box.max.x;
        const My = box.max.y;
        const Mz = box.max.z;
        const corners = [
            [mx, my, mz],
            [Mx, my, mz],
            [mx, My, mz],
            [Mx, My, mz],
            [mx, my, Mz],
            [Mx, my, Mz],
            [mx, My, Mz],
            [Mx, My, Mz]
        ];
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        const v = new THREE.Vector3();
        for (let c = 0; c < 8; c++) {
            const t = corners[c];
            v.set(t[0], t[1], t[2]).project(camera);
            minX = Math.min(minX, v.x);
            maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y);
            maxY = Math.max(maxY, v.y);
        }
        if (!isFinite(minX)) return null;
        return { minX, maxX, minY, maxY };
    }

    ndcBoundsOverlap2D(a, b, inset) {
        if (!a || !b) return false;
        const ax0 = a.minX + inset;
        const ax1 = a.maxX - inset;
        const ay0 = a.minY + inset;
        const ay1 = a.maxY - inset;
        const bx0 = b.minX + inset;
        const bx1 = b.maxX - inset;
        const by0 = b.minY + inset;
        const by1 = b.maxY - inset;
        if (ax0 > ax1 || ay0 > ay1 || bx0 > bx1 || by0 > by1) return false;
        return !(ax1 < bx0 || ax0 > bx1 || ay1 < by0 || ay0 > by1);
    }

    /** Horizontal span for camera pullback after layout / screen-separation moves (pivot x ± half bbox width). */
    getHeroPivotsHorizontalSpan(pivots, widths) {
        const n = pivots.length;
        if (n === 0) return 0;
        let minE = Infinity;
        let maxE = -Infinity;
        for (let i = 0; i < n; i++) {
            const hw = ((widths[i] != null ? widths[i] : 1) * 0.5);
            const x = pivots[i].position.x;
            minE = Math.min(minE, x - hw);
            maxE = Math.max(maxE, x + hw);
        }
        return Math.max(0, maxE - minE);
    }

    /**
     * Equalize apparent scale along the arc: chairs farther from the camera get a larger world scale so
     * screen size matches the center reference (each model is already normalized to the same bbox max axis).
     */
    applyHeroPerspectiveUniformScale(pivots) {
        if (!HERO_PERSPECTIVE_UNIFORM_SCALE || !this.camera || pivots.length < 2) return;
        const cam = this.camera.position;
        const v = new THREE.Vector3();
        const centerIdx = Math.floor((pivots.length - 1) / 2);
        pivots[centerIdx].updateMatrixWorld(true);
        const refPos = new THREE.Vector3();
        pivots[centerIdx].getWorldPosition(refPos);
        const refDist = cam.distanceTo(refPos);
        if (refDist < 1e-6) return;

        const n = pivots.length;
        pivots.forEach((pivot, i) => {
            const model = pivot.children[0];
            if (!model || !model.userData.heroRestScale) return;
            const base = model.userData.heroUniformBaseScale || model.userData.heroRestScale;
            pivot.updateMatrixWorld(true);
            pivot.getWorldPosition(v);
            let factor = cam.distanceTo(v) / refDist;
            factor = Math.min(HERO_PERSPECTIVE_SCALE_MAX, Math.max(HERO_PERSPECTIVE_SCALE_MIN, factor));
            /* Farthest arc end (#5) still reads large vs #1 — pull scale toward center reference */
            if (n >= 2 && i === n - 1) {
                factor *= 0.88;
            }
            model.scale.copy(base).multiplyScalar(factor);
            model.userData.heroRestScale.copy(model.scale);
        });
    }

    /**
     * If adjacent chairs’ projected AABBs overlap in NDC, nudge them apart on X and Z; re-center X each pass.
     * Stronger Z nudge when the eastern chair sits on the +X side (typical right-of-screen overlap).
     */
    resolveHeroScreenOverlap(pivots, camera) {
        const n = pivots.length;
        if (n < 2 || !camera) return;
        camera.updateProjectionMatrix();
        const inset = HERO_SCREEN_OVERLAP_INSET_NDC;

        for (let iter = 0; iter < HERO_SCREEN_SEP_MAX_ITERS; iter++) {
            const bounds = pivots.map((p) => this.getPivotNDCBounds(p, camera));
            let overlapped = false;
            for (let i = 0; i < n - 1; i++) {
                if (this.ndcBoundsOverlap2D(bounds[i], bounds[i + 1], inset)) {
                    overlapped = true;
                    const left = pivots[i];
                    const right = pivots[i + 1];
                    left.position.x -= HERO_SCREEN_SEP_STEP_X;
                    right.position.x += HERO_SCREEN_SEP_STEP_X;
                    const zExtra =
                        right.position.x > 0.08
                            ? HERO_SCREEN_SEP_STEP_Z * 1.12
                            : HERO_SCREEN_SEP_STEP_Z * 0.88;
                    right.position.z += zExtra;
                    left.position.z -= zExtra * 0.42;
                }
            }
            const cx = pivots.reduce((s, p) => s + p.position.x, 0) / n;
            pivots.forEach((p) => {
                p.position.x -= cx;
            });
            if (!overlapped) break;
        }

        pivots.forEach((p) => {
            p.userData.baseX = p.position.x;
            p.userData.baseZ = p.position.z;
        });
    }

    /**
     * Align all hero pivots so their world AABB bottoms share the same Y (fixes one chair “floating” higher).
     */
    alignHeroPivotsToSharedGround(pivots) {
        if (!pivots.length) return;
        const box = new THREE.Box3();
        const mins = [];
        pivots.forEach((pivot) => {
            pivot.updateMatrixWorld(true);
            box.setFromObject(pivot);
            mins.push(box.min.y);
        });
        const targetGround = Math.min(...mins);
        pivots.forEach((pivot) => {
            pivot.updateMatrixWorld(true);
            box.setFromObject(pivot);
            const dy = targetGround - box.min.y;
            if (Math.abs(dy) < 1e-7) return;
            pivot.position.y += dy;
            const by = pivot.userData.baseY ?? HERO_ARRANGEMENT_Y_OFFSET;
            pivot.userData.baseY = by + dy;
        });
    }

    findIntersectRoot(object) {
        let o = object;
        while (o) {
            if (this.intersectTargets.includes(o)) return o;
            o = o.parent;
        }
        return null;
    }

    /**
     * Normalize scale (max axis → targetMaxDimension), then place mesh so the bbox bottom-center sits at the
     * pivot origin (0,0,0). Yaw/idle spin on the parent pivot then rotates around the vertical through that
     * footprint center — same ground line across chairs; alignHeroPivotsToSharedGround refines after layout.
     */
    normalizeCenterGroundModel(model) {
        model.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(model);
        if (box.isEmpty()) {
            console.warn('[Hero normalize] Empty bounds', model.userData.modelIndex);
            return;
        }
        const size = box.getSize(new THREE.Vector3());
        const largestDimension = Math.max(size.x, size.y, size.z);
        if (!isFinite(largestDimension) || largestDimension < 1e-6) return;

        console.log('[Hero normalize] bbox size (x,y,z):', size.x.toFixed(4), size.y.toFixed(4), size.z.toFixed(4));

        const scaleFactor = targetMaxDimension / largestDimension;
        console.log('[Hero normalize] scaleFactor:', scaleFactor.toFixed(6));
        model.scale.setScalar(scaleFactor);

        model.updateMatrixWorld(true);
        box.setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const minY = box.min.y;
        model.position.x -= center.x;
        model.position.z -= center.z;
        model.position.y -= minY;

        console.log(
            '[Hero normalize] final model.position:',
            model.position.x.toFixed(4),
            model.position.y.toFixed(4),
            model.position.z.toFixed(4)
        );
    }

    /**
     * Place pivots on a shallow arc in XZ, center C = (0,0,-R), point at θ=0 is world origin.
     * Equal angular steps; step size from max chord needed between neighbors (width + gap) × safety.
     * Each chair yaws to face outward from C, blended slightly toward the midline for readability.
     * After arc XZ, alternating ±HERO_DEPTH_STAGGER_Z on Z only (horizontal spacing / chord logic unchanged).
     * @returns {{ spanX: number }} horizontal extent for camera framing (approx 2R sin(halfSpan))
     */
    layoutModelArcFromWidths(pivots, widths) {
        const n = pivots.length;
        if (n === 0) return { spanX: 0 };

        if (n === 1) {
            const pivot = pivots[0];
            const y0 = HERO_ARRANGEMENT_Y_OFFSET;
            const spin0 = heroSpinStartRadForIndex(0);
            pivot.position.set(0, y0, 0);
            pivot.userData.baseX = 0;
            pivot.userData.baseY = y0;
            pivot.userData.baseZ = 0;
            pivot.userData.arcTheta = 0;
            pivot.userData.baseYaw = HERO_PIVOT_ROT_Y_BASE;
            pivot.userData.spinStartRad = spin0;
            pivot.userData.floatPhase = 0;
            pivot.rotation.set(HERO_PIVOT_ROT_X, HERO_PIVOT_ROT_Y_BASE + spin0, 0);
            return { spanX: Math.max(0, widths[0] || 0) };
        }

        let R = ARC_RADIUS;
        for (let i = 0; i < n - 1; i++) {
            const sep =
                (widths[i] * 0.5 + widths[i + 1] * 0.5 + MODEL_ROW_GAP) * ARC_SAFETY_MULT;
            R = Math.max(R, sep * 0.5001);
        }

        let deltaTheta = 0;
        for (let iter = 0; iter < 28; iter++) {
            deltaTheta = 0;
            for (let i = 0; i < n - 1; i++) {
                const sep =
                    (widths[i] * 0.5 + widths[i + 1] * 0.5 + MODEL_ROW_GAP) * ARC_SAFETY_MULT;
                const ratio = sep / (2 * R);
                const step = 2 * Math.asin(Math.min(1, ratio));
                deltaTheta = Math.max(deltaTheta, step);
            }
            const totalSpan = (n - 1) * deltaTheta;
            if (totalSpan <= 2 * ARC_MAX_HALF_SPAN_RAD + 1e-7) break;
            R *= 1.055;
        }

        const totalSpan = (n - 1) * deltaTheta;
        const cz = -R;

        const y0 = HERO_ARRANGEMENT_Y_OFFSET;
        const centerIndex = (n - 1) / 2;
        for (let k = 0; k < n; k++) {
            const theta = -totalSpan * 0.5 + k * deltaTheta;
            const px = R * Math.sin(theta);
            const pzArc = cz + R * Math.cos(theta);
            let zAlt = k % 2 === 0 ? -HERO_DEPTH_STAGGER_Z : HERO_DEPTH_STAGGER_Z;
            // Odd count: true middle chair must sit outward (+Z toward camera), not recessed by even/odd pattern.
            if (n % 2 === 1 && k === centerIndex) {
                zAlt = HERO_DEPTH_STAGGER_Z;
            }
            const zStagger = zAlt + (px > 0 ? HERO_DEPTH_RIGHT_EXTRA_Z : 0);
            const pz = pzArc + zStagger;
            const yaw = HERO_PIVOT_ROT_Y_BASE + theta * (1 - ARC_YAW_INWARD_BLEND);
            const spin0 = heroSpinStartRadForIndex(k);
            const pivot = pivots[k];
            pivot.position.set(px, y0, pz);
            pivot.userData.baseX = px;
            pivot.userData.baseY = y0;
            pivot.userData.baseZ = pz;
            pivot.userData.arcTheta = theta;
            pivot.userData.baseYaw = yaw;
            pivot.userData.spinStartRad = spin0;
            pivot.userData.floatPhase = k * 1.35;
            pivot.rotation.set(HERO_PIVOT_ROT_X, yaw + spin0, 0);
        }

        const spanX = 2 * R * Math.sin(totalSpan * 0.5);
        console.log('[Arc layout]', {
            n,
            R: R.toFixed(3),
            deltaTheta: deltaTheta.toFixed(4),
            totalSpanDeg: ((totalSpan * 180) / Math.PI).toFixed(1),
            spanX: spanX.toFixed(4)
        });
        return { spanX };
    }

    /** Sets FOV, X/Y position, and Z (with optional multi-model pullback). lookAt + orbit target stay at VIEW_CAMERA_LOOK_AT. */
    applyHeroViewCamera(horizontalSpan, modelCount) {
        if (!this.camera) return;
        const spacingFactor = horizontalSpan * 0.5;
        let z = VIEW_CAMERA_BASE_Z;
        if (modelCount > 1) {
            z += spacingFactor * VIEW_CAMERA_ROW_Z_SCALE;
        }
        this.camera.fov = VIEW_CAMERA_FOV;
        this.camera.position.set(VIEW_CAMERA_POSITION.x, VIEW_CAMERA_POSITION.y, z);
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(VIEW_CAMERA_LOOK_AT);
        if (this.controls) {
            this.controls.target.copy(VIEW_CAMERA_LOOK_AT);
            this.controls.update();
        }
    }

    async loadModels() {
        const notice = document.getElementById('model-load-notice');
        if (notice) notice.classList.add('hidden');

        try {
            this.clearLoadedModels();

            const loader = new THREE.GLTFLoader();
            if (typeof loader.setCrossOrigin === 'function') {
                loader.setCrossOrigin('anonymous');
            }
            console.log(`Loading ${this.modelFiles.length} GLBs for bbox-spaced arc (parallel fetch)`);

            const widths = [];
            const pivots = [];

            const outcomes = await Promise.allSettled(
                this.modelFiles.map((url) => this.loadModel(loader, url))
            );

            for (let i = 0; i < outcomes.length; i++) {
                const outcome = outcomes[i];
                if (outcome.status !== 'fulfilled') {
                    console.error(`[${i}] Error loading model:`, outcome.reason);
                    continue;
                }
                try {
                    const gltf = outcome.value;
                    this.models.push(gltf);

                    const model = gltf.scene;
                    model.userData.modelIndex = i;

                    const pivot = new THREE.Group();
                    pivot.position.set(0, 0, 0);
                    pivot.rotation.set(HERO_PIVOT_ROT_X, HERO_PIVOT_ROT_Y_BASE, 0);
                    pivot.add(model);
                    model.userData.pivot = pivot;
                    this.scene.add(pivot);
                    pivots.push(pivot);
                    this.modelPivots.push(pivot);

                    this.normalizeCenterGroundModel(model);

                    pivot.rotation.set(HERO_PIVOT_ROT_X, HERO_PIVOT_ROT_Y_BASE, 0);
                    const widthX = this.getPivotWorldWidthX(pivot);
                    widths.push(widthX);
                    console.log(`[Arc] model ${i} world X width (AABB):`, widthX.toFixed(4));

                    this.enableShadows(model);
                    this.finalizeHeroMaterialsForColor(model);
                    this.intersectTargets.push(model);

                    this.originalPositions.push({
                        x: model.position.x,
                        y: model.position.y,
                        z: model.position.z,
                        scale: model.scale.clone()
                    });

                    model.userData.heroRestScale = model.scale.clone();
                    model.userData.heroUniformBaseScale = model.scale.clone();

                    console.log(`[${i}] Loaded:`, this.modelFiles[i]);
                } catch (error) {
                    console.error(`[${i}] Error loading model:`, error);
                }
            }

            let layoutSpanX = 0;
            if (pivots.length > 0) {
                const { spanX } = this.layoutModelArcFromWidths(pivots, widths);
                layoutSpanX = spanX;
            }

            this.applyHeroViewCamera(layoutSpanX, pivots.length);

            if (pivots.length > 1) {
                this.resolveHeroScreenOverlap(pivots, this.camera);
                layoutSpanX = this.getHeroPivotsHorizontalSpan(pivots, widths);
                this.applyHeroViewCamera(layoutSpanX, pivots.length);
                this.applyHeroPerspectiveUniformScale(pivots);
                this.resolveHeroScreenOverlap(pivots, this.camera);
                layoutSpanX = this.getHeroPivotsHorizontalSpan(pivots, widths);
                this.applyHeroViewCamera(layoutSpanX, pivots.length);
                /* Extra pass: perspective scaling can widen silhouettes; settle overlaps again */
                this.resolveHeroScreenOverlap(pivots, this.camera);
                layoutSpanX = this.getHeroPivotsHorizontalSpan(pivots, widths);
                this.applyHeroViewCamera(layoutSpanX, pivots.length);
            }

            if (pivots.length >= 5) {
                const last = pivots[pivots.length - 1];
                last.position.z -= HERO_LAST_MODEL_Z_OFFSET;
                last.userData.baseZ = last.position.z;
                this.applyHeroPerspectiveUniformScale(pivots);
                this.resolveHeroScreenOverlap(pivots, this.camera);
                layoutSpanX = this.getHeroPivotsHorizontalSpan(pivots, widths);
                this.applyHeroViewCamera(layoutSpanX, pivots.length);
            }

            if (pivots.length > 0) {
                this.alignHeroPivotsToSharedGround(pivots);
            }

            console.log(`Scene models loaded: ${this.models.length}`);
        } catch (e) {
            console.error('loadModels fatal:', e);
        } finally {
            this._modelsReadyForHandoff = true;
            this._tryRevealAfterIntro();
        }
    }
    
    isTooClose(newPosition, minDistance) {
        if (!this.modelPositions) return false;
        
        return this.modelPositions.some(existing => 
            existing.distanceTo(newPosition) < minDistance
        );
    }
    
    loadModel(loader, url) {
        const TIMEOUT_MS = 120000;
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error(`Timed out after ${TIMEOUT_MS / 1000}s: ${url}`));
            }, TIMEOUT_MS);

            const finish = (fn, arg) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                fn(arg);
            };

            const loadUrl = GLB_USE_CACHE_BUST
                ? url.includes('?')
                    ? `${url}&v=${Date.now()}`
                    : `${url}?v=${Date.now()}`
                : url;
            loader.load(
                loadUrl,
                (gltf) => finish(resolve, gltf),
                (progress) => {
                    if (progress && progress.total) {
                        const pct = (progress.loaded / progress.total) * 100;
                        console.log(`Loading progress: ${pct.toFixed(2)}%`);
                    }
                },
                (error) => finish(reject, error)
            );
        });
    }
    
    enableShadows(model) {
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
    }

    finalizeHeroMaterialsForColor(model) {
        redoFinalizeGltfMaterialsForColor(model);
    }

    setModelToGrayscale(model) {
        model.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((mat) => {
                if (!mat.userData.originalColor && mat.color) {
                    mat.userData.originalColor = mat.color.clone();
                }
                if (!mat.userData.originalMap && mat.map) {
                    mat.userData.originalMap = mat.map;
                }

                if (mat.map) {
                    if (!mat.userData.grayMap) {
                        mat.userData.grayMap = this.createGrayscaleTexture(mat.map);
                    }
                    if (mat.userData.grayMap) {
                        mat.map = mat.userData.grayMap;
                    }
                } else if (mat.color) {
                    const hsl = { h: 0, s: 0, l: 0 };
                    mat.color.getHSL(hsl);
                    mat.color.setHSL(0, 0, hsl.l);
                }
                mat.needsUpdate = true;
            });
        });
    }

    restoreModelColor(model) {
        model.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((mat) => {
                if (mat.userData.originalMap) {
                    mat.map = mat.userData.originalMap;
                }
                if (mat.color && mat.userData.originalColor) {
                    mat.color.copy(mat.userData.originalColor);
                }
                mat.needsUpdate = true;
            });
        });
    }

    createGrayscaleTexture(map) {
        const image = map.image;
        if (!image) return null;

        const canvas = document.createElement('canvas');
        const width = image.width || image.videoWidth || image.naturalWidth;
        const height = image.height || image.videoHeight || image.naturalHeight;
        if (!width || !height) return null;

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        try {
            ctx.drawImage(image, 0, 0, width, height);
        } catch (err) {
            return null;
        }

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
        }
        ctx.putImageData(imageData, 0, 0);

        const grayTexture = new THREE.CanvasTexture(canvas);
        grayTexture.flipY = map.flipY;
        grayTexture.encoding = map.encoding;
        grayTexture.needsUpdate = true;
        return grayTexture;
    }

    syncHeroModelColors() {
        if (!this.intersectTargets.length) return;
        for (const model of this.intersectTargets) {
            this.restoreModelColor(model);
        }
    }

    getHeroScaleTarget(model) {
        if (!model?.userData?.heroRestScale) return null;
        const b = model.userData.heroRestScale;
        const sel = model === this.selectedModel;
        const hov = model === this.hoveredModel;
        let mult = 1;
        if (sel && hov) mult = SELECTED_HOVER_MODEL_SCALE_MULT;
        else if (sel) mult = SELECTED_MODEL_SCALE_MULT;
        else if (hov) mult = HOVER_SCALE_MULTIPLIER;
        return { x: b.x * mult, y: b.y * mult, z: b.z * mult };
    }

    stopHeroHoverScaleTween(model) {
        if (!model?.userData?.hoverScaleTween) return;
        const tw = model.userData.hoverScaleTween;
        if (typeof tw.stop === 'function') tw.stop();
        model.userData.hoverScaleTween = null;
    }

    /** Tween.js — only system that writes model.scale for hero chairs (rAF uses pivots only). */
    tweenHeroModelToTargetScale(model) {
        if (!model) return;
        if (!model.userData.heroRestScale) {
            model.userData.heroRestScale = model.scale.clone();
        }
        const target = this.getHeroScaleTarget(model);
        if (!target) return;
        this.stopHeroHoverScaleTween(model);
        if (typeof TWEEN === 'undefined' || !TWEEN.Tween) {
            model.scale.set(target.x, target.y, target.z);
            return;
        }
        const tw = new TWEEN.Tween(model.scale)
            .to(target, HOVER_SCALE_DURATION_MS)
            .easing(TWEEN.Easing.Cubic.InOut)
            .onComplete(() => {
                model.userData.hoverScaleTween = null;
            })
            .start();
        model.userData.hoverScaleTween = tw;
    }

    applyHeroEmissiveMode(model, mode) {
        const strength = mode === 'selected' ? 0.22 : mode === 'hover' ? 0.12 : 0;
        model.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((mat) => {
                if (!mat.emissive) return;
                if (!mat.userData._heroEmissiveBase) {
                    mat.userData._heroEmissiveBase = mat.emissive.clone();
                }
                if (strength <= 0) {
                    mat.emissive.copy(mat.userData._heroEmissiveBase);
                } else {
                    mat.emissive.copy(mat.userData._heroEmissiveBase).lerp(new THREE.Color(0xffffff), strength * 0.55);
                }
                mat.needsUpdate = true;
            });
        });
    }

    syncHeroEmissiveForAll() {
        this.intersectTargets.forEach((model) => {
            const mode =
                model === this.selectedModel ? 'selected' : model === this.hoveredModel ? 'hover' : 'none';
            if (model.userData._glowMode === mode) return;
            model.userData._glowMode = mode;
            this.applyHeroEmissiveMode(model, mode);
        });
    }

    syncHeroCanvasCursor(overHero) {
        if (!this.renderer?.domElement) return;
        /* Global square cursor — keep OS cursor hidden on canvas */
        this.renderer.domElement.style.cursor = 'none';
    }

    updateHoverFromPointer() {
        if (!this.pointerActive || this.intersectTargets.length === 0) {
            if (this.hoveredModel) {
                const prev = this.hoveredModel;
                this.hoveredModel = null;
                this.syncHeroModelColors();
                this.tweenHeroModelToTargetScale(prev);
                if (this.selectedModel && this.selectedModel !== prev) {
                    this.tweenHeroModelToTargetScale(this.selectedModel);
                }
            } else {
                this.syncHeroModelColors();
            }
            this.syncHeroEmissiveForAll();
            this.syncHeroCanvasCursor(false);
            return;
        }

        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersects = this.raycaster.intersectObjects(this.intersectTargets, true);

        let nextHovered = null;
        if (intersects.length > 0) {
            nextHovered = this.findIntersectRoot(intersects[0].object);
        }

        if (nextHovered !== this.hoveredModel) {
            const prev = this.hoveredModel;
            this.hoveredModel = nextHovered;
            if (prev) this.tweenHeroModelToTargetScale(prev);
            if (nextHovered) this.tweenHeroModelToTargetScale(nextHovered);
            if (this.selectedModel && this.selectedModel !== prev && this.selectedModel !== nextHovered) {
                this.tweenHeroModelToTargetScale(this.selectedModel);
            }
        }

        this.syncHeroModelColors();
        this.syncHeroEmissiveForAll();
        this.syncHeroCanvasCursor(!!nextHovered);
    }

    applyHeroSelection(model) {
        if (!model) return;
        if (this.selectedModel === model) {
            this.clearHeroSelection();
            return;
        }
        const prev = this.selectedModel;
        this.selectedModel = model;
        if (prev) {
            delete prev.userData._glowMode;
            this.tweenHeroModelToTargetScale(prev);
            const pPrev = prev.userData.pivot;
            if (pPrev) {
                pPrev.userData.heroDragYaw = 0;
                pPrev.userData.heroDragPitch = 0;
            }
        }
        delete model.userData._glowMode;
        this.tweenHeroModelToTargetScale(model);
        const pNew = model.userData.pivot;
        if (pNew) {
            pNew.userData.heroDragYaw = 0;
            pNew.userData.heroDragPitch = 0;
        }
        this.syncHeroModelColors();
        this.syncHeroEmissiveForAll();
    }

    clearHeroSelection() {
        if (!this.selectedModel) return;
        const prev = this.selectedModel;
        this.selectedModel = null;
        delete prev.userData._glowMode;
        this.intersectTargets.forEach((m) => delete m.userData._glowMode);
        const pPrev = prev.userData.pivot;
        if (pPrev) {
            pPrev.userData.heroDragYaw = 0;
            pPrev.userData.heroDragPitch = 0;
        }
        this.tweenHeroModelToTargetScale(prev);
        this.syncHeroModelColors();
        this.syncHeroEmissiveForAll();
    }

    /** rAF: pivot rotation + float only — no model.scale (avoids fighting Tween.js). */
    updateHeroAmbientMotion(elapsed) {
        const heroSpinPhaseRad = elapsed * HERO_SPIN_RAD_PER_SEC;
        this.modelPivots.forEach((pivot) => {
            const model = pivot.children[0];
            const isSel = model && this.selectedModel === model;
            const baseYaw = pivot.userData.baseYaw ?? HERO_PIVOT_ROT_Y_BASE;
            const spin0 = pivot.userData.spinStartRad ?? 0;
            const baseY = pivot.userData.baseY ?? HERO_ARRANGEMENT_Y_OFFSET;
            const phase = pivot.userData.floatPhase ?? 0;
            const yBob = HERO_FLOAT_AMP * Math.sin(elapsed * HERO_FLOAT_FREQ_RAD_S + phase);
            const spinPhase = isSel ? 0 : heroSpinPhaseRad;
            const dragYaw = isSel ? pivot.userData.heroDragYaw || 0 : 0;
            const dragPitch = isSel ? pivot.userData.heroDragPitch || 0 : 0;
            pivot.rotation.x = HERO_PIVOT_ROT_X + dragPitch;
            pivot.rotation.y = baseYaw + spin0 + spinPhase + dragYaw;
            pivot.rotation.z = 0;
            pivot.position.set(pivot.userData.baseX ?? 0, baseY + yBob, pivot.userData.baseZ ?? 0);
        });
    }

    separateModels(maxIterations = 40) {
        // Compute simple bounding sphere radii for each model
        const entries = this.models.map((modelData) => {
            const model = modelData.scene;
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const radius = Math.max(size.x, size.y, size.z) * 0.5; // after scaling, roughly ~5
            return { model, radius: radius * 1.05 }; // small buffer
        });
        
        for (let iter = 0; iter < maxIterations; iter++) {
            let anyMoved = false;
            for (let i = 0; i < entries.length; i++) {
                for (let j = i + 1; j < entries.length; j++) {
                    const a = entries[i];
                    const b = entries[j];
                    const delta = new THREE.Vector3().subVectors(b.model.position, a.model.position);
                    let dist = delta.length();
                    const minDist = a.radius + b.radius;
                    if (dist < 1e-4) {
                        // Coincident; random nudge
                        delta.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
                        dist = 1e-4;
                    }
                    if (dist < minDist) {
                        const overlap = (minDist - dist) * 0.55; // move a bit more than half to speed convergence
                        delta.normalize();
                        a.model.position.addScaledVector(delta, -overlap * 0.5);
                        b.model.position.addScaledVector(delta, overlap * 0.5);
                        anyMoved = true;
                    }
                }
            }
            if (!anyMoved) break;
        }
    }
    
    setupEventListeners() {
        const onCanvasMouseMove = (event) => {
            const rect = this.renderer.domElement.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            this.pointer.x = x;
            this.pointer.y = y;
            this.pointerActive = true;

            if (this._heroRotateDrag && this.selectedModel) {
                const dx = event.clientX - this._heroLastDragXY.x;
                const dy = event.clientY - this._heroLastDragXY.y;
                this._heroLastDragXY.x = event.clientX;
                this._heroLastDragXY.y = event.clientY;
                const pivot = this.selectedModel.userData.pivot;
                if (pivot) {
                    const sens = 0.0065;
                    pivot.userData.heroDragYaw = (pivot.userData.heroDragYaw || 0) - dx * sens;
                    pivot.userData.heroDragPitch = (pivot.userData.heroDragPitch || 0) - dy * sens;
                    pivot.userData.heroDragPitch = Math.max(-0.95, Math.min(0.95, pivot.userData.heroDragPitch));
                    if (Math.abs(dx) + Math.abs(dy) > 2) this._heroSkipClickFromDrag = true;
                }
            }
        };

        this.renderer.domElement.addEventListener('mousemove', onCanvasMouseMove);

        this.renderer.domElement.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || this.isLoading || !this.selectedModel) return;
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            this.raycaster.setFromCamera(this.pointer, this.camera);
            const intersects = this.raycaster.intersectObjects(this.intersectTargets, true);
            if (intersects.length === 0) return;
            const root = this.findIntersectRoot(intersects[0].object);
            if (root !== this.selectedModel) return;
            this._heroRotateDrag = true;
            this._heroSkipClickFromDrag = false;
            this._heroLastDragXY = { x: e.clientX, y: e.clientY };
        });

        const endHeroDrag = () => {
            this._heroRotateDrag = false;
        };
        window.addEventListener('mouseup', endHeroDrag);

        this.renderer.domElement.addEventListener('mouseleave', () => {
            endHeroDrag();
            this.pointerActive = false;
            if (this.hoveredModel) {
                const prev = this.hoveredModel;
                this.hoveredModel = null;
                this.syncHeroModelColors();
                this.tweenHeroModelToTargetScale(prev);
                if (this.selectedModel && this.selectedModel !== prev) {
                    this.tweenHeroModelToTargetScale(this.selectedModel);
                }
            } else {
                this.syncHeroModelColors();
            }
            this.syncHeroEmissiveForAll();
            this.syncHeroCanvasCursor(false);
        });

        this.renderer.domElement.addEventListener('click', (event) => {
            if (this._heroSkipClickFromDrag) {
                this._heroSkipClickFromDrag = false;
                return;
            }
            if (this.isLoading || !this.intersectTargets.length) return;
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            this.raycaster.setFromCamera(this.pointer, this.camera);
            const intersects = this.raycaster.intersectObjects(this.intersectTargets, true);
            if (intersects.length > 0) {
                const root = this.findIntersectRoot(intersects[0].object);
                if (root) this.applyHeroSelection(root);
            } else {
                this.clearHeroSelection();
            }
        });
        
        // Window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
        
        // Navigation dots click functionality
        this.setupNavDots();
    }
    
    setupNavDots() {
        const navSteps = document.querySelectorAll('.nav-step');

        navSteps.forEach((step) => {
            step.addEventListener('click', () => {
                const n = parseInt(step.dataset.flowStep, 10);
                if (Number.isNaN(n) || !this.canUnlockFlowStep(n)) return;
                this.openStepSliderToStep(n);
            });
        });

        this.setupStepSlider();
        this.setupStep2Interactions();
        this.setupStep3Interactions();
        this.setupStep4Panel();
        this.setupMaterialUpload();
        this.setupTopLogoHome();
        initRedoBlueprintReveal();
        initRedoStepContentReveal();
        initRedoCursorHint();
        initDragLabelMagnetic();
        this.setupStepNavHandles();
        this.syncNavStepsFromFlow();
        this.syncStep3OutputChosenClass();
    }

    canUnlockFlowStep(step) {
        if (step === 1) return true;
        if (step === 2) return this.imageSelected === true;
        if (step === 3) return this.imageSelected === true && this.selectedDesignOption != null;
        if (step === 4) {
            if (!this.imageSelected || this.selectedDesignOption == null) return false;
            if (!this._step3OutputsReady) return false;
            return !!document.querySelector('#step-3-options .step-3-option.selected');
        }
        return false;
    }

    syncFlowStateFromDom() {
        const uploadBox = document.querySelector('.upload-box');
        const uploadBoxImg = uploadBox ? uploadBox.querySelector('.selected-image') : null;
        const srcAttr = uploadBoxImg ? uploadBoxImg.getAttribute('src') : '';
        const hasUpload =
            uploadBox &&
            uploadBox.classList.contains('has-image') &&
            srcAttr &&
            srcAttr.trim().length > 0;

        const selectedThumbnail = document.querySelector('.image-thumbnail.selected');

        if (hasUpload && uploadBoxImg) {
            this.imageSelected = true;
            this.updateStep2Image(uploadBoxImg.src);
        } else if (selectedThumbnail) {
            const thumbnailImg = selectedThumbnail.querySelector('img');
            if (thumbnailImg && uploadBox && uploadBoxImg) {
                uploadBoxImg.src = thumbnailImg.src;
                uploadBox.classList.add('has-image');
                uploadBoxImg.style.display = 'block';
            }
            this.imageSelected = true;
            this.updateStep2Image(thumbnailImg ? thumbnailImg.src : '');
        } else {
            this.imageSelected = false;
        }

        const selOpt = document.querySelector('.step-2-option.selected');
        if (selOpt) {
            const options = document.querySelectorAll('.step-2-option');
            options.forEach((opt, i) => {
                if (opt === selOpt) this.selectedDesignOption = i + 1;
            });
            this.setStep2OptionsTabCollapsed(true);
        }
    }

    syncNavStepsFromFlow() {
        const sliderEl = document.getElementById('step-slider');
        const sliderOpen = sliderEl && !sliderEl.classList.contains('hidden');
        const navSteps = document.querySelectorAll('.nav-step');

        navSteps.forEach((el) => {
            const n = parseInt(el.dataset.flowStep, 10);
            el.classList.remove('active', 'nav-step--locked', 'nav-step--completed');

            const unlocked = this.canUnlockFlowStep(n);
            if (!unlocked) el.classList.add('nav-step--locked');

            let isActive = false;
            let isCompleted = false;
            if (sliderOpen) {
                isActive = unlocked && n === this.currentStep;
                isCompleted = unlocked && n < this.currentStep;
            } else {
                isActive = n === 1;
                isCompleted =
                    unlocked &&
                    ((n === 2 && this.imageSelected) ||
                        (n === 3 && this.selectedDesignOption != null) ||
                        (n === 4 && this.maxFlowStepReached >= 4));
            }

            if (isCompleted) el.classList.add('nav-step--completed');
            if (isActive) el.classList.add('active');
        });
    }

    openStepSliderToStep(step) {
        if (step < 1 || step > 4 || !this.canUnlockFlowStep(step)) return;

        const slider = document.getElementById('step-slider');
        const stepRange = document.getElementById('step-range');
        if (!slider) return;

        document.body.classList.remove('redo-homepage');

        slider.classList.remove('hidden');

        this.syncFlowStateFromDom();

        const prevStep = this.currentStep;
        this.currentStep = step;
        this.maxFlowStepReached = Math.max(this.maxFlowStepReached || 1, step);
        if (stepRange) stepRange.value = step;
        this.currentSliderValue = step;
        this.targetSliderValue = step;

        if (step !== 2) {
            this._abortStep2Analysis();
            this._abortStep2ImageReveal();
        }
        if (step !== 3) {
            this._abortStep3GenerationUi();
        }

        this.applyStepComposition();
        this.updateCanvasPositions();
        this.updateSliderVisibility();
        this.updateStep2Draggers();
        this.updateActiveSlideClasses();
        this.applySliderVisuals(step, true);

        if (step === 2 && prevStep === 1) {
            queueMicrotask(() => this._runStep2AnalysisSequence());
        }
        if (step === 2) {
            queueMicrotask(() => this._revealStep2MaterialImage(prevStep));
        }

        if (step === 3 && this.selectedDesignOption) {
            if (prevStep === 2) {
                queueMicrotask(() => this._startStep3EntryFlow(this.selectedDesignOption));
            } else {
                queueMicrotask(() => this._applyStep3ImagesAfterBuild(this.selectedDesignOption));
            }
        }

        queueMicrotask(() => {
            this.updateSliderColor();
            this.syncNavStepsFromFlow();
            this.syncStep3OutputChosenClass();
        });

        queueMicrotask(() => {
            document
                .querySelector('.step-slide.is-current-step .canvas-content')
                ?.classList.add('step-content--revealed');
        });

        if (prevStep === 2 && step === 3) {
            queueMicrotask(() => this._runStep2To3Crossfade());
        }

        if (step === 4) {
            queueMicrotask(() => this.refreshStep4Outputs());
        }

        if (step === 2 && prevStep !== 2) {
            queueMicrotask(() => this.syncStep2OptionsTabOpenStateForEntry());
        }
    }

    /** @deprecated Use openStepSliderToStep(1) — kept for clarity at call sites */
    showStepSlider() {
        this.openStepSliderToStep(1);
    }

    /**
     * Homepage = full-viewport 5-GLB scene + bottom nav; step panel stays hidden until user opens a step.
     */
    goToHomepage() {
        this.skipHomeIntro();
        this.currentStep = 1;
        const stepRange = document.getElementById('step-range');
        if (stepRange) stepRange.value = '1';
        this.currentSliderValue = 1;
        this.targetSliderValue = 1;
        document.body.dataset.activeFlowStep = '1';
        document.body.classList.add('redo-homepage');
        this.hideStepSlider();
        this.syncNavStepsFromFlow();
        this.updateActiveSlideClasses();
    }

    /** One click on the forward (right) handle → next step, with smooth panel transition. */
    tryAdvanceForwardClick() {
        const next = this.currentStep + 1;
        if (next > 4) return;
        if (!this.canUnlockFlowStep(next)) return;
        const slider = document.getElementById('step-slider');
        if (!slider || slider.classList.contains('hidden')) return;
        slider.classList.add('step-slider--flow-animate');
        this.openStepSliderToStep(next);
        window.setTimeout(() => {
            slider.classList.remove('step-slider--flow-animate');
        }, 1150);
    }

    /** One click on the back (left) handle → previous step, with smooth panel transition. */
    tryGoBackClick() {
        const prev = this.currentStep - 1;
        if (prev < 1) return;
        if (!this.canUnlockFlowStep(prev)) return;
        const slider = document.getElementById('step-slider');
        if (!slider || slider.classList.contains('hidden')) return;
        slider.classList.add('step-slider--flow-animate');
        this.openStepSliderToStep(prev);
        window.setTimeout(() => {
            slider.classList.remove('step-slider--flow-animate');
        }, 1150);
    }

    /**
     * Forward/back handles: click only (no boundary drag).
     * Bound once; uses capture so clicks on inner arrows/SVG still navigate.
     */
    setupStepNavHandles() {
        if (this._stepNavHandlesBound) return;
        this._stepNavHandlesBound = true;
        const stepSlider = document.getElementById('step-slider');
        if (!stepSlider) return;

        stepSlider.addEventListener(
            'click',
            (e) => {
                const handle = e.target.closest('.canvas-slider .progress-circle');
                if (!handle) return;
                const canvasSlider = handle.closest('.canvas-slider');
                const stepSlide = handle.closest('.step-slide');
                if (!canvasSlider || !stepSlide) return;

                const canvasStep = parseInt(stepSlide.dataset.step, 10);
                if (Number.isNaN(canvasStep) || canvasStep !== this.currentStep) return;

                const dir = canvasSlider.dataset.direction;
                if (dir === 'right') {
                    e.preventDefault();
                    this.tryAdvanceForwardClick();
                } else if (dir === 'left') {
                    e.preventDefault();
                    this.tryGoBackClick();
                }
            },
            true
        );
    }

    setupTopLogoHome() {
        const el = document.getElementById('top-logo') || document.querySelector('.top-logo');
        if (!el) return;
        el.addEventListener('click', (e) => {
            e.preventDefault();
            this.goToHomepage();
        });
    }

    setupMaterialUpload() {
        const fileInput = document.getElementById('material-upload-input');
        const uploadBox = document.querySelector('.upload-box');
        const thumbnails = document.querySelectorAll('.image-thumbnail');

        const applyFile = (file) => {
            if (!file || !file.type.startsWith('image/')) return;
            const url = URL.createObjectURL(file);
            const box = document.querySelector('.upload-box');
            const img = box ? box.querySelector('.selected-image') : null;
            if (box && img) {
                img.src = url;
                box.classList.add('has-image');
                img.style.display = 'block';
            }
            thumbnails.forEach((t) => t.classList.remove('selected'));
            this.imageSelected = true;
            this.skipHomeIntro();
            this.openStepSliderToStep(1);
            this.updateSliderColor();
            this.updateStep2Image(url);
            this.syncNavStepsFromFlow();
            queueMicrotask(() => this.updateDragHandleHint());
        };

        if (fileInput) {
            fileInput.addEventListener('change', () => {
                const f = fileInput.files && fileInput.files[0];
                applyFile(f);
                fileInput.value = '';
            });
        }

        if (uploadBox) {
            uploadBox.addEventListener('click', (e) => {
                e.preventDefault();
                fileInput?.click();
            });
        }
    }
    
    updateSliderColor() {
        // Update slider color based on image selection
        const stepSlider = document.getElementById('step-slider');
        if (stepSlider) {
            if (this.imageSelected) {
                stepSlider.classList.add('image-selected');
                console.log('Slider color: YELLOW (image selected)');
            } else {
                stepSlider.classList.remove('image-selected');
                console.log('Slider color: BLACK (no image selected)');
            }
        } else {
            console.warn('Step slider element not found');
        }
    }
    
    updateSliderVisibility() {
        // Get all canvas sliders
        const step1 = document.querySelector('.step-slide[data-step="1"]');
        const step2 = document.querySelector('.step-slide[data-step="2"]');
        const step3 = document.querySelector('.step-slide[data-step="3"]');
        const step4 = document.querySelector('.step-slide[data-step="4"]');
        
        const prevBadge = document.getElementById('prev-step-badge');
        const nextBadge = document.getElementById('next-step-badge');
        
        // Hide all sliders first
        const allSliders = document.querySelectorAll('.canvas-slider');
        allSliders.forEach(slider => {
            slider.style.display = 'none';
        });
        
        // Only show sliders for the current step to avoid duplicates at boundaries
        if (this.currentStep === 1 && step1) {
            const rightSlider = step1.querySelector('.slider-right');
            if (rightSlider) rightSlider.style.display = 'block';
        } else if (this.currentStep === 2 && step2) {
            const leftSlider = step2.querySelector('.slider-left');
            const rightSlider = step2.querySelector('.slider-right');
            if (leftSlider) leftSlider.style.display = 'block';
            if (rightSlider) rightSlider.style.display = 'block';
        } else if (this.currentStep === 3 && step3) {
            const leftSlider = step3.querySelector('.slider-left');
            const rightSlider = step3.querySelector('.slider-right');
            if (leftSlider) leftSlider.style.display = 'block';
            if (rightSlider) rightSlider.style.display = 'block';
        } else if (this.currentStep === 4 && step4) {
            const leftSlider = step4.querySelector('.slider-left');
            if (leftSlider) leftSlider.style.display = 'block';
        }
        
        // Update badges
        if (this.currentStep === 1) {
            if (prevBadge) prevBadge.classList.add('hidden');
            if (nextBadge) {
                nextBadge.textContent = '2';
                nextBadge.classList.remove('hidden');
            }
        } else if (this.currentStep === 2) {
            if (prevBadge) {
                prevBadge.textContent = '1';
                prevBadge.classList.remove('hidden');
            }
            if (nextBadge) {
                nextBadge.textContent = '3';
                nextBadge.classList.remove('hidden');
            }
        } else if (this.currentStep === 3) {
            if (prevBadge) {
                prevBadge.textContent = '2';
                prevBadge.classList.remove('hidden');
            }
            if (nextBadge) {
                nextBadge.textContent = '4';
                nextBadge.classList.remove('hidden');
            }
        } else if (this.currentStep === 4) {
            if (prevBadge) {
                prevBadge.textContent = '3';
                prevBadge.classList.remove('hidden');
            }
            if (nextBadge) nextBadge.classList.add('hidden');
        }
    }
    
    updateCanvasPositions() {
        // Update CSS variables for boundaries
        document.documentElement.style.setProperty('--boundary-1-2', `${this.boundaries['1-2']}vw`);
        document.documentElement.style.setProperty('--boundary-2-3', `${this.boundaries['2-3']}vw`);
        document.documentElement.style.setProperty('--boundary-3-4', `${this.boundaries['3-4']}vw`);
        
        // Update badge positions
        const nextBadge = document.getElementById('next-step-badge');
        const prevBadge = document.getElementById('prev-step-badge');
        
        if (nextBadge && this.currentStep < 4) {
            const boundaryKey = `${this.currentStep}-${this.currentStep + 1}`;
            nextBadge.style.left = `${this.boundaries[boundaryKey]}vw`;
        }
        
        if (prevBadge && this.currentStep > 1) {
            const boundaryKey = `${this.currentStep - 1}-${this.currentStep}`;
            prevBadge.style.right = `${100 - this.boundaries[boundaryKey]}vw`;
        }

    }
    
    hideStepSlider() {
        const slider = document.getElementById('step-slider');
        slider.classList.add('hidden');
        slider.classList.remove('step-slider--raise-above-intro');
        slider.classList.remove('step-slider--drag-hint-next');
        this.syncNavStepsFromFlow();
    }

    selectCatalogThumbnail(thumbnailEl) {
        const thumbnails = document.querySelectorAll('.image-thumbnail');
        const thumbnailImg = thumbnailEl.querySelector('img');
        const imageSrc = thumbnailImg && thumbnailImg.src;
        const imageName = thumbnailEl.dataset.image;
        if (!imageSrc) return;

        thumbnails.forEach((thumb) => {
            thumb.classList.remove('selected');
            const indicator = thumb.querySelector('.selection-indicator');
            if (indicator) indicator.remove();
        });
        thumbnailEl.classList.add('selected');

        const uploadBox = document.querySelector('.upload-box');
        const uploadBoxImg = uploadBox ? uploadBox.querySelector('.selected-image') : null;
        if (uploadBox && uploadBoxImg) {
            uploadBoxImg.src = imageSrc;
            uploadBox.classList.add('has-image');
            uploadBoxImg.style.display = 'block';
        }

        this.imageSelected = true;
        this.updateSliderColor();
        this.updateStep2Image(imageSrc);
        this.syncNavStepsFromFlow();
        queueMicrotask(() => this.updateDragHandleHint());

        if (imageName) console.log(`Selected image: ${imageName}`);
    }

    /** True if `el` is “empty” UI on step 1 (not upload, tiles, or dragger). */
    isStep1WhitespaceDeselectTarget(el) {
        if (!el || typeof el.closest !== 'function') return false;
        const slide = document.querySelector('.step-slide[data-step="1"]');
        if (!slide || !slide.classList.contains('is-current-step') || !slide.contains(el)) return false;
        if (el.closest('a, button, input, textarea, label, [role="button"]')) return false;
        if (el.closest('.upload-box')) return false;
        if (el.closest('.image-thumbnail')) return false;
        if (el.closest('.bottom-images')) return false;
        if (el.closest('.canvas-slider')) return false;
        return true;
    }

    clearCatalogImageSelection() {
        if (!this.imageSelected) return;

        document.querySelectorAll('.image-thumbnail').forEach((thumb) => {
            thumb.classList.remove('selected');
            const indicator = thumb.querySelector('.selection-indicator');
            if (indicator) indicator.remove();
        });

        const uploadBox = document.querySelector('.upload-box');
        const uploadBoxImg = uploadBox ? uploadBox.querySelector('.selected-image') : null;
        if (uploadBoxImg) {
            const prev = uploadBoxImg.getAttribute('src') || '';
            if (prev.startsWith('blob:')) {
                try {
                    URL.revokeObjectURL(prev);
                } catch {
                    /* ignore */
                }
            }
            uploadBoxImg.removeAttribute('src');
            uploadBoxImg.style.display = 'none';
        }
        if (uploadBox) uploadBox.classList.remove('has-image');

        this.imageSelected = false;
        this.updateSliderColor();
        this.updateStep2Image('');
        this.syncNavStepsFromFlow();
        queueMicrotask(() => this.updateDragHandleHint());
    }
    
    setupStepSlider() {
        const thumbnails = document.querySelectorAll('.image-thumbnail');
        const arrowButtons = document.querySelectorAll('.arrow-button');
        const stepRange = document.getElementById('step-range');

        const bottomImages = document.querySelector('.bottom-images');

        // Block the synthetic click after a drag-drop (capture, before bubble selection)
        thumbnails.forEach((thumbnail) => {
            thumbnail.addEventListener(
                'click',
                (e) => {
                    if (thumbnail.dataset.suppressNextClick === '1') {
                        delete thumbnail.dataset.suppressNextClick;
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        e.stopPropagation();
                    }
                },
                true
            );
        });

        // Single selection path (delegated so re-rendered thumbnails still work)
        if (bottomImages) {
            bottomImages.addEventListener('click', (e) => {
                const item = e.target && e.target.closest('.image-thumbnail');
                if (!item) return;
                const img = item.querySelector('img');
                if (!img) return;
                this.selectCatalogThumbnail(item);
            });
        }

        initThumbnailDragToSlot(this);

        const step1Slide = document.querySelector('.step-slide[data-step="1"]');
        if (step1Slide && step1Slide.dataset.redoWhitespaceClearBound !== '1') {
            step1Slide.dataset.redoWhitespaceClearBound = '1';
            step1Slide.addEventListener(
                'click',
                (e) => {
                    if (!this.imageSelected || this.currentStep !== 1) return;
                    if (!this.isStep1WhitespaceDeselectTarget(e.target)) return;
                    e.preventDefault();
                    this.clearCatalogImageSelection();
                },
                true
            );
        }

        // Handle arrow button clicks for navigation
        arrowButtons.forEach(button => {
            button.addEventListener('click', () => {
                this.slideToNextStep();
                // Update slider position
                stepRange.value = this.currentStep;
                this.updateContinuousSlider(this.currentStep, false);
            });
        });
        
        // Step nav handles: setupStepNavHandles() in setupNavDots (click-only)
        // Keep the old range input hidden for now
        stepRange.style.display = 'none';
        
        // Close slider with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideStepSlider();
            }
        });
    }
    
    updateActiveSlideClasses() {
        const slider = document.getElementById('step-slider');
        const stepStr = String(this.currentStep);
        if (slider) slider.dataset.activeFlowStep = stepStr;
        document.body.dataset.activeFlowStep = stepStr;

        const slides = document.querySelectorAll('.step-slide');
        slides.forEach((slide) => {
            const step = parseInt(slide.dataset.step);
            slide.classList.remove('step-slide--adjacent-prev', 'step-slide--adjacent-next');
            if (step === this.currentStep) {
                slide.classList.add('is-current-step');
            } else {
                slide.classList.remove('is-current-step');
                if (step < this.currentStep) {
                    slide.classList.add('step-slide--adjacent-prev');
                } else {
                    slide.classList.add('step-slide--adjacent-next');
                }
            }
        });

        const cur = document.querySelector('.step-slide.is-current-step .canvas-content');
        if (cur) cur.classList.add('step-content--revealed');
    }

    /** Bounce/glow on the “next” handle when the forward action is available. */
    updateDragHandleHint() {
        const slider = document.getElementById('step-slider');
        if (!slider) return;
        if (slider.classList.contains('hidden')) {
            slider.classList.remove('step-slider--drag-hint-next');
            return;
        }

        const step3Ready = slider.classList.contains('step-3-output-ready');
        const step3Chosen = slider.classList.contains('step-3-output-chosen');
        const wantsHint =
            (this.imageSelected && this.currentStep === 1) ||
            (this.selectedDesignOption != null && this.currentStep === 2) ||
            (this.imageSelected && this.currentStep === 3 && step3Ready && step3Chosen);

        if (wantsHint) {
            slider.classList.add('step-slider--drag-hint-next');
        } else {
            slider.classList.remove('step-slider--drag-hint-next');
        }

        const flowAttr = slider.dataset.activeFlowStep ?? '';
        const hasImageCls = slider.classList.contains('image-selected');
        const hasDesignCls = slider.classList.contains('design-selected');
        const hasHintCls = slider.classList.contains('step-slider--drag-hint-next');
        const forwardArmedVisual =
            (flowAttr === '1' && hasImageCls) ||
            (flowAttr === '2' && hasDesignCls) ||
            (flowAttr === '3' && hasImageCls && step3Ready && step3Chosen);
        const logKey = `${this.currentStep}|${flowAttr}|${hasImageCls}|${hasDesignCls}|${step3Ready}|${step3Chosen}|${hasHintCls}|${forwardArmedVisual}`;
        if (logKey !== this._forwardDraggerLogKey) {
            this._forwardDraggerLogKey = logKey;
            console.log(
                `Forward handle: step=${this.currentStep} data-active-flow-step=${flowAttr} image-selected=${hasImageCls} design-selected=${hasDesignCls} step-3-output-ready=${step3Ready} step-3-output-chosen=${step3Chosen} hint-next=${hasHintCls} forward-armed-visual=${forwardArmedVisual}`
            );
        }
    }

    applyStepComposition() {
        // Active step composition:
        // Step 1/4 (edge): 70% current + 30% adjacent
        // Step 2/3 (middle): 15% prev + 70% current + 15% next
        if (this.currentStep === 1) {
            this.boundaries['1-2'] = 70;
            this.boundaries['2-3'] = 100;
            this.boundaries['3-4'] = 100;
        } else if (this.currentStep === 2) {
            this.boundaries['1-2'] = 15;
            this.boundaries['2-3'] = 85;
            this.boundaries['3-4'] = 100;
        } else if (this.currentStep === 3) {
            this.boundaries['1-2'] = 0;
            this.boundaries['2-3'] = 15;
            this.boundaries['3-4'] = 85;
        } else if (this.currentStep === 4) {
            this.boundaries['1-2'] = 0;
            this.boundaries['2-3'] = 0;
            this.boundaries['3-4'] = 30;
        } else {
            return;
        }

        this.updateCanvasPositions();
    }

    /**
     * Cross-fade Step 2 ↔ Step 3 panel content (CSS-driven; no Framer Motion in this static build).
     */
    _runStep2To3Crossfade() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const slider = document.getElementById('step-slider');
        if (!slider || slider.classList.contains('hidden')) return;

        window.clearTimeout(this._crossfade23Timer);
        slider.classList.remove('step-slider--crossfade-2-3-active');
        slider.classList.add('step-slider--crossfade-2-3');

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                slider.classList.add('step-slider--crossfade-2-3-active');
            });
        });

        this._crossfade23Timer = window.setTimeout(() => {
            slider.classList.remove('step-slider--crossfade-2-3', 'step-slider--crossfade-2-3-active');
            document
                .querySelector('.step-slide[data-step="3"] .canvas-content.step-3-content')
                ?.classList.add('step-content--revealed');
        }, 720);
    }

    _abortStep2ImageReveal() {
        this._step2ImageRevealRunId += 1;
        if (this._step2ImageRevealTimer != null) {
            clearTimeout(this._step2ImageRevealTimer);
            this._step2ImageRevealTimer = null;
        }
        const box = document.querySelector('.step-2-image-box');
        const overlay = document.getElementById('step-2-image-processing');
        if (box) box.classList.remove('step-2-image-box--processing');
        if (overlay) overlay.setAttribute('aria-hidden', 'true');
    }

    _commitStep2ImageToDom(src) {
        const step2Image = document.getElementById('step-2-selected-image');
        if (!step2Image || !src) return;
        step2Image.src = src;
        step2Image.style.display = 'block';
    }

    /**
     * Show Step 2 material image only once the user is on Step 2.
     * From Step 1: brief “Processing image” state, then reveal.
     * From other steps: show immediately (no loader).
     */
    _revealStep2MaterialImage(previousStep) {
        const src = (this._step2MaterialImageSrc || '').trim();
        if (!src) {
            const step2Image = document.getElementById('step-2-selected-image');
            if (step2Image) {
                step2Image.removeAttribute('src');
                step2Image.style.display = 'none';
            }
            const box = document.querySelector('.step-2-image-box');
            if (box) box.classList.remove('step-2-image-box--processing');
            const overlay = document.getElementById('step-2-image-processing');
            if (overlay) overlay.setAttribute('aria-hidden', 'true');
            return;
        }

        if (previousStep !== 1) {
            this._abortStep2ImageReveal();
            this._commitStep2ImageToDom(src);
            return;
        }

        this._abortStep2ImageReveal();
        this._step2ImageRevealRunId += 1;
        const runId = this._step2ImageRevealRunId;

        const box = document.querySelector('.step-2-image-box');
        const overlay = document.getElementById('step-2-image-processing');
        const img = document.getElementById('step-2-selected-image');
        if (img) {
            img.removeAttribute('src');
            img.style.display = 'none';
        }

        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const processingMs = reduce ? 0 : STEP2_IMAGE_PROCESSING_MS;

        const showGreyLoaderThenImage = () => {
            if (runId !== this._step2ImageRevealRunId) return;
            if (box) box.classList.add('step-2-image-box--processing');
            if (overlay) overlay.setAttribute('aria-hidden', 'false');
            this._step2ImageRevealTimer = window.setTimeout(() => {
                this._step2ImageRevealTimer = null;
                if (runId !== this._step2ImageRevealRunId) return;
                if ((this._step2MaterialImageSrc || '').trim() !== src) return;
                this._commitStep2ImageToDom(src);
                if (box) box.classList.remove('step-2-image-box--processing');
                if (overlay) overlay.setAttribute('aria-hidden', 'true');
            }, processingMs);
        };

        // After Step 2 is painted (user has “landed”), then match the same loader treatment as the prompt analysis overlay
        requestAnimationFrame(() => {
            requestAnimationFrame(showGreyLoaderThenImage);
        });
    }

    /** Stash material URL from Step 1; Step 2 preview is filled only when user reaches Step 2 (see _revealStep2MaterialImage). */
    updateStep2Image(imageSrc) {
        const trimmed = imageSrc && String(imageSrc).trim() !== '' ? String(imageSrc).trim() : '';
        this._step2MaterialImageSrc = trimmed;

        const step2Image = document.getElementById('step-2-selected-image');
        const box = document.querySelector('.step-2-image-box');
        const overlay = document.getElementById('step-2-image-processing');

        if (!trimmed) {
            this._abortStep2ImageReveal();
            if (step2Image) {
                step2Image.removeAttribute('src');
                step2Image.style.display = 'none';
            }
            if (box) box.classList.remove('step-2-image-box--processing');
            if (overlay) overlay.setAttribute('aria-hidden', 'true');
            return;
        }

        this._abortStep2ImageReveal();
        if (step2Image) {
            step2Image.removeAttribute('src');
            step2Image.style.display = 'none';
        }
        if (box) box.classList.remove('step-2-image-box--processing');
        if (overlay) overlay.setAttribute('aria-hidden', 'true');

        if (this.currentStep === 2) {
            this._revealStep2MaterialImage(3);
        }

        console.log('Step 2 material stashed (shown when user opens Step 2):', trimmed);
    }
    
    setupStep2Interactions() {
        if (this._step2InteractionsBound) return;
        this._step2InteractionsBound = true;

        const options = document.querySelectorAll('.step-2-option');
        const chosenDisplay = document.getElementById('design-chosen-display');

        const applyStep2Selection = (option, index) => {
            options.forEach((opt) => {
                opt.classList.remove('selected');
                opt.setAttribute('aria-selected', 'false');
            });
            option.classList.add('selected');
            option.setAttribute('aria-selected', 'true');

            const optionText = option.dataset.option || option.textContent.trim();
            if (chosenDisplay) {
                chosenDisplay.textContent = optionText;
                chosenDisplay.classList.remove('step-2-chosen-display--empty');
            }

            this.selectedDesignOption = index + 1;
            console.log(`Selected design option: ${this.selectedDesignOption}`);

            this.updateStep2Draggers();
            this.syncNavStepsFromFlow();
            queueMicrotask(() => this.updateDragHandleHint());
            this.setStep2OptionsTabCollapsed(true);
        };

        const optionsTab = document.getElementById('step-2-options-tab');
        const optionsToggle = document.getElementById('step-2-options-toggle');
        optionsToggle?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!optionsTab) return;
            const collapsed = optionsTab.classList.toggle('step-2-options-tab--collapsed');
            optionsToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        });

        options.forEach((option, index) => {
            option.setAttribute('aria-selected', 'false');
            option.addEventListener('click', () => applyStep2Selection(option, index));
            option.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    applyStep2Selection(option, index);
                }
            });
        });

        const arrowButton = document.getElementById('design-arrow-btn');
        if (arrowButton) {
            arrowButton.addEventListener('click', () => {
                console.log('Design arrow button clicked');
                // Add functionality here if needed
            });
        }
    }

    setStep2OptionsTabCollapsed(collapsed) {
        const tab = document.getElementById('step-2-options-tab');
        const toggle = document.getElementById('step-2-options-toggle');
        if (!tab || !toggle) return;
        tab.classList.toggle('step-2-options-tab--collapsed', collapsed);
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    syncStep2OptionsTabOpenStateForEntry() {
        if (this.currentStep !== 2) return;
        /* Open when no design picked yet; collapsed only after user selects (or restored from DOM). */
        this.setStep2OptionsTabCollapsed(!!this.selectedDesignOption);
    }

    updateStep2Draggers() {
        const slider = document.getElementById('step-slider');
        if (!slider) return;
        if (this.selectedDesignOption) {
            slider.classList.add('design-selected');
        } else {
            slider.classList.remove('design-selected');
        }
        const arrowBtn = document.getElementById('design-arrow-btn');
        if (arrowBtn) {
            arrowBtn.setAttribute(
                'aria-label',
                this.selectedDesignOption ? 'Design selected' : 'Select a design from Options below'
            );
        }
        this.updateDragHandleHint();
    }

    syncStep3OutputReadyClass() {
        const slider = document.getElementById('step-slider');
        if (!slider) return;
        if (this._step3OutputsReady) {
            slider.classList.add('step-3-output-ready');
        } else {
            slider.classList.remove('step-3-output-ready');
        }
        this.syncStep3OutputChosenClass();
    }

    /** Step 3 forward dragger arms only after user picks a tile (not when previews merely finish loading). */
    syncStep3OutputChosenClass() {
        const slider = document.getElementById('step-slider');
        if (!slider) return;
        const chosen = !!document.querySelector('#step-3-options .step-3-option.selected');
        slider.classList.toggle('step-3-output-chosen', chosen);
        this.updateDragHandleHint();
    }

    _abortStep2Analysis() {
        this._step2AnalysisRunId += 1;
        if (this._step2SeqTimer != null) {
            clearTimeout(this._step2SeqTimer);
            this._step2SeqTimer = null;
        }
        const content = document.querySelector('.step-2-content');
        if (content) content.classList.remove('step-2--analysis-active');
        const overlay = document.getElementById('step-2-analysis-overlay');
        const statusEl = document.getElementById('step-2-analysis-status');
        if (overlay) overlay.setAttribute('aria-hidden', 'true');
        if (statusEl) statusEl.textContent = '';
    }

    _runStep2AnalysisSequence() {
        const content = document.querySelector('.step-2-content');
        const overlay = document.getElementById('step-2-analysis-overlay');
        const statusEl = document.getElementById('step-2-analysis-status');
        if (!content || !overlay || !statusEl) return;

        if (this._step2SeqTimer != null) {
            clearTimeout(this._step2SeqTimer);
            this._step2SeqTimer = null;
        }
        this._step2AnalysisRunId += 1;
        const runId = this._step2AnalysisRunId;

        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const messages = reduce
            ? [STEP2_ANALYSIS_MESSAGES[STEP2_ANALYSIS_MESSAGES.length - 1]]
            : STEP2_ANALYSIS_MESSAGES;
        const lineMs = reduce ? 400 : STEP2_ANALYSIS_LINE_MS;

        content.classList.add('step-2--analysis-active');
        overlay.setAttribute('aria-hidden', 'false');
        statusEl.textContent = messages[0];

        let i = 0;
        const step = () => {
            this._step2SeqTimer = window.setTimeout(() => {
                if (runId !== this._step2AnalysisRunId) return;
                i += 1;
                if (i >= messages.length) {
                    this._step2SeqTimer = null;
                    content.classList.remove('step-2--analysis-active');
                    overlay.setAttribute('aria-hidden', 'true');
                    statusEl.textContent = '';
                    return;
                }
                statusEl.textContent = messages[i];
                step();
            }, lineMs);
        };
        step();
    }

    _abortStep3GenerationUi() {
        this._step3GenRunId += 1;
        this._clearStep3GenerationTimers();
        this._step3OutputsReady = false;
        this.syncStep3OutputReadyClass();
        const container = document.getElementById('step-3-options');
        if (container) {
            container.classList.remove('step-3-generation--busy', 'step-3-generation--text-only');
        }
        const overlay = document.getElementById('step-3-generation-overlay');
        const statusEl = document.getElementById('step-3-generation-status');
        if (overlay) overlay.setAttribute('aria-hidden', 'true');
        if (statusEl) statusEl.textContent = '';
    }

    _startStep3EntryFlow(optionNumber) {
        const container = document.getElementById('step-3-options');
        const overlay = document.getElementById('step-3-generation-overlay');
        const statusEl = document.getElementById('step-3-generation-status');
        if (!container || !overlay || !statusEl || !optionNumber) return;

        this._step3OutputsReady = false;
        this.syncStep3OutputReadyClass();

        this._clearStep3GenerationTimers();
        if (this._step3SeqTimer != null) {
            clearTimeout(this._step3SeqTimer);
            this._step3SeqTimer = null;
        }

        this._step3GenRunId += 1;
        const runId = this._step3GenRunId;

        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const messages = reduce
            ? [STEP3_BUILD_MESSAGES[STEP3_BUILD_MESSAGES.length - 1]]
            : STEP3_BUILD_MESSAGES;
        const lineMs = reduce ? 350 : STEP3_BUILD_LINE_MS;

        container.classList.add('step-3-generation--busy', 'step-3-generation--text-only');
        overlay.setAttribute('aria-hidden', 'false');
        statusEl.textContent = messages[0];

        let i = 0;
        const advance = () => {
            this._step3SeqTimer = window.setTimeout(() => {
                if (runId !== this._step3GenRunId) return;
                i += 1;
                if (i >= messages.length) {
                    this._step3SeqTimer = null;
                    container.classList.remove('step-3-generation--text-only');
                    this._applyStep3ImagesAfterBuild(optionNumber, runId);
                    return;
                }
                statusEl.textContent = messages[i];
                advance();
            }, lineMs);
        };
        advance();
    }

    _clearStep3GenerationTimers() {
        if (this._step3SeqTimer != null) {
            clearTimeout(this._step3SeqTimer);
            this._step3SeqTimer = null;
        }
        if (this._step3GenCompleteTimer != null) {
            clearTimeout(this._step3GenCompleteTimer);
            this._step3GenCompleteTimer = null;
        }
    }

    _finishStep3GenerationFeedback() {
        this._clearStep3GenerationTimers();
        const container = document.getElementById('step-3-options');
        const overlay = document.getElementById('step-3-generation-overlay');
        const statusEl = document.getElementById('step-3-generation-status');
        if (container) {
            container.querySelectorAll('.step-3-option-img').forEach((img) => {
                img.classList.remove(REDO_BLUEPRINT_PENDING);
                img.classList.add(REDO_BLUEPRINT_REVEALED);
                window._redoBlueprintIO?.unobserve(img);
            });
            container.classList.remove('step-3-generation--busy', 'step-3-generation--text-only');
        }
        if (overlay) overlay.setAttribute('aria-hidden', 'true');
        if (statusEl) statusEl.textContent = '';
        this._step3OutputsReady = true;
        this.syncStep3OutputReadyClass();
    }

    updateStep3Images(optionNumber) {
        this._applyStep3ImagesAfterBuild(optionNumber);
    }

    _applyStep3ImagesAfterBuild(optionNumber, expectedRunId = null) {
        // optionNumber: 1, 2, or 3
        const imageSet = {
            1: [redoAssetPath('Assets/op1_1.png'), redoAssetPath('Assets/op1_2.png'), redoAssetPath('Assets/op1_3.png')],
            2: [redoAssetPath('Assets/op2_1.png'), redoAssetPath('Assets/op2_2.png'), redoAssetPath('Assets/op2_3.png')],
            3: [redoAssetPath('Assets/op3_1.png'), redoAssetPath('Assets/op3_2.jpg'), redoAssetPath('Assets/op3_3.png')]
        };

        const images = imageSet[optionNumber];
        if (!images) {
            console.warn(`No image set found for option ${optionNumber}`);
            return;
        }

        this._resetStep3PreviewSelection();

        let runId;
        if (expectedRunId != null) {
            runId = expectedRunId;
        } else {
            this._step3GenRunId += 1;
            runId = this._step3GenRunId;
        }
        this._clearStep3GenerationTimers();

        this._step3OutputsReady = false;
        this.syncStep3OutputReadyClass();

        const container = document.getElementById('step-3-options');
        const overlay = document.getElementById('step-3-generation-overlay');
        const statusEl = document.getElementById('step-3-generation-status');
        if (container) {
            container.classList.add('step-3-generation--busy');
            container.classList.remove('step-3-generation--text-only');
        }
        if (overlay) overlay.setAttribute('aria-hidden', 'false');
        if (statusEl) statusEl.textContent = '';

        const loadStartedAt = performance.now();
        
        const optionElements = document.querySelectorAll('.step-3-option');
        console.log(`Updating Step 3 images for option ${optionNumber}, found ${optionElements.length} option elements`);
        
        const imgs = [];

        if (optionElements.length >= 3) {
            // Top thumbnail (index 0)
            const topImg = optionElements[0].querySelector('.step-3-option-img');
            if (topImg) {
                topImg.src = images[0];
                topImg.style.display = 'block';
                redoObserveBlueprintImg(topImg);
                imgs.push(topImg);
                console.log(`Set top image: ${images[0]}`);
            }
            
            // Main/center image (index 1)
            const mainImg = optionElements[1].querySelector('.step-3-option-img');
            if (mainImg) {
                mainImg.src = images[1];
                mainImg.style.display = 'block';
                redoObserveBlueprintImg(mainImg);
                imgs.push(mainImg);
                console.log(`Set main image: ${images[1]}`);
            }
            
            // Bottom thumbnail (index 2)
            const bottomImg = optionElements[2].querySelector('.step-3-option-img');
            if (bottomImg) {
                bottomImg.src = images[2];
                bottomImg.style.display = 'block';
                redoObserveBlueprintImg(bottomImg);
                imgs.push(bottomImg);
                console.log(`Set bottom image: ${images[2]}`);
            }
        } else {
            console.warn(`Expected 3 option elements, found ${optionElements.length}`);
        }

        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const minMs = reduceMotion ? 400 : STEP3_GEN_MIN_MS;

        const scheduleFinish = () => {
            if (runId !== this._step3GenRunId) return;
            const elapsed = performance.now() - loadStartedAt;
            const wait = Math.max(0, minMs - elapsed);
            this._step3GenCompleteTimer = window.setTimeout(() => {
                if (runId !== this._step3GenRunId) return;
                this._finishStep3GenerationFeedback();
            }, wait);
        };

        if (imgs.length === 0) {
            scheduleFinish();
        } else {
            let done = 0;
            const onOne = () => {
                if (runId !== this._step3GenRunId) return;
                done += 1;
                if (done >= imgs.length) scheduleFinish();
            };

            imgs.forEach((img) => {
                if (img.complete && img.naturalWidth > 0) {
                    onOne();
                } else {
                    img.addEventListener('load', onOne, { once: true });
                    img.addEventListener('error', onOne, { once: true });
                }
            });
        }
        
        const optionsContainer = document.getElementById('step-3-options');
        const selectedOption = optionsContainer?.querySelector('.step-3-option.selected');
        if (optionsContainer && selectedOption) {
            setTimeout(() => {
                selectedOption.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        }
    }

    _resetStep3PreviewSelection() {
        const container = document.getElementById('step-3-options');
        if (!container) return;
        container.classList.remove('step-3-selection-visual');
        container.querySelectorAll('.step-3-option').forEach((o) => o.classList.remove('selected'));
        this.syncStep3OutputChosenClass();
    }

    setupStep3Interactions() {
        if (this._step3InteractionsBound) return;
        this._step3InteractionsBound = true;

        const container = document.getElementById('step-3-options');
        const options = container?.querySelectorAll('.step-3-option');

        options?.forEach((option) => {
            option.addEventListener('click', () => {
                options.forEach((o) => o.classList.remove('selected'));
                option.classList.add('selected');
                container.classList.add('step-3-selection-visual');
                this.syncStep3OutputChosenClass();
                option.scrollIntoView({ behavior: 'smooth', block: 'center' });
                if (this.currentStep === 4) {
                    queueMicrotask(() => this.refreshStep4Outputs());
                }
            });
        });
    }

    getStep3OutputIndex() {
        const sel = document.querySelector('#step-3-options .step-3-option.selected');
        if (!sel) return null;
        const idx = parseInt(sel.getAttribute('data-option-index'), 10);
        if (Number.isNaN(idx) || idx < 0 || idx > 2) return null;
        return idx;
    }

    _ensureStep4Viewer() {
        if (this._step4Viewer) return;
        const canvas = document.getElementById('step-4-model-canvas');
        if (!canvas || typeof THREE === 'undefined') return;
        this._step4Viewer = new Step4ModelViewer(canvas);
        this._step4Viewer.init();
    }

    setupStep4Panel() {
        if (this._step4PanelBound) return;
        this._step4PanelBound = true;

        const scroller = document.getElementById('step-4-output-scroller');
        scroller?.addEventListener('click', (e) => {
            const pill = e.target && e.target.closest('.step-4-output-tab[data-step4-view]');
            if (!pill || !scroller.contains(pill)) return;
            const view = pill.getAttribute('data-step4-view');
            if (!view) return;
            this.setStep4View(view);
        });

        const copyBtn = document.getElementById('step-4-copy-btn');
        const dlBtn = document.getElementById('step-4-download-btn');
        const body = document.getElementById('step-4-instructions-body');

        copyBtn?.addEventListener('click', async () => {
            const t = this._step4LastText || (body ? body.textContent : '');
            if (!t) return;
            try {
                await navigator.clipboard.writeText(t);
                const prev = copyBtn.textContent;
                copyBtn.textContent = 'Copied';
                window.setTimeout(() => {
                    copyBtn.textContent = prev;
                }, 1600);
            } catch (e) {
                console.warn('Clipboard failed', e);
            }
        });

        dlBtn?.addEventListener('click', () => {
            const t = this._step4LastText || (body ? body.textContent : '');
            if (!t) return;
            const blob = new Blob([t], { type: 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = this._step4LastFilename || 'redo-instructions.txt';
            a.click();
            URL.revokeObjectURL(a.href);
        });
    }

    /** @param {'3d'|'diagram'|'instructions'} view */
    setStep4View(view) {
        const allowed = new Set(['3d', 'diagram', 'instructions']);
        const v = allowed.has(view) ? view : '3d';
        this._step4ActiveView = v;

        const panels = document.getElementById('step-4-panels');
        if (panels) panels.setAttribute('data-step4-view', v);

        document.querySelectorAll('.step-4-output-tab[data-step4-view]').forEach((btn) => {
            const on = btn.getAttribute('data-step4-view') === v;
            btn.classList.toggle('step-4-output-tab--active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });

        document.querySelectorAll('.step-4-section[data-step4-view]').forEach((sec) => {
            const match = sec.getAttribute('data-step4-view') === v;
            if (match) {
                sec.removeAttribute('hidden');
                sec.setAttribute('aria-hidden', 'false');
            } else {
                sec.setAttribute('hidden', '');
                sec.setAttribute('aria-hidden', 'true');
            }
        });

        const root = document.getElementById('step-4-output-scroller');
        requestAnimationFrame(() => {
            const activeBtn = root?.querySelector(`.step-4-output-tab[data-step4-view="${v}"]`);
            const instant = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
            activeBtn?.scrollIntoView?.({
                behavior: instant ? 'auto' : 'smooth',
                inline: 'center',
                block: 'nearest'
            });
        });
    }

    /** Keeps tab UI aligned after refresh (preserves current view). */
    _syncStep4ViewTabs() {
        const v = this._step4ActiveView && ['3d', 'diagram', 'instructions'].includes(this._step4ActiveView)
            ? this._step4ActiveView
            : '3d';
        this.setStep4View(v);
    }

    /** Renders raw markdown text as clean HTML for the instructions panel. */
    _step4RenderMarkdown(raw) {
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const inline = (s) => {
            s = esc(s);
            s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            return s;
        };

        const lines = raw.split('\n');
        const out = [];
        let listType = null;
        let paraLines = [];

        const flushPara = () => {
            if (!paraLines.length) return;
            out.push(`<p class="md-p">${paraLines.map(inline).join('<br>')}</p>`);
            paraLines = [];
        };
        const closeList = () => {
            if (!listType) return;
            out.push(`</${listType}>`);
            listType = null;
        };
        const openList = (type) => {
            if (listType === type) return;
            closeList();
            out.push(`<${type} class="md-list">`);
            listType = type;
        };

        let i = 0;
        while (i < lines.length) {
            const line = lines[i].trimEnd();

            // Fenced code block
            if (line.trim().startsWith('```')) {
                flushPara(); closeList();
                const codeLines = [];
                i++;
                while (i < lines.length && !lines[i].trim().startsWith('```')) {
                    codeLines.push(esc(lines[i]));
                    i++;
                }
                out.push(`<pre class="md-pre">${codeLines.join('\n')}</pre>`);
                i++; continue;
            }

            // ATX heading  # to ######
            const hm = line.match(/^(#{1,6})\s+(.*)/);
            if (hm) {
                flushPara(); closeList();
                const depth = hm[1].length;
                const tag = depth <= 2 ? `h${depth}` : depth <= 4 ? 'h3' : 'h4';
                out.push(`<${tag} class="md-h${depth}">${inline(hm[2].trim())}</${tag}>`);
                i++; continue;
            }

            // Horizontal rule (4+ dashes)
            if (/^-{4,}\s*$/.test(line.trim())) {
                flushPara(); closeList();
                out.push('<hr class="md-hr">');
                i++; continue;
            }

            // Unordered list item (- or *, any indent)
            const ulm = line.match(/^(\s*)([-*])\s+(.+)$/);
            if (ulm) {
                flushPara(); openList('ul');
                out.push(`<li>${inline(ulm[3])}</li>`);
                i++; continue;
            }

            // Ordered list item (1. …, any indent)
            const olm = line.match(/^(\s*)\d+\.\s+(.+)$/);
            if (olm) {
                flushPara(); openList('ol');
                out.push(`<li>${inline(olm[2])}</li>`);
                i++; continue;
            }

            // Empty line — paragraph break
            if (line.trim() === '') {
                flushPara(); closeList();
                i++; continue;
            }

            // Regular text — accumulate
            closeList();
            paraLines.push(line.trim());
            i++;
        }

        flushPara(); closeList();
        return out.join('\n');
    }

    /** Loads GLB, diagram, and instructions for the Step 3–selected design; tabs only change which panel is visible. */
    refreshStep4Outputs() {
        if (this.currentStep !== 4) return;

        const idx = this.getStep3OutputIndex();
        const spec =
            idx !== null && idx !== undefined ? STEP4_OUTPUT_SPECS[idx] || STEP4_OUTPUT_SPECS[1] : STEP4_OUTPUT_SPECS[1];
        const glbUrl = step4ResolveGlbUrl(spec.glb);
        const diagramUrl = redoAssetPath(spec.diagram);
        const txtUrl = redoAssetPath(spec.instructionsTxt);

        this._step4LastFilename = `redo-build-instructions-output-${idx + 1}.txt`;

        const imgEl = document.getElementById('step-4-diagram-img');
        if (imgEl) {
            imgEl.src = diagramUrl;
            imgEl.alt = `Construction diagram — output ${idx + 1}`;
        }

        const body = document.getElementById('step-4-instructions-body');
        if (body) body.innerHTML = '<p class="md-p md-p--loading">Loading instructions\u2026</p>';

        fetch(txtUrl)
            .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
            .then((text) => {
                this._step4LastText = text;
                if (body) body.innerHTML = this._step4RenderMarkdown(text);
            })
            .catch(() => {
                const fb = `Could not load ${spec.instructionsTxt}. Add the file under Assets/ or fix the path.`;
                this._step4LastText = fb;
                if (body) body.innerHTML = `<p class="md-p">${fb}</p>`;
            });

        this._ensureStep4Viewer();
        if (this._step4Viewer) {
            this._step4Viewer.loadGlb(glbUrl);
        }

        this._syncStep4ViewTabs();
    }
    
    slideToNextStep() {
        const slides = document.querySelectorAll('.step-slide');
        const totalSteps = slides.length;
        
        if (this.currentStep < totalSteps) {
            // Move current slide to previous
            const currentSlide = document.querySelector(`.step-slide[data-step="${this.currentStep}"]`);
            currentSlide.classList.remove('active');
            currentSlide.classList.add('prev');
            
            // Move next slide to active
            this.currentStep++;
            const nextSlide = document.querySelector(`.step-slide[data-step="${this.currentStep}"]`);
            nextSlide.classList.remove('next');
            nextSlide.classList.add('active');
            
            // Update progress line
            this.updateProgressLine();
            
            console.log(`Slided to step ${this.currentStep}`);
        }
    }
    
    slideToPrevStep() {
        const slides = document.querySelectorAll('.step-slide');
        
        if (this.currentStep > 1) {
            // Move current slide to next
            const currentSlide = document.querySelector(`.step-slide[data-step="${this.currentStep}"]`);
            currentSlide.classList.remove('active');
            currentSlide.classList.add('next');
            
            // Move previous slide to active
            this.currentStep--;
            const prevSlide = document.querySelector(`.step-slide[data-step="${this.currentStep}"]`);
            prevSlide.classList.remove('prev');
            prevSlide.classList.add('active');
            
            // Update progress line
            this.updateProgressLine();
            
            console.log(`Slided back to step ${this.currentStep}`);
        }
    }
    
    slideToStep(targetStep) {
        if (targetStep === this.currentStep) return;
        
        const slides = document.querySelectorAll('.step-slide');
        
        // Reset all slides
        slides.forEach(slide => {
            slide.classList.remove('active', 'prev', 'next');
            const stepNum = parseInt(slide.dataset.step);
            
            if (stepNum === targetStep) {
                slide.classList.add('active');
            } else if (stepNum < targetStep) {
                slide.classList.add('prev');
            } else {
                slide.classList.add('next');
            }
        });
        
        this.currentStep = targetStep;
        this.updateProgressLine();
        
        console.log(`Slided to step ${this.currentStep}`);
    }
    
    updateContinuousSlider(sliderValue, immediate = false, updateSlides = true) {
        const progressLine = document.querySelector('.progress-line');
        const totalSteps = 4;
        
        // Base at 75% and offset across remaining space
        const basePercent = 75;
        const stepOffset = 8;
        if (immediate) {
            // Immediate jump (no animation path)
            this.currentSliderValue = sliderValue;
            const progressPercent = basePercent + ((this.currentSliderValue - 1) * stepOffset);
            if (progressLine) progressLine.style.left = `${progressPercent}%`;
            this.applySliderVisuals(this.currentSliderValue, updateSlides);
            return;
        }
        
        // Set new target and animate gently (used for button/keyboard)
        this.targetSliderValue = sliderValue;
        if (!this.sliderAnimating) {
            this.animateSliderTowardsTarget();
        }
    }
    
    animateSliderTowardsTarget() {
        this.sliderAnimating = true;
        const step = () => {
            const delta = this.targetSliderValue - this.currentSliderValue;
            if (Math.abs(delta) < 0.001) {
                this.currentSliderValue = this.targetSliderValue;
                this.applySliderVisuals(this.currentSliderValue, true);
                this.sliderAnimating = false;
                return;
            }
            // Damping factor controls "speed" (lower = slower, more control)
            this.currentSliderValue += delta * 0.12;
            this.applySliderVisuals(this.currentSliderValue, true);
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }
    
    applySliderVisuals(value, updateSlides = true) {
        const progressLine = document.querySelector('.progress-line');
        const basePercent = 75; // 3rd division end
        const stepOffset = 8;   // movement per step
        const progressPercent = basePercent + ((value - 1) * stepOffset);
        if (progressLine) progressLine.style.left = `${progressPercent}%`;
        // Also set CSS var in viewport units so canvases and badges track the dragger
        document.documentElement.style.setProperty('--slider-left', `${progressPercent}vw`);
        
        const slides = document.querySelectorAll('.step-slide');
        const activeStep = Math.min(4, Math.max(1, Math.round(value)));
        if (updateSlides) {
            slides.forEach(slide => {
                slide.classList.remove('active', 'prev', 'next');
                const stepNum = parseInt(slide.dataset.step);
                if (stepNum === activeStep) {
                    slide.classList.add('active');
                } else if (stepNum < activeStep) {
                    slide.classList.add('prev');
                } else {
                    slide.classList.add('next');
                }
            });
        }
        // Update next step badge (always black with next step number)
        const nextBadge = document.getElementById('next-step-badge');
        if (nextBadge) {
            const next = Math.min(4, activeStep + 1);
            if (next === activeStep) {
                nextBadge.classList.add('hidden');
            } else {
                nextBadge.textContent = String(next);
                nextBadge.classList.remove('hidden');
            }
        }
        
        // Update canvas backgrounds based on current step
        const stepSlider = document.querySelector('.step-slider');
        if (stepSlider) {
            const canvasBg = '#fafafa';
            stepSlider.style.setProperty('--left-canvas-bg', canvasBg);
            stepSlider.style.setProperty('--right-canvas-bg', canvasBg);
        }
    }

    _updateFromPointer(e, sliderEl, updateSlides = false) {
        const rect = sliderEl.getBoundingClientRect();
        const clientX = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        // Map to 1..4 with high precision
        const value = 1 + ratio * 3;
        sliderEl.value = value.toFixed(2);
        this.updateContinuousSlider(value, true, updateSlides);
    }
    
    updateProgressLine() {
        // Animate to the discrete step position smoothly (button/keyboard only)
        this.updateContinuousSlider(this.currentStep, false);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());

        if (this._lenis) {
            this._lenis.raf(performance.now());
        }

        if (this.clock) {
            this.clock.getDelta();
        }

        if (!this.isLoading) {
            const elapsed = this.clock.getElapsedTime();

            this.updateHoverFromPointer();
            this.updateHeroAmbientMotion(elapsed);

            if (this.controls) {
                if (this.models.length > 0) {
                    this.controls.target.copy(VIEW_CAMERA_LOOK_AT);
                }
                this.controls.update();
            }
        }

        if (typeof TWEEN !== 'undefined' && TWEEN.update) {
            TWEEN.update();
        }

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
}

function logRedoAssetExpectations() {
    const tag = '[reDO assets]';
    try {
        console.info(tag, 'document.baseURI:', document.baseURI);
        console.info(tag, 'Resolved stylesheet URL:', new URL('./styles.css', document.baseURI).href);
        console.info(tag, 'Resolved app script URL:', new URL('./script.js', document.baseURI).href);
        console.info(
            tag,
            'Linked stylesheets:',
            [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href)
        );
        document.querySelectorAll('script[src]').forEach((s) => console.info(tag, 'External script:', s.src));
        const cssUrl = new URL('./styles.css', document.baseURI).href;
        fetch(cssUrl, { method: 'HEAD', cache: 'no-store' })
            .then((r) => {
                if (!r.ok) console.warn(tag, 'styles.css HEAD failed:', r.status, r.url);
                else console.info(tag, 'styles.css OK (HEAD', r.status + '):', r.url);
            })
            .catch((err) => console.warn(tag, 'styles.css fetch check failed (network/CORS):', err && err.message));
    } catch (e) {
        console.warn(tag, 'logging failed:', e);
    }
}

window.addEventListener('load', () => {
    logRedoAssetExpectations();
    try {
        if (typeof THREE === 'undefined') {
            throw new Error('Three.js did not load (CDN blocked or offline).');
        }
        if (typeof THREE.GLTFLoader !== 'function') {
            throw new Error('GLTFLoader not available. Check script tags / CDN.');
        }
        if (typeof THREE.OrbitControls !== 'function') {
            throw new Error('OrbitControls not available. Check script tags / CDN.');
        }
        window.scene3D = new Scene3D();
    } catch (err) {
        console.error(err);
        document.getElementById('loading-screen')?.classList.add('hidden');
        document.body.classList.add('redo-chrome-visible');
        const notice = document.getElementById('model-load-notice');
        if (notice) {
            notice.textContent =
                (err && err.message) ||
                'Could not start the app. Use a local server (e.g. python -m http.server), check the console, and ensure CDN scripts are not blocked.';
            notice.classList.remove('hidden');
        }
    }
}); 