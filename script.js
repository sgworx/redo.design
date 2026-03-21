/**
 * Homepage: multiple GLBs from assets.redo.design, normalized (max axis 2), laid out on a shallow arc (bbox widths + gap, centered on x=0).
 * Cache bust in loadModel().
 */
const MODEL_ASSETS_BASE = 'https://assets.redo.design/';
const MODEL_FILE_STEM = 'text';
const MODEL_COUNT = 5;

/** After load, largest bbox dimension is scaled to this (world units) */
const targetMaxDimension = 2.0;

/** Minimum chord gap between adjacent pivot centers (arc spacing baseline) */
const MODEL_ROW_GAP = 0.35;

/** Arc: circle radius in XZ (tune for composition); may grow slightly to satisfy spacing / max span */
const ARC_RADIUS = 5.0;
/** Multiply required chord (width halves + gap) to keep motion / AABB error from clipping */
const ARC_SAFETY_MULT = 1.18;
/** If equal angular steps exceed this total span, radius is increased (shallower arc) */
const ARC_MAX_HALF_SPAN_RAD = 0.72;
/** 0 = fully face outward from arc center; 1 = same yaw as center chair (silhouette blend) */
const ARC_YAW_INWARD_BLEND = 0.14;

const VIEW_CAMERA_FOV = 36;
/** Baseline Z distance; widened FOV + multi-model boost keep the row framed with breathing room */
const VIEW_CAMERA_BASE_Z = 6.0;
/** Slightly lower eye line vs look-at for a neutral premium product view (less low-angle). */
const VIEW_CAMERA_POSITION = new THREE.Vector3(0, 0.81, VIEW_CAMERA_BASE_Z);
const VIEW_CAMERA_LOOK_AT = new THREE.Vector3(0, 0.57, 0);
/** Extra Z per half-row-width when more than one model: z = baseZ + (rowWidth/2) * this */
const VIEW_CAMERA_ROW_Z_SCALE = 0.6;

/** BAM-style presentation (pivot); ambient motion applied on top in animate() */
const HERO_PIVOT_ROT_X = -0.08;
const HERO_PIVOT_ROT_Y_BASE = 0.55;
/** Lower entire arc in world Y (eye-level framing with camera tweaks) */
const HERO_ARRANGEMENT_Y_OFFSET = -0.13;
/** Slow continuous yaw on each pivot (rad/s); same for all chairs */
const HERO_SPIN_RAD_PER_SEC = 0.2;
/** Curated initial Y phase per chair (rad); yaw = baseYaw + spinStartRad + elapsed * HERO_SPIN_RAD_PER_SEC */
const HERO_SPIN_START_OFFSETS = [-0.8, -0.2, 0.5, 1.1, 1.8];
/** Alternating depth on Z after arc placement: even index → −mag, odd → +mag (layered from camera at +Z). X unchanged. */
const HERO_DEPTH_STAGGER_Z = 0.55;

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

class Scene3D {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.raycaster = null;
        this.mouse = null;
        this.models = [];
        this.isLoading = true;
        this.selectedModel = null;
        this.originalPositions = [];
        this.modelPivots = [];

        // Motion and interaction state
        this.clock = new THREE.Clock();
        this.pointer = new THREE.Vector2(0, 0); // normalized device coords
        this.parallaxStrength = 0.15; // Subtle parallax like BAM Works
        this.pointerActive = false;
        this.hoveredModel = null;
        this.intersectTargets = [];
        this.hoverScale = 0.8; // Hover zoom out by 20%
        this.defaultColorModel = null; // Keep 2.glb colored unless hovering another model
        
        // Slider smoothing state
        this.currentSliderValue = 1; // smoothed value
        this.targetSliderValue = 1; // target value from input
        this.sliderAnimating = false;
        this.isUserSliding = false; // true while user holds the slider
        this.imageSelected = false; // track if image is selected (required for dragging)
        this.currentStep = 1; // current active step (1-4)
        this.selectedDesignOption = null; // track which design option was selected in Step 2 (1, 2, or 3)

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

