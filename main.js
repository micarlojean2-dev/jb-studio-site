const CONTACT_WHATSAPP  = "15035931690"; // Ejemplo: "15035551234" — código de país + número, sin + ni espacios
const CONTACT_INSTAGRAM = "jb__studiodesing"; // Ejemplo: "miusuario" — username sin @

const revealItems = document.querySelectorAll(".section-reveal");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (prefersReducedMotion) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else if ("IntersectionObserver" in window) {
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
        } else {
          entry.target.classList.remove("is-visible");
        }
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -48px 0px" }
  );

  revealItems.forEach((item) => sectionObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

function setStaggerDelays(selector, step = 70, maxDelay = 240) {
  document.querySelectorAll(selector).forEach((item, index) => {
    item.classList.add("stagger-item");
    const delay = Math.min(index * step, maxDelay);
    item.style.setProperty("--stagger-delay", `${delay}ms`);
  });
}

function initPremiumMotion() {
  const premiumSelectors = [
    ".option-card",
    ".about-team-card",
    ".booking-problem-card",
    ".booking-showcase-card",
    ".booking-hero-shot",
    ".contact-btn",
    ".req-btn-wa",
    ".req-btn-ig",
    ".req-btn-preview",
    ".template-card",
  ];

  premiumSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => el.classList.add("premium-card"));
  });

  [
    ".about-team-card",
    ".booking-showcase-card",
    ".booking-hero-shot",
    ".template-card",
  ].forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => el.classList.add("tilt-card"));
  });

  [".booking-showcase-card", ".booking-hero-shot", ".template-card"].forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => el.classList.add("mockup-card"));
  });

  setStaggerDelays(".about-team-grid .about-team-card", 120, 240);
  setStaggerDelays(".booking-problem-grid .booking-problem-card", 70, 240);
  setStaggerDelays(".booking-showcase-grid .booking-showcase-card", 120, 240);
  setStaggerDelays(".request-options .option-card", 90, 240);

  const canTilt =
    !prefersReducedMotion &&
    window.innerWidth > 860 &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  document.querySelectorAll(".tilt-card").forEach((card) => {
    if (card.dataset.tiltBound === "true") return;
    card.dataset.tiltBound = "true";
    card.style.setProperty("--tilt-x", "0deg");
    card.style.setProperty("--tilt-y", "0deg");
    if (!canTilt) return;

    card.addEventListener("mousemove", (event) => {
      const rect = card.getBoundingClientRect();
      const relX = (event.clientX - rect.left) / rect.width;
      const relY = (event.clientY - rect.top) / rect.height;
      const rotateY = (relX - 0.5) * 4;
      const rotateX = (0.5 - relY) * 4;
      card.style.setProperty("--tilt-x", `${rotateX.toFixed(2)}deg`);
      card.style.setProperty("--tilt-y", `${rotateY.toFixed(2)}deg`);
    });

    card.addEventListener("mouseleave", () => {
      card.style.setProperty("--tilt-x", "0deg");
      card.style.setProperty("--tilt-y", "0deg");
    });
  });
}

initPremiumMotion();

const flowbookTrigger = document.querySelector("[data-flowbook-toggle]");
const flowbookDetails = document.querySelector("#flowbook-details");

