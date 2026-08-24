# Chrome S26 Debug Handoff

## Problem Summary

A Google Apps Script web app that previously worked well in Chrome on a Samsung Galaxy S21 now intermittently becomes unresponsive on a Samsung Galaxy S26.

The same deployed app works correctly on a laptop.

The problem appears to be specific to Chrome on the S26 rather than a general failure of the web app.

## Observed Behavior

- The app initially loads and can work normally.
- At some point, interaction inside the web app becomes unreliable or stops.
- Taps inside the page stop responding.
- Scrolling can also stop working or become intermittent.
- Chrome itself remains responsive.
- The problem also occurs in Chrome Incognito mode.
- Samsung Internet works correctly with the same deployed app.
- Rotating the phone from portrait to landscape and then back to portrait restores correct behavior.
- A display/orientation change therefore appears to force Chrome to recover.
- The fact that the application works normally at least some of the time strongly suggests that JavaScript is loading and executing; this does not look like a simple case of JavaScript being disabled.

## Important Comparison

| Environment | Result |
|---|---|
| Samsung Galaxy S26 + Chrome | Intermittent freeze / touch and scrolling failure |
| Samsung Galaxy S26 + Chrome Incognito | Same problem |
| Samsung Galaxy S26 + Samsung Internet | Works correctly |
| Laptop browser | Works correctly |
| S21 + Chrome (historically) | Worked correctly |

This comparison points toward a Chrome/S26 rendering, compositor, viewport, event-handling, or browser-specific issue.

## Particularly Strong Clue

Changing screen orientation fixes the problem.

That action typically causes the browser to recalculate some combination of:

- viewport dimensions
- layout
- visual viewport
- compositing layers
- paint state
- hit-test regions
- scroll containers

Because an orientation change restores touch and scrolling without reloading the application, investigate Chrome rendering/layout state before assuming that application logic has hung.

## Working Hypotheses

### 1. Chrome compositor / rendering bug

A Chrome or Chromium issue on the S26 may leave a composited layer visually present but with incorrect hit-testing or scrolling state.

This is especially plausible because:

- Chrome itself does not freeze.
- Samsung Internet works.
- Orientation change repairs the page.
- Both taps and scrolling are affected.

### 2. Invisible or misplaced overlay

A transparent or invisible DOM element may occasionally cover much of the viewport and intercept touch events.

Potential causes include:

- loading overlays
- modal backdrops
- full-screen divs
- elements with `position: fixed`
- unexpectedly large elements
- high `z-index` elements
- pseudo-elements
- stale UI blockers that are visually transparent

Orientation-induced layout recalculation might reposition or remove the effective obstruction.

### 3. Fixed/sticky element + mobile viewport interaction

Look closely at elements using:

```css
position: fixed;
position: sticky;
height: 100vh;
height: 100dvh;
overflow: hidden;
overflow: auto;
```

Also inspect any JavaScript that explicitly calculates viewport height or element size.

### 4. Touch / pointer event handling

Check for handlers involving:

```javascript
touchstart
touchmove
touchend
pointerdown
pointermove
pointerup
preventDefault()
```

Also inspect CSS such as:

```css
touch-action
pointer-events
overscroll-behavior
```

An event handler may occasionally leave the page in a state where native scrolling or hit testing is suppressed.

### 5. Scroll locking that is not released

Search for code that changes:

```javascript
document.body.style.overflow
document.documentElement.style.overflow
```

or applies classes that contain:

```css
overflow: hidden;
```

A modal, menu, spinner, or asynchronous operation may lock scrolling and occasionally fail to restore it.

This would not fully explain all tap failures unless an overlay is also involved, but the two mechanisms often occur together.

## Recommended Debugging Order

### Step 1 — Search for viewport-sized overlays

In the source tree, search for:

```text
position: fixed
position: absolute
z-index
pointer-events
100vh
100dvh
inset: 0
top: 0
left: 0
loading
spinner
overlay
modal
backdrop
```

Identify anything capable of occupying most or all of the screen.

### Step 2 — Inspect scroll locking

Search for:

