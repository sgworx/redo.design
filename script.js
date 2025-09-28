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
        
        // Slider smoothing state
        this.currentSliderValue = 1; // smoothed value
        this.targetSliderValue = 1; // target value from input
        this.sliderAnimating = false;
        this.isUserSliding = false; // true while user holds the slider
        
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
        this.camera.position.set(0, 0, 20); // Camera pulled back even further for extremely wide layout
        
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
    }
    
    showStepSlider() {
        const slider = document.getElementById('step-slider');
        const logo = document.querySelector('.top-logo');
        const stepRange = document.getElementById('step-range');
        
        slider.classList.remove('hidden');
        logo.classList.add('visible');
        
        // Reset to step 1 and update progress line
        this.currentStep = 1;
        stepRange.value = 1;
        this.currentSliderValue = 1;
        this.targetSliderValue = 1;
        this.applySliderVisuals(1);
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
                const uploadBoxImg = uploadBox ? uploadBox.querySelector('img') : null;
                if (uploadBox && uploadBoxImg && imageSrc) {
                    uploadBoxImg.src = imageSrc;
                    uploadBox.classList.add('has-image');
                    uploadBoxImg.style.display = 'block'; // force visible in case of stale styles
                }
                
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
                const uploadBoxImg = uploadBox ? uploadBox.querySelector('img') : null;
                if (uploadBox && uploadBoxImg) {
                    uploadBoxImg.src = img.src;
                    uploadBox.classList.add('has-image');
                    uploadBoxImg.style.display = 'block';
                }
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
        
        // Custom precise dragging: prevent native jump-on-click
        stepRange.style.touchAction = 'none';
        this.dragStartX = 0;
        
        const startDrag = (e) => {
            this.isUserSliding = true;
            e.preventDefault();
            this.dragStartX = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
            // Do not update on simple click; wait for move
        };
        const moveDrag = (e) => {
            if (!this.isUserSliding) return;
            e.preventDefault();
            this._updateFromPointer(e, stepRange, false); // update visuals without snapping slides
        };
        const endDrag = (e) => {
            if (!this.isUserSliding) return;
            this.isUserSliding = false;
            // Snap to nearest step on release
            const finalStep = Math.round(this.currentSliderValue || 1);
            this.slideToStep(finalStep);
        };
        stepRange.addEventListener('pointerdown', startDrag);
        document.addEventListener('pointermove', moveDrag);
        document.addEventListener('pointerup', endDrag);
        // Support touch events
        stepRange.addEventListener('touchstart', startDrag, { passive: false });
        document.addEventListener('touchmove', moveDrag, { passive: false });
        document.addEventListener('touchend', endDrag, { passive: true });
        
        // Remove native input handling (we manage it ourselves)
        
        // Also handle change event for final positioning (fallback)
        stepRange.addEventListener('change', (e) => {
            const newStep = Math.round(parseFloat(e.target.value));
            this.slideToStep(newStep);
        });
        
        // Close slider with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideStepSlider();
            }
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
            
            // Render
            this.renderer.render(this.scene, this.camera);
        }
    }
}

// Initialize the scene when the page loads
window.addEventListener('load', () => {
    window.scene3D = new Scene3D(); // Make it globally accessible
}); 