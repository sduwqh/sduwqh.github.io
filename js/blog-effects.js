(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ensureProgressBar() {
    if (document.querySelector('.reading-progress')) {
      return;
    }
    var bar = document.createElement('div');
    bar.className = 'reading-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
  }

  function updateProgress() {
    var bar = document.querySelector('.reading-progress');
    if (!bar) {
      return;
    }
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var height = document.documentElement.scrollHeight - window.innerHeight;
    var progress = height > 0 ? Math.min(100, Math.max(0, (scrollTop / height) * 100)) : 0;
    bar.style.width = progress + '%';
  }

  function slugify(text) {
    return text.trim()
      .toLowerCase()
      .replace(/[\s/]+/g, '-')
      .replace(/[^\w\u4e00-\u9fa5-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function enhanceHeadings() {
    var headings = document.querySelectorAll('.article .content h2, .article .content h3, .article .content h4');
    var used = {};
    headings.forEach(function (heading) {
      if (!heading.id) {
        var base = slugify(heading.textContent) || 'section';
        var id = base;
        var i = 2;
        while (used[id] || document.getElementById(id)) {
          id = base + '-' + i;
          i += 1;
        }
        heading.id = id;
      }
      used[heading.id] = true;
      if (!heading.querySelector('.heading-anchor')) {
        var anchor = document.createElement('a');
        anchor.className = 'heading-anchor';
        anchor.href = '#' + heading.id;
        anchor.setAttribute('aria-label', '复制标题链接');
        anchor.textContent = '#';
        heading.appendChild(anchor);
      }
    });
  }

  function ensureLightbox() {
    var box = document.querySelector('.image-lightbox');
    if (box) {
      return box;
    }
    box = document.createElement('div');
    box.className = 'image-lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = '<button type="button" aria-label="关闭图片预览">×</button><img alt="">';
    document.body.appendChild(box);
    box.addEventListener('click', function (event) {
      if (event.target === box || event.target.tagName === 'BUTTON' || event.target.tagName === 'IMG') {
        box.classList.remove('is-open');
        document.body.style.overflow = '';
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        box.classList.remove('is-open');
        document.body.style.overflow = '';
      }
    });
    return box;
  }

  function enhanceImages() {
    var box = ensureLightbox();
    var boxImg = box.querySelector('img');
    document.querySelectorAll('.article .content img:not(.no-lightbox)').forEach(function (img) {
      if (img.dataset.lightboxReady) {
        return;
      }
      img.dataset.lightboxReady = 'true';
      img.addEventListener('click', function () {
        boxImg.src = img.currentSrc || img.src;
        boxImg.alt = img.alt || '';
        box.classList.add('is-open');
        document.body.style.overflow = 'hidden';
      });
    });
  }

  function enhanceSearch() {
    var searchButton = document.querySelector('.navbar-item.search');
    if (searchButton && !searchButton.dataset.labelReady) {
      searchButton.dataset.labelReady = 'true';
      searchButton.setAttribute('aria-label', '搜索文章');
    }

    var input = document.querySelector('.searchbox-input');
    if (input && !input.dataset.placeholderReady) {
      input.dataset.placeholderReady = 'true';
      input.setAttribute('placeholder', '搜索文章、标签或分类');
    }

    var body = document.querySelector('.searchbox-body');
    if (body && !body.querySelector('.searchbox-empty-hint')) {
      var hint = document.createElement('div');
      hint.className = 'searchbox-empty-hint';
      hint.textContent = '输入关键词，快速定位文章、标签和分类。';
      body.appendChild(hint);
    }

    document.querySelectorAll('.searchbox-result-item').forEach(function (item) {
      item.setAttribute('title', item.textContent.trim());
    });
  }

  function revealElements() {
    if (reduceMotion) {
      return;
    }
    document.documentElement.classList.add('reveal-ready');
    var items = document.querySelectorAll('.blog-article-card, .post-navigation');
    if (!('IntersectionObserver' in window)) {
      items.forEach(function (item) {
        item.classList.add('is-visible');
      });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    items.forEach(function (item) {
      observer.observe(item);
    });
  }

  function addExternalLinkLabels() {
    document.querySelectorAll('.article .content a[href^="http"]').forEach(function (link) {
      if (link.hostname && link.hostname !== window.location.hostname) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener');
      }
    });
  }

  function init() {
    ensureProgressBar();
    updateProgress();
    enhanceHeadings();
    enhanceImages();
    enhanceSearch();
    revealElements();
    addExternalLinkLabels();
  }

  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress);
  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('pjax:success', init);
  document.addEventListener('click', function () {
    window.setTimeout(enhanceSearch, 60);
  });
})();