```text
overflow = 'hidden'
overflow:hidden
classList.add
classList.remove
preventDefault
```

Pay particular attention to code executed during:

- data loading
- dialogs
- menus
- navigation
- asynchronous Google Apps Script calls

### Step 3 — Add a temporary visual overlay detector

When the problem occurs, it would be useful to identify the element Chrome believes is under the user's finger.

A temporary debugging function can log or display:

```javascript
document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
```

A stronger diagnostic version could show the element under several screen coordinates.

If an unexpected full-screen element is returned while the app is frozen, that would strongly identify the problem.

### Step 4 — Log viewport information

Capture:

```javascript
window.innerWidth
window.innerHeight
window.visualViewport?.width
window.visualViewport?.height
window.scrollX
window.scrollY
document.documentElement.clientWidth
document.documentElement.clientHeight
```

Log these:

1. when the app is behaving normally,
2. while it is frozen,
3. immediately after rotating the phone and restoring functionality.

A meaningful change may expose a viewport/layout problem.

### Step 5 — Test a forced reflow

Because orientation change fixes the issue, test whether a smaller forced layout operation also fixes it.

Examples to try manually in a debugging build:

```javascript
window.dispatchEvent(new Event('resize'));
```

or:

```javascript
document.body.getBoundingClientRect();
```

If a resize event repairs the UI, investigate resize-dependent layout code.

If forcing layout/paint repairs it, a Chrome rendering/compositor bug becomes more likely.

## Useful Diagnostic Code

### Find the element currently receiving hit tests

```javascript
function debugHitTest() {
  const points = [
    [window.innerWidth / 2, window.innerHeight / 2],
    [20, 20],
    [window.innerWidth - 20, 20],
    [20, window.innerHeight - 20],
    [window.innerWidth - 20, window.innerHeight - 20]
  ];

  return points.map(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return {
      x,
      y,
      tag: el?.tagName,
      id: el?.id,
      className: el?.className
    };
  });
}
```

When the page fails, compare the result with the normal state.

### Dump visible fixed-position elements

```javascript
function debugFixedElements() {
  return [...document.querySelectorAll('*')]
    .filter(el => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();

      return (
        s.position === 'fixed' &&
        s.display !== 'none' &&
        s.visibility !== 'hidden' &&
        r.width > 0 &&
        r.height > 0
      );
    })
    .map(el => ({
      tag: el.tagName,
      id: el.id,
      className: el.className,
      zIndex: getComputedStyle(el).zIndex,
      rect: el.getBoundingClientRect().toJSON()
    }));
}
```

### Dump viewport state

```javascript
function debugViewport() {
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    visualViewport: window.visualViewport
      ? {
          width: window.visualViewport.width,
          height: window.visualViewport.height,
          offsetLeft: window.visualViewport.offsetLeft,
          offsetTop: window.visualViewport.offsetTop,
          scale: window.visualViewport.scale
        }
      : null
  };
}
```

## Things That Are Probably Lower Priority

Given the current evidence, do not start by assuming:

- JavaScript is disabled.
- Google Apps Script itself is failing globally.
- Network communication is the primary issue.
- The application's business logic has completely hung.
- The phone's touchscreen is defective.

Those explanations fit the observations less well than a Chrome-specific rendering or event-layer problem.

## Current Best Direction

The highest-value investigation is:

1. Look for a transparent/full-screen overlay or stale scroll lock.
2. Inspect `position: fixed`, `100vh`, viewport-dependent sizing, and high-z-index elements.
3. Use `elementFromPoint()` during failure to determine what Chrome thinks is receiving touch events.
4. Compare viewport state before and after the orientation-change recovery.
5. If the DOM is correct while hit-testing is wrong, treat this increasingly as a Chrome/S26 compositor or rendering bug.

## Goal for the Next Session

Use the source code in VS Code to identify any element or state capable of blocking the viewport, then add the smallest possible instrumentation needed to capture the page state when the S26/Chrome failure occurs.

The key diagnostic fact to preserve is:

> **Chrome on the S26 loses page touch/scroll interaction, while Chrome itself remains responsive; Samsung Internet works; rotating the phone restores the page immediately.**
