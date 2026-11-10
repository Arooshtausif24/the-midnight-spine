# The Midnight Spine — Product requirements

- The homepage prominently lets readers search the no-auth Open Library Search API by title.

- Open Library discovery requests up to 40 book records and displays title, author name(s), first publish year, publisher, and Cover API artwork when available, with a styled placeholder when no cover exists.

- Search results can be added to My TBR, duplicate additions are prevented, and the dashboard count plus next-read picker update immediately using local browser state.

- The TBR view continues to support shelf search, status filters, reading progress, completed books, and review actions.

- The reading log includes All read, Reviewed, and Needs review filters. A book is reviewed when it has a rating or note, and completed books retain an Edit review action.

- API errors and public quota limits show a clear retry message instead of failing silently.

- The visual system uses the final Nightshade and dusty-rose palette with dark typography, lightweight ambient effects, responsive layout, and reduced-motion support.

- The interface uses transparent, fluid surfaces with subtle ambient gradients, depth, hover/focus feedback, and purposeful page transitions without obscuring readable content.

- The first paint includes an accessible loading screen that exits automatically after the initial app render and never blocks the reading experience afterward.

- Layouts and controls remain usable across desktop, tablet, and mobile widths; touch targets are comfortable on phones, expensive blur/ambient effects are reduced on slower or narrow devices, and reduced-motion preferences disable nonessential animation.

- The site is published as a static website so the delivered public URL is not the preview-only Manus watermark experience.
- Book actions live in a "More options" menu (start, progress, finish, review, edit, remove). Nothing is removed directly; removing a book or goal always asks for confirmation first.

- Clicking any book (shelf, reading, reading log, shelf strip, next-read pick, search result) opens a full-page book view with cover, details, description, average rating with a breakdown, and reader reviews below. Open Library supplies the description and star ratings; reader review text is preview content until a reviews backend exists.

## Update — performance, navigation and goals

- Manual "Add a book" / "Log a book" entry points are removed. Books are added only from Open Library search results. "Edit details" remains for books already on the shelf.
- Search results can always be dismissed: "← Back to Today" (home), "Clear results" (TBR), and the browser/phone Back button. Opening a book and going back returns to the same results.
- Book pages and main views use the History API, so the browser/phone Back button works throughout the app.
- Goals no longer use a dialog. An inline goal setter reads "I want to read N books by <date>" (stepper, quick picks 12/24/36/52, end-of-year shortcuts), shows the pace needed, and updates the featured goal and the dashboard challenge card. Only books finished inside the goal's date range count toward it.
- Cancel and × buttons in every dialog are plain closers (they never run the save handler); clicking the dimmed backdrop also closes a dialog.
- Performance: only the visible view is re-rendered (others refresh when opened); search results are cached for the session; cover images are applied only when they change; smooth-scroll on every tab switch is removed; modal backdrop blur is removed; the loading screen exits right after the first render instead of waiting a fixed 2 seconds.
