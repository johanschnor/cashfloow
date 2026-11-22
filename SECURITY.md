# Sikkerhed

Regnskab MCP kører lokalt og læser regnskabsdata med de e-conomic-tokens, du selv giver den. Den gemmer intet på disk, skriver aldrig til e-conomic og sender kun data til den MCP-klient, der har startet den.

**Meld et sikkerhedshul:** Brug GitHubs "Report a vulnerability" under fanen Security i repoet. Opret ikke et offentligt issue for sikkerhedshuller.

**Dine tokens:** `ECONOMIC_APP_SECRET_TOKEN` og `ECONOMIC_AGREEMENT_GRANT_TOKEN` giver læseadgang til dit regnskab. Læg dem kun i `.env` eller i din Claude-konfiguration, aldrig i kode, issues eller pull requests. Mistænker du, at de er lækket, så tilbagekald appens adgang i e-conomic og opret nye.
