# Mobile Nav Implementation

## Objective
Convert sidebar to a bottom navigation bar on mobile screens (<861px).

## CSS Strategy (in sidebar-modern.css)
Target: `@media (max-width: 860px)`

1.  **Container**: Override `.sidebar` fixed position.
    *   `top: auto`, `bottom: 0`, `left: 0`, `right: 0`, `width: 100%`, `height: 60px` (or slightly more).
    *   `border-radius: 12px 12px 0 0` (top rounded).
    *   `display: flex`, `flex-direction: row`, `justify-content: space-between`, `align-items: center`.
    *   `padding: 0 10px`.

2.  **Navigation Items**:
    *   `.nav-item` needs to stack vertically (Icon on top, text below).
    *   `flex: 1`, `text-align: center`, `padding: 5px`.
    *   Font size smaller (0.8rem).
    *   Hide `.nav-text` if space is too tight? User wants "clara y visible", so maybe small text is better.

3.  **Hiding Unnecessary Elements**:
    *   `.sidebar-header` -> `display: none` (No room/need for logo/close button).
    *   `.nav-separator` -> `display: none`.
    *   `#supportBtn` -> `display: none` (or move to profile menu).

4.  **Profile Section**:
    *   Needs to fit in the row.
    *   `.profile-nav-group` content should be flexed.
    *   The profile image might be too big for a bottom bar. Maybe replace with a generic user icon? Or scale it down very small (24px).

5.  **Main Content Adjustment**:
    *   Add `padding-bottom: 70px` to `.main-content` to prevent content being hidden behind the bar.

## Implementation Steps
Append the new media query block to `public/css/sidebar-modern.css`.
No JS changes required if CSS can handle the layout shift.