if (flowbookTrigger && flowbookDetails) {
  flowbookTrigger.addEventListener("click", () => {
    const isOpen = flowbookDetails.classList.toggle("is-open");

    flowbookTrigger.textContent = isOpen
      ? "Hide FlowBook ↑"
      : "Explore FlowBook ↓";
    flowbookTrigger.setAttribute("aria-expanded", String(isOpen));

    if (isOpen) {
      flowbookDetails.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

const templateGrid = document.querySelector("[data-template-grid]");
const categoryTitle = document.querySelector("[data-category-title]");
const categoryButtons = document.querySelectorAll(".category-chip[data-category]");

if (templateGrid && categoryTitle && categoryButtons.length) {
  const templateCatalog = {
    landing: {
      title: "LANDING PAGES",
      cards: [
        {
          label: "TEMPLATE 01",
          title: "AGENCY LANDING PAGE",
          description: "A bold page for agencies, campaigns and service offers.",
          starterPrice: "$309",
          minimumPrice: "$240",
          moreChangesPrice: "$450+",
          image: "assets/designs/landing-page-01.png",
          alt: "Agency landing page template preview",
          href: "templates/landing-page-01.html",
          slug: "agency-landing",
          liveUrl: "https://damas.framer.website/",
        },
        {
          label: "TEMPLATE 02",
          title: "SOCIAL MEDIA AGENCY LANDING PAGE",
          description: "A clean landing page for agencies, creators and content-driven service brands.",
          starterPrice: "$299",
          minimumPrice: "$260",
          moreChangesPrice: "$500+",
          image: "assets/designs/landing-page-02.png",
          alt: "Social media agency landing page template preview",
          href: "templates/landing-page-02.html",
          slug: "social-media-agency",
          liveUrl: "https://viral-sma.framer.website/?via=hxmzaehsan&utm_source=framer",
        },
        {
          label: "TEMPLATE 03",
          title: "AGENCY PRO",
          description: "A polished website for modern agencies and service-focused teams.",
          starterPrice: "$349",
          minimumPrice: "$290",
          moreChangesPrice: "$590+",
          image: "assets/designs/agency-pro.png",
          alt: "Agency Pro website template preview",
          href: "templates/agency-pro.html",
          slug: "agency-pro",
          liveUrl: "https://neutra.framer.website/",
        },
        {
          label: "TEMPLATE 04",
          title: "SONIC PRODUCT LANDING",
          description: "A sharp landing page for product launches, features and conversion goals.",
          starterPrice: "$339",
          minimumPrice: "$280",
          moreChangesPrice: "$560+",
          image: "assets/designs/sonic-product-landing.png",
          alt: "Sonic product landing template preview",
          href: "templates/sonic-product-landing.html",
          slug: "sonic-product",
          liveUrl: "https://sonic.framer.media/#about",
        },
        {
          label: "TEMPLATE 05",
          title: "CLOVER PRODUCT LANDING",
          description: "An energetic product landing page for fintech apps, savings tools and cashback offers.",
          starterPrice: "$349",
          minimumPrice: "$290",
          moreChangesPrice: "$590+",
          image: "assets/designs/business-consultancy.png",
          alt: "Clover product landing template preview",
          href: "templates/clover-product-landing.html",
          slug: "clover-product",
          liveUrl: "https://greenclover.framer.website/#product",
        },
        {
          label: "TEMPLATE 06",
          title: "BRANDORA AGENCY",
          description: "A modern agency landing page for branding studios and creative service teams.",
          starterPrice: "$359",
          minimumPrice: "$300",
          moreChangesPrice: "$620+",
          image: "assets/designs/digital-designer-portfolio.png",
          alt: "Brandora agency template preview",
          href: "templates/brandora-agency.html",
          slug: "brandora-agency",
          liveUrl: "https://brandora.framer.website/",
        },
      ],
    },
    restaurant: {
      title: "RESTAURANT WEBSITES",
      cards: [
        {
          label: "TEMPLATE 01",
          title: "CAFE PREMIUM",
          description: "A premium cafe website focused on ambience, menu highlights and reservations.",
          starterPrice: "$449",
          minimumPrice: "$320",
          moreChangesPrice: "$650+",
          image: "assets/designs/cafe-premium.png",
          alt: "Cafe premium website template preview",
          href: "templates/cafe-premium.html",
          slug: "cafe-premium",
          liveUrl: "https://cafen-wbs.framer.website/menu",
        },
      ],
    },
    barbershop: {
      title: "BARBERSHOP / SALON",
      cards: [
        {
          label: "TEMPLATE 01",
          title: "HAIR SALON WEBSITE",
          description: "A soft and elegant website for hair salons, beauty services and appointments.",
          starterPrice: "$419",
          minimumPrice: "$320",
          moreChangesPrice: "$670+",
          image: "assets/designs/service-business-04.png",
          alt: "Hair salon and beauty website template preview",
          href: "templates/barbershop-salon-02.html",
          slug: "hair-salon",
          liveUrl: "https://velvera.framer.website/",
        },
      ],
    },
    business: {
      title: "BUSINESS WEBSITES",
      cards: [
        {
          label: "TEMPLATE 01",
          title: "YOGA / WELLNESS WEBSITE",
          description: "A calm website for wellness studios, yoga classes and appointment-based services.",
          starterPrice: "$409",
          minimumPrice: "$250",
          moreChangesPrice: "$500+",
          image: "assets/designs/service-business-01.png",
          alt: "Yoga and wellness website template preview",
          href: "templates/service-business-01.html",
          slug: "yoga-wellness",
          liveUrl: "https://asana.framer.website/",
        },
        {
          label: "TEMPLATE 02",
          title: "FITNESS PRODUCT WEBSITE",
          description: "A modern landing page for fitness products, apps and active lifestyle brands.",
          starterPrice: "$309",
          minimumPrice: "$280",
          moreChangesPrice: "$560+",
          image: "assets/designs/service-business-02.png",
          alt: "Fitness product website template preview",
          href: "templates/service-business-02.html",
          slug: "fitness-product",
          liveUrl: "https://asana.framer.website/",
        },
        {
          label: "TEMPLATE 03",
          title: "CONSULTING BUSINESS WEBSITE",
          description: "A clean business website for consultants, agencies and professional services.",
          starterPrice: "$319",
          minimumPrice: "$290",
          moreChangesPrice: "$590+",
          image: "assets/designs/service-business-03.png",
          alt: "Consulting business website template preview",
          href: "templates/service-business-03.html",
          slug: "consulting-business",
          liveUrl: "https://consulting.framer.media/",
        },
        {
          label: "TEMPLATE 04",
          title: "MEDICAL SERVICE WEBSITE",
          description: "A clean healthcare website for clinics, doctors, dental care and patient services.",
          starterPrice: "$399",
          minimumPrice: "$340",
          moreChangesPrice: "$700+",
          image: "assets/designs/portfolio-website-01.png",
          alt: "Medical service website template preview",
          href: "templates/service-business-04.html",
          slug: "medical-service",
          liveUrl: "https://vitalflow.framer.website/",
        },
        {
          label: "TEMPLATE 05",
          title: "BUSINESS CONSULTING WEBSITE",
          description: "A professional website for consultants, advisors and business service brands.",
          starterPrice: "$399",
          minimumPrice: "$310",
          moreChangesPrice: "$630+",
          image: "assets/designs/barbershop-salon-02.png",
          alt: "Business consulting website template preview",
          href: "templates/service-business-05.html",
          slug: "business-consulting",
          liveUrl: "https://stratex.framer.website/#services",
        },
        {
          label: "TEMPLATE 06",
          title: "BUSINESS CONSULTANCY",
          description: "A conversion-focused consultancy website for business growth and advisory services.",
          starterPrice: "$309",
          minimumPrice: "$310",
          moreChangesPrice: "$650+",
          image: "assets/designs/clover-product-landing.png",
          alt: "Business consultancy template preview",
          href: "templates/business-consultancy.html",
          slug: "business-consultancy",
          liveUrl: "https://archio-template.framer.website/#hero",
        },
        {
          label: "TEMPLATE 07",
          title: "PET GROOMING WEBSITE",
          description: "A friendly service website for pet grooming, bookings and customer trust.",
          starterPrice: "$379",
          minimumPrice: "$260",
          moreChangesPrice: "$540+",
          image: "assets/designs/minimal-personal-portfolio.png",
          alt: "Pet grooming website template preview",
          href: "templates/pet-grooming-website.html",
          slug: "pet-grooming",
          liveUrl: "https://groomix.framer.website/",
        },
      ],
    },
    portfolio: {
      title: "PORTFOLIO WEBSITE",
      cards: [
        {
          label: "TEMPLATE 01",
          title: "MINIMAL PRODUCT PORTFOLIO",
          description: "A clean portfolio for product designers, makers and modern creative work.",
          starterPrice: "$339",
          minimumPrice: "$250",
          moreChangesPrice: "$500+",
          image: "assets/designs/service-business-05.png",
          alt: "Minimal product portfolio template preview",
          href: "templates/portfolio-website-01.html",
          slug: "minimal-product-portfolio",
          liveUrl: "https://lluno.framer.website/",
        },
        {
          label: "TEMPLATE 02",
          title: "DARK DESIGNER PORTFOLIO",
          description: "A bold dark portfolio for designers, creatives and visual professionals.",
          starterPrice: "$349",
          minimumPrice: "$290",
          moreChangesPrice: "$590+",
          image: "assets/designs/portfolio-website-02.png",
          alt: "Dark designer portfolio template preview",
          href: "templates/portfolio-website-02.html",
          slug: "dark-designer-portfolio",
          liveUrl: "https://portfolo.framer.website/#testimonials",
        },
        {
          label: "TEMPLATE 03",
          title: "DARK CREATIVE PORTFOLIO",
          description: "A cinematic dark layout for creative portfolios and bold visual storytelling.",
          starterPrice: "$379",
          minimumPrice: "$320",
          moreChangesPrice: "$670+",
          image: "assets/designs/dark-creative-portfolio.png",
          alt: "Dark creative portfolio template preview",
          href: "templates/dark-creative-portfolio.html",
          slug: "dark-creative-portfolio",
          liveUrl: "https://matte.framer.media/",
        },
        {
          label: "TEMPLATE 04",
          title: "LUXURY BRAND PORTFOLIO",
          description: "An elegant premium portfolio for luxury brands and high-end creative showcases.",
          starterPrice: "$469",
          minimumPrice: "$390",
          moreChangesPrice: "$850+",
          image: "assets/designs/luxury-brand-portfolio.png",
          alt: "Luxury brand portfolio template preview",
          href: "templates/luxury-brand-portfolio.html",
          slug: "luxury-brand-portfolio",
          liveUrl: "https://billie-duvalle.framer.website/?via=gustaveflowbert",
        },
        {
          label: "TEMPLATE 05",
          title: "MINIMAL PERSONAL PORTFOLIO",
          description: "A soft minimalist portfolio for personal brands, blogs and independent creatives.",
          starterPrice: "$299",
          minimumPrice: "$250",
          moreChangesPrice: "$500+",
          image: "assets/designs/pet-grooming-website.png",
          alt: "Minimal personal portfolio template preview",
          href: "templates/minimal-personal-portfolio.html",
          slug: "minimal-personal-portfolio",
          liveUrl: "https://writeme.framer.website/about",
        },
        {
          label: "TEMPLATE 06",
          title: "DIGITAL DESIGNER PORTFOLIO",
          description: "A clean digital portfolio for designers, visual work and case-study storytelling.",
          starterPrice: "$359",
          minimumPrice: "$300",
          moreChangesPrice: "$620+",
          image: "assets/designs/brandora-agency.png",
          alt: "Digital designer portfolio template preview",
          href: "templates/digital-designer-portfolio.html",
          slug: "digital-designer-portfolio",
          liveUrl: "https://portavia.framer.website/",
        },
      ],
    },
  };

  const prefersReduced = prefersReducedMotion;

  const buildCard = (card) => `
    <article class="project template-card premium-card tilt-card mockup-card" data-card-title="${card.title}" data-card-slug="${card.slug}" data-card-image="${card.image}" data-card-live-url="${card.liveUrl}">
      <figure class="project-preview">
        <img src="${card.image}" alt="${card.alt}" onload="this.parentElement.classList.add('has-image')" onerror="this.remove()" />
        <figcaption>IMAGE PREVIEW</figcaption>
      </figure>
      <div class="project-meta">${card.label}</div>
      <h3>${card.title}</h3>
      <p>${card.description}</p>
      <div class="template-price">
        <p class="template-price-label">Starting at <span>${card.starterPrice || "$299"}</span></p>
      </div>
      <div class="card-actions">
        <a class="btn-expand" href="${card.href}" target="_blank" rel="noopener noreferrer">EXPAND PREVIEW</a>
        <a class="btn-live" href="preview.html?template=${card.slug}">VIEW LIVE SITE →</a>
        <a class="btn-request" href="#about" data-req-title="${card.title}" data-req-slug="${card.slug}">REQUEST →</a>
      </div>
    </article>
  `;

  const animateInCards = () => {
    const cards = templateGrid.querySelectorAll(".template-card");
    cards.forEach((card, index) => {
      if (prefersReduced) {
        card.classList.remove("template-enter", "is-in");
        return;
      }
      card.classList.add("template-enter");
      card.style.transitionDelay = `${40 + index * 80}ms`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => card.classList.add("is-in"));
      });
    });
  };

  const renderCategory = (key) => {
    const category = templateCatalog[key];
    if (!category) return;

    categoryTitle.textContent = category.title;
    categoryButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.category === key);
      button.setAttribute("aria-pressed", String(button.dataset.category === key));
    });

    if (prefersReduced) {
      templateGrid.innerHTML = category.cards.map(buildCard).join("");
      initPremiumMotion();
      templateGrid
        .querySelectorAll(".template-card")
        .forEach((card) => card.classList.remove("template-enter", "is-in"));
      return;
    }

    templateGrid.classList.add("is-updating");
    setTimeout(() => {
      templateGrid.innerHTML = category.cards.map(buildCard).join("");
      initPremiumMotion();
      templateGrid.classList.remove("is-updating");
      animateInCards();
    }, 170);
  };

  categoryButtons.forEach((button) => {
    button.addEventListener("click", () => renderCategory(button.dataset.category));
  });

  templateGrid.addEventListener("click", (event) => {
    const liveButton = event.target.closest(".btn-live");
    if (liveButton) {
      const cardEl = liveButton.closest(".template-card");
      if (cardEl) {
        console.log({
          clickedTitle:   cardEl.dataset.cardTitle   || "",
          clickedSlug:    cardEl.dataset.cardSlug    || "",
          clickedImage:   cardEl.dataset.cardImage   || "",
          clickedLiveUrl: cardEl.dataset.cardLiveUrl || "",
        });
      }
      return;
    }

    const reqButton = event.target.closest(".btn-request");
    if (reqButton) {
      event.preventDefault();
      const title     = reqButton.dataset.reqTitle || "";
      const slug      = reqButton.dataset.reqSlug || "";
      const typeEl    = document.getElementById("req-type");
      const tmplEl    = document.getElementById("req-template");
      if (typeEl) {
        typeEl.value = "Adapt a template";
        typeEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (tmplEl && title) {
        const match = Array.from(tmplEl.options).find(
          (o) => o.value === slug || o.dataset.title === title
        );
        if (match) tmplEl.value = match.value;
        tmplEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const aboutEl = document.getElementById("about");
      if (aboutEl) {
        aboutEl.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => {
          const first = aboutEl.querySelector("input, select, textarea");
          if (first) first.focus({ preventScroll: true });
        }, 650);
      }
    }
  });

  renderCategory("landing");

  // Populate #req-template with all catalog templates
  const reqTemplateSel = document.getElementById("req-template");
  if (reqTemplateSel) {
    reqTemplateSel.innerHTML = '<option value="">Select a template</option>';
    Object.values(templateCatalog).forEach((cat) => {
      cat.cards.forEach((card) => {
        const opt = document.createElement("option");
        opt.value = card.slug;
        opt.dataset.title = card.title;
        opt.dataset.starterPrice = card.starterPrice || "";
        opt.textContent = card.title;
        reqTemplateSel.appendChild(opt);
      });
    });
    [
      { value: "not-sure-yet", label: "Not sure yet" },
      { value: "design-from-scratch", label: "I want a design from scratch" },
    ].forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      reqTemplateSel.appendChild(opt);
    });
  }
}