        this.init();
        if (this.renderer && this.camera && this.controls) {
            this.setupEventListeners();
        }
    }
    
    init() {
        try {
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0xffffff);

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
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            this.renderer.domElement.style.display = 'block';
            this.renderer.domElement.style.width = '100%';
            this.renderer.domElement.style.height = '100%';

            document.getElementById('container').appendChild(this.renderer.domElement);

            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.enableZoom = true;
            this.controls.enablePan = false;
            this.controls.autoRotate = false;
            this.controls.target.copy(VIEW_CAMERA_LOOK_AT);
            this.controls.update();

            this.raycaster = new THREE.Raycaster();
            this.mouse = new THREE.Vector2();

            this.setupLighting();

            this._loadOverlayDismissed = false;
            this.loadModels().catch((err) => {
                console.error('loadModels rejected:', err);
                this.dismissLoadingOverlay(this.models.length);
            });

            this.animate();
        } catch (err) {
            console.error('Scene3D init failed:', err);
            this.isLoading = false;
            document.getElementById('loading-screen')?.classList.add('hidden');
            const notice = document.getElementById('model-load-notice');
            if (notice) {
                notice.textContent =
                    (err && err.message) ||
                    '3D view failed to start (WebGL or setup error). See console.';
                notice.classList.remove('hidden');
            }
        }
    }
    
    setupLighting() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        // Directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 5);
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
        this.defaultColorModel = null;
    }

    /** World-space AABB width along X after pivot + model transforms (for row spacing). */
    getPivotWorldWidthX(pivot) {
        pivot.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(pivot);
        if (box.isEmpty()) return 0;
        return Math.max(0, box.max.x - box.min.x);
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
     * Normalize scale (max axis → targetMaxDimension), recenter at origin, then shift Y so mesh rests on y≈0.
     * Call with pivot at scene origin so box center and position.sub(center) align.
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
        model.position.sub(center);

        model.updateMatrixWorld(true);
        box.setFromObject(model);
        model.position.y -= box.min.y;

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
        for (let k = 0; k < n; k++) {
            const theta = -totalSpan * 0.5 + k * deltaTheta;
            const px = R * Math.sin(theta);
            const pzArc = cz + R * Math.cos(theta);
            const zStagger = k % 2 === 0 ? -HERO_DEPTH_STAGGER_Z : HERO_DEPTH_STAGGER_Z;
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
            console.log(`Loading ${this.modelFiles.length} GLBs for bbox-spaced arc`);

            const widths = [];
            const pivots = [];

            for (let i = 0; i < this.modelFiles.length; i++) {
                try {
                    const url = this.modelFiles[i];
                    const gltf = await this.loadModel(loader, url);
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
                    try {
                        this.setModelToGrayscale(model);
                    } catch (grayErr) {
                        console.warn(`[${i}] Grayscale pass skipped:`, grayErr);
                    }
                    this.intersectTargets.push(model);
                    if (i === 1) {
                        this.defaultColorModel = model;
                    }

                    this.originalPositions.push({
                        x: model.position.x,
                        y: model.position.y,
                        z: model.position.z,
                        scale: model.scale.clone()
                    });

                    console.log(`[${i}] Loaded:`, url);
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

            console.log(`Scene models loaded: ${this.models.length}`);
        } catch (e) {
            console.error('loadModels fatal:', e);
        } finally {
            this.dismissLoadingOverlay(this.models.length);
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

            // Bypass browser/CDN cache during development — each load gets ?v=timestamp (e.g. …/1.glb?v=173…)
            const cacheBustUrl = url.includes('?') ? `${url}&v=${Date.now()}` : `${url}?v=${Date.now()}`;
            loader.load(
                cacheBustUrl,
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

    updateHoverFromPointer() {
        if (!this.pointerActive || this.intersectTargets.length === 0) {
            if (this.hoveredModel) {
                this.setModelToGrayscale(this.hoveredModel);
                this.resetHoverScale(this.hoveredModel);
                this.hoveredModel = null;
            }
            if (this.defaultColorModel) {
                this.restoreModelColor(this.defaultColorModel);
            }
            return;
        }

        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersects = this.raycaster.intersectObjects(this.intersectTargets, true);

        let nextHovered = null;
        if (intersects.length > 0) {
            nextHovered = this.findIntersectRoot(intersects[0].object);
        }

        if (nextHovered !== this.hoveredModel) {
            if (this.hoveredModel) {
                this.setModelToGrayscale(this.hoveredModel);
                this.resetHoverScale(this.hoveredModel);
            }
            if (nextHovered) {
                this.restoreModelColor(nextHovered);
                this.applyHoverScale(nextHovered);
            }
            this.hoveredModel = nextHovered;
        }

        if (this.defaultColorModel && this.defaultColorModel !== this.hoveredModel) {
            if (this.hoveredModel) {
                this.setModelToGrayscale(this.defaultColorModel);
            } else {
                this.restoreModelColor(this.defaultColorModel);
            }
        }
    }

    applyHoverScale(model) {
        if (!model) return;
        if (!model.userData.hoverBaseScale) {
            model.userData.hoverBaseScale = model.scale.clone();
        }
        model.scale.copy(model.userData.hoverBaseScale).multiplyScalar(this.hoverScale);
    }

    resetHoverScale(model) {
        if (!model || !model.userData.hoverBaseScale) return;
        model.scale.copy(model.userData.hoverBaseScale);
        delete model.userData.hoverBaseScale;
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
    
    onMouseClick(event) {
        // Calculate mouse position in normalized device coordinates
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        // Update the picking ray with the camera and mouse position
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Calculate objects intersecting the picking ray
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);
        
        if (intersects.length > 0) {
            let clickedModel = null;
            for (const intersect of intersects) {
                const root = this.findIntersectRoot(intersect.object);
                if (root) {
                    clickedModel = root;
                    break;
                }
            }
            if (clickedModel) {
                this.handleModelClick(clickedModel);
            }
        }
    }
    
    handleModelClick(model) {
        // Reset all models to original state
        this.resetAllModels();
        
        // Animate the clicked model
        this.animateModelFocus(model);
        
        // Update selected model
        this.selectedModel = model;
    }
    
    resetAllModels() {
        this.models.forEach((modelData, index) => {
            const model = modelData.scene;
            const pivot = model.userData.pivot;
            const original = this.originalPositions[index];

            if (original && pivot && model) {
                model.position.set(original.x, original.y, original.z);
                model.scale.copy(original.scale);
                pivot.position.set(
                    pivot.userData.baseX ?? 0,
                    pivot.userData.baseY ?? HERO_ARRANGEMENT_Y_OFFSET,
                    pivot.userData.baseZ ?? 0
                );
                const spin0 = pivot.userData.spinStartRad ?? 0;
                pivot.rotation.set(
                    HERO_PIVOT_ROT_X,
                    (pivot.userData.baseYaw ?? HERO_PIVOT_ROT_Y_BASE) + spin0,
                    0
                );
            }
        });
    }
    
    animateModelFocus(model) {
        // Create a focus animation for the selected model
        const targetScale = 1.3;
        const targetY = 0;
        
        // Animate scale and position
        const scaleTween = new TWEEN.Tween(model.scale)
            .to({ x: targetScale, y: targetScale, z: targetScale }, 800)
            .easing(TWEEN.Easing.Quadratic.Out);
            
        const positionTween = new TWEEN.Tween(model.position)
            .to({ y: targetY }, 800)
            .easing(TWEEN.Easing.Quadratic.Out);
            
        scaleTween.start();
        positionTween.start();
    }
    
    setupEventListeners() {
        // Mouse click for object selection
        window.addEventListener('click', (event) => {
            this.onMouseClick(event);
        });
        
        // Pointer move for parallax + hover (relative to renderer canvas)
        this.renderer.domElement.addEventListener('mousemove', (event) => {
            const rect = this.renderer.domElement.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            this.pointer.x = x;
            this.pointer.y = y;
            this.pointerActive = true;
        });
        
        this.renderer.domElement.addEventListener('mouseleave', () => {
            this.pointerActive = false;
            if (this.hoveredModel) {
                this.setModelToGrayscale(this.hoveredModel);
                this.hoveredModel = null;
            }
        });
        
        // Window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
        
        // Keep zoom via OrbitControls (no manual wheel zoom to avoid conflicts)
        
        // Touch support for mobile (only for 3D canvas, don't block UI taps)
        this.renderer.domElement.addEventListener('touchend', (event) => {
            const target = event.target;
            if (target && (target.closest('button') || target.closest('input') || target.closest('a'))) {
                return;
            }
            this.onMouseClick(event.changedTouches[0]);
        });
        
        // Navigation dots click functionality
        this.setupNavDots();
    }
    
    setupNavDots() {
        const navSteps = document.querySelectorAll('.nav-step');
        
        navSteps.forEach((step, index) => {
            step.addEventListener('click', () => {
                // Remove active class from all steps
                navSteps.forEach(s => s.classList.remove('active'));
                
                // Add active class to clicked step
                step.classList.add('active');
                
                // Show step slider for step 1
                if (index === 0) {
                    this.showStepSlider();
                } else {
                    this.hideStepSlider();
                }
                
                console.log(`Navigation step ${index + 1} clicked`);
            });
        });
        
        // Setup step slider functionality
        this.setupStepSlider();
        
        // Setup Step 2 interactions
        this.setupStep2Interactions();
        
        // Setup Step 3 interactions
        this.setupStep3Interactions();
    }
    
    showStepSlider() {
        const slider = document.getElementById('step-slider');
        const logo = document.querySelector('.top-logo');
        const stepRange = document.getElementById('step-range');
        
        slider.classList.remove('hidden');
        logo.classList.add('visible');
        
        // Explicitly remove image-selected class on initialization
        slider.classList.remove('image-selected');
        slider.classList.remove('design-selected');
        
        // Reset to step 1
        this.currentStep = 1;
        stepRange.value = 1;
        this.currentSliderValue = 1;
        this.targetSliderValue = 1;
        
        // Reset boundaries based on current step
        // Initial state: Step 1 at 70vw, Step 2 at 30vw, Steps 3-4 hidden
        this.boundaries = {
            '1-2': 70,   // Step 1: 70vw
            '2-3': 100,  // Step 2: 30vw (visible)
            '3-4': 100   // Step 3: 0vw (hidden), Step 4: 0vw (hidden)
        };
        
        // Initialize CSS variables
        document.documentElement.style.setProperty('--boundary-1-2', `${this.boundaries['1-2']}vw`);
        document.documentElement.style.setProperty('--boundary-2-3', `${this.boundaries['2-3']}vw`);
        document.documentElement.style.setProperty('--boundary-3-4', `${this.boundaries['3-4']}vw`);
        
        // Update canvas positions first
        this.updateCanvasPositions();
        
        // Update slider visibility
        this.updateSliderVisibility();

        // Sync Step 2 dragger state
        this.updateStep2Draggers();

        // Ensure active step class is applied for proper z-index
        this.updateActiveSlideClasses();
        
        // Check if an image is already selected (from HTML default)
        const selectedThumbnail = document.querySelector('.image-thumbnail.selected');
        if (selectedThumbnail) {
            // Show selected image in upload box
            const thumbnailImg = selectedThumbnail.querySelector('img');
            const uploadBox = document.querySelector('.upload-box');
            const uploadBoxImg = uploadBox ? uploadBox.querySelector('.selected-image') : null;
            if (uploadBox && uploadBoxImg && thumbnailImg) {
                uploadBoxImg.src = thumbnailImg.src;
                uploadBox.classList.add('has-image');
                uploadBoxImg.style.display = 'block';
            }
            
            this.imageSelected = true;
            this.enableSliderDragging();
            
            // Update Step 2 image with pre-selected image
            this.updateStep2Image(thumbnailImg.src);
        } else {
            this.imageSelected = false;
            this.sliderDragEnabled = false;
        }
        
        // Setup Step 2 interactions
        this.setupStep2Interactions();
        
        // Update slider color based on image selection state (after slider is visible)
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            this.updateSliderColor();
        }, 0);
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

        this.updateCanvasBlur();
    }

    updateCanvasBlur() {
        const maxBlur = 6; // px
        const minBlur = 2; // px - keep non-active steps slightly blurred
        const widths = {
            1: this.boundaries['1-2'],
            2: this.boundaries['2-3'] - this.boundaries['1-2'],
            3: this.boundaries['3-4'] - this.boundaries['2-3'],
            4: 100 - this.boundaries['3-4']
        };

        document.querySelectorAll('.step-slide').forEach((slide) => {
            const step = parseInt(slide.dataset.step);
            const width = Math.max(0, widths[step] || 0);
            const content = slide.querySelector('.canvas-content');

            if (!content) return;

            if (step === this.currentStep) {
                content.style.filter = 'none';
                return;
            }

            const ratio = Math.min(1, Math.max(0, width / 100));
            const blur = minBlur + (maxBlur - minBlur) * (1 - ratio);
            content.style.filter = `blur(${blur.toFixed(2)}px)`;
        });
    }
    
    hideStepSlider() {
        const slider = document.getElementById('step-slider');
        const logo = document.querySelector('.top-logo');
        slider.classList.add('hidden');
        logo.classList.remove('visible');
    }
    
    setupStepSlider() {
        const thumbnails = document.querySelectorAll('.image-thumbnail');
        const arrowButtons = document.querySelectorAll('.arrow-button');
        const uploadBox = document.querySelector('.upload-box');
        const stepRange = document.getElementById('step-range');
        this.currentStep = 1;
        
        // Handle thumbnail selection
        thumbnails.forEach(thumbnail => {
            thumbnail.addEventListener('click', () => {
                // Remove selected class from all thumbnails
                thumbnails.forEach(thumb => {
                    thumb.classList.remove('selected');
                    const indicator = thumb.querySelector('.selection-indicator');
                    if (indicator) indicator.remove();
                });
                
                // Add selected class to clicked thumbnail
                thumbnail.classList.add('selected');
                
                // Get the image source from the clicked thumbnail
                const thumbnailImg = thumbnail.querySelector('img');
                const imageSrc = thumbnailImg && thumbnailImg.src;
                const imageName = thumbnail.dataset.image;
                
                // Update the upload box to show the selected image
                const uploadBox = document.querySelector('.upload-box');
                const uploadBoxImg = uploadBox ? uploadBox.querySelector('.selected-image') : null;
                if (uploadBox && uploadBoxImg && imageSrc) {
                    uploadBoxImg.src = imageSrc;
                    uploadBox.classList.add('has-image');
                    uploadBoxImg.style.display = 'block'; // force visible in case of stale styles
                }
                
                // Enable dragging after image selection
                this.imageSelected = true;
                this.enableSliderDragging();
                this.updateSliderColor(); // Update slider to yellow
                
                // Update Step 2 image if it exists
                this.updateStep2Image(imageSrc);
                
                console.log(`Selected image: ${imageName}`);
            });
        });
        
        // Fallback delegated handler (in case thumbnails are re-rendered)
        const bottomImages = document.querySelector('.bottom-images');
        if (bottomImages) {
            bottomImages.addEventListener('click', (e) => {
                const item = e.target && e.target.closest('.image-thumbnail');
                if (!item) return;
                const img = item.querySelector('img');
                if (!img) return;
                const uploadBox = document.querySelector('.upload-box');
                const uploadBoxImg = uploadBox ? uploadBox.querySelector('.selected-image') : null;
                if (uploadBox && uploadBoxImg) {
                    uploadBoxImg.src = img.src;
                    uploadBox.classList.add('has-image');
                    uploadBoxImg.style.display = 'block';
                }
                
                // Enable dragging after image selection
                this.imageSelected = true;
                this.enableSliderDragging();
                this.updateSliderColor(); // Update slider to yellow
                
                // Update Step 2 image if it exists
                this.updateStep2Image(img.src);
            });
        }
        
        // Handle upload box click
        if (uploadBox) {
            uploadBox.addEventListener('click', () => {
                console.log('Upload box clicked - would open file picker');
            });
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
        
        // Setup will be done in enableSliderDragging() after image selection
        // Keep the old range input hidden for now
        stepRange.style.display = 'none';
        
        // Close slider with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideStepSlider();
            }
        });
    }
    
    enableSliderDragging() {
        // Only enable if image is selected and not already enabled
        if (!this.imageSelected || this.sliderDragEnabled) return;
        this.sliderDragEnabled = true;
        
        const stepSlider = document.querySelector('.step-slider');
        if (!stepSlider) return;
        
        // Get all dragger handles from all canvases
        const allHandles = document.querySelectorAll('.canvas-slider .progress-circle');
        
        let isDragging = false;
        let dragDirection = null; // 'left' or 'right'
        let startX = 0;
        let startBoundary = 0;
        let activeBoundary = null; // e.g., '1-2', '2-3', '3-4'
        
        // Disable transitions during drag
        const disableTransitions = () => {
            stepSlider.classList.add('no-transition');
        };
        
        // Re-enable transitions after drag
        const enableTransitions = () => {
            stepSlider.classList.remove('no-transition');
        };
        
        // Update boundary position based on drag with minimum width constraints
        const updateBoundary = (newPositionVw) => {
            if (!activeBoundary) return;
            
            const MIN_STEP_WIDTH = 15; // Minimum width for each step in vw
            
            // Calculate the current width of each step
            const step1Width = (activeBoundary === '1-2') ? newPositionVw : this.boundaries['1-2'];
            const step2Width = (activeBoundary === '2-3') ? 
                (newPositionVw - this.boundaries['1-2']) : 
                (activeBoundary === '1-2' ? 
                    (this.boundaries['2-3'] - newPositionVw) : 
                    (this.boundaries['2-3'] - this.boundaries['1-2']));
            const step3Width = (activeBoundary === '3-4') ? 
                (newPositionVw - this.boundaries['2-3']) : 
                (activeBoundary === '2-3' ? 
                    (this.boundaries['3-4'] - newPositionVw) : 
                    (this.boundaries['3-4'] - this.boundaries['2-3']));
            const step4Width = (activeBoundary === '3-4') ? 
                (100 - newPositionVw) : 
                (100 - this.boundaries['3-4']);
            
            // Apply constraints: no step can go below minimum width
            let clampedPosition = newPositionVw;
            
            if (activeBoundary === '1-2') {
                // Step 1 must be at least MIN_STEP_WIDTH
                if (step1Width < MIN_STEP_WIDTH) {
                    clampedPosition = MIN_STEP_WIDTH;
                }
                // Step 2 must be at least MIN_STEP_WIDTH (if Step 2 is visible, i.e., boundary 2-3 < 100)
                if (this.boundaries['2-3'] < 100 && (this.boundaries['2-3'] - clampedPosition) < MIN_STEP_WIDTH) {
                    clampedPosition = this.boundaries['2-3'] - MIN_STEP_WIDTH;
                }
                // Step 1 can expand up to 100vw (when other steps are hidden)
                clampedPosition = Math.max(MIN_STEP_WIDTH, Math.min(100, clampedPosition));
            } else if (activeBoundary === '2-3') {
                // Step 2 must be at least MIN_STEP_WIDTH
                if (step2Width < MIN_STEP_WIDTH) {
                    clampedPosition = this.boundaries['1-2'] + MIN_STEP_WIDTH;
                }
                // Step 3 must be at least MIN_STEP_WIDTH (if Step 3 is visible, i.e., boundary 3-4 < 100)
                if (this.boundaries['3-4'] < 100 && (this.boundaries['3-4'] - clampedPosition) < MIN_STEP_WIDTH) {
                    clampedPosition = this.boundaries['3-4'] - MIN_STEP_WIDTH;
                }
                // Boundary 2-3 must be between boundary 1-2 + MIN and 100
                clampedPosition = Math.max(this.boundaries['1-2'] + MIN_STEP_WIDTH, Math.min(100, clampedPosition));
            } else if (activeBoundary === '3-4') {
                // Step 3 must be at least MIN_STEP_WIDTH
                if (step3Width < MIN_STEP_WIDTH) {
                    clampedPosition = this.boundaries['2-3'] + MIN_STEP_WIDTH;
                }
                // Step 4 must be at least MIN_STEP_WIDTH
                if (step4Width < MIN_STEP_WIDTH) {
                    clampedPosition = 100 - MIN_STEP_WIDTH;
                }
                // Boundary 3-4 must be between boundary 2-3 + MIN and 100 - MIN
                clampedPosition = Math.max(this.boundaries['2-3'] + MIN_STEP_WIDTH, Math.min(100 - MIN_STEP_WIDTH, clampedPosition));
            }
            
            this.boundaries[activeBoundary] = clampedPosition;
            
            // Update canvas positions in real-time
            this.updateCanvasPositions();
            this.updateSliderVisibility();
        };
        
        // Start drag handler - works for both left and right handles
        const startDrag = (e) => {
            if (!this.imageSelected) return;
            
            const handle = e.target.closest('.progress-circle');
            if (!handle) return;
            
            const canvasSlider = handle.closest('.canvas-slider');
            if (!canvasSlider) return;
            
            const canvas = canvasSlider.closest('.step-slide');
            if (!canvas) return;
            
            const canvasStep = parseInt(canvas.dataset.step);
            dragDirection = canvasSlider.dataset.direction; // 'left' or 'right'
            
            // Determine which boundary we're dragging based on canvas and direction
            if (dragDirection === 'right') {
                // Dragging right from current canvas
                if (canvasStep === 1) {
                    activeBoundary = '1-2';
                } else if (canvasStep === 2) {
                    activeBoundary = '2-3';
                } else if (canvasStep === 3) {
                    activeBoundary = '3-4';
                }
            } else if (dragDirection === 'left') {
                // Dragging left from current canvas
                if (canvasStep === 2) {
                    activeBoundary = '1-2';
                } else if (canvasStep === 3) {
                    activeBoundary = '2-3';
                } else if (canvasStep === 4) {
                    activeBoundary = '3-4';
                }
            }
            
            if (!activeBoundary) return; // Invalid drag
            
            isDragging = true;
            this.isUserSliding = true;
            e.preventDefault();
            e.stopPropagation();
            
            startX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            startBoundary = this.boundaries[activeBoundary];
            
            disableTransitions();
            
            handle.style.cursor = 'grabbing';
            document.body.style.cursor = 'grabbing';
        };
        
        // Mouse move during drag
        const moveDrag = (e) => {
            if (!isDragging || !this.imageSelected) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            const currentX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            const deltaX = currentX - startX;
            const deltaVw = (deltaX / window.innerWidth) * 100;
            
            // Calculate desired position
            let newPosition = startBoundary + deltaVw;
            
            // Apply constraints through updateBoundary
            updateBoundary(newPosition);
        };
        
        // Mouse up - end drag
        const endDrag = (e) => {
            if (!isDragging) return;
            
            isDragging = false;
            dragDirection = null;
            activeBoundary = null;
            this.isUserSliding = false;
            
            enableTransitions();
            
            // Update current step based on boundary positions
            this.updateCurrentStepFromBoundaries();
            
            // Update slider visibility
            this.updateSliderVisibility();
            
            // If Step 3 is now visible and we have a selected design option, update images
            if (this.currentStep === 3 && this.selectedDesignOption) {
                this.updateStep3Images(this.selectedDesignOption);
            }
            
            // Reset cursors
            allHandles.forEach(handle => {
                handle.style.cursor = 'grab';
            });
            document.body.style.cursor = '';
        };
        
        // Attach event listeners to all handles
        allHandles.forEach(handle => {
            handle.style.cursor = 'grab';
            handle.addEventListener('pointerdown', startDrag);
            handle.addEventListener('touchstart', startDrag, { passive: false });
        });
        
        // Use document for move/up to handle mouse leaving element
        document.addEventListener('pointermove', moveDrag);
        document.addEventListener('pointerup', endDrag);
        document.addEventListener('touchmove', moveDrag, { passive: false });
        document.addEventListener('touchend', endDrag);
    }
    
    updateCurrentStepFromBoundaries() {
        // Determine current step based on which canvas is widest
        // Use threshold to prevent switching too early
        const threshold = 10; // Only switch when a canvas is clearly dominant (10vw threshold)
        
        const step1Width = this.boundaries['1-2'];
        const step2Width = this.boundaries['2-3'] - this.boundaries['1-2'];
        const step3Width = this.boundaries['3-4'] - this.boundaries['2-3'];
        const step4Width = 100 - this.boundaries['3-4'];
        
        // Determine current step based on widest canvas
        let newStep = this.currentStep; // Default to current step to prevent flickering
        const widths = [step1Width, step2Width, step3Width, step4Width];
        const maxWidth = Math.max(...widths);
        if (maxWidth > threshold) {
            const maxIndex = widths.indexOf(maxWidth);
            newStep = maxIndex + 1;
        }
        
        // Only update if step actually changed (prevents unnecessary updates)
        if (newStep !== this.currentStep) {
            this.currentStep = newStep;
            
            // If Step 3 is now visible, ensure images are loaded
            if (newStep === 3) {
                // Use selected design option or default to option 1
                const optionToLoad = this.selectedDesignOption || 1;
                this.updateStep3Images(optionToLoad);
            }
            
            // Update step indicator
            const stepNumEl = document.getElementById('step-top-left-number');
            const stepTitleEl = document.getElementById('step-top-left-title');
            if (stepNumEl && stepTitleEl) {
                stepNumEl.textContent = String(this.currentStep);
                const titles = {
                    1: 'Select Image',
                    2: 'Design Prompt',
                    3: 'Choose Design',
                    4: 'Get it ready'
                };
                stepTitleEl.textContent = titles[this.currentStep] || '';
            }

            const topLeft = document.querySelector('.step-top-left');
            if (topLeft) {
                topLeft.style.display = this.currentStep === 1 ? 'flex' : 'none';
            }
        }

        if (!this.isUserSliding) {
            this.applyStepComposition();
        }

        this.updateActiveSlideClasses();
    }

    updateActiveSlideClasses() {
        const slides = document.querySelectorAll('.step-slide');
        slides.forEach((slide) => {
            const step = parseInt(slide.dataset.step);
            if (step === this.currentStep) {
                slide.classList.add('is-current-step');
            } else {
                slide.classList.remove('is-current-step');
            }
        });
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
    
    updateStep2Image(imageSrc) {
        // Update the Step 2 image display with the selected image from Step 1
        const step2Image = document.getElementById('step-2-selected-image');
        if (step2Image) {
            if (imageSrc && imageSrc.trim() !== '') {
                step2Image.src = imageSrc;
                step2Image.style.display = 'block';
                console.log('Step 2 image updated:', imageSrc);
            } else {
                step2Image.style.display = 'none';
            }
        }
    }
    
    setupStep2Interactions() {
        // Handle design option clicks
        const options = document.querySelectorAll('.step-2-option');
        const designInput = document.getElementById('design-input');
        
        options.forEach((option, index) => {
            option.addEventListener('click', () => {
                // Remove selected class from all options
                options.forEach(opt => opt.classList.remove('selected'));
                
                // Add selected class to clicked option
                option.classList.add('selected');
                
                // Update input field with selected option text
                if (designInput) {
                    const optionText = option.dataset.option || option.textContent.trim();
                    designInput.value = optionText;
                }
                
                // Store selected design option (1, 2, or 3)
                this.selectedDesignOption = index + 1;
                console.log(`Selected design option: ${this.selectedDesignOption}`);
                
                // Update Step 3 images when option is selected
                this.updateStep3Images(this.selectedDesignOption);
                this.updateStep2Draggers();
            });
        });
        
        // Handle arrow button click (if needed for future functionality)
        const arrowButton = document.getElementById('design-arrow-btn');
        if (arrowButton) {
            arrowButton.addEventListener('click', () => {
                console.log('Design arrow button clicked');
                // Add functionality here if needed
            });
        }
    }

    updateStep2Draggers() {
        const slider = document.getElementById('step-slider');
        if (!slider) return;
        if (this.selectedDesignOption) {
            slider.classList.add('design-selected');
        } else {
            slider.classList.remove('design-selected');
        }
    }
    
    updateStep3Images(optionNumber) {
        // optionNumber: 1, 2, or 3
        const imageSet = {
            1: ['Assets/op1_1.png', 'Assets/op1_2.png', 'Assets/op1_3.png'],
            2: ['Assets/op2_1.png', 'Assets/op2_2.png', 'Assets/op2_3.png'],
            3: ['Assets/op3_1.png', 'Assets/op3_2.jpg', 'Assets/op3_3.png']
        };
        
        const images = imageSet[optionNumber];
        if (!images) {
            console.warn(`No image set found for option ${optionNumber}`);
            return;
        }
        
        const optionElements = document.querySelectorAll('.step-3-option');
        console.log(`Updating Step 3 images for option ${optionNumber}, found ${optionElements.length} option elements`);
        
        if (optionElements.length >= 3) {
            // Top thumbnail (index 0)
            const topImg = optionElements[0].querySelector('.step-3-option-img');
            if (topImg) {
                topImg.src = images[0];
                topImg.style.display = 'block';
                console.log(`Set top image: ${images[0]}`);
            }
            
            // Main/center image (index 1)
            const mainImg = optionElements[1].querySelector('.step-3-option-img');
            if (mainImg) {
                mainImg.src = images[1];
                mainImg.style.display = 'block';
                console.log(`Set main image: ${images[1]}`);
            }
            
            // Bottom thumbnail (index 2)
            const bottomImg = optionElements[2].querySelector('.step-3-option-img');
            if (bottomImg) {
                bottomImg.src = images[2];
                bottomImg.style.display = 'block';
                console.log(`Set bottom image: ${images[2]}`);
            }
        } else {
            console.warn(`Expected 3 option elements, found ${optionElements.length}`);
        }
        
        // Auto-scroll to center image
        const optionsContainer = document.getElementById('step-3-options');
        const mainOption = document.querySelector('.step-3-main');
        if (optionsContainer && mainOption) {
            setTimeout(() => {
                mainOption.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        }
    }
    
    setupStep3Interactions() {
        // Handle arrow click to finalize design and go to Step 4
        const finalizeArrow = document.getElementById('step-3-finalize-arrow');
        if (finalizeArrow) {
            finalizeArrow.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Move boundaries to reveal Step 4
                // Step 4 should take up the full viewport
                this.boundaries['3-4'] = 0; // Step 4 starts at 0vw
                this.boundaries['2-3'] = 0; // Step 3 ends at 0vw (hidden)
                this.boundaries['1-2'] = 0; // Step 2 ends at 0vw (hidden)
                
                // Update canvas positions
                this.updateCanvasPositions();
                this.updateSliderVisibility();
                
                // Update current step
                this.currentStep = 4;
                this.updateCurrentStepFromBoundaries();
                
                console.log('Finalized design, moved to Step 4');
            });
        }
        
        // Handle thumbnail clicks to switch main image (optional enhancement)
        const thumbnails = document.querySelectorAll('.step-3-thumbnail');
        const mainOption = document.querySelector('.step-3-main');
        
        thumbnails.forEach(thumbnail => {
            thumbnail.addEventListener('click', () => {
                const thumbnailImg = thumbnail.querySelector('.step-3-option-img');
                const mainImg = mainOption ? mainOption.querySelector('.step-3-option-img') : null;
                
                if (thumbnailImg && mainImg) {
                    // Swap images
                    const tempSrc = mainImg.src;
                    mainImg.src = thumbnailImg.src;
                    thumbnailImg.src = tempSrc;
                    
                    // Scroll to main image
                    if (mainOption) {
                        mainOption.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
                }
            });
        });
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
            // Full user control while dragging
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
        // Update top-left step indicator
        const stepNumEl = document.getElementById('step-top-left-number');
        const stepTitleEl = document.getElementById('step-top-left-title');
        if (stepNumEl && stepTitleEl) {
            stepNumEl.textContent = String(activeStep);
            const titles = {
                1: 'Select Image',
                2: 'Design Prompt',
                3: 'Choose Design',
                4: 'Get it ready'
            };
            stepTitleEl.textContent = titles[activeStep] || '';
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
            if (activeStep === 1) {
                // Step 1: Left canvas white, right canvas black
                stepSlider.style.setProperty('--left-canvas-bg', '#ffffff');
                stepSlider.style.setProperty('--right-canvas-bg', '#000000');
            } else if (activeStep === 2) {
                // Step 2: Both canvases white
                stepSlider.style.setProperty('--left-canvas-bg', '#ffffff');
                stepSlider.style.setProperty('--right-canvas-bg', '#ffffff');
            } else {
                // Steps 3-4: Both canvases white
                stepSlider.style.setProperty('--left-canvas-bg', '#ffffff');
                stepSlider.style.setProperty('--right-canvas-bg', '#ffffff');
            }
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

        if (!this.isLoading) {
            const elapsed = this.clock.getElapsedTime();

            this.modelPivots.forEach((pivot) => {
                const baseYaw = pivot.userData.baseYaw ?? HERO_PIVOT_ROT_Y_BASE;
                const spin0 = pivot.userData.spinStartRad ?? 0;
                const baseY = pivot.userData.baseY ?? HERO_ARRANGEMENT_Y_OFFSET;
                pivot.rotation.x = HERO_PIVOT_ROT_X;
                pivot.rotation.y = baseYaw + spin0 + elapsed * HERO_SPIN_RAD_PER_SEC;
                pivot.position.set(
                    pivot.userData.baseX ?? 0,
                    baseY + Math.sin(elapsed * 0.8) * 0.03,
                    pivot.userData.baseZ ?? 0
                );
                pivot.rotation.z = 0;
            });

            if (this.controls && this.models.length > 0) {
                this.controls.target.copy(VIEW_CAMERA_LOOK_AT);
            }

            if (typeof TWEEN !== 'undefined' && TWEEN.update) TWEEN.update();
            if (this.controls) this.controls.update();
            this.updateHoverFromPointer();
        }

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
}

window.addEventListener('load', () => {
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
        const notice = document.getElementById('model-load-notice');
        if (notice) {
            notice.textContent =
                (err && err.message) ||
                'Could not start the app. Use a local server (e.g. python -m http.server), check the console, and ensure CDN scripts are not blocked.';
            notice.classList.remove('hidden');
        }
    }
}); 