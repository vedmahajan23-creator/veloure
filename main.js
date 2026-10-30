import { isSupabaseConfigured, supabase } from "./supabase.js";

(() => {
      "use strict";

      const categories = ["Everything","Little memories","Soft & botanical","For your people"];
      const state = {
        templates: [],
        category: "Everything",
        query: "",
        currentTemplate: null,
        activeSlot: 0,
        photos: [],
        photoAdjustments: [],
        draggingPhoto: null,
        draftFile: null,
        draftImageUrl: null,
        draftImage: null,
        draftImageSize: null,
        draftSlots: [],
        selectedDraftSlot: -1,
        drawingSlot: null,
        user: null,
        noticeTimer: null
      };
      const $ = (selector, root = document) => root.querySelector(selector);
      const grid = $("#template-grid");
      let galleryObserver = null;

      async function loadTemplates() {
        try {
          if (!supabase) throw new Error("Supabase is not configured. Add the project URL and publishable key.");
          let query = supabase.from("templates").select("*").order("created_at", {ascending:false});
          if (!isAdmin()) query = query.eq("published", true);
          const {data, error} = await query;
          if (error) throw error;
          return (data || []).map(template => {
            const {data: {publicUrl}} = supabase.storage
              .from("template-artwork")
              .getPublicUrl(template.image_path);
            return {
              ...template,
              imageWidth:template.image_width,
              imageHeight:template.image_height,
              templateImageUrl:publicUrl
            };
          });
        } catch (error) {
          console.error("Could not load templates from Supabase.", error);
          showNotice(`Couldn't load the template gallery: ${error.message}`);
          return [];
        }
      }

      function isAdmin(user = state.user) {
        return user?.app_metadata?.is_admin === true || user?.app_metadata?.is_admin === "true";
      }

      function configuredTemplateError() {
        return "Supabase isn't configured yet. Add the project URL and publishable key, then rebuild the site.";
      }

      function isValidSlot(area) {
        return area
          && ["x","y","width","height"].every(key => Number.isFinite(area[key]))
          && area.x >= 0 && area.y >= 0
          && area.width > 0 && area.height > 0
          && area.x + area.width <= 1
          && area.y + area.height <= 1;
      }

      function validateTemplate(template) {
        return template
          && typeof template.id === "string"
          && typeof template.title === "string"
          && typeof template.image_path === "string"
          && Number.isFinite(template.image_width)
          && Number.isFinite(template.image_height)
          && Array.isArray(template.slots)
          && template.slots.length > 0
          && template.slots.length <= 8
          && template.slots.every(isValidSlot);
      }

      async function refreshTemplates() {
        state.templates = (await loadTemplates()).filter(validateTemplate);
        renderGallery();
      }

      async function signInAdmin(username, password) {
        if (!supabase) throw new Error(configuredTemplateError());
        const {data, error} = await supabase.auth.signInWithPassword({email:username.trim(), password});
        if (error) throw error;
        if (!isAdmin(data.user)) {
          await supabase.auth.signOut();
          throw new Error("This account does not have studio administrator access.");
        }
        state.user = data.user;
        await refreshTemplates();
      }

      async function signOutAdmin() {
        if (!supabase) return;
        const {error} = await supabase.auth.signOut();
        if (error) throw error;
        state.user = null;
        state.templates = await loadTemplates();
        renderGallery();
      }

      async function deleteTemplateRecord(template) {
        if (!supabase || !isAdmin()) throw new Error("Studio administrator access is required.");
        const {error} = await supabase.from("templates").delete().eq("id", template.id);
        if (error) throw error;
        const {error:storageError} = await supabase.storage
          .from("template-artwork")
          .remove([template.image_path]);
        if (storageError) {
          console.error("Template was deleted, but its artwork could not be removed.", storageError);
          return storageError;
        }
        return null;
      }

      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
      }

      function renderCategories() {
        const row = $("#category-row");
        row.innerHTML = categories.map(category => `<button class="category-chip${category === state.category ? " active" : ""}" type="button" aria-pressed="${category === state.category}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("");
      }

      function visibleTemplates() {
        const query = state.query.trim().toLowerCase();
        return state.templates.filter(item => (state.category === "Everything" || item.category === state.category)
          && (!query || `${item.title} ${item.category}`.toLowerCase().includes(query)));
      }

      function slotMarkup(template, slot, photos, isEditor) {
        const uploaded = photos && photos[slot];
        const activeClass = isEditor && state.activeSlot === slot ? " active-slot" : "";
        const alt = `Photo ${slot + 1} for ${template.title}`;
        const area = template.slots[slot];
        const position = `left:${area.x * 100}%;top:${area.y * 100}%;width:${area.width * 100}%;height:${area.height * 100}%`;
        return `<div class="photo-slot custom-photo-slot${activeClass}" style="${position}" data-slot="${slot}" role="${isEditor ? "button" : "presentation"}"${isEditor ? ` tabindex="0" aria-label="Choose photo frame ${slot + 1}"` : ""}>${uploaded
          ? `<img src="${uploaded}" alt="${alt}">`
          : `<span class="slot-inner"><span class="plus">+</span><span>${isEditor ? "Add your photo" : "ADD+"}</span></span>`}</div>`;
      }

      function artMarkup(template, photos = [], isEditor = false) {
        return `<img class="template-artwork" src="${escapeHtml(template.templateImageUrl)}" alt="${escapeHtml(template.title)} template artwork">
          ${template.slots.map((_, index) => slotMarkup(template, index, photos, isEditor)).join("")}`;
      }

      function renderGallery() {
        if (galleryObserver) galleryObserver.disconnect();
        const visible = visibleTemplates();
        grid.classList.toggle("few-templates", visible.length > 0 && visible.length <= 3);
        $("#result-count").textContent = `${visible.length} little ${visible.length === 1 ? "find" : "finds"}`;
        if (!visible.length) {
          const noTemplates = state.templates.length === 0;
          const emptyCopy = !isSupabaseConfigured
            ? "Our shared collection is getting ready. Please visit again soon."
            : !noTemplates ? "Try another search or choose a different feeling."
            : "Our studio is getting the first templates ready. Check back soon.";
          grid.innerHTML = `<div class="empty-state${noTemplates ? " is-empty" : ""}">
            ${noTemplates ? `<div class="empty-art" aria-hidden="true">
              <span class="empty-orbit orbit-one"></span><span class="empty-orbit orbit-two"></span>
              <span class="empty-confetti confetti-one">✦</span><span class="empty-confetti confetti-two">✧</span>
              <span class="empty-polaroid polaroid-back"></span>
              <span class="empty-polaroid polaroid-front"><span class="empty-photo-mark">♡</span></span>
              <span class="empty-sticker">YOUR<br>STORY</span>
            </div>` : ""}
            <div class="empty-copy"><span class="empty-eyebrow">${noTemplates ? "A little something is on its way" : "Try another little mood"}</span>
              <h3>${noTemplates ? "The first page is yours to make." : "Nothing in this frame just yet."}</h3>
              <p>${emptyCopy}</p>
              ${noTemplates ? `<button class="empty-action" id="empty-state-admin" type="button">Visit the studio <span aria-hidden="true">↗</span></button>` : ""}
            </div>
          </div>`;
          return;
        }
        grid.innerHTML = visible.map(template => {
          const safeTitle = escapeHtml(template.title);
          const safeCategory = escapeHtml(template.category);
          const ratio = Number(template.imageWidth) / Number(template.imageHeight);
          return `<article class="template-card" tabindex="0" role="button" aria-label="Personalize ${safeTitle}" data-open-template="${escapeHtml(template.id)}">
            <div class="template-art" style="--template-ratio:${Number.isFinite(ratio) && ratio > 0 ? ratio : .79}">${artMarkup(template)}</div>
            <div class="template-meta"><div><h3 class="template-title">${safeTitle}</h3><p class="template-category">${safeCategory}</p>${template.description ? `<p class="template-description">${escapeHtml(template.description)}</p>` : ""}<span class="use-link">Make it yours <span>&rarr;</span></span></div><span class="slot-count">${template.slots.length} ${template.slots.length === 1 ? "photo" : "photos"}</span></div>
          </article>`;
        }).join("");
        const cards = [...grid.querySelectorAll(".template-card")];
        if (!("IntersectionObserver" in window)) {
          cards.forEach(card => card.classList.add("is-visible"));
          return;
        }
        galleryObserver = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-visible");
            galleryObserver.unobserve(entry.target);
          }
        }, {threshold:.12});
        cards.forEach((card, index) => {
          card.style.setProperty("--reveal-delay", `${Math.min(index, 7) * 70}ms`);
          galleryObserver.observe(card);
        });
      }

      function openOverlay(id) {
        const overlay = document.getElementById(id);
        overlay.classList.add("open");
        document.body.style.overflow = "hidden";
        const close = $(".dialog-close", overlay);
        if (close) close.focus();
      }

      function closeOverlay(id) {
        const overlay = document.getElementById(id);
        overlay.classList.remove("open");
        if (!$(".overlay.open")) document.body.style.overflow = "";
      }

      function openEditor(template) {
        state.currentTemplate = template;
        state.activeSlot = 0;
        state.photos = Array.from({length: template.slots.length}, () => null);
        state.photoAdjustments = Array.from({length: template.slots.length}, () => ({zoom:1, x:50, y:50}));
        state.draggingPhoto = null;
        $("#editor-title").textContent = template.title;
        $("#editor-hint").textContent = `${template.slots.length} ${template.slots.length === 1 ? "little frame is" : "little frames are"} waiting for a photo. Your pictures stay right here in your browser.`;
        $("#editor-status").textContent = "";
        renderEditor();
        openOverlay("editor-overlay");
      }

      function applyPhotoCrop(index) {
        const image = $(`#editor-art .photo-slot[data-slot="${index}"] img`);
        if (!image) return;
        const apply = () => {
          if (!image.naturalWidth || !image.naturalHeight) return;
          const template = state.currentTemplate;
          const area = template.slots[index];
          const adjustment = state.photoAdjustments[index];
          const frameRatio = area.width * template.imageWidth / (area.height * template.imageHeight);
          const imageRatio = image.naturalWidth / image.naturalHeight;
          const baseWidth = imageRatio > frameRatio ? image.naturalHeight * frameRatio : image.naturalWidth;
          const baseHeight = imageRatio > frameRatio ? image.naturalHeight : image.naturalWidth / frameRatio;
          const visibleWidth = baseWidth / adjustment.zoom;
          const visibleHeight = baseHeight / adjustment.zoom;
          const sourceX = (image.naturalWidth - visibleWidth) * adjustment.x / 100;
          const sourceY = (image.naturalHeight - visibleHeight) * adjustment.y / 100;
          image.style.width = `${image.naturalWidth / visibleWidth * 100}%`;
          image.style.height = `${image.naturalHeight / visibleHeight * 100}%`;
          image.style.left = `${-sourceX / visibleWidth * 100}%`;
          image.style.top = `${-sourceY / visibleHeight * 100}%`;
        };
        if (image.complete) apply();
        else image.addEventListener("load", apply, {once:true});
      }

      function renderEditor() {
        const template = state.currentTemplate;
        if (!template) return;
        const art = $("#editor-art");
        const ratio = Number(template.imageWidth) / Number(template.imageHeight);
        art.className = "editor-art custom-editor-art";
        art.style.setProperty("--template-ratio", Number.isFinite(ratio) && ratio > 0 ? ratio : .79);
        art.innerHTML = artMarkup(template, state.photos, true);
        art.querySelectorAll(".photo-slot").forEach((slot, index) => {
          if (state.photos[index]) applyPhotoCrop(index);
        });
        $("#slot-picker").innerHTML = state.photos.map((_, index) => `<button type="button" class="slot-choice${index === state.activeSlot ? " active" : ""}" data-select-slot="${index}" aria-pressed="${index === state.activeSlot}">Frame ${index + 1}${state.photos[index] ? " ready" : ""}</button>`).join("");
        const hasPhoto = Boolean(state.photos[state.activeSlot]);
        const adjustments = $("#photo-adjustments");
        adjustments.hidden = !hasPhoto;
        if (hasPhoto) {
          const adjustment = state.photoAdjustments[state.activeSlot];
          $("#adjustment-frame-number").textContent = state.activeSlot + 1;
          $("#photo-zoom").value = Math.round(adjustment.zoom * 100);
          $("#photo-x").value = adjustment.x;
          $("#photo-y").value = adjustment.y;
          $("#photo-zoom-value").value = `${Math.round(adjustment.zoom * 100)}%`;
          $("#photo-x-value").value = `${adjustment.x}%`;
          $("#photo-y-value").value = `${adjustment.y}%`;
        }
      }

      function updateSelectedPhotoAdjustments() {
        const adjustment = state.photoAdjustments[state.activeSlot];
        if (!adjustment || !state.photos[state.activeSlot]) return;
        applyPhotoCrop(state.activeSlot);
        $("#photo-zoom-value").value = `${Math.round(adjustment.zoom * 100)}%`;
        $("#photo-x-value").value = `${adjustment.x}%`;
        $("#photo-y-value").value = `${adjustment.y}%`;
      }

      function updatePhotoFromPointer(event) {
        const drag = state.draggingPhoto;
        if (!drag) return;
        const adjustment = state.photoAdjustments[drag.index];
        adjustment.x = Math.round(Math.max(0, Math.min(100, drag.startX - (event.clientX - drag.pointerX) / drag.width * 100)));
        adjustment.y = Math.round(Math.max(0, Math.min(100, drag.startY - (event.clientY - drag.pointerY) / drag.height * 100)));
        state.activeSlot = drag.index;
        $("#photo-x").value = adjustment.x;
        $("#photo-y").value = adjustment.y;
        updateSelectedPhotoAdjustments();
      }

      function showNotice(message) {
        const notice = $("#notice");
        notice.textContent = message;
        notice.classList.add("show");
        clearTimeout(state.noticeTimer);
        state.noticeTimer = setTimeout(() => notice.classList.remove("show"), 3200);
      }

      function readImageFile(file) {
        return new Promise((resolve, reject) => {
          if (!file || !file.type.startsWith("image/")) {
            reject(new Error("Please choose an image file."));
            return;
          }
          if (file.size > 12 * 1024 * 1024) {
            reject(new Error("That photo is a little large. Choose an image smaller than 12 MB."));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("We couldn't read that photo. Please try another."));
          reader.readAsDataURL(file);
        });
      }

      async function uploadPhoto(file) {
        try {
          const imageData = await readImageFile(file);
          state.photos[state.activeSlot] = imageData;
          renderEditor();
          $("#editor-status").textContent = `Lovely. Your photo is in frame ${state.activeSlot + 1}.`;
        } catch (error) {
          $("#editor-status").textContent = error.message;
        }
      }

      function drawCover(ctx, image, x, y, width, height, adjustment = {zoom:1,x:50,y:50}) {
        const scale = Math.max(width / image.width, height / image.height);
        const visibleWidth = Math.min(image.width, width / scale / adjustment.zoom);
        const visibleHeight = Math.min(image.height, height / scale / adjustment.zoom);
        const sourceX = (image.width - visibleWidth) * (adjustment.x / 100);
        const sourceY = (image.height - visibleHeight) * (adjustment.y / 100);
        const sourceWidth = visibleWidth;
        const sourceHeight = visibleHeight;
        ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
      }

      function updateDraftSlotCount() {
        const count = state.draftSlots.length;
        $("#draft-slot-count").textContent = `${count} photo area${count === 1 ? "" : "s"} marked`;
        const selected = state.selectedDraftSlot;
        $("#selected-photo-area").textContent = selected >= 0
          ? `Photo area ${selected + 1} selected`
          : "Select an area to fine-tune";
      }

      function drawTemplatePreview(currentArea = null, currentIndex = -1) {
        const canvas = $("#template-preview");
        if (!canvas || !state.draftImage) return;
        const context = canvas.getContext("2d");
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(state.draftImage, 0, 0, canvas.width, canvas.height);
        const areas = [...state.draftSlots];
        if (currentArea && currentIndex === areas.length) areas.push(currentArea);
        else if (currentArea && currentIndex >= 0) areas[currentIndex] = currentArea;
        for (const [index, area] of areas.entries()) {
          const x = area.x * canvas.width;
          const y = area.y * canvas.height;
          const width = area.width * canvas.width;
          const height = area.height * canvas.height;
          const selected = index === state.selectedDraftSlot;
          context.fillStyle = selected ? "#fff4e8a8" : "#fff4e877";
          context.fillRect(x, y, width, height);
          context.strokeStyle = selected ? "#fffdf8" : "#773942";
          context.lineWidth = Math.max(selected ? 3 : 2, canvas.width / 300);
          context.strokeRect(x, y, width, height);
          const label = `PHOTO ${index + 1}`;
          context.font = `700 ${Math.max(11, Math.min(canvas.width / 35, width / 10))}px sans-serif`;
          const labelWidth = context.measureText(label).width + 12;
          const labelHeight = Math.max(19, canvas.width / 30);
          context.fillStyle = "#592a32";
          context.fillRect(x + 4, y + 4, Math.min(labelWidth, Math.max(1, width - 8)), labelHeight);
          context.fillStyle = "#fffdf8";
          context.textAlign = "left";
          context.textBaseline = "middle";
          context.fillText(label, x + 10, y + 4 + labelHeight / 2, Math.max(1, width - 12));
          if (selected) {
            const handleRadius = Math.max(8, canvas.width / 45);
            for (const handleX of [x, x + width / 2, x + width]) {
              for (const handleY of [y, y + height / 2, y + height]) {
                if (handleX === x + width / 2 && handleY === y + height / 2) continue;
                context.beginPath();
                context.arc(handleX, handleY, handleRadius, 0, Math.PI * 2);
                context.fillStyle = "#fffdf8";
                context.fill();
                context.strokeStyle = "#773942";
                context.lineWidth = 2;
                context.stroke();
              }
            }
          }
        }
      }

      function previewPoint(event) {
        const bounds = previewBounds();
        return {
          x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
          y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
        };
      }

      function previewBounds() {
        const canvas = $("#template-preview");
        const bounds = canvas.getBoundingClientRect();
        const style = getComputedStyle(canvas);
        const leftBorder = parseFloat(style.borderLeftWidth) || 0;
        const rightBorder = parseFloat(style.borderRightWidth) || 0;
        const topBorder = parseFloat(style.borderTopWidth) || 0;
        const bottomBorder = parseFloat(style.borderBottomWidth) || 0;
        return {
          left:bounds.left + leftBorder,
          top:bounds.top + topBorder,
          width:bounds.width - leftBorder - rightBorder,
          height:bounds.height - topBorder - bottomBorder
        };
      }

      async function prepareTemplateImage(file) {
        const errorBox = $("#admin-save-error");
        errorBox.textContent = "";
        if (state.draftImageUrl) URL.revokeObjectURL(state.draftImageUrl);
        state.draftImageUrl = null;
        state.draftImage = null;
        state.draftFile = null;
        state.draftImageSize = null;
        state.draftSlots = [];
        state.selectedDraftSlot = -1;
        state.drawingSlot = null;
        $("#template-preview").hidden = true;
        updateDraftSlotCount();
        if (!file) return;
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
          errorBox.textContent = "Choose a PNG, JPG or WebP template image.";
          return;
        }
        if (file.size > 15 * 1024 * 1024) {
          errorBox.textContent = "Choose a template image smaller than 15 MB.";
          return;
        }
        const previewUrl = URL.createObjectURL(file);
        const image = new Image();
        image.src = previewUrl;
        try {
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error("We couldn't open that image. Please choose another one."));
          });
          if (state.draftImageUrl) URL.revokeObjectURL(state.draftImageUrl);
          state.draftFile = file;
          state.draftImageUrl = previewUrl;
          state.draftImage = image;
          state.draftImageSize = {width:image.naturalWidth, height:image.naturalHeight};
          state.draftSlots = [];
          state.selectedDraftSlot = -1;
          const canvas = $("#template-preview");
          const scale = Math.min(1, 1200 / image.naturalWidth, 1200 / image.naturalHeight);
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas.hidden = false;
          $("#preview-instructions").textContent = "Drag on the image to mark a photo area. Then drag inside it to move it, or drag an edge or corner handle to fit the frame precisely.";
          updateDraftSlotCount();
          drawTemplatePreview();
        } catch (error) {
          URL.revokeObjectURL(previewUrl);
          errorBox.textContent = error.message;
        }
      }

      async function downloadCreation() {
        const template = state.currentTemplate;
        if (!template) return;
        if (!state.photos.some(Boolean)) {
          $("#editor-status").textContent = "Add a photo first, and your little keepsake will be ready to save.";
          return;
        }
        $("#editor-status").textContent = "Putting your little keepsake together...";
        const artwork = new Image();
        artwork.crossOrigin = "anonymous";
        artwork.src = template.templateImageUrl;
        await new Promise((resolve, reject) => {
          artwork.onload = resolve;
          artwork.onerror = () => reject(new Error("The template image could not be opened."));
        });
        const canvas = document.createElement("canvas");
        canvas.width = artwork.width;
        canvas.height = artwork.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(artwork, 0, 0, canvas.width, canvas.height);
        for (let index = 0; index < template.slots.length; index++) {
          if (!state.photos[index]) continue;
          const image = new Image();
          image.src = state.photos[index];
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error("Your photo could not be prepared for download."));
          });
          const area = template.slots[index];
          const x = Math.round(area.x * canvas.width);
          const y = Math.round(area.y * canvas.height);
          const width = Math.round(area.width * canvas.width);
          const height = Math.round(area.height * canvas.height);
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, width, height);
          ctx.clip();
          drawCover(ctx, image, x, y, width, height, state.photoAdjustments[index]);
          ctx.restore();
        }
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("We couldn't make that download. Please try again.");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `veloura-${template.id}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        $("#editor-status").textContent = "Your little keepsake is ready to download.";
      }

      function adminLoginView() {
        if (!isSupabaseConfigured) {
          return `<p class="eyebrow">The little back room</p><h2 class="serif" id="admin-title">Studio setup needed.</h2>
            <p>Add the Supabase project URL and publishable key to the host environment to enable the secure studio login.</p>
            <div class="admin-error">Secure studio access becomes available after connecting Supabase.</div>`;
        }
        return `<p class="eyebrow">The little back room</p><h2 class="serif" id="admin-title">Hello, studio.</h2>
          <p>Sign in with the studio admin account to curate the shared template collection.</p>
          <form id="login-form"><label class="form-field"><span>Admin email</span><input id="admin-username" name="username" type="email" autocomplete="username" required></label>
          <label class="form-field"><span>Password</span><input id="admin-password" name="password" type="password" autocomplete="current-password" required></label>
          <div class="admin-error" id="admin-error" aria-live="polite"></div><button class="primary-button" type="submit">Sign in to the studio</button></form>`;
      }

      function adminDashboardView() {
        const rows = state.templates.length ? state.templates.map(template => `<div class="admin-row"><div class="admin-row-info"><img class="admin-row-thumb" src="${escapeHtml(template.templateImageUrl)}" alt=""><div><strong>${escapeHtml(template.title)}</strong><small>${escapeHtml(template.category)} - ${template.slots.length} photo area${template.slots.length === 1 ? "" : "s"}</small></div></div><button type="button" class="delete-button" data-delete-template="${escapeHtml(template.id)}" aria-label="Remove ${escapeHtml(template.title)}">Remove</button></div>`).join("") : `<p class="editor-hint">Your collection is waiting for the first image you upload from this device.</p>`;
        return `<div class="admin-top"><div><p class="eyebrow">Veloura studio</p><h2 class="serif" id="admin-title">Your collection.</h2></div><button type="button" id="admin-logout">Sign out</button></div>
          <p>Templates published here are shared with every visitor.</p><div class="admin-list">${rows}</div>
          <h3 class="serif" style="margin:22px 0 8px;font-size:19px">Add your template artwork</h3>
          <p>Upload the finished design, name it, then mark the photo areas so visitors know where to add their pictures.</p>
          <form id="add-template-form" class="form-grid">
            <label class="form-field full"><span>Template image from this device</span><input class="admin-image-input" id="template-image-input" name="image" type="file" accept="image/png,image/jpeg,image/webp" required><small class="admin-upload-hint">Choose a finished design image (PNG, JPG or WebP, up to 15 MB). The user photo areas will be placed on top of this artwork.</small></label>
            <div class="form-field full"><div class="admin-slot-tools"><strong id="draft-slot-count">0 photo areas marked</strong><div><button class="secondary-button" id="whole-image-area" type="button">Use whole image</button> <button class="secondary-button" id="undo-photo-area" type="button">Undo last area</button></div></div><div class="admin-preview-status" id="selected-photo-area">Select an area to fine-tune</div><canvas class="admin-preview" id="template-preview" hidden aria-label="Template image preview; drag to mark photo areas, move them, or resize their handles"></canvas><p class="admin-upload-hint" id="preview-instructions">After uploading, drag across a photo frame. Then drag inside the marked area to move it, or drag an edge or corner to fit it precisely.</p></div>
            <label class="form-field"><span>Template name</span><input name="title" maxlength="48" placeholder="The Golden Hour" required></label>
            <label class="form-field"><span>Collection</span><select name="category"><option>Little memories</option><option>Soft & botanical</option><option>For your people</option></select></label>
            <label class="form-field full"><span>Short description (optional)</span><input name="description" maxlength="90" placeholder="A soft little keepsake for your favorite moments"></label>
            <div class="admin-error form-field full" id="admin-save-error" aria-live="polite"></div>
            <div class="form-field full"><button class="primary-button" type="submit">Publish this template</button></div>
          </form>`;
      }

      function renderAdmin() {
        const admin = isAdmin();
        $("#admin-dialog").classList.toggle("has-template-editor", admin);
        $("#admin-content").innerHTML = admin ? adminDashboardView() : adminLoginView();
        if (admin) updateDraftSlotCount();
      }

      function openAdmin() {
        renderAdmin();
        openOverlay("admin-overlay");
      }

      async function addTemplate(form) {
        const data = new FormData(form);
        const title = String(data.get("title") || "").trim();
        if (!title) return;
        const errorBox = $("#admin-save-error");
        if (!supabase || !isAdmin()) {
          errorBox.textContent = "Sign in with the studio admin account before publishing templates.";
          return;
        }
        if (!state.draftFile || !state.draftImageSize) {
          errorBox.textContent = "Choose a template image from this device first.";
          return;
        }
        if (!state.draftSlots.length) {
          errorBox.textContent = "Drag over at least one photo area on your template image.";
          return;
        }
        const id = `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const extension = state.draftFile.type === "image/jpeg" ? "jpg" : state.draftFile.type.slice("image/".length);
        const imagePath = `${state.user.id}/${id}.${extension}`;
        let uploaded = false;
        try {
          const {error:uploadError} = await supabase.storage
            .from("template-artwork")
            .upload(imagePath, state.draftFile, {contentType:state.draftFile.type, upsert:false});
          if (uploadError) throw uploadError;
          uploaded = true;
          const {error:insertError} = await supabase.from("templates").insert({
            id,
            title,
            category:String(data.get("category")),
            description:String(data.get("description") || "").trim(),
            image_path:imagePath,
            image_width:state.draftImageSize.width,
            image_height:state.draftImageSize.height,
            slots:state.draftSlots.map(area => ({x:area.x,y:area.y,width:area.width,height:area.height})),
            published:true
          });
          if (insertError) throw insertError;
        } catch (error) {
          if (uploaded) {
            const {error:cleanupError} = await supabase.storage.from("template-artwork").remove([imagePath]);
            if (cleanupError) console.error("Could not clean up artwork after template publishing failed.", cleanupError);
          }
          console.error("Could not publish the uploaded template.", error);
          errorBox.textContent = `Couldn't save this template: ${error.message}`;
          return;
        }
        state.draftFile = null;
        state.draftImage = null;
        state.draftImageSize = null;
        if (state.draftImageUrl) URL.revokeObjectURL(state.draftImageUrl);
        state.draftImageUrl = null;
        state.draftSlots = [];
        await refreshTemplates();
        renderAdmin();
        showNotice(`${title} is now in the little collection.`);
      }

      async function removeTemplate(id) {
        const item = state.templates.find(template => template.id === id);
        if (!item) return;
        try {
          const storageError = await deleteTemplateRecord(item);
          await refreshTemplates();
          renderAdmin();
          if (storageError) {
            showNotice(`Template removed, but artwork cleanup failed: ${storageError.message}`);
          } else {
            showNotice(`${item.title} was removed from the collection.`);
          }
        } catch (error) {
          console.error("Could not remove the template.", error);
          showNotice(`Couldn't remove ${item.title}: ${error.message}`);
        }
      }

      function startPhotoArea(event) {
        if (!state.draftImage || !isAdmin()) return;
        event.preventDefault();
        const point = previewPoint(event);
        const bounds = previewBounds();
        const handleRadiusX = 20 / bounds.width;
        const handleRadiusY = 20 / bounds.height;
        const selectedArea = state.selectedDraftSlot >= 0
          ? state.draftSlots[state.selectedDraftSlot]
          : null;
        let resize = null;
        if (selectedArea) {
          const handles = [
            {x:selectedArea.x,y:selectedArea.y,edges:{x:-1,y:-1}},
            {x:selectedArea.x + selectedArea.width / 2,y:selectedArea.y,edges:{x:0,y:-1}},
            {x:selectedArea.x + selectedArea.width,y:selectedArea.y,edges:{x:1,y:-1}},
            {x:selectedArea.x,y:selectedArea.y + selectedArea.height / 2,edges:{x:-1,y:0}},
            {x:selectedArea.x + selectedArea.width,y:selectedArea.y + selectedArea.height / 2,edges:{x:1,y:0}},
            {x:selectedArea.x,y:selectedArea.y + selectedArea.height,edges:{x:-1,y:1}},
            {x:selectedArea.x + selectedArea.width / 2,y:selectedArea.y + selectedArea.height,edges:{x:0,y:1}},
            {x:selectedArea.x + selectedArea.width,y:selectedArea.y + selectedArea.height,edges:{x:1,y:1}}
          ];
          resize = handles.find(handle =>
            Math.abs(point.x - handle.x) <= handleRadiusX
            && Math.abs(point.y - handle.y) <= handleRadiusY
          );
        }
        let areaIndex = state.draftSlots.findIndex(area =>
          point.x >= area.x && point.x <= area.x + area.width
          && point.y >= area.y && point.y <= area.y + area.height
        );
        if (resize && (areaIndex < 0 || areaIndex === state.selectedDraftSlot)) {
          areaIndex = state.selectedDraftSlot;
        } else {
          resize = null;
        }
        if (areaIndex >= 0) {
          state.selectedDraftSlot = areaIndex;
          state.drawingSlot = {
            mode:resize ? "resize" : "move",
            index:areaIndex,
            edges:resize?.edges,
            startX:point.x,
            startY:point.y,
            original:{...state.draftSlots[areaIndex]}
          };
          $("#preview-instructions").textContent = resize
            ? "Adjusting this frame. Release to check it, then fine-tune again if needed."
            : "Moving this frame. Release to check it, or drag an edge or corner handle to resize.";
        } else {
          state.selectedDraftSlot = -1;
          state.drawingSlot = {
            mode:"draw",
            index:state.draftSlots.length,
            startX:point.x,
            startY:point.y,
            original:{x:point.x,y:point.y,width:0,height:0},
            current:{x:point.x,y:point.y,width:0,height:0}
          };
          $("#preview-instructions").textContent = "Drag across the full empty photo frame. Select any marked area to move or resize it.";
        }
        updateDraftSlotCount();
        event.target.setPointerCapture(event.pointerId);
        drawTemplatePreview(
          state.drawingSlot.mode === "draw" ? state.drawingSlot.current : state.drawingSlot.original,
          state.drawingSlot.index
        );
      }

      function updatePhotoArea(event) {
        if (!state.drawingSlot) return;
        const point = previewPoint(event);
        const gesture = state.drawingSlot;
        const original = gesture.original;
        const deltaX = point.x - gesture.startX;
        const deltaY = point.y - gesture.startY;
        let area;
        if (gesture.mode === "move") {
          area = {
            ...original,
            x:Math.max(0, Math.min(1 - original.width, original.x + deltaX)),
            y:Math.max(0, Math.min(1 - original.height, original.y + deltaY))
          };
        } else if (gesture.mode === "resize") {
          const edges = gesture.edges;
          let left = original.x;
          let right = original.x + original.width;
          let top = original.y;
          let bottom = original.y + original.height;
          if (edges.x < 0) left = Math.max(0, Math.min(right - .01, original.x + deltaX));
          if (edges.x > 0) right = Math.min(1, Math.max(left + .01, original.x + original.width + deltaX));
          if (edges.y < 0) top = Math.max(0, Math.min(bottom - .01, original.y + deltaY));
          if (edges.y > 0) bottom = Math.min(1, Math.max(top + .01, original.y + original.height + deltaY));
          area = {x:left,y:top,width:right-left,height:bottom-top};
        } else {
          area = {
            x:Math.min(gesture.startX, point.x),
            y:Math.min(gesture.startY, point.y),
            width:Math.abs(point.x - gesture.startX),
            height:Math.abs(point.y - gesture.startY)
          };
        }
        gesture.current = area;
        drawTemplatePreview(area, gesture.index);
      }

      function finishPhotoArea(event) {
        if (!state.drawingSlot) return;
        updatePhotoArea(event);
        const gesture = state.drawingSlot;
        const area = gesture.current;
        state.drawingSlot = null;
        if (gesture.mode === "draw" && (area.width < .015 || area.height < .015)) {
          state.selectedDraftSlot = -1;
          drawTemplatePreview();
          updateDraftSlotCount();
          $("#preview-instructions").textContent = "That area was too small. Drag across the full photo frame.";
          return;
        }
        const otherAreas = state.draftSlots.filter((_, index) => index !== gesture.index);
        const overlaps = otherAreas.some(other =>
          area.x < other.x + other.width && area.x + area.width > other.x
          && area.y < other.y + other.height && area.y + area.height > other.y
        );
        if (overlaps) {
          state.selectedDraftSlot = gesture.mode === "draw" ? -1 : gesture.index;
          drawTemplatePreview();
          updateDraftSlotCount();
          $("#preview-instructions").textContent = "Photo areas can't overlap. Please mark a different frame.";
          return;
        }
        if (gesture.mode === "draw" && state.draftSlots.length >= 8) {
          state.selectedDraftSlot = -1;
          drawTemplatePreview();
          updateDraftSlotCount();
          $("#preview-instructions").textContent = "This template already has the maximum of 8 photo areas.";
          return;
        }
        if (gesture.mode === "draw") {
          state.draftSlots.push(area);
          state.selectedDraftSlot = state.draftSlots.length - 1;
        } else {
          state.draftSlots[gesture.index] = area;
          state.selectedDraftSlot = gesture.index;
        }
        updateDraftSlotCount();
        drawTemplatePreview();
        $("#preview-instructions").textContent = "Frame fitted. Drag inside it to move, or use a white edge or corner handle to fine-tune the fit.";
      }

      function useWholeImageAsPhotoArea() {
        if (!state.draftImage) {
          $("#admin-save-error").textContent = "Upload your template image first.";
          return;
        }
        state.draftSlots = [{x:0,y:0,width:1,height:1}];
        state.selectedDraftSlot = 0;
        state.drawingSlot = null;
        updateDraftSlotCount();
        drawTemplatePreview();
        $("#preview-instructions").textContent = "The whole image will be replaceable by one user photo. Use this for a simple full-photo template.";
      }

      document.addEventListener("click", event => {
        const editorSlot = event.target.closest("#editor-art .photo-slot");
        if (editorSlot && state.currentTemplate) {
          state.activeSlot = Number(editorSlot.dataset.slot);
          renderEditor();
          if (!state.photos[state.activeSlot]) $("#photo-input").click();
          return;
        }
        const target = event.target.closest("button, [data-open-template], [data-close], .overlay");
        if (!target) return;
        if (target.id === "open-admin") { openAdmin(); return; }
        if (target.id === "empty-state-admin") { openAdmin(); return; }
        if (target.id === "focus-search") { $("#search-input").focus(); $("#templates").scrollIntoView({behavior:"smooth"}); return; }
        if (target.dataset.category) {
          state.category = target.dataset.category;
          renderCategories();
          renderGallery();
          return;
        }
        if (target.dataset.openTemplate) {
          const template = state.templates.find(item => item.id === target.dataset.openTemplate);
          if (template) openEditor(template);
          return;
        }
        if (target.dataset.selectSlot !== undefined) {
          state.activeSlot = Number(target.dataset.selectSlot);
          renderEditor();
          return;
        }
        if (target.id === "download-creation") { downloadCreation().catch(error => { console.error(error); $("#editor-status").textContent = error.message; }); return; }
        if (target.id === "clear-photos") {
          state.photos = state.photos.map(() => null);
          state.photoAdjustments = state.photoAdjustments.map(() => ({zoom:1,x:50,y:50}));
          renderEditor();
          $("#editor-status").textContent = "A fresh little canvas, just for you.";
          return;
        }
        if (target.id === "remove-selected-photo") {
          state.photos[state.activeSlot] = null;
          state.photoAdjustments[state.activeSlot] = {zoom:1,x:50,y:50};
          renderEditor();
          $("#editor-status").textContent = `Photo removed from frame ${state.activeSlot + 1}.`;
          return;
        }
        if (target.id === "undo-photo-area") {
          state.draftSlots.pop();
          state.selectedDraftSlot = -1;
          updateDraftSlotCount();
          drawTemplatePreview();
          $("#preview-instructions").textContent = state.draftSlots.length
            ? "Last photo area removed. Drag to add another, then adjust its edges if needed."
            : "Drag across a photo frame to mark it. Then move or resize it to fit precisely.";
          return;
        }
        if (target.id === "whole-image-area") {
          useWholeImageAsPhotoArea();
          return;
        }
        if (target.id === "admin-logout") {
          signOutAdmin().then(() => renderAdmin()).catch(error => {
            console.error("Could not sign out of the studio.", error);
            showNotice(`Couldn't sign out: ${error.message}`);
          });
          return;
        }
        if (target.dataset.deleteTemplate) {
          removeTemplate(target.dataset.deleteTemplate);
          return;
        }
        if (target.dataset.close) { closeOverlay(target.dataset.close); return; }
        if (target.classList.contains("overlay") && target === event.target) { closeOverlay(target.id); }
      });

      document.addEventListener("keydown", event => {
        if ((event.key === "Enter" || event.key === " ") && event.target.matches(".template-card")) {
          event.preventDefault();
          const template = state.templates.find(item => item.id === event.target.dataset.openTemplate);
          if (template) openEditor(template);
        }
        if ((event.key === "Enter" || event.key === " ") && event.target.matches(".editor-art .photo-slot")) {
          event.preventDefault();
          state.activeSlot = Number(event.target.dataset.slot);
          renderEditor();
          $("#photo-input").click();
        }
        if (event.key === "Escape") {
          const overlay = $(".overlay.open");
          if (overlay) closeOverlay(overlay.id);
        }
      });

      document.addEventListener("submit", event => {
        if (event.target.id === "login-form") {
          event.preventDefault();
          const submit = $("button[type=submit]", event.target);
          const error = $("#admin-error");
          submit.disabled = true;
          error.textContent = "";
          const username = $("#admin-username").value.trim();
          const password = $("#admin-password").value;
          signInAdmin(username, password).then(() => renderAdmin()).catch(signInError => {
            console.error("Studio admin sign-in failed.", signInError);
            error.textContent = signInError.message;
          }).finally(() => { submit.disabled = false; });
          return;
        }
        if (event.target.id === "add-template-form") {
          event.preventDefault();
          addTemplate(event.target);
        }
      });

      document.addEventListener("change", event => {
        if (event.target.id === "template-image-input") {
          prepareTemplateImage(event.target.files && event.target.files[0]);
        }
      });

      if (supabase) {
        supabase.auth.onAuthStateChange((event, session) => {
          const previousAdmin = isAdmin();
          const previousUserId = state.user?.id;
          state.user = session?.user ?? null;
          const authChanged = previousAdmin !== isAdmin() || previousUserId !== state.user?.id;
          setTimeout(() => {
            refreshTemplates().then(() => {
              const adminOpen = $("#admin-overlay").classList.contains("open");
              const hasUnpublishedDraft = Boolean(state.draftFile || state.draftImage || state.draftSlots.length);
              if (adminOpen && (event === "SIGNED_OUT" || (authChanged && (!isAdmin() || !hasUnpublishedDraft)))) {
                renderAdmin();
              }
            }).catch(error => {
              console.error("Could not refresh the shared template gallery.", error);
            });
          }, 0);
        });
      }

      $("#editor-controls").addEventListener("input", event => {
        const adjustment = state.photoAdjustments[state.activeSlot];
        if (!adjustment) return;
        if (event.target.id === "photo-zoom") {
          adjustment.zoom = Number(event.target.value) / 100;
        } else if (event.target.id === "photo-x") {
          adjustment.x = Number(event.target.value);
        } else if (event.target.id === "photo-y") {
          adjustment.y = Number(event.target.value);
        } else {
          return;
        }
        updateSelectedPhotoAdjustments();
      });

      $("#search-input").addEventListener("input", event => {
        state.query = event.target.value;
        renderGallery();
      });
      $("#photo-input").addEventListener("change", event => {
        const file = event.target.files && event.target.files[0];
        if (file) uploadPhoto(file);
        event.target.value = "";
      });

      $("#admin-content").addEventListener("pointerdown", event => {
        if (event.target.id === "template-preview") startPhotoArea(event);
      });
      document.addEventListener("pointermove", event => {
        if (state.drawingSlot) updatePhotoArea(event);
        if (state.draggingPhoto) updatePhotoFromPointer(event);
      });
      document.addEventListener("pointerup", event => {
        if (state.drawingSlot) finishPhotoArea(event);
        if (state.draggingPhoto) {
          updatePhotoFromPointer(event);
          const slot = $(`#editor-art .photo-slot[data-slot="${state.draggingPhoto.index}"]`);
          if (slot) slot.classList.remove("dragging-photo");
          state.draggingPhoto = null;
        }
      });
      document.addEventListener("pointercancel", () => {
        if (state.drawingSlot) {
          state.drawingSlot = null;
          drawTemplatePreview();
        }
        if (state.draggingPhoto) {
          const slot = $(`#editor-art .photo-slot[data-slot="${state.draggingPhoto.index}"]`);
          if (slot) slot.classList.remove("dragging-photo");
          state.draggingPhoto = null;
        }
      });
      $("#editor-art").addEventListener("pointerdown", event => {
        const slot = event.target.closest(".photo-slot");
        const index = slot ? Number(slot.dataset.slot) : -1;
        if (!slot || index < 0 || !state.photos[index]) return;
        const bounds = slot.getBoundingClientRect();
        state.activeSlot = index;
        state.draggingPhoto = {
          index,
          pointerX:event.clientX,
          pointerY:event.clientY,
          startX:state.photoAdjustments[index].x,
          startY:state.photoAdjustments[index].y,
          width:bounds.width,
          height:bounds.height
        };
        slot.classList.add("dragging-photo");
        event.preventDefault();
        slot.setPointerCapture(event.pointerId);
      });
      let lastSparkleAt = 0;
      document.addEventListener("pointermove", event => {
        if (event.pointerType !== "mouse" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const now = performance.now();
        if (now - lastSparkleAt < 90) return;
        lastSparkleAt = now;
        const sparkle = document.createElement("span");
        sparkle.className = "cursor-sparkle";
        sparkle.textContent = Math.random() > .5 ? "✦" : "✧";
        sparkle.style.left = `${event.clientX}px`;
        sparkle.style.top = `${event.clientY}px`;
        sparkle.style.setProperty("--sparkle-size", `${10 + Math.random() * 9}px`);
        sparkle.style.setProperty("--sparkle-dx", `${Math.round((Math.random() - .5) * 40)}px`);
        sparkle.style.setProperty("--sparkle-dy", `${Math.round(-12 - Math.random() * 28)}px`);
        sparkle.style.setProperty("--sparkle-color", ["#a76779","#af8c63","#8a9670"][Math.floor(Math.random() * 3)]);
        document.body.append(sparkle);
        setTimeout(() => sparkle.remove(), 900);
      });
      $("#year").textContent = new Date().getFullYear();
      renderCategories();
      if (!supabase) {
        renderGallery();
      } else {
        supabase.auth.getSession().then(({data,error}) => {
          if (error) throw error;
          state.user = data.session?.user ?? null;
          return refreshTemplates();
        }).catch(error => {
          console.error("Could not initialize Supabase.", error);
          showNotice(`Studio connection failed: ${error.message}`);
          renderGallery();
        });
      }
    })();
