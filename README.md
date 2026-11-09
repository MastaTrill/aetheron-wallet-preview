# Aetheron isolated wallet acceptance preview

This repository publishes a **QA-only** Aetheron website build at https://mastatrill.github.io/aetheron-wallet-preview/ from the exact `MastaTrill/Aetheron_platform` source commit `9ee3085af19cc0273d4c19b37ca81ddb7681e984`.

The site footer now targets the full `dashboard-enhanced.html` page instead of the legacy `dashboard.html` Sentinel widget fragment. The source's complete test suite includes `dashboard-navigation.test.mjs`, and the Pages publish workflow checks the built dashboard target before deploying.

The on-demand `qa-preview-audit.yml` checks deployed assets, screenshots, mobile Lighthouse, and **synthetic** wallet scenarios for cancellation, refused Base network switching, and approval/disconnect/reconnect. Synthetic checks do not replace physical MetaMask consent tests. The original `mastatrill.github.io` site permission remains under the user's control; do not revoke it to manufacture a first-connection test. Do not bypass MetaMask warnings for other preview origins.

**Release HOLD:** This preview does not publish to `aetrs.com`, merge Mainnet contracts, activate trading or liquidity, or authorize transactions, token spending, or wallet signatures.
