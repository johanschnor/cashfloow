# Security

Cashfloow runs locally and reads accounting data with the e-conomic tokens you give it. It stores nothing on disk, never writes to e-conomic and only sends data to the MCP client that started it.

**Report a vulnerability:** Use GitHub's "Report a vulnerability" under the Security tab of the repository. Do not open a public issue for security problems.

**Your tokens:** `ECONOMIC_APP_SECRET_TOKEN` and `ECONOMIC_AGREEMENT_GRANT_TOKEN` give read access to your accounts. Only put them in `.env` or your Claude configuration, never in code, issues or pull requests. If you suspect they have leaked, revoke the app's access in e-conomic and create new ones.

*På dansk:* Meld sikkerhedshuller via "Report a vulnerability" under fanen Security, ikke i et offentligt issue. Læg kun dine tokens i `.env` eller Claude-konfigurationen.