// ── Hero typewriter & bilingual support ──────────────
(function () {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const intro      = document.querySelector(".intro");
  const frontEnd   = document.querySelector(".hero-title-back span:first-child");
  const devBack    = document.querySelector(".hero-title-back span:last-child");
  const devFront   = document.querySelector(".front-mask-developer");
  const personBase = document.querySelector(".hero-person-base");
  const personHead = document.querySelector(".hero-person-head");

  if (!intro || !frontEnd) return;

  let animDone = false;
  const BRAND = '<span class="notranslate" translate="no">JB</span>';

  function isEs() {
    return (document.documentElement.lang || "").toLowerCase().startsWith("es");
  }

  function applyLang() {
    if (!animDone) return;
    const es = isEs();
    const key = es ? "es" : "en";
    intro.innerHTML = "Hi there, we're " + BRAND + " Studio";
    if (frontEnd) frontEnd.textContent = frontEnd.getAttribute("data-" + key);
    if (devBack)  devBack.textContent  = devBack.getAttribute("data-" + key);
    if (devFront) devFront.textContent = devFront.getAttribute("data-" + key);
  }

  // Detect Google Translate (changes document lang attribute)
  new MutationObserver(applyLang).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });

  function revealPhoto() {
    const person2 = document.querySelector(".hero-person-2");
    personBase && personBase.classList.add("hero-photo-visible");
    personHead && personHead.classList.add("hero-photo-visible");
    person2 && person2.classList.add("hero-photo-visible");
  }

  function finish() {
    animDone = true;
    applyLang();
    setTimeout(revealPhoto, 120);
  }

  if (prefersReduced) {
    animDone = true;
    applyLang();
    revealPhoto();
    return;
  }

  intro.textContent    = "";
  frontEnd.textContent = "";
  if (devBack)  devBack.textContent  = "";
  if (devFront) devFront.textContent = "";

  function type(targets, text, ms, done) {
    const els = [].concat(targets);
    const delay = ms / text.length;
    let i = 0;
    const id = setInterval(() => {
      const ch = text[i++];
      els.forEach(el => { el.textContent += ch; });
      if (i >= text.length) { clearInterval(id); done && setTimeout(done, 80); }
    }, delay);
  }

  setTimeout(() => {
    type(intro, "Hi there, we're JB Studio", 700, () => {
      type(frontEnd, "Modern Web", 900, () => {
        type([devBack, devFront].filter(Boolean), "Design", 900, finish);
      });
    });
  }, 200);
})();

