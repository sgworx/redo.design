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
        
        // Motion and interaction state
        this.clock = new THREE.Clock();
        this.pointer = new THREE.Vector2(0, 0); // normalized device coords
        this.parallaxStrength = 0.15; // Subtle parallax like BAM Works
        this.pointerActive = false;
        this.hoveredModel = null;
        this.intersectTargets = [];
        
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
        
        this.modelFiles = [
            'Assets/1.glb',
            'Assets/2.glb',
            'Assets/3.glb',
            'Assets/4.glb',
            'Assets/5.glb'
        ];
        
        this.init();
        this.setupEventListeners();
    }
    
    init() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff);
        
        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(-42, 42, 95); // Rotate further left, same scale
        this.camera.lookAt(0, 0, 0);
        
        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        document.getElementById('container').appendChild(this.renderer.domElement);
        
        // Create controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.enableZoom = true;
        this.controls.enablePan = false;
        this.controls.autoRotate = true; // Enable auto-rotation
        this.controls.autoRotateSpeed = 0.1; // Very subtle rotation like BAM Works
        this.controls.target.set(0, 0, 0);
        this.controls.update();
        
        // Setup raycaster for object selection
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Add lighting
        this.setupLighting();
        
        // Load models
        this.loadModels();
        
        // Start animation loop
        this.animate();
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
        
        // Point light for better illumination
        const pointLight = new THREE.PointLight(0xffffff, 0.5);
        pointLight.position.set(-10, -10, -5);
        this.scene.add(pointLight);
    }
    
    async loadModels() {
        const loader = new THREE.GLTFLoader();
        console.log(`Starting to load ${this.modelFiles.length} models:`, this.modelFiles);
        
        for (let i = 0; i < this.modelFiles.length; i++) {
            try {
                console.log(`[${i}] Loading model: ${this.modelFiles[i]}`);
                const gltf = await this.loadModel(loader, this.modelFiles[i]);
                this.models.push(gltf);
                
                const model = gltf.scene;
                console.log(`[${i}] Model loaded, adding to scene`);
                this.scene.add(model);
                
                console.log(`[${i}] Position before positioning:`, model.position.toArray());
                
                // Position FIRST, then scale
                this.positionModelCloud(model, i);
                console.log(`[${i}] Position after cloud positioning:`, model.position.toArray());
                
                this.centerAndScaleModel(model);
                console.log(`[${i}] Position after scaling:`, model.position.toArray());
                
                this.enableShadows(model);
                this.setModelToGrayscale(model);
                this.intersectTargets.push(model);
                
                this.addFloatingOrbitAnimation(model, i);
                
                // Store original position for reset
                this.originalPositions.push({
                    x: model.position.x,
                    y: model.position.y,
                    z: model.position.z,
                    scale: model.scale.clone()
                });
                
                console.log(`[${i}] Successfully loaded and positioned model: ${this.modelFiles[i]}`);
            } catch (error) {
                console.error(`[${i}] Error loading model ${this.modelFiles[i]}:`, error);
                console.log(`[${i}] Skipping model due to loading error`);
            }
        }
        
        console.log(`Total models in scene: ${this.models.length}`);
        console.log(`Total objects in Three.js scene: ${this.scene.children.length}`);
        
        // Hide loading screen
        setTimeout(() => {
            document.getElementById('loading-screen').classList.add('hidden');
            this.isLoading = false;
            console.log(`Loaded ${this.models.length} models successfully`);
            console.log('Model positions:', this.models.map((m, i) => `Model ${i}: (${m.scene.position.x.toFixed(2)}, ${m.scene.position.y.toFixed(2)}, ${m.scene.position.z.toFixed(2)})`));
            
            // Verify separation
            if (this.models.length > 1) {
                const pos1 = this.models[0].scene.position;
                const pos2 = this.models[1].scene.position;
                const distance = pos1.distanceTo(pos2);
                console.log(`Distance between first two models: ${distance.toFixed(2)} units`);
            }
        }, 1000);
    }
    
    positionModelCloud(model, index) {
        // Simple test: place models in a clear pattern to verify they're separating
        const spacing = 20;
        const angle = (index / this.modelFiles.length) * Math.PI * 2;
        const x = Math.cos(angle) * spacing;
        const z = Math.sin(angle) * spacing;
        const y = (index - 2) * 5; // Vertical offset for visibility
        
        const position = new THREE.Vector3(x, y, z);
        model.position.add(position);
        
        console.log(`Model ${index} positioned at:`, model.position.toArray());
    }
    
    isTooClose(newPosition, minDistance) {
        if (!this.modelPositions) return false;
        
        return this.modelPositions.some(existing => 
            existing.distanceTo(newPosition) < minDistance
        );
    }
    
    loadModel(loader, url) {
        return new Promise((resolve, reject) => {
            loader.load(
                url,
                (gltf) => {
                    resolve(gltf);
                },
                (progress) => {
                    console.log(`Loading progress: ${(progress.loaded / progress.total * 100).toFixed(2)}%`);
                },
                (error) => {
                    reject(error);
                }
            );
        });
    }
    
    centerAndScaleModel(model) {
        // First, position the model in the cloud BEFORE centering
        // This way centering won't override our positioning
        
        // Scale to fit in view - significantly larger scale
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 10.0 / maxDim;
        model.scale.setScalar(scale);
        
        // DON'T center the model - let it keep its position
        console.log("Skipping centering to preserve position");
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
                this.hoveredModel = null;
            }
            return;
        }

        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersects = this.raycaster.intersectObjects(this.intersectTargets, true);

        let nextHovered = null;
        if (intersects.length > 0) {
            let current = intersects[0].object;
            while (current.parent && current.parent !== this.scene) {
                current = current.parent;
            }
            if (this.intersectTargets.includes(current)) {
                nextHovered = current;
            }
        }

        if (nextHovered !== this.hoveredModel) {
            if (this.hoveredModel) {
                this.setModelToGrayscale(this.hoveredModel);
            }
            if (nextHovered) {
                this.restoreModelColor(nextHovered);
            }
            this.hoveredModel = nextHovered;
        }
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
    
    addFloatingOrbitAnimation(model, index) {
        // BAM Works style: very slow, gentle orbital motion
        model.userData.motion = {
            baseOffset: model.position.clone(),
            amplitude: new THREE.Vector3(
                0.3 + Math.random() * 0.4, // Much smaller amplitude
                0.3 + Math.random() * 0.4,
                0.2 + Math.random() * 0.3
            ),
            speed: new THREE.Vector3(
                0.08 + Math.random() * 0.06, // Much slower speeds
                0.07 + Math.random() * 0.06,
                0.06 + Math.random() * 0.05
            ),
            phase: new THREE.Vector3(
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2
            ),
            rotSpeed: new THREE.Vector3(
                0.02 + Math.random() * 0.03, // Very slow rotation
                0.02 + Math.random() * 0.03,
                0.015 + Math.random() * 0.025
            )
        };
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
            // Find which model was clicked
            let clickedModel = null;
            for (let intersect of intersects) {
                // Traverse up the parent chain to find the root model
                let current = intersect.object;
                while (current.parent && current.parent !== this.scene) {
                    current = current.parent;
                }
                
                // Check if this is one of our loaded models
                for (let modelData of this.models) {
                    if (modelData.scene === current) {
                        clickedModel = current;
                        break;
                    }
                }
                if (clickedModel) break;
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
            const original = this.originalPositions[index];
            
            if (original) {
                // Reset position and scale
                model.position.set(original.x, original.y, original.z);
                model.scale.copy(original.scale);
            }
        });
    }
    
    animateModelFocus(model) {
        // Create a focus animation for the selected model
        const targetScale = 1.5;
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
        
        // Pointer move for parallax
        window.addEventListener('mousemove', (event) => {
            this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
            this.pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
            this.pointerActive = true;
        });

        window.addEventListener('mouseleave', () => {
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
        
        // Touch support for mobile
        window.addEventListener('touchend', (event) => {
            event.preventDefault();
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
        
        // Reset to step 1
        this.currentStep = 1;
        stepRange.value = 1;
        this.currentSliderValue = 1;
        this.targetSliderValue = 1;
        
        // Reset boundaries based on current step
        // Each step maintains minimum 30vw width
        // Initial state: Step 1 visible, others hidden (Step 1 at 100vw)
        this.boundaries = {
            '1-2': 100,  // Step 1: 100vw (fully visible)
            '2-3': 100,  // Step 2: 0vw (hidden)
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
        
        // Show sliders based on which canvases are visible (have width > 0)
        // Step 1: Show right slider if Step 1 canvas is visible
        if (step1) {
            const step1Width = this.boundaries['1-2'];
            if (step1Width > 0) {
                const rightSlider = step1.querySelector('.slider-right');
                if (rightSlider) {
                    rightSlider.style.display = 'block';
                }
            }
        }
        
        // Step 2: Show sliders if Step 2 canvas is visible
        if (step2) {
            const step2Width = this.boundaries['2-3'] - this.boundaries['1-2'];
            if (step2Width > 0) {
                const leftSlider = step2.querySelector('.slider-left');
                const rightSlider = step2.querySelector('.slider-right');
                if (leftSlider) {
                    leftSlider.style.display = 'block';
                }
                if (rightSlider) {
                    rightSlider.style.display = 'block';
                }
            }
        }
        
        // Step 3: Show sliders if Step 3 canvas is visible
        if (step3) {
            const step3Width = this.boundaries['3-4'] - this.boundaries['2-3'];
            if (step3Width > 0) {
                const leftSlider = step3.querySelector('.slider-left');
                const rightSlider = step3.querySelector('.slider-right');
                if (leftSlider) {
                    leftSlider.style.display = 'block';
                }
                if (rightSlider) {
                    rightSlider.style.display = 'block';
                }
            }
        }
        
        // Step 4: Show left slider if Step 4 canvas is visible
        if (step4) {
            const step4Width = 100 - this.boundaries['3-4'];
            if (step4Width > 0) {
                const leftSlider = step4.querySelector('.slider-left');
                if (leftSlider) {
                    leftSlider.style.display = 'block';
                }
            }
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
                const indicator = document.createElement('div');
                indicator.className = 'selection-indicator';
                indicator.textContent = 'A';
                thumbnail.appendChild(indicator);
                
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
        // Determine current step based on which canvas is leftmost and has significant width
        // Use threshold to prevent switching too early
        const threshold = 10; // Only switch when a canvas is clearly dominant (10vw threshold)
        
        const step1Width = this.boundaries['1-2'];
        const step2Width = this.boundaries['2-3'] - this.boundaries['1-2'];
        const step3Width = this.boundaries['3-4'] - this.boundaries['2-3'];
        const step4Width = 100 - this.boundaries['3-4'];
        
        // Determine current step based on leftmost canvas with significant width
        // Step 1 always starts at 0, so if it has width > threshold, it's current
        let newStep = this.currentStep; // Default to current step to prevent flickering
        
        if (step1Width > threshold) {
            // Step 1 is visible and significant
            newStep = 1;
        } else if (step1Width <= threshold && step2Width > threshold) {
            // Step 1 is mostly hidden, Step 2 is visible
            newStep = 2;
        } else if (step2Width <= threshold && step3Width > threshold) {
            // Step 2 is mostly hidden, Step 3 is visible
            newStep = 3;
        } else if (step3Width <= threshold && step4Width > threshold) {
            // Step 3 is mostly hidden, Step 4 is visible
            newStep = 4;
        } else {
            // Fallback: use the widest canvas
            const widths = [step1Width, step2Width, step3Width, step4Width];
            const maxIndex = widths.indexOf(Math.max(...widths));
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
        }
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
    
    updateStep3Images(optionNumber) {
        // optionNumber: 1, 2, or 3
        const imageSet = {
            1: ['Assets/op1_1.png', 'Assets/op1_2.png', 'Assets/op1_3.png'],
            2: ['Assets/op2_1.png', 'Assets/op2_2.png', 'Assets/op2_3.png'],
            3: ['Assets/op3_1.png', 'Assets/op3_2.png', 'Assets/op3_3.png']
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
            const parallaxX = this.pointer.x * this.parallaxStrength;
            const parallaxY = -this.pointer.y * this.parallaxStrength;
            // Update floating orbit motion for all models
            this.models.forEach((modelData) => {
                const model = modelData.scene;
                const motion = model.userData.motion;
                if (!model || !motion) return;
                model.position.x = motion.baseOffset.x + Math.sin(elapsed * motion.speed.x + motion.phase.x) * motion.amplitude.x + parallaxX;
                model.position.y = motion.baseOffset.y + Math.cos(elapsed * motion.speed.y + motion.phase.y) * motion.amplitude.y + parallaxY;
                model.position.z = motion.baseOffset.z + Math.sin(elapsed * motion.speed.z + motion.phase.z) * motion.amplitude.z;
                
                model.rotation.x += 0.002 * motion.rotSpeed.x;
                model.rotation.y += 0.002 * motion.rotSpeed.y;
                model.rotation.z += 0.0015 * motion.rotSpeed.z;
            });
            
            // Update TWEEN animations
            TWEEN.update();
            
            // Update controls
            this.controls.update();

            // Update hover highlight
            this.updateHoverFromPointer();
            
            // Render
            this.renderer.render(this.scene, this.camera);
        }
    }
}

// Initialize the scene when the page loads
window.addEventListener('load', () => {
    window.scene3D = new Scene3D(); // Make it globally accessible
}); 