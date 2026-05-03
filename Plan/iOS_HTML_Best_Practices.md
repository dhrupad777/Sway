# iOS/Safari HTML Development Best Practices

This reference guide documents the design patterns required to ensure HTML/CSS components render flawlessly on iPhone (Safari), mitigating common bugs like elements stuck at `opacity: 0`, dropped pseudo-elements, and aggressive background-script pausing.

---

## 1. The Core Bulletproof Viewport
To ensure iPhones mathematically calculate the width correctly and fill screen notches ("dynamic island"), you must use:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
```

## 2. Typography & Smoothing
iPhones have advanced Retina displays that can sometimes render web fonts too heavily. Enforce font-smoothing and lock adjusting text sizes manually:
```css
html {
  -webkit-text-size-adjust: 100%; /* Prevents iOS from randomly resizing text in landscape */
}

body {
  font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  -webkit-font-smoothing: antialiased; /* Crisp, premium text rendering */
}
```

## 3. The `opacity: 0` Scroll Bug (Crucial)
**The Problem:** iOS Safari pauses execution of heavy scripts, Canvas renders, and `IntersectionObserver` callbacks when scrolling fast or when the battery is low. If you set an element to `opacity: 0` in CSS, expecting JavaScript to add a `.reveal` class later, the JS might never fire, leaving your user with a blank white screen.

**The Solution:** Do not rely on JS to un-hide essential content. Either:
1. Load everything natively visible (`opacity: 1`) globally.
2. Use CSS keyframes starting from 0 opacity on initial load natively.
3. If you MUST use scroll-reveal, employ a `setTimeout` fallback or set your initial state such that if JS breaks, everything is still readable.

## 4. Animation Webkit Prefixes 
Safari often drops complex multi-dimensional animations unless explicitly prefixed and Hardware-Accelerated (using the Z-axis).

**Bad:**
```css
.card {
  transition: opacity 0.8s ease, transform 0.8s ease;
  transform: translateY(30px);
}
```

**Good (Bulletproof):**
```css
.card {
  transition: opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1);
  -webkit-transition: opacity 0.8s, -webkit-transform 0.8s;

  transform: translateY(30px);
  -webkit-transform: translateY(30px);
}
```

## 5. Disappearing Pseudo-Elements
Sometimes, `::before` or `::after` content disappears on mobile Safari when absolute positioning is mixed with transitions. Ensure they are treated as block-level structural DOM elements:
```css
.card::after {
  content: '';
  display: block; /* Mandatory on iOS when absolutely positioning empty boxes */
  position: absolute;
}
```

## 6. Over-aggressive Media Queries
If using grids or complex paddings, ensure `max-width: 600px` tightens horizontal spacing severely. iPhones are ~375px wide. If an internal container forces a width of `380px` via padding, it forces invisible horizontal scroll and breaks centering logic.

**Standard Mobile Wrapper:**
```css
@media (max-width: 600px) {
  body { 
    padding: 30px 16px; /* Tight padding to prevent horizontal bleeds */
    overflow-x: hidden;
  }
}
```

---

> [!TIP]
> **Summary Rule:** When developing for iOS, rely on **statically compiled CSS** for positioning and states as much as possible, rather than JS triggers. Keep animations native (`transition` over `@keyframes`), use `--webkit-` explicit prefixes, and avoid JS-dependent opacity masks. 
