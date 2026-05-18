const templatePage = document.querySelector(".template-page");

if (templatePage) {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReduced) {
    templatePage.classList.add("is-visible");
  } else if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            templatePage.classList.add("is-visible");
            observer.disconnect();
          }
        });
      },
      { threshold: 0.2 }
    );

    observer.observe(templatePage);
  } else {
    templatePage.classList.add("is-visible");
  }
}

const templatePreview = document.querySelector(".template-preview");
const templateActions = document.querySelector(".template-actions");
const templateFrame = document.querySelector(".template-frame");

const pageName = window.location.pathname.split("/").pop() || "";
const templateSlug = pageName.replace(".html", "");
const templateImageFromData =
  templatePage?.getAttribute("data-template-image") ||
  document.body.getAttribute("data-template-image") ||
  "";
const templateVideoFromData =
  templatePage?.getAttribute("data-template-video") ||
  document.body.getAttribute("data-template-video") ||
  "";
const imageSrc = templateImageFromData || `../assets/designs/${templateSlug}.png`;
const videoSrc = templateVideoFromData || `../assets/template-videos/${templateSlug}.mp4`;

let previewMedia = null;

if (templateFrame) {
  templateFrame.classList.add("template-frame-image");
  const placeholder = templateFrame.querySelector(".template-placeholder");
  if (placeholder) {
    placeholder.textContent = "IMAGE PREVIEW";
  }

  templateFrame.querySelectorAll("video.template-media, img.template-media").forEach((media) => {
    media.remove();
  });

  const image = document.createElement("img");
  image.className = "template-media";
  image.src = imageSrc;
  image.alt = `${templateSlug.replace(/-/g, " ")} full design preview`;
  image.addEventListener("load", () => {
    templateFrame.classList.add("has-media");
  });
  image.addEventListener("error", () => {
    image.remove();
    templateFrame.classList.remove("has-media");
  });
  templateFrame.insertAdjacentElement("afterbegin", image);
  previewMedia = image;
}

if (templateActions) {
  if (!templateActions.querySelector("[data-expand-preview]")) {
    const expandButton = document.createElement("button");
    expandButton.type = "button";
    expandButton.className = "template-expand";
    expandButton.setAttribute("data-expand-preview", "");
    expandButton.textContent = "EXPAND PREVIEW ↗";
    templateActions.prepend(expandButton);
  }

  if (!templateActions.querySelector("[data-watch-video]")) {
    const watchButton = document.createElement("a");
    watchButton.className = "template-expand";
    watchButton.setAttribute("data-watch-video", "");
    watchButton.href = "#template-video";
    watchButton.textContent = "WATCH VIDEO →";
    templateActions.append(watchButton);
  }
}

if (templatePreview && !document.querySelector("#template-video")) {
  const section = document.createElement("section");
  section.className = "template-video-section";
  section.id = "template-video";
  section.innerHTML = `
    <p class="template-kicker">VIDEO PREVIEW</p>
    <h2 class="template-video-title">SEE THE DESIGN IN MOTION</h2>
    <p class="template-video-copy">Watch a short preview of how this template looks with movement, scrolling and interactions.</p>
    <article class="template-video-shell">
      <figure class="template-video-frame">
        <video class="template-video-media" src="${videoSrc}" muted autoplay loop playsinline controls></video>
        <figcaption class="template-video-placeholder">VIDEO PREVIEW COMING SOON</figcaption>
      </figure>
      <div class="template-video-actions">
        <button class="template-expand" type="button" data-expand-video>EXPAND VIDEO ↗</button>
      </div>
    </article>
  `;
  templatePreview.insertAdjacentElement("afterend", section);
}

const videoPreview = document.querySelector(".template-video-media");
const videoPlaceholder = document.querySelector(".template-video-placeholder");

if (videoPreview && videoPlaceholder) {
  videoPreview.addEventListener("loadeddata", () => {
    videoPlaceholder.style.display = "none";
  });
  videoPreview.addEventListener("error", () => {
    videoPreview.style.display = "none";
    videoPlaceholder.style.display = "grid";
  });
}

const watchVideo = document.querySelector("[data-watch-video]");
if (watchVideo) {
  watchVideo.addEventListener("click", (event) => {
    event.preventDefault();
    const target = document.querySelector("#template-video");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

let lightbox = document.querySelector("[data-template-lightbox]");
if (!lightbox) {
  lightbox = document.createElement("div");
  lightbox.className = "template-lightbox";
  lightbox.setAttribute("data-template-lightbox", "");
  lightbox.innerHTML = `
    <div class="template-lightbox-content" data-template-lightbox-content>
      <button class="template-lightbox-close" type="button" data-template-lightbox-close>CLOSE</button>
      <div data-template-lightbox-media></div>
    </div>
  `;
  document.body.append(lightbox);
}

const lightboxContent = lightbox.querySelector("[data-template-lightbox-media]");
const lightboxClose = lightbox.querySelector("[data-template-lightbox-close]");

const openLightbox = (type) => {
  if (!lightboxContent) return;
  if (type === "video") {
    lightboxContent.innerHTML = `<video class="template-lightbox-video" src="${videoSrc}" muted autoplay loop playsinline controls></video><p class="template-lightbox-fallback">VIDEO PREVIEW COMING SOON</p>`;
    const modalVideo = lightboxContent.querySelector(".template-lightbox-video");
    const fallback = lightboxContent.querySelector(".template-lightbox-fallback");
    if (modalVideo && fallback) {
      modalVideo.addEventListener("loadeddata", () => {
        fallback.style.display = "none";
      });
      modalVideo.addEventListener("error", () => {
        modalVideo.style.display = "none";
        fallback.style.display = "grid";
      });
    }
  } else {
    const img = previewMedia && previewMedia.tagName === "IMG" ? previewMedia.getAttribute("src") : "";
    if (img) {
      lightboxContent.innerHTML = `<img class="template-lightbox-image" src="${img}" alt="Expanded template preview" />`;
    } else if (previewMedia && previewMedia.tagName === "VIDEO") {
      const videoPreviewSrc = previewMedia.getAttribute("src") || "";
      lightboxContent.innerHTML = `<video class="template-lightbox-video" src="${videoPreviewSrc}" muted autoplay loop playsinline controls></video><p class="template-lightbox-fallback">IMAGE PREVIEW COMING SOON</p>`;
      const modalPreviewVideo = lightboxContent.querySelector(".template-lightbox-video");
      const previewFallback = lightboxContent.querySelector(".template-lightbox-fallback");
      if (modalPreviewVideo && previewFallback) {
        modalPreviewVideo.addEventListener("loadeddata", () => {
          previewFallback.style.display = "none";
        });
        modalPreviewVideo.addEventListener("error", () => {
          modalPreviewVideo.style.display = "none";
          previewFallback.style.display = "grid";
        });
      }
    } else {
      lightboxContent.innerHTML = `<p class="template-lightbox-fallback">IMAGE PREVIEW COMING SOON</p>`;
    }
  }
  lightbox.classList.add("is-open");
};

const closeLightbox = () => {
  lightbox.classList.remove("is-open");
};

const expandPreview = document.querySelector("[data-expand-preview]");
if (expandPreview) {
  expandPreview.addEventListener("click", () => openLightbox("image"));
}

const expandVideo = document.querySelector("[data-expand-video]");
if (expandVideo) {
  expandVideo.addEventListener("click", () => openLightbox("video"));
}

if (lightboxClose) {
  lightboxClose.addEventListener("click", closeLightbox);
}

lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLightbox();
  }
});