// ── Contact CTA Buttons ───────────────────────────────
(function () {
  const contactWaBtn = document.getElementById("contact-wa-btn");
  if (!contactWaBtn) return;

  contactWaBtn.addEventListener("click", (event) => {
    event.preventDefault();
    const message = "Hi, I’m interested in a website for my business. I’d like to know more.";
    const encoded = encodeURIComponent(message);
    const num = CONTACT_WHATSAPP;
    const url = num
      ? "https://wa.me/" + num + "?text=" + encoded
      : "https://wa.me/?text=" + encoded;
    window.open(url, "_blank", "noopener,noreferrer");
  });
})();

// ── Quick Request Buttons (WA + IG) ───────────────────
(function () {
  const errMsg = document.getElementById("req-error");
  const waBtn  = document.getElementById("req-wa-btn");
  const igBtn  = document.getElementById("req-ig-btn");
  const igNote = document.getElementById("req-ig-note");
  const typeSelect = document.getElementById("req-type");
  const templateSelect = document.getElementById("req-template");
  const templateBlock = document.getElementById("req-template-block");
  const previewBtn = document.getElementById("req-preview-btn");
  const templateHint = document.getElementById("req-template-hint");

  if (igBtn && !CONTACT_INSTAGRAM) {
    igBtn.hidden = true;
  }

  function getTemplateLabel() {
    if (!templateSelect) return "";
    const selected = templateSelect.options[templateSelect.selectedIndex];
    return selected ? selected.textContent.trim() : "";
  }

  function getTemplateStarterPrice() {
    if (!templateSelect) return "";
    const selected = templateSelect.options[templateSelect.selectedIndex];
    return selected ? (selected.dataset.starterPrice || "") : "";
  }

  function updatePreviewButtonState() {
    if (!templateSelect || !previewBtn) return;
    const typeValue = (typeSelect || {}).value || "";
    if (typeValue === "Design from scratch") {
      previewBtn.disabled = true;
      previewBtn.setAttribute("aria-disabled", "true");
      if (templateHint) templateHint.hidden = true;
      return;
    }

    const selectedValue = templateSelect.value;
    const isCatalogTemplate =
      selectedValue &&
      selectedValue !== "not-sure-yet" &&
      selectedValue !== "design-from-scratch";

    previewBtn.disabled = !isCatalogTemplate;
    previewBtn.setAttribute("aria-disabled", String(!isCatalogTemplate));
    if (templateHint) templateHint.hidden = isCatalogTemplate;
  }

  function syncTemplateBlock() {
    if (!typeSelect || !templateSelect || !templateBlock) return;
    const typeValue = typeSelect.value;
    const isScratch = typeValue === "Design from scratch";

    templateBlock.hidden = isScratch;

    if (isScratch) {
      templateSelect.value = "design-from-scratch";
    } else if (typeValue === "Not sure yet" && !templateSelect.value) {
      templateSelect.value = "not-sure-yet";
    }

    updatePreviewButtonState();
  }

  if (templateSelect && typeSelect) {
    templateSelect.addEventListener("change", updatePreviewButtonState);
    typeSelect.addEventListener("change", syncTemplateBlock);
    syncTemplateBlock();
  }

  if (previewBtn) {
    previewBtn.addEventListener("click", () => {
      if (!templateSelect) return;
      const slug = templateSelect.value;
      if (!slug || slug === "not-sure-yet" || slug === "design-from-scratch") {
        updatePreviewButtonState();
        return;
      }
      window.open("preview.html?template=" + encodeURIComponent(slug), "_blank", "noopener,noreferrer");
    });
  }

  function validate() {
    const type = (document.getElementById("req-type") || {}).value || "";
    const templateValue = (templateSelect || {}).value || "";
    const budget   = (document.getElementById("req-budget")   || {}).value || "";
    let template = getTemplateLabel();
    let starterPrice = getTemplateStarterPrice();
    let hasTemplate = Boolean(templateValue);

    if (type === "Design from scratch") {
      template = "Design from scratch";
      starterPrice = "Custom quote";
      hasTemplate = true;
    }

    if (type === "Not sure yet") {
      if (!templateValue) {
        template = "Not sure yet";
      }
      starterPrice = templateValue ? (starterPrice || "To be confirmed") : "To be confirmed";
      hasTemplate = true;
    }

    if (type === "Adapt a template") {
      const isRealTemplate =
        templateValue &&
        templateValue !== "not-sure-yet" &&
        templateValue !== "design-from-scratch";
      hasTemplate = Boolean(isRealTemplate);
    }

    if (!type || !budget || !hasTemplate) {
      if (errMsg) {
        errMsg.hidden = false;
        errMsg.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      return null;
    }
    if (errMsg) errMsg.hidden = true;
    return { type, template, starterPrice, budget };
  }

  function buildMessage(data) {
    return [
      "WEB",
      "",
      "Hi, I want a website.",
      "",
      "Project type:",
      data.type,
      "",
      "Template I liked:",
      data.template,
      "",
      "Starting price:",
      data.starterPrice || "To be confirmed",
      "",
      "Approximate budget:",
      data.budget,
      "",
      "I came from the template catalog and want to answer the quick questions to see if my project fits.",
    ].join("\n");
  }

  if (waBtn) {
    waBtn.addEventListener("click", () => {
      const data = validate();
      if (!data) return;
      const encoded = encodeURIComponent(buildMessage(data));
      const num     = CONTACT_WHATSAPP;
      const url     = num
        ? "https://wa.me/" + num + "?text=" + encoded
        : "https://wa.me/?text=" + encoded;
      window.open(url, "_blank", "noopener,noreferrer");
    });
  }

  if (igBtn) {
    igBtn.addEventListener("click", () => {
      const data = validate();
      if (!data) return;
      if (igNote) igNote.hidden = false;
      window.open(
        "https://www.instagram.com/jb__studiodesing/",
        "_blank",
        "noopener,noreferrer"
      );
    });
  }
})();
