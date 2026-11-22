# Bidrag

Tak fordi du vil hjælpe.

- **Fejl og ønsker:** Opret et issue. Beskriv hvad du spurgte om, hvad du fik, og hvad du forventede. Indsæt aldrig rigtige regnskabsdata eller tokens; brug eksempeldata eller e-conomics demokonto.
- **Kode:** Ingen eksterne biblioteker til beregninger; statistik ligger i `lib/stats.js`. Værktøjernes navne, beskrivelser og svar er på dansk; kommentarer i koden på engelsk.
- **Nye analyser:** Læg en situation ind i eksempeldata (`lib/sample.js`, `lib/sample-inventory.js`), som metoden skal finde, og en test i `test/mcp.test.mjs`, der tjekker det. Så kan alle se, at metoden virker.
- **Før pull request:** `npm test` skal bestå.
