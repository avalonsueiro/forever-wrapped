/* Page 09: your happiest day. The same page as page 08 (your saddest day) with a smile instead of a
   frown; both are built by moodDaySlide in 08-saddest-day.js so they always match.
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */
defineSlide("happiest-day", () => moodDaySlide("happy"));
