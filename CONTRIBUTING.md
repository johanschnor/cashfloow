# Contributing

Thanks for helping.

- **Bugs and ideas:** Open an issue. Describe what you asked, what you got and what you expected. Never paste real accounting data or tokens; use the sample data or e-conomic's demo account.
- **Code:** No external libraries for calculations; statistics live in `lib/stats.js`. Code comments are in English.
- **Both languages:** Every text a user or Claude sees exists in Danish and English. Write sentences with `tr(danish, english)` from `lib/i18n.js`. Field names in answers are built in Danish and translated in `KEYS` in `lib/i18n.js`; add new ones there. Tools are registered with `reg()` from `lib/register.js` with both names. The test fails if a field name is left untranslated.
- **New analyses:** Build a situation into the sample data (`lib/sample.js`, `lib/sample-inventory.js`) that the method should find, and add a test in `test/mcp.test.mjs` that checks it. That way everyone can see the method works.
- **Before a pull request:** `npm test` must pass.

*På dansk:* Fejl og forslag som issues, aldrig med rigtige regnskabsdata eller tokens. Al tekst findes på dansk og engelsk via `tr()`, og `npm test` skal bestå.
